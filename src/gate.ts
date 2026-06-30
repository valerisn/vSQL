// A simple readiness gate. Callers await whenReady() and are released the moment
// the gate opens, so queries issued during startup - or while a reconnect is in
// flight - queue instead of failing, and resolve as soon as the pool is back.
// Kept dependency-free so the queue/release behaviour can be tested directly.
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

  // Reject everyone currently waiting (used when the circuit breaker trips, so a
  // hard-down database fails callers fast instead of hanging them). The gate stays
  // closed; later callers queue again until it opens.
  fail(err: any): void {
    const pending = this.waiters;
    this.waiters = [];
    for (const w of pending) w.reject(err);
  }
}
