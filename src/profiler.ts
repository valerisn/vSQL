export interface SlowEntry {
  sql: string;
  ms: number;
  at: number;
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

export class Profiler {
  count = 0;
  errors = 0;
  cacheHits = 0;
  // Slow-query threshold in ms. Configured from the convar at startup rather
  // than read from the global config on every record(), so the profiler has no
  // hidden dependency and can be exercised in isolation.
  slowMs = 150;
  private totalMs = 0;
  // Latency samples kept in a fixed-size ring buffer. Writing into a slot we
  // overwrite (instead of push + shift) keeps record() O(1) on the hot path
  // once the window fills, rather than O(n) from shifting a growing array.
  private readonly maxSamples = 2000;
  private samples: number[] = [];
  private sampleHead = 0;
  private slow: SlowEntry[] = [];
  // Per-shape aggregates, à la pg_stat_statements: which *kinds* of query cost
  // the most in aggregate, not just which single call was slow. Bounded so a
  // flood of distinct shapes can't grow memory without limit.
  private readonly maxShapes = 1000;
  private shapes = new Map<string, ShapeAgg>();

  configure(slowMs: number): void {
    this.slowMs = slowMs;
  }

  record(sql: string, ms: number): void {
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

  // Drop the shape with the least total time so the heavy hitters survive. Only
  // runs when the shape table is full and a brand-new shape appears.
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

  // The heaviest query shapes by total time consumed - the ones actually worth
  // optimizing, even when each individual call looks fast.
  top(limit = 10): ShapeStat[] {
    return [...this.shapes.entries()]
      .map(([shape, a]) => ({ shape, count: a.count, totalMs: a.totalMs, avgMs: a.totalMs / a.count, maxMs: a.maxMs }))
      .sort((a, b) => b.totalMs - a.totalMs)
      .slice(0, limit);
  }

  recordError(): void {
    this.errors++;
  }

  recordCacheHit(): void {
    this.cacheHits++;
    this.count++;
  }

  private percentile(p: number): number {
    if (this.samples.length === 0) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx];
  }

  stats(): ProfilerStats {
    return {
      count: this.count,
      errors: this.errors,
      cacheHits: this.cacheHits,
      avgMs: this.count ? this.totalMs / this.count : 0,
      p50: this.percentile(50),
      p95: this.percentile(95),
      p99: this.percentile(99),
      slow: [...this.slow].reverse().slice(0, 10)
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
  }
}

// Collapse whitespace and cap length so a stored slow-query sample stays a short
// one-liner in the profiler output. Kept local so the profiler has no imports.
function summarize(sql: string, max = 200): string {
  const flat = sql.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

// Reduce a query to its structural shape by erasing the parts that vary between
// calls - literals, comments, and IN-list lengths - so `WHERE id = 5` and
// `WHERE id = 9` aggregate together. Exported for tests.
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
