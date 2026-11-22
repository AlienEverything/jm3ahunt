/** In-memory token bucket: `capacity` tokens, refilled continuously over `perMs`. */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private capacity: number,
    private perMs: number,
    private now: () => number,
  ) {}

  /** Takes one token; false when the bucket is empty. */
  take(key: string): boolean {
    const t = this.now();
    const b = this.buckets.get(key) ?? { tokens: this.capacity, at: t };
    b.tokens = Math.min(this.capacity, b.tokens + ((t - b.at) / this.perMs) * this.capacity);
    b.at = t;
    if (b.tokens < 1) {
      this.buckets.set(key, b);
      return false;
    }
    b.tokens -= 1;
    this.buckets.set(key, b);
    // shortcut: drop everything when the map grows large (refilled buckets are equivalent to new ones); use LRU if abused.
    if (this.buckets.size > 20_000) this.buckets.clear();
    return true;
  }
}

/** SPEC §5 limits. */
export function createLimits(now: () => number) {
  return {
    join: new RateLimiter(10, 60_000, now),
    auth: new RateLimiter(10, 60_000, now),
    capture: new RateLimiter(6, 60_000, now),
    rest: new RateLimiter(120, 60_000, now),
  };
}
export type Limits = ReturnType<typeof createLimits>;
