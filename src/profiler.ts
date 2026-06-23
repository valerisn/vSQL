import { config } from './config';
import { preview } from './util';

export interface SlowEntry {
  sql: string;
  ms: number;
  at: number;
}

export interface Stats {
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
  private totalMs = 0;
  private samples: number[] = [];
  private readonly maxSamples = 2000;
  private slow: SlowEntry[] = [];

  record(sql: string, ms: number): void {
    this.count++;
    this.totalMs += ms;
    this.samples.push(ms);
    if (this.samples.length > this.maxSamples) this.samples.shift();
    if (ms >= config.slowQueryMs) {
      this.slow.push({ sql: preview(sql), ms, at: Date.now() });
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

  stats(): Stats {
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
    this.slow = [];
  }
}
