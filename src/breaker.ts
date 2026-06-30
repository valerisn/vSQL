// A small circuit breaker for the connection lifecycle. Normally vSQL queues
// callers on whenReady() until the pool connects - great for startup and brief
// blips. But if the database is *hard* down, that queue grows without bound and
// every dependent resource hangs. The breaker bounds that: after `threshold`
// consecutive connection failures it "opens", and while open the gate fast-fails
// callers with a clear error instead of queueing them. After `resetMs` it goes
// half-open (one probe is allowed to queue again); a success closes it, another
// failure re-opens it.
//
// Pure and clock-injectable, so the state transitions are testable without
// timers. Disabled when threshold is 0.
export type BreakerState = 'closed' | 'open' | 'half-open';

export class CircuitBreaker {
  threshold = 0; // consecutive failures before opening; 0 disables the breaker
  resetMs = 30_000; // how long it stays open before allowing a probe
  private failures = 0;
  private opened = false;
  private openedAt = 0;
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  configure(threshold: number, resetMs: number): void {
    this.threshold = Math.max(0, threshold);
    this.resetMs = resetMs;
  }

  get enabled(): boolean {
    return this.threshold > 0;
  }

  // A failed connection attempt. Past the threshold it (re)opens the breaker and
  // restarts the cooldown, so it stays open while attempts keep failing.
  onFailure(): void {
    this.failures++;
    if (this.enabled && this.failures >= this.threshold) {
      this.opened = true;
      this.openedAt = this.now();
    }
  }

  // A successful connect closes the breaker and clears the failure count.
  onSuccess(): void {
    this.failures = 0;
    this.opened = false;
    this.openedAt = 0;
  }

  // True only while open *and* inside the cooldown window. Once the window
  // elapses it reports half-open so the next probe is allowed through.
  isOpen(): boolean {
    return this.opened && this.now() - this.openedAt < this.resetMs;
  }

  state(): BreakerState {
    if (!this.opened) return 'closed';
    return this.isOpen() ? 'open' : 'half-open';
  }
}
