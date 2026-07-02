// A readiness gate: callers await whenReady() and are released when it opens, so
// queries during startup or a reconnect queue instead of failing. Dependency-free
// so the queue/release behaviour can be tested on its own.
interface Waiter {
  resolve: () => void;
  reject: (err: any) => void;
}

export class ReadyGate {
  private ready = false;
  private waiters: Waiter[] = [];

  get isReady(): boolean {
    return this.ready;
  }

  whenReady(): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  // Open the gate and release everyone currently waiting. Idempotent.
  open(): void {
    this.ready = true;
    const pending = this.waiters;
    this.waiters = [];
    for (const w of pending) w.resolve();
  }

  // Close the gate so new callers queue again (connection loss / shutdown).
  close(): void {
    this.ready = false;
  }

  // Reject everyone waiting (when the breaker trips, so a hard-down DB fails fast
  // instead of hanging). The gate stays closed; later callers queue again.
  fail(err: any): void {
    const pending = this.waiters;
    this.waiters = [];
    for (const w of pending) w.reject(err);
  }
}
