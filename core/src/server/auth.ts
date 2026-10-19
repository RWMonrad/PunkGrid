// Authentication port (contract section 11: the actor is never taken from the
// body).
//
// The deployment target is Supabase Auth, where the API gateway exchanges a JWT
// for a subject and a database trigger provisions the user row (ADR-011). That
// integration is not in place, so this sprint ships a self-contained dev port:
// an HMAC-signed bearer token. It is one implementation of `AuthPort`, so
// replacing it touches this file and the wiring script only — not the API, the
// engine, or the tests.

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ID } from '../domain.js';
import { err } from '../errors.js';

export interface Actor {
  userId: ID;
}

export interface AuthPort {
  /** Resolve the caller from request headers, or throw EngineError(401). */
  authenticate(headers: Record<string, string>): Actor | Promise<Actor>;
}

const PREFIX = 'pgd1';
/** Contract section 11 asks for short-lived bearer tokens. Twelve hours is the
 *  longest dev session that still forces a re-issue daily; the real auth stack
 *  issues one-hour access tokens with a refresh flow. */
const DEFAULT_TTL_MS = 12 * 3600_000;

export interface DevTokenPayload {
  sub: ID;
  /** Expiry as epoch milliseconds. Required: a token that cannot expire is a
   *  permanent credential in a bearer header. */
  exp: number;
}

/** A secret below this length is a mistake, not a key — refuse to start rather
 *  than run an alpha on a guessable signature. */
export const MIN_SECRET_LENGTH = 32;

export function issueDevToken(secret: string, userId: ID, opts: { ttlMs?: number; now?: number } = {}): string {
  assertSecret(secret);
  const now = opts.now ?? Date.now();
  const payload = b64(JSON.stringify({ sub: userId, exp: now + (opts.ttlMs ?? DEFAULT_TTL_MS) } satisfies DevTokenPayload));
  return `${PREFIX}.${payload}.${sign(secret, `${PREFIX}.${payload}`)}`;
}

export class HmacDevAuth implements AuthPort {
  constructor(private readonly secret: string) {
    assertSecret(secret);
  }

  /** Milliseconds the caller may be ahead of the server clock and still have a
   *  fresh token; guards a skewed test host, not a real clock drift. */
  private static readonly clockSkewMs = 60_000;

  authenticate(headers: Record<string, string>): Actor {
    const raw = headers['authorization'];
    if (!raw || !raw.toLowerCase().startsWith('bearer ')) throw err.unauthenticated('Bearer token required');
    const token = raw.slice(7).trim();
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== PREFIX || !parts[1] || !parts[2]) {
      throw err.unauthenticated('Malformed token');
    }
    const expected = sign(this.secret, `${parts[0]}.${parts[1]}`);
    const got = parts[2];
    if (expected.length !== got.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(got))) {
      throw err.unauthenticated('Token signature rejected');
    }
    let payload: DevTokenPayload;
    try {
      payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as DevTokenPayload;
    } catch {
      throw err.unauthenticated('Malformed token payload');
    }
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) throw err.unauthenticated('Token has no subject');
    if (typeof payload.exp !== 'number' || payload.exp <= Date.now() - HmacDevAuth.clockSkewMs) {
      throw err.unauthenticated('Token expired');
    }
    return { userId: payload.sub };
  }
}

function assertSecret(secret: string): void {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`Dev token secret must be at least ${MIN_SECRET_LENGTH} characters — generate one with: openssl rand -hex 32`);
  }
}

function b64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function sign(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}
