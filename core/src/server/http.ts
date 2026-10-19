// node:http adapter for the normative /v1 boundary (ADR-016).
//
// The transport owns everything that is not a domain decision: request id, size
// limits, the auth port, and rate limiting. Routing, idempotency, version checks
// and the error envelope stay in core/src/api.ts, so one Api object serves the
// in-memory test path and the Postgres path.

import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Api, ApiRequest } from '../api.js';
import type { ID } from '../domain.js';
import { EngineError, err } from '../errors.js';
import { issueDevToken, type Actor, type AuthPort } from './auth.js';
import type { Limiters } from './rateLimit.js';

/** Small bodies only: the API accepts bounded commands, never prose uploads
 *  (contract section 5 keeps world input to a validated template). */
export const MAX_BODY_BYTES = 64 * 1024;

/** An address worth using as a bucket key: IPv4, IPv6 with its colons, or the
 *  `unknown` fallback. Deliberately strict — a header is client input, and a key
 *  that can hold arbitrary text is a way to fill the limiter's map with junk or
 *  forge a log line. */
const ADDRESS = /^[\da-fA-F:.]{1,45}$/;

export interface HttpOptions {
  api: Api;
  auth: AuthPort;
  limiters: Limiters;
  maxBodyBytes?: number;
  /** Read the peer address from `x-forwarded-for` instead of the socket. Set this
   *  only when every request really does arrive through one proxy you control:
   *  with it, the header decides which bucket a caller lands in, and a caller who
   *  can reach the port directly can choose that bucket at will (F-S6). */
  trustProxy?: boolean;
  /** Sign-in minting for the dev auth port (ADR-016). Absent means the route
   *  does not exist at all; present means only these named accounts can obtain a
   *  token. Production uses Supabase Auth and never sets this. */
  devAuth?: { secret: string; userIds: readonly ID[] };
  /** One line per response. The default is silent so tests that deliberately
   *  provoke negatives do not fill the report. */
  log?: (line: string) => void;
}

export interface AppServer {
  server: Server;
  port: number;
  url: string;
  close(): Promise<void>;
}

export function createRequestHandler(opts: HttpOptions): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    handle(opts, req, res).catch((e: unknown) => {
      // Nothing inside handle may throw past this point. If it does, the socket
      // still has to answer.
      if (!res.headersSent) crash(opts, res, requestIdOf(req), e);
      else res.destroy();
    });
  };
}

export async function startAppServer(opts: HttpOptions, listen: { port?: number; host?: string } = {}): Promise<AppServer> {
  const server = createServer(createRequestHandler(opts));
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(listen.port ?? 0, listen.host ?? '127.0.0.1', () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  const host = listen.host ?? '127.0.0.1';
  return {
    server,
    port,
    url: `http://${host}:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

async function handle(opts: HttpOptions, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const requestId = requestIdOf(req);
  const headers = flatHeaders(req);
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  const method = req.method ?? 'GET';
  const peer = peerAddress(req, opts.trustProxy);

  // Liveness is not part of the API contract and takes no actor. It also says
  // whether this instance has dev sign-in, so the app can show the right screen.
  if (path === '/healthz') {
    return respond(opts, res, 200, requestId, { status: 'ok', ...(opts.devAuth ? { devAuth: true } : {}) });
  }

  // Fail fast, before reading a body from an anonymous socket.
  if (method !== 'GET' && method !== 'POST') return reject(opts, res, requestId, err.methodNotAllowed(method, path));
  const byAddress = await opts.limiters.addresses.tryTake(`ip:${peer}`);
  if (!byAddress.allowed) return reject(opts, res, requestId, err.rateLimited(byAddress.retryAfterSeconds));

  if (path === '/dev/token') return mint(opts, res, requestId, req, method);

  if (path !== '/v1' && !path.startsWith('/v1/')) return reject(opts, res, requestId, err.notFound(`No v1 endpoint at ${path}`));

  let actor: Actor;
  try {
    actor = await opts.auth.authenticate(headers);
  } catch (e) {
    return reject(opts, res, requestId, e instanceof EngineError ? e : err.unauthenticated());
  }

  // The client is now known, so its own bucket applies on top of the address
  // bucket: a shared NAT does not starve one account, and one account cannot
  // outrun its allowance by spreading over addresses. With a database this is the
  // bucket the whole deployment shares, so the allowance means one per account and
  // not one per instance (F-S6).
  const byAccount = await opts.limiters.accounts.tryTake(actor.userId);
  if (!byAccount.allowed) return reject(opts, res, requestId, err.rateLimited(byAccount.retryAfterSeconds));

  const parsed = await readRequest(opts, req, { method, path, headers, requestId, actor, query: url.searchParams });
  if ('failure' in parsed) return reject(opts, res, requestId, parsed.failure);

  const response = await opts.api.handle(parsed.request);
  // A pending episode is polled (contract section 7, ADR-006); caching a 202
  // would freeze the client on "pending".
  respond(opts, res, response.status, requestId, response.body, response.status === 202 ? { 'retry-after': '2' } : {});
}

type RequestShape = { method: 'GET' | 'POST'; path: string; headers: Record<string, string>; requestId: string; actor: Actor; query: URLSearchParams };

async function readRequest(
  opts: HttpOptions,
  req: IncomingMessage,
  ctx: RequestShape,
): Promise<{ request: ApiRequest } | { failure: EngineError }> {
  const headers = { ...ctx.headers, 'x-request-id': ctx.requestId };
  if (ctx.method === 'GET') {
    // A GET has no body; its parameters arrive as the query string.
    return { request: { method: 'GET', path: ctx.path, body: Object.fromEntries(ctx.query), headers, actor: ctx.actor } };
  }
  const parsed = await readJson(req, opts.maxBodyBytes ?? MAX_BODY_BYTES);
  if ('failure' in parsed) return { failure: parsed.failure };
  return { request: { method: 'POST', path: ctx.path, body: parsed.body, headers, actor: ctx.actor } };
}

/** Mints a dev token for a named demo account. Two things limit the blast
 *  radius: the route only exists when the process was started with an allowlist,
 *  and it can only name an account already on that list. */
async function mint(opts: HttpOptions, res: ServerResponse, requestId: string, req: IncomingMessage, method: string): Promise<void> {
  if (!opts.devAuth || method !== 'POST') return reject(opts, res, requestId, err.notFound(`No v1 endpoint at ${req.url ?? ''}`));
  const parsed = await readJson(req, 1024);
  if ('failure' in parsed) return reject(opts, res, requestId, parsed.failure);
  const userId = parsed.body.userId;
  if (typeof userId !== 'string' || !opts.devAuth.userIds.includes(userId)) {
    return reject(opts, res, requestId, err.accessDenied('Not a development account'));
  }
  respond(opts, res, 200, requestId, { requestId, userId, token: issueDevToken(opts.devAuth.secret, userId) });
}

async function readJson(req: IncomingMessage, limit: number): Promise<{ body: Record<string, unknown> } | { failure: EngineError }> {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > limit) return { failure: err.payloadTooLarge(limit) };
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) return { failure: err.payloadTooLarge(limit) };
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  let body: unknown;
  try {
    body = raw.length === 0 ? {} : JSON.parse(raw);
  } catch {
    return { failure: err.invalidSchema('Body must be JSON') };
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { failure: err.invalidSchema('Body must be a JSON object') };
  }
  return { body: body as Record<string, unknown> };
}

function reject(opts: HttpOptions, res: ServerResponse, requestId: string, error: EngineError): void {
  const retryAfter = (error.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
  respond(
    opts,
    res,
    error.status,
    requestId,
    { requestId, error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } },
    retryAfter === undefined ? {} : { 'retry-after': String(retryAfter) },
  );
}

/** A fault the engine never produces (a persistence or programming error). The
 *  detail goes to the log, not the client: contract section 15 forbids leaking
 *  storage internals. */
function crash(opts: HttpOptions, res: ServerResponse, requestId: string, cause: unknown): void {
  // `String(error)` drops the properties node-postgres puts on an error, and 23505
  // is the difference between "an id collided" and "something failed" — the log is
  // the only place either reading of it survives.
  const sqlState = (cause as { code?: unknown } | undefined)?.code;
  opts.log?.(`${requestId} 500 fault ${cause instanceof Error ? `${cause.name}: ${cause.message}` : typeof cause}`
    + (typeof sqlState === 'string' ? ` [SQLSTATE ${sqlState}]` : ''));
  respond(opts, res, 500, requestId, { requestId, error: { code: 'INTERNAL_ERROR', message: 'Request failed' } });
}

/** The one place that writes a response: every reply carries the request id,
 *  JSON, a length and a no-store policy. */
function respond(
  opts: HttpOptions,
  res: ServerResponse,
  status: number,
  requestId: string,
  body: Record<string, unknown>,
  extra: Record<string, string> = {},
): void {
  const text = JSON.stringify(body);
  opts.log?.(`${requestId} ${status}`);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'x-request-id': requestId,
    'cache-control': 'no-store',
    ...extra,
  });
  res.end(text);
}

/** The address the pre-auth bucket keys on.
 *
 *  By default that is the socket peer: the only address this process can verify.
 *  With one trusted proxy it becomes the *last* entry of `x-forwarded-for`,
 *  because the proxy appends the peer it saw — a caller that forged
 *  `x-forwarded-for: 203.0.113.9` arrives as `203.0.113.9, <real>`, and the forged
 *  entry is skipped instead of believed. A missing or malformed header falls back
 *  to the socket rather than to a guess.
 */
function peerAddress(req: IncomingMessage, trustProxy: boolean | undefined): string {
  const socket = req.socket.remoteAddress ?? 'unknown';
  if (!trustProxy) return socket;
  const value = req.headers['x-forwarded-for'];
  const list = Array.isArray(value) ? value.join(',') : value;
  const last = list?.split(',').pop()?.trim();
  return last && ADDRESS.test(last) ? last : socket;
}

function requestIdOf(req: IncomingMessage): string {
  const inbound = req.headers['x-request-id'];
  const given = Array.isArray(inbound) ? inbound[0] : inbound;
  // Reuse the caller's id for tracing (contract section 11). The printable-ASCII
  // length cap stops a client filling logs with one enormous identifier or with
  // a newline that forges a log line.
  return given && /^[\x21-\x7e]{1,200}$/.test(given) ? given : `req_${randomUUID().slice(0, 8)}`;
}

function flatHeaders(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') out[name.toLowerCase()] = value;
    else if (Array.isArray(value) && typeof value[0] === 'string') out[name.toLowerCase()] = value[0];
  }
  return out;
}
