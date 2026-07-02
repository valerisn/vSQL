export interface SlowEntry {
  sql: string;
  ms: number;
  at: number;
}

/** Aggregated query activity for a single calling resource. */
export interface ResourceStat {
  resource: string;
  count: number;
  totalMs: number;
  avgMs: number;
  errors: number;
}

export interface ProfilerStats {
  count: number;
  errors: number;
  cacheHits: number;
  avgMs: number;
  p50: number;
  p95: number;
  p99: number;
  slow: SlowEntry[];
  byResource: ResourceStat[];
  /** Queries currently in flight (executing or waiting for a pool connection). */
  inFlight: number;
  /** Highest concurrent in-flight count seen; compare to the pool size for saturation. */
  peakInFlight: number;
}

/** One aggregated query *shape* - all calls that differ only by literal values. */
export interface ShapeStat {
  shape: string;
  count: number;
  totalMs: number;
  avgMs: number;
  maxMs: number;
}

interface ShapeAgg {
  count: number;
  totalMs: number;
  maxMs: number;
}

interface ResourceAgg {
  count: number;
  totalMs: number;
  errors: number;
}

export class Profiler {
  count = 0;
  errors = 0;
  cacheHits = 0;
  // When peakInFlight runs well past the pool size, queries are queueing for a
  // connection - that's the latency cliff under load.
  inFlight = 0;
  peakInFlight = 0;
  // Set from the convar at startup, not read from global config per record(), so
  // the profiler stays a self-contained leaf we can test in isolation.
  slowMs = 150;
  private totalMs = 0;
  // Latency samples in a ring buffer - overwrite in place instead of push+shift,
  // so record() stays O(1) once the window fills.
  private readonly maxSamples = 2000;
  private samples: number[] = [];
  private sampleHead = 0;
  private slow: SlowEntry[] = [];
  // pg_stat_statements-style: which *kinds* of query cost the most overall, not
  // just which single call was slow. Bounded so a flood of shapes can't leak.
  private readonly maxShapes = 1000;
  private shapes = new Map<string, ShapeAgg>();
  // Same idea per calling resource - who's actually driving the database.
  private readonly maxResources = 256;
  private resources = new Map<string, ResourceAgg>();

  configure(slowMs: number): void {
    this.slowMs = slowMs;
  }

  record(sql: string, ms: number, resource?: string): void {
    this.count++;
    this.totalMs += ms;
    if (this.samples.length < this.maxSamples) {
      this.samples.push(ms);
    } else {
      this.samples[this.sampleHead] = ms;
      this.sampleHead = (this.sampleHead + 1) % this.maxSamples;
    }
    if (ms >= this.slowMs) {
      this.slow.push({ sql: summarize(sql), ms, at: Date.now() });
      if (this.slow.length > 50) this.slow.shift();
    }
    this.recordShape(sql, ms);
    if (resource) {
      const agg = this.resourceAgg(resource);
      agg.count++;
      agg.totalMs += ms;
    }
  }

  private recordShape(sql: string, ms: number): void {
    const shape = normalizeShape(sql);
    const agg = this.shapes.get(shape);
    if (agg) {
      agg.count++;
      agg.totalMs += ms;
      if (ms > agg.maxMs) agg.maxMs = ms;
      return;
    }
    if (this.shapes.size >= this.maxShapes) this.evictLightestShape();
    this.shapes.set(shape, { count: 1, totalMs: ms, maxMs: ms });
  }

  // Evict the cheapest shape so the heavy hitters survive. Only when the table's
  // full and a new shape shows up.
  private evictLightestShape(): void {
    let lightestKey: string | undefined;
    let lightest = Infinity;
    for (const [key, agg] of this.shapes) {
      if (agg.totalMs < lightest) {
        lightest = agg.totalMs;
        lightestKey = key;
      }
    }
    if (lightestKey !== undefined) this.shapes.delete(lightestKey);
  }

  // Heaviest shapes by total time - the ones worth optimizing, even when each
  // individual call looks fast.
  top(limit = 10): ShapeStat[] {
    return [...this.shapes.entries()]
      .map(([shape, a]) => ({ shape, count: a.count, totalMs: a.totalMs, avgMs: a.totalMs / a.count, maxMs: a.maxMs }))
      .sort((a, b) => b.totalMs - a.totalMs)
      .slice(0, limit);
  }

  // Get or lazily create the aggregate for a resource, evicting if full.
  private resourceAgg(resource: string): ResourceAgg {
    let agg = this.resources.get(resource);
    if (!agg) {
      if (this.resources.size >= this.maxResources) this.evictLightestResource();
      agg = { count: 0, totalMs: 0, errors: 0 };
      this.resources.set(resource, agg);
    }
    return agg;
  }

  private evictLightestResource(): void {
    let lightestKey: string | undefined;
    let lightest = Infinity;
    for (const [key, agg] of this.resources) {
      if (agg.totalMs < lightest) {
        lightest = agg.totalMs;
        lightestKey = key;
      }
    }
    if (lightestKey !== undefined) this.resources.delete(lightestKey);
  }

  // Activity per resource, heaviest first.
  byResource(limit = 10): ResourceStat[] {
    return [...this.resources.entries()]
      .map(([resource, a]) => ({
        resource,
        count: a.count,
        totalMs: a.totalMs,
        avgMs: a.count ? a.totalMs / a.count : 0,
        errors: a.errors
      }))
      .sort((a, b) => b.totalMs - a.totalMs)
      .slice(0, limit);
  }

  // Bracket a query - including its wait for a connection - with enter()/leave().
  enter(): void {
    this.inFlight++;
    if (this.inFlight > this.peakInFlight) this.peakInFlight = this.inFlight;
  }

  leave(): void {
    if (this.inFlight > 0) this.inFlight--;
  }

  recordError(resource?: string): void {
    this.errors++;
    if (resource) this.resourceAgg(resource).errors++;
  }

  recordCacheHit(resource?: string): void {
    this.cacheHits++;
    this.count++;
    // Still a query the resource made, it just cost ~no server time.
    if (resource) this.resourceAgg(resource).count++;
  }

  stats(): ProfilerStats {
    // Sort the sample window once and read all three percentiles off it, rather
    // than re-sorting per percentile - stats() can be polled on an interval.
    const sorted = [...this.samples].sort((a, b) => a - b);
    const pct = (p: number): number => {
      if (sorted.length === 0) return 0;
      return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
    };
    return {
      count: this.count,
      errors: this.errors,
      cacheHits: this.cacheHits,
      avgMs: this.count ? this.totalMs / this.count : 0,
      p50: pct(50),
      p95: pct(95),
      p99: pct(99),
      slow: [...this.slow].reverse().slice(0, 10),
      byResource: this.byResource(20),
      inFlight: this.inFlight,
      peakInFlight: this.peakInFlight
    };
  }

  reset(): void {
    this.count = 0;
    this.errors = 0;
    this.cacheHits = 0;
    this.totalMs = 0;
    this.samples = [];
    this.sampleHead = 0;
    this.slow = [];
    this.shapes.clear();
    this.resources.clear();
    // Queries are still running, so keep the live count; just drop the high-water
    // mark back to it.
    this.peakInFlight = this.inFlight;
  }
}

// Flatten to a short one-liner for the slow-query log. Local so the profiler
// keeps zero imports (it's a leaf module).
function summarize(sql: string, max = 200): string {
  const flat = sql.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

// Strip the parts that vary between calls - literals, comments, IN-list length -
// so `WHERE id = 5` and `WHERE id = 9` collapse to one shape. Exported for tests.
export function normalizeShape(sql: string, max = 300): string {
  const flat = sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // block comments
    .replace(/(?:--[ \t][^\n]*|#[^\n]*)/g, ' ') // line comments
    .replace(/'(?:[^'\\]|\\.)*'/g, '?') // single-quoted strings
    .replace(/"(?:[^"\\]|\\.)*"/g, '?') // double-quoted strings
    .replace(/\b\d+(?:\.\d+)?\b/g, '?') // numeric literals
    .replace(/\(\s*\?(?:\s*,\s*\?)*\s*\)/g, '(?)') // collapse (?, ?, ...) lists
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
