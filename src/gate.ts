// A simple readiness gate. Callers await whenReady() and are released the moment
// the gate opens, so queries issued during startup - or while a reconnect is in
// flight - queue instead of failing, and resolve as soon as the pool is back.
// Kept dependency-free so the queue/release behaviour can be tested directly.
export class ReadyGate {
  private ready = false;
  private waiters: Array<() => void> = [];

  get isReady(): boolean {
    return this.ready;
  }

  whenReady(): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  // Open the gate and release everyone currently waiting. Idempotent.
  open(): void {
    this.ready = true;
    const pending = this.waiters;
    this.waiters = [];
    for (const resolve of pending) resolve();
  }

  // Close the gate so new callers queue again (connection loss / shutdown).
  close(): void {
    this.ready = false;
  }
}
