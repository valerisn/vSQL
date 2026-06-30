// A health-aware, round-robin set of read replicas. Reads are spread across the
// healthy replicas; when one errors with a connection failure it is taken out of
// rotation for a cooldown and the caller falls back to the primary. Pure and
// generic over the pool type (and clock-injectable), so the selection and health
// logic is testable without real pools.

interface Entry<T> {
  pool: T;
  label: string;
  downUntil: number; // 0 = healthy; otherwise the time it may rejoin
}

export interface ReplicaStatus {
  label: string;
  down: boolean;
}

export class ReplicaSet<T> {
  private entries: Entry<T>[] = [];
  private cursor = 0;
  private cooldownMs = 10_000;
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  configure(cooldownMs: number): void {
    this.cooldownMs = cooldownMs;
  }

  add(pool: T, label: string): void {
    this.entries.push({ pool, label, downUntil: 0 });
  }

  get size(): number {
    return this.entries.length;
  }

  // Next healthy replica in round-robin order, or undefined if there are none
  // (or all are in cooldown). Advances the cursor only when one is handed out.
  next(): T | undefined {
    const n = this.entries.length;
    const t = this.now();
    for (let i = 0; i < n; i++) {
      const idx = (this.cursor + i) % n;
      const e = this.entries[idx];
      if (e.downUntil <= t) {
        this.cursor = (idx + 1) % n;
        return e.pool;
      }
    }
    return undefined;
  }

  // Take a replica out of rotation for the cooldown window (called after a
  // connection failure on it).
  markDown(pool: T): void {
    const e = this.entries.find((x) => x.pool === pool);
    if (e) e.downUntil = this.now() + this.cooldownMs;
  }

  status(): ReplicaStatus[] {
    const t = this.now();
    return this.entries.map((e) => ({ label: e.label, down: e.downUntil > t }));
  }

  all(): T[] {
    return this.entries.map((e) => e.pool);
  }
}
