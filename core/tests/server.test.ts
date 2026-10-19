// The HTTP boundary over the in-memory canon: what the transport adds and what
// it must not touch. Routing, idempotency and version semantics are covered in
// api.test.ts; here the questions are the ones only a socket can answer —
// authentication, rate limiting, body limits, request ids, and the status codes
// a client actually branches on. The Postgres request path is exercised in
// pg.test.ts, where the schema wipe and these tests run in one file.

import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, type AppInstance } from '../src/server/app.js';
import { issueDevToken } from '../src/server/auth.js';
import { T0 } from './helpers.js';

const SECRET = 'unit-test-secret-please-never-use-in-a-deployment';
let app: AppInstance | null = null;
let url = '';

async function boot(config: Parameters<typeof buildApp>[0] = { secret: SECRET, seed: 20261011 }): Promise<string> {
  app = buildApp({ ...config, now: () => T0 });
  const server = await app.listen({ port: 0 });
  url = server.url;
  return url;
}

afterEach(async () => {
  if (app) await app.close().catch(() => {});
  app = null;
});

interface Reply {
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

async function call(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  opts: { token?: string; body?: unknown; idempotencyKey?: string; headers?: Record<string, string>; raw?: string } = {},
): Promise<Reply> {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
  const body = opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(url + path, { method, headers, body });
  const text = await res.text();
  return {
    status: res.status,
    body: text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {},
    headers: Object.fromEntries(res.headers.entries()),
  };
}

/** The dev sign-in every client here starts from. */
async function signIn(base: string, userId = 'user_demo'): Promise<string> {
  const res = await fetch(`${base}/dev/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId }) });
  const json = (await res.json()) as { token?: string };
  if (res.status !== 200 || !json.token) throw new Error(`sign-in failed: ${res.status} ${JSON.stringify(json)}`);
  return json.token;
}

describe('HTTP boundary', () => {
  it('answers liveness without an actor and advertises dev sign-in', async () => {
    await boot({ secret: SECRET, seed: 20261011, devUserIds: ['user_demo'] });
    const res = await call('GET', '/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', devAuth: true });

    await boot({ secret: SECRET, seed: 20261011 });
    expect((await call('GET', '/healthz')).body).toEqual({ status: 'ok' });
  });

  it('rejects a missing, forged, expired or malformed token with 401', async () => {
    await boot({ secret: SECRET, seed: 20261011, devUserIds: ['user_demo'] });
    const good = issueDevToken(SECRET, 'user_demo');

    const cases = await Promise.all([
      call('GET', '/v1/worlds'),
      call('GET', '/v1/worlds', { headers: { authorization: 'Basic dXNlcjpwYXNz' } }),
      call('GET', '/v1/worlds', { token: 'not-a-token' }),
      call('GET', '/v1/worlds', { token: forged(good) }),
      call('GET', '/v1/worlds', { token: issueDevToken(SECRET, 'user_demo', { now: Date.now() - 40 * 3600_000 }) }),
      call('GET', '/v1/worlds', { token: issueDevToken('a-different-secret-but-long-enough-xx', 'user_demo') }),
    ]);
    for (const res of cases) {
      expect(res.status).toBe(401);
      expect((res.body.error as { code: string }).code).toBe('UNAUTHENTICATED');
    }
    expect((await call('GET', '/v1/worlds', { token: good })).status).toBe(200);
  });

  it('mints a token only for an account on the allowlist', async () => {
    await boot({ secret: SECRET, seed: 20261011, devUserIds: ['user_demo'] });
    const allowed = await call('POST', '/dev/token', { body: { userId: 'user_demo' } });
    expect(allowed.status).toBe(200);
    expect(typeof allowed.body.token).toBe('string');

    const stranger = await call('POST', '/dev/token', { body: { userId: 'user_intruder' } });
    expect(stranger.status).toBe(403);
    expect((stranger.body.error as { code: string }).code).toBe('WORLD_ACCESS_DENIED');

    await boot({ secret: SECRET, seed: 20261011 });
    expect((await call('POST', '/dev/token', { body: { userId: 'user_demo' } })).status).toBe(404);
  });

  it('creates a world, offers choices and publishes the first episode over sockets', async () => {
    await boot({ secret: SECRET, seed: 20261011, devUserIds: ['user_demo'] });
    const token = await signIn(url);

    const created = await call('POST', '/v1/worlds', { token, body: { mode: 'create', templateId: 'glass-harbor-2034', commandId: 'cmd_http_gen' }, idempotencyKey: 'cmd_http_gen' });
    expect(created.status).toBe(201);
    const worldId = created.body.worldId as string;
    expect(created.body.episodeStatus).toBe('published');

    // Re-sending the same command with the same key replays the stored result
    // instead of creating a second world.
    const replay = await call('POST', '/v1/worlds', { token, body: { mode: 'create', templateId: 'glass-harbor-2034', commandId: 'cmd_http_gen' }, idempotencyKey: 'cmd_http_gen' });
    expect(replay.status).toBe(201);
    expect(replay.body.worldId).toBe(worldId);

    const view = await call('GET', `/v1/worlds/${worldId}`, { token });
    expect(view.status).toBe(200);
    const choices = view.body.choices as { choiceId: string }[];
    expect(choices.length).toBeGreaterThan(0);

    // The identity the world was created with is readable, so a client can name
    // an actor without inventing one (ADR-016).
    const identityId = view.body.identityId as string;
    expect(identityId).toBeTruthy();

    const forgedActor = await call('POST', `/v1/worlds/${worldId}/choices`, {
      token,
      body: { commandId: 'cmd_http_forged', actorIdentityId: 'idn_someone_else', expectedWorldVersion: view.body.stateVersion, choiceId: choices[0]!.choiceId },
      idempotencyKey: 'cmd_http_forged',
    });
    expect(forgedActor.status).toBe(403);

    const staleVersion = await call('POST', `/v1/worlds/${worldId}/choices`, {
      token,
      body: { commandId: 'cmd_http_stale', actorIdentityId: identityId, expectedWorldVersion: 99, choiceId: choices[0]!.choiceId },
      idempotencyKey: 'cmd_http_stale',
    });
    expect(staleVersion.status).toBe(409);
    expect((staleVersion.body.error as { details: { currentVersion: number } }).details.currentVersion).toBe(view.body.stateVersion);

    const acted = await call('POST', `/v1/worlds/${worldId}/choices`, {
      token,
      body: { commandId: 'cmd_http_choice', actorIdentityId: identityId, expectedWorldVersion: view.body.stateVersion, choiceId: choices[0]!.choiceId },
      idempotencyKey: 'cmd_http_choice',
    });
    expect(acted.status).toBe(200);
    expect((acted.body.commandResult as { outcome: string }).outcome).toBe('committed');

    const episodes = await call('GET', `/v1/worlds/${worldId}/episodes?limit=5`, { token });
    expect(episodes.status).toBe(200);
    expect((episodes.body.items as unknown[]).length).toBeGreaterThan(0);
  });

  it('keeps one account inside its own worlds', async () => {
    await boot({ secret: SECRET, seed: 20261011, devUserIds: ['user_a', 'user_b'] });
    const a = await signIn(url, 'user_a');
    const b = await signIn(url, 'user_b');
    const created = await call('POST', '/v1/worlds', { token: a, body: { mode: 'create', templateId: 'glass-harbor-2034', commandId: 'cmd_a' }, idempotencyKey: 'cmd_a' });
    const worldId = created.body.worldId as string;

    expect((await call('GET', `/v1/worlds/${worldId}`, { token: b })).status).toBe(404);
    expect((await call('GET', `/v1/worlds/${worldId}/episodes`, { token: b })).status).toBe(404);
    expect((await call('GET', `/v1/worlds/${worldId}`, { token: a })).status).toBe(200);
    expect(((await call('GET', '/v1/worlds', { token: b })).body.items as unknown[]).length).toBe(0);
  });

  it('answers the transport failures with the contract envelope', async () => {
    await boot({ secret: SECRET, seed: 20261011, devUserIds: ['user_demo'] });
    const token = await signIn(url);

    const noKey = await call('POST', '/v1/worlds', { token, body: { mode: 'create', commandId: 'cmd_x' } });
    expect(noKey.status).toBe(400);
    expect((noKey.body.error as { code: string }).code).toBe('INVALID_SCHEMA');

    const wrongKey = await call('POST', '/v1/worlds', { token, body: { mode: 'create', commandId: 'cmd_x' }, idempotencyKey: 'cmd_y' });
    expect(wrongKey.status).toBe(400);

    const badJson = await call('POST', '/v1/worlds', { token, raw: '{not json', idempotencyKey: 'cmd_x' });
    expect(badJson.status).toBe(400);

    const arrayBody = await call('POST', '/v1/worlds', { token, raw: '[]', idempotencyKey: 'cmd_x' });
    expect(arrayBody.status).toBe(400);

    const tooBig = await call('POST', '/v1/worlds', { token, raw: JSON.stringify({ commandId: 'cmd_big', blob: 'x'.repeat(70 * 1024) }), idempotencyKey: 'cmd_big' });
    expect(tooBig.status).toBe(413);
    expect((tooBig.body.error as { details: { limitBytes: number } }).details.limitBytes).toBe(65536);

    const wrongMethod = await call('PUT', '/v1/worlds', { token });
    expect(wrongMethod.status).toBe(405);
    expect((wrongMethod.body.error as { code: string }).code).toBe('INVALID_SCHEMA');

    const unknownPath = await call('GET', '/v2/worlds', { token });
    expect(unknownPath.status).toBe(404);
    expect((unknownPath.body.error as { code: string }).code).toBe('NOT_FOUND');
  });

  it('propagates the request id and never echoes an unsafe one', async () => {
    await boot({ secret: SECRET, seed: 20261011, devUserIds: ['user_demo'] });
    const kept = await call('GET', '/healthz', { headers: { 'x-request-id': 'req_trace_42' } });
    expect(kept.headers['x-request-id']).toBe('req_trace_42');
    expect(kept.body.requestId).toBeUndefined();

    // A client cannot dictate the shape of a traced id: anything longer than the
    // cap, or containing a space or control byte, is replaced rather than echoed
    // into logs. (A literal CRLF cannot be sent at all — Node refuses to build
    // the request — so the header parser never has to defend against it here.)
    const tooLong = await call('GET', '/healthz', { headers: { 'x-request-id': 'x'.repeat(300) } });
    expect(tooLong.headers['x-request-id']).toMatch(/^req_/);
    const withSpace = await call('GET', '/healthz', { headers: { 'x-request-id': 'req 1' } });
    expect(withSpace.headers['x-request-id']).toMatch(/^req_[0-9a-f-]{8}$/);

    const generated = await call('GET', '/healthz');
    expect(generated.headers['x-request-id']).toMatch(/^req_[0-9a-f-]{8}/);
    expect(generated.headers['cache-control']).toBe('no-store');
  });

  it('limits one account and answers 429 with a retry hint', async () => {
    await boot({ secret: SECRET, seed: 20261011, devUserIds: ['user_demo'], rateLimit: { capacity: 4, refillPerMinute: 1 } });
    const token = await signIn(url);
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await call('GET', '/v1/worlds', { token })).status);
    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses.at(-1)).toBe(429);

    const blocked = await call('GET', '/v1/worlds', { token });
    expect(blocked.headers['retry-after']).toBeTruthy();
    const body = blocked.body.error as { code: string; details: { retryAfterSeconds: number } };
    expect(body.code).toBe('RATE_LIMITED');
    expect(body.details.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('refuses a second world once the free quota is spent, through the same envelope', async () => {
    await boot({ secret: SECRET, seed: 20261011, devUserIds: ['user_demo'] });
    const token = await signIn(url);
    const first = await call('POST', '/v1/worlds', { token, body: { mode: 'create', templateId: 'glass-harbor-2034', commandId: 'cmd_q1' }, idempotencyKey: 'cmd_q1' });
    expect(first.status).toBe(201);
    let last: Reply = first;
    for (let i = 2; i <= 6; i += 1) {
      last = await call('POST', '/v1/worlds', { token, body: { mode: 'create', templateId: 'glass-harbor-2034', commandId: `cmd_q${i}` }, idempotencyKey: `cmd_q${i}` });
      if (last.status === 403) break;
    }
    expect(last.status).toBe(403);
    expect((last.body.error as { code: string }).code).toBe('WORLD_LIMIT_REACHED');
  });
});

/** Same shape as a valid token, wrong signature. */
function forged(token: string): string {
  const parts = token.split('.');
  const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as { sub: string; exp: number };
  payload.sub = 'user_intruder';
  const body = `${parts[0]}.${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}`;
  return `${body}.${parts[2]}`;
}
