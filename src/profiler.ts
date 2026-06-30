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
  }
}

// Collapse whitespace and cap length so a stored slow-query sample stays a short
// one-liner in the profiler output. Kept local so the profiler has no imports.
function summarize(sql: string, max = 200): string {
  const flat = sql.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
