// The shared half of F-S6: the same token bucket as rateLimit.ts, held in one
// Postgres row per key so N API instances spend one allowance rather than N.
//
// The arithmetic lives in punkgrid_rate_limit_take() (010_rate_limit.sql), not
// here, for one reason: elapsed time has to be measured by a clock every instance
// agrees on. Computing it in JavaScript would make the bucket depend on which
// process happened to answer, and clock skew between processes is exactly the
// disagreement this table exists to remove.
//
// A take is one round trip, and a failed round trip is thrown to the caller. A
// limiter that swallowed database errors would silently remove the abuse guard
// while the deployment was already failing every other query, so the failure
// surfaces as the same 500 any other database fault gives.

import type { PgPool } from '../db/client.js';
import { DEFAULT_POLICY, type RateLimitDecision, type RateLimiter } from './rateLimit.js';

export interface PgRateLimitOptions {
  /** Full bucket size — the burst one account may spend across all instances. */
  capacity?: number;
  refillPerMinute?: number;
}

export class PgTokenBucket implements RateLimiter {
  private readonly pool: PgPool;
  private readonly capacity: number;
  private readonly refillPerMinute: number;

  constructor(pool: PgPool, opts: PgRateLimitOptions = {}) {
    this.pool = pool;
    this.capacity = opts.capacity ?? DEFAULT_POLICY.capacity;
    this.refillPerMinute = opts.refillPerMinute ?? DEFAULT_POLICY.refillPerMinute;
  }

  async tryTake(key: string): Promise<RateLimitDecision> {
    const { rows } = await this.pool.query<{ allowed: boolean; remaining: number; retry_after_seconds: number }>(
      'SELECT allowed, remaining, retry_after_seconds FROM punkgrid.punkgrid_rate_limit_take($1, $2, $3)',
      [key, this.capacity, this.refillPerMinute],
    );
    const row = rows[0];
    // No row means the installed function is not the one 010 created: a broken
    // deployment, not a caller's error. http.ts turns it into a bare 500.
    if (!row) throw new Error('punkgrid_rate_limit_take returned no row');
    if (row.allowed) return { allowed: true, remaining: row.remaining };
    return { allowed: false, retryAfterSeconds: row.retry_after_seconds };
  }
}
