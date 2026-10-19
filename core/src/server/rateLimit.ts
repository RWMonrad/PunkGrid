// Per-caller token bucket (contract section 11 has RATE_LIMITED; Master NFR
// wants abuse protection on the public edge).
//
// This one lives in the process. That is the right shape for the anonymous,
// pre-auth guard — an unauthenticated request that writes a database row is a
// denial of service the limiter is supposed to prevent. It is the wrong shape for
// the account allowance, because N instances give one account N allowances; that
// bucket is shared through Postgres in pgRateLimit.ts instead (F-S6). A
// single-process deployment has nothing to share, so both guards use this class.

export interface RateLimitOptions {
  /** Full bucket size — the burst a client may spend in one instant. */
  capacity?: number;
  /** Tokens added per minute, continuously. */
  refillPerMinute?: number;
  /** Bucket keys idle for longer than this are dropped, so the map cannot grow
   *  without bound as callers come and go. */
  idleTtlMs?: number;
  now?: () => number;
}

/** The allowance a client gets when the deployment states no policy. Both
 *  limiters start from these numbers, so a one-process server and a shared one
 *  cost the same caller the same amount. */
export const DEFAULT_POLICY = { capacity: 30, refillPerMinute: 30 } as const;

export type RateLimitDecision =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSeconds: number };

/** What the transport needs from a limiter: one take per request per key. Async
 *  because the deployed shape answers from the database; the in-process bucket
 *  resolves on the next microtask. */
export interface RateLimiter {
  tryTake(key: string): Promise<RateLimitDecision>;
}

/** The two guards one request passes: the address bucket answers for a caller the
 *  server does not trust yet, the account bucket for one it does. */
export interface Limiters {
  /** Keyed by the peer address (http.ts decides which address that is), before
   *  authentication. In-process by construction, so its size follows the number of
   *  distinct addresses that connect — which is what idleTtlMs is for. */
  addresses: TokenBucket;
  /** Keyed by account id, after authentication. Shared between instances when a
   *  database is configured (F-S6). */
  accounts: RateLimiter;
}

export class TokenBucket implements RateLimiter {
  private readonly capacity: number;
  private readonly perMs: number;
  private readonly idleTtlMs: number;
  private readonly now: () => number;
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  private lastSweep: number;

  constructor(opts: RateLimitOptions = {}) {
    this.capacity = opts.capacity ?? DEFAULT_POLICY.capacity;
    this.perMs = (opts.refillPerMinute ?? DEFAULT_POLICY.refillPerMinute) / 60_000;
    this.idleTtlMs = opts.idleTtlMs ?? 10 * 60_000;
    this.now = opts.now ?? Date.now;
    this.lastSweep = this.now();
  }

  async tryTake(key: string): Promise<RateLimitDecision> {
    const now = this.now();
    this.sweep(now);
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, at: now };
    const tokens = Math.min(this.capacity, bucket.tokens + (now - bucket.at) * this.perMs);
    if (tokens < 1) {
      bucket.tokens = tokens;
      bucket.at = now;
      this.buckets.set(key, bucket);
      const needed = 1 - tokens;
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(needed / this.perMs / 1000)) };
    }
    this.buckets.set(key, { tokens: tokens - 1, at: now });
    return { allowed: true, remaining: Math.floor(tokens - 1) };
  }

  /** Test hook: how many keys are currently tracked. */
  get size(): number {
    return this.buckets.size;
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < this.idleTtlMs) return;
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.at > this.idleTtlMs) this.buckets.delete(key);
    }
  }
}
