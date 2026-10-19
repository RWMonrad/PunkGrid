// The player's journey, in the order the app actually takes it, over real sockets.
//
// Unit files answer one question each; this file asks the one only a sequence can:
// does the flow a customer uses — sign in, open a world, read, decide, wait for
// prose, come back days later, report a scene — hold together when nothing is
// stubbed between the halves? Every step keeps the ids and versions the previous
// response returned, exactly as `apps/mobile/src/lib/play.ts` does, and the bodies
// are the app's own (the shapes `apps/mobile/src/lib/api.test.ts` pins).
//
// Scope, stated plainly: this runs against the in-memory canon in one process,
// where narration settles inside the command. The pending-then-polled shape needs
// the outbox, so it is measured in `core/tests/pg.test.ts` ("over HTTP with the
// outbox worker"), including the two NFR timings in that deployed shape
// (`pg.test.ts:736` and `:767`). That file is also where the Postgres
// truncate-wipe lives — a second file touching the same schema would race it, so
// this one stays DB-free.
//
// The latency assertions are NFR-01 and NFR-02 from Master §6 measured on this
// machine over loopback. They are project requirements, not production evidence:
// a local p95 says nothing about a real deployment, and nothing here should be
// quoted as one. The Postgres block gives the same two numbers with the queue,
// the worker and the shared bucket on the path; both are still loopback, and
// neither replaces a load test or a real narration gateway.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type AppInstance } from '../src/server/app.js';
import { clip } from '../src/moderation.js';

const SECRET = 'e2e-secret-never-use-this-anywhere-real';
const SEED = 20261012;

let app: AppInstance | null = null;
let base = '';

/** Every response this file gets, with the wall-clock cost of the round trip. */
interface Timed {
  status: number;
  body: Record<string, any>;
  headers: Record<string, string>;
  ms: number;
  method: string;
  path: string;
}
const trace: Timed[] = [];

async function call(
  method: 'GET' | 'POST',
  path: string,
  opts: { token?: string; body?: Record<string, unknown>; idempotencyKey?: string } = {},
): Promise<Timed> {
  const headers: Record<string, string> = { 'x-request-id': `req_e2e_${trace.length + 1}` };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const started = performance.now();
  const res = await fetch(base + path, {
    method,
    headers,
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
  const ms = performance.now() - started;
  const text = await res.text();
  const out: Timed = {
    status: res.status,
    body: text.length > 0 ? (JSON.parse(text) as Record<string, any>) : {},
    headers: Object.fromEntries(res.headers.entries()),
    ms,
    method,
    path,
  };
  trace.push(out);
  return out;
}

/** The client's own id discipline: one command id per intent, reused on retry. */
let cmdCounter = 0;
const commandId = (p = 'cmd') => `${p}_e2e_${(++cmdCounter).toString(36).padStart(3, '0')}`;

function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index]!;
}

beforeAll(async () => {
  app = buildApp({
    secret: SECRET,
    seed: SEED,
    devUserIds: ['player_1', 'player_2', 'player_3'],
    // The journey is long and the rate limit is server.test.ts's subject, not this one.
    rateLimit: { capacity: 1000, refillPerMinute: 1000 },
  });
  const server = await app.listen({ port: 0 });
  base = server.url;
});

afterAll(async () => {
  await app?.close().catch(() => {});
  app = null;
});

describe('E2E — one player, one world, the whole route list', () => {
  let token = '';
  let worldId = '';
  let identityId = '';
  let version = 0;
  let firstEpisodeId = '';

  it('signs in through the dev port and reads liveness first', async () => {
    const health = await call('GET', '/healthz');
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('ok');
    expect(health.body.devAuth).toBe(true);

    const signed = await call('POST', '/dev/token', { body: { userId: 'player_1' } });
    expect(signed.status).toBe(200);
    expect(typeof signed.body.token).toBe('string');
    token = String(signed.body.token);

    // A world list on a fresh account is the empty state UI07 shows, not an error.
    const empty = await call('GET', '/v1/worlds', { token });
    expect(empty.status).toBe(200);
    expect(empty.body.items).toEqual([]);
    expect(empty.body.nextCursor).toBeNull();
  });

  it('creates the world the create-screen sends and reads it back as UI07 lists it', async () => {
    const id = commandId('gen');
    const created = await call('POST', '/v1/worlds', {
      token,
      body: { schemaVersion: '1.0', commandId: id, mode: 'create', templateId: 'glass-harbor-2034' },
      idempotencyKey: id,
    });
    expect(created.status).toBe(201);
    worldId = String(created.body.worldId);
    version = Number(created.body.version);
    firstEpisodeId = String(created.body.episodeId);
    expect(created.body.episodeStatus).toBe('published');
    expect(version).toBeGreaterThan(0);

    const listed = await call('GET', '/v1/worlds', { token });
    expect(listed.status).toBe(200);
    const row = listed.body.items[0];
    expect(row.worldId).toBe(worldId);
    // ADR-019: the row carries the template id so the client can print a title
    // rather than `world_…`.
    expect(row.rulepackId).toBe('glass-harbor-2034');
    expect(row.status).toBe('active');
    expect(row.stateVersion).toBe(version);
    identityId = String(row.identityId);
    expect(identityId).toMatch(/^idn_/);
  });

  it('opens on a readable first scene with prose and offered choices', async () => {
    const view = await call('GET', `/v1/worlds/${worldId}`, { token });
    expect(view.status).toBe(200);
    expect(view.body.identityId).toBe(identityId);
    expect(view.body.stateVersion).toBe(version);
    expect(Array.isArray(view.body.choices)).toBe(true);
    expect((view.body.choices as unknown[]).length).toBeGreaterThan(0);
    expect(Object.keys(view.body.summary as object).sort()).toEqual(['arcs', 'resources', 'worldTime']);

    const episode = await call('GET', `/v1/worlds/${worldId}/episodes/${firstEpisodeId}`, { token });
    expect(episode.status).toBe(200);
    expect(episode.body.status).toBe('published');
    expect(String(episode.body.episode.content).length).toBeGreaterThan(40);
    expect(episode.body.episode.worldStateVersion).toBe(version);
    expect(episode.body.episode.validationStatus).toBe('passed');
  });

  it('plays four beats and keeps the canon the only thing that moved', async () => {
    const proseSeen: string[] = [];
    const hashes: string[] = [];
    for (let beat = 0; beat < 4; beat += 1) {
      const view = await call('GET', `/v1/worlds/${worldId}`, { token });
      const choices = view.body.choices as { choiceId: string }[];
      const choiceId = choices[0]!.choiceId;
      const expected = Number(view.body.stateVersion);
      const id = commandId('cho');
      const ack = await call('POST', `/v1/worlds/${worldId}/choices`, {
        token,
        body: { schemaVersion: '1.0', commandId: id, actorIdentityId: identityId, expectedWorldVersion: expected, choiceId },
        idempotencyKey: id,
      });
      expect(ack.status, `beat ${beat}: ${JSON.stringify(ack.body)}`).toBe(200);
      const result = ack.body.commandResult as { newVersion: number; previousVersion: number; stateHash: string; eventIds: string[] };
      expect(result.previousVersion).toBe(expected);
      expect(result.newVersion).toBe(expected + 1);
      version = result.newVersion;
      hashes.push(result.stateHash);

      const polled = await call('GET', `/v1/worlds/${worldId}/episodes/${String(ack.body.episodeId)}`, { token });
      expect(polled.body.status).toBe('published');
      proseSeen.push(String(polled.body.episode.content));
    }
    // Prose is a description of state, never a cause of it: four different scenes,
    // four different state hashes, and none of the prose inside the canonical view.
    expect(new Set(hashes).size).toBe(4);
    expect(new Set(proseSeen).size).toBeGreaterThan(1);
    const view = await call('GET', `/v1/worlds/${worldId}`, { token });
    expect(JSON.stringify(view.body.world)).not.toContain(proseSeen[1]!.slice(0, 24));

    const history = await call('GET', `/v1/worlds/${worldId}/episodes`, { token });
    const items = history.body.items as { fromEventSequence: number; throughEventSequence: number }[];
    expect(items.length).toBe(5);
    expect(history.body.nextCursor).toBeNull();
    for (let i = 1; i < items.length; i += 1) {
      expect(items[i]!.fromEventSequence).toBeGreaterThan(items[i - 1]!.fromEventSequence);
    }
  });

  it('retries the same intent idempotently, the way a dropped response forces it', async () => {
    const view = await call('GET', `/v1/worlds/${worldId}`, { token });
    const id = commandId('dup');
    const body = {
      schemaVersion: '1.0',
      commandId: id,
      actorIdentityId: identityId,
      expectedWorldVersion: Number(view.body.stateVersion),
      choiceId: (view.body.choices as { choiceId: string }[])[0]!.choiceId,
    };
    const first = await call('POST', `/v1/worlds/${worldId}/choices`, { token, body, idempotencyKey: id });
    const second = await call('POST', `/v1/worlds/${worldId}/choices`, { token, body, idempotencyKey: id });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    // NFR-06: the same answer, and not a second set of events. The request id
    // differs because it identifies the attempt, not the intent.
    expect(second.body.commandResult).toEqual(first.body.commandResult);
    expect(second.body.episodeId).toBe(first.body.episodeId);
    expect(second.body.requestId).not.toBe(first.body.requestId);
    expect((second.body.commandResult as { newVersion: number }).newVersion)
      .toBe((first.body.commandResult as { newVersion: number }).newVersion);
    version = (first.body.commandResult as { newVersion: number }).newVersion;
  });

  it('answers a stale decision with 409 and the reload the app performs', async () => {
    const view = await call('GET', `/v1/worlds/${worldId}`, { token });
    const id = commandId('stale');
    const stale = await call('POST', `/v1/worlds/${worldId}/choices`, {
      token,
      body: {
        schemaVersion: '1.0',
        commandId: id,
        actorIdentityId: identityId,
        expectedWorldVersion: Number(view.body.stateVersion) - 1,
        choiceId: (view.body.choices as { choiceId: string }[])[0]!.choiceId,
      },
      idempotencyKey: id,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('WORLD_VERSION_CONFLICT');
    expect(stale.body.error.details.currentVersion).toBe(version);

    const after = await call('GET', `/v1/worlds/${worldId}`, { token });
    expect(after.body.stateVersion).toBe(version);
  });

  it('asks for a surprise and accepts either a scene or the documented no-op', async () => {
    const view = await call('GET', `/v1/worlds/${worldId}`, { token });
    const id = commandId('sur');
    const res = await call('POST', `/v1/worlds/${worldId}/surprises`, {
      token,
      body: { schemaVersion: '1.0', commandId: id, actorIdentityId: identityId, expectedWorldVersion: Number(view.body.stateVersion) },
      idempotencyKey: id,
    });
    expect(res.status).toBe(200);
    const result = res.body.commandResult as { outcome: string; newVersion: number; eventIds: string[] };
    // T15/T16 semantics survive the transport: an ineligible surprise is an
    // explicit no-op, and it still costs a version stamp for the attempt.
    if (result.outcome === 'no_op') expect(result.eventIds).toEqual([]);
    else expect(result.eventIds.length).toBeGreaterThan(0);
    version = result.newVersion;
  });

  it('pauses the world, refuses to act inside it, and resumes it', async () => {
    const view = await call('GET', `/v1/worlds/${worldId}`, { token });
    const pauseId = commandId('pause');
    const paused = await call('POST', `/v1/worlds/${worldId}/pause`, {
      token,
      body: { schemaVersion: '1.0', commandId: pauseId, actorIdentityId: identityId, expectedWorldVersion: Number(view.body.stateVersion) },
      idempotencyKey: pauseId,
    });
    expect(paused.status).toBe(200);
    expect(paused.body.status).toBe('paused');
    version = Number(paused.body.version);

    const reopened = await call('GET', `/v1/worlds/${worldId}`, { token });
    expect((reopened.body.world as { status: string }).status).toBe('paused');

    const tryChoice = commandId('in-pause');
    const refused = await call('POST', `/v1/worlds/${worldId}/choices`, {
      token,
      body: {
        schemaVersion: '1.0',
        commandId: tryChoice,
        actorIdentityId: identityId,
        expectedWorldVersion: version,
        choiceId: (reopened.body.choices as { choiceId: string }[])[0]!.choiceId,
      },
      idempotencyKey: tryChoice,
    });
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe('RULE_PRECONDITION_FAILED');
    expect(refused.body.error.details.ruleCode).toBe('WORLD_PAUSED');

    const resumeId = commandId('resume');
    const resumed = await call('POST', `/v1/worlds/${worldId}/resume`, {
      token,
      body: { schemaVersion: '1.0', commandId: resumeId, actorIdentityId: identityId, expectedWorldVersion: version },
      idempotencyKey: resumeId,
    });
    expect(resumed.status).toBe(200);
    version = (resumed.body.commandResult as { newVersion: number }).newVersion;
    const live = await call('GET', `/v1/worlds/${worldId}`, { token });
    expect((live.body.world as { status: string }).status).toBe('active');
  });

  it('reports a published scene without moving the world, and deduplicates the tap', async () => {
    const episodes = await call('GET', `/v1/worlds/${worldId}/episodes`, { token });
    const episodeId = (episodes.body.items as { id: string }[]).at(-1)!.id;
    const scene = await call('GET', `/v1/worlds/${worldId}/episodes/${episodeId}`, { token });
    const prose = (scene.body.episode as { content: string }).content;
    const before = await call('GET', `/v1/worlds/${worldId}`, { token });
    const reportId = commandId('rpt');
    const reported = await call('POST', `/v1/worlds/${worldId}/episodes/${episodeId}/reports`, {
      token,
      body: { schemaVersion: '1.0', commandId: reportId, actorIdentityId: identityId, reason: 'offensive_language', note: 'reads like an ad' },
      idempotencyKey: reportId,
    });
    expect(reported.status).toBe(201);
    expect(reported.body.status).toBe('open');
    // engine.ts:33 derives the receipt from the last eight characters of the case
    // id, uppercased — base36, so letters belong in it.
    expect(String(reported.body.receipt)).toMatch(/^PG-RPT-[0-9A-Z]{8}$/);

    const again = await call('POST', `/v1/worlds/${worldId}/episodes/${episodeId}/reports`, {
      token,
      body: { schemaVersion: '1.0', commandId: reportId, actorIdentityId: identityId, reason: 'offensive_language', note: 'reads like an ad' },
      idempotencyKey: reportId,
    });
    expect(again.status).toBe(201);
    expect(again.body.status).toBe('duplicate');
    expect(again.body.reportId).toBe(reported.body.reportId);

    // The report is not a world command: no event, no version (ADR-018).
    const after = await call('GET', `/v1/worlds/${worldId}`, { token });
    expect(after.body.stateVersion).toBe(before.body.stateVersion);

    // §15 as moderation.test.ts:256-259 and pg.test.ts:382-384 pin it: the case
    // holds the episode reference plus the bounded fragment, never the readable
    // episode. The exact equality is what says the engine wrote a fragment rather
    // than a copy of the scene.
    const caseRow = app!.engine!.store.moderationCases.get(reportId);
    expect(caseRow).toBeDefined();
    expect(caseRow!.excerpt).toBe(`${episodeId}: ${clip(prose, 180)}`);
    expect(caseRow!.excerpt.length).toBeLessThanOrEqual(260);
    expect(caseRow!.reporterNote!.length).toBeLessThanOrEqual(201);
  });

  it('archives the world, and the archive is terminal but still readable', async () => {
    const id = commandId('arch');
    const archived = await call('POST', `/v1/worlds/${worldId}/archive`, {
      token,
      body: { schemaVersion: '1.0', commandId: id, actorIdentityId: identityId, expectedWorldVersion: version },
      idempotencyKey: id,
    });
    expect(archived.status).toBe(200);
    expect(archived.body.status).toBe('archived');

    const readable = await call('GET', `/v1/worlds/${worldId}`, { token });
    expect(readable.status).toBe(200);
    expect((readable.body.world as { status: string }).status).toBe('archived');

    const tryLater = commandId('after-archive');
    const refused = await call('POST', `/v1/worlds/${worldId}/choices`, {
      token,
      body: {
        schemaVersion: '1.0',
        commandId: tryLater,
        actorIdentityId: identityId,
        expectedWorldVersion: Number(readable.body.stateVersion),
        choiceId: (readable.body.choices as { choiceId: string }[])[0]!.choiceId,
      },
      idempotencyKey: tryLater,
    });
    expect(refused.status).toBe(422);
    expect(refused.body.error.details.ruleCode).toBe('WORLD_ARCHIVED');
  });

  it('runs a second player through the same journey without seeing the first', async () => {
    const other = await call('POST', '/dev/token', { body: { userId: 'player_2' } });
    const otherToken = String(other.body.token);
    const id = commandId('gen2');
    const created = await call('POST', '/v1/worlds', {
      token: otherToken,
      body: { schemaVersion: '1.0', commandId: id, mode: 'surprise' },
      idempotencyKey: id,
    });
    expect(created.status).toBe(201);
    const otherWorld = String(created.body.worldId);

    const own = await call('GET', '/v1/worlds', { token });
    expect((own.body.items as unknown[]).length).toBe(1);
    expect((own.body.items as { worldId: string }[]).some((w) => w.worldId === otherWorld)).toBe(false);

    const peek = await call('GET', `/v1/worlds/${otherWorld}`, { token });
    const ghost = await call('GET', '/v1/worlds/no_such_world', { token });
    // §1.7: not owned and not there are the same answer, so an attacker cannot
    // probe which world ids exist. The requestId names the attempt, not the
    // payload, so it is the one field allowed to differ.
    expect(peek.status).toBe(404);
    expect(ghost.status).toBe(404);
    expect(peek.body.error).toEqual(ghost.body.error);
  });

  it('replays the finished world to the hash the server says it holds', async () => {
    const view = await call('GET', `/v1/worlds/${worldId}`, { token });
    const engine = app!.engine!;
    const stored = engine.store.latestSnapshot(worldId);
    // NFR-04: the state the requests were answered from is the state a replay of
    // the event log rebuilds, and the version the client holds is that version.
    expect(stored.version).toBe(Number(view.body.stateVersion));
    const check = engine.verifyReplay(worldId);
    expect(check.equal, JSON.stringify(check)).toBe(true);
    expect(check.replayedHash).toBe(stored.stateHash);
    expect(stored.lastEventSeq).toBe((view.body.world as { lastEventSequence: number }).lastEventSequence);
  });

  it('keeps every response traceable and answers the whole journey inside NFR-01', () => {
    const gets = trace.filter((t) => t.method === 'GET');
    const misses = trace.filter((t) => t.status >= 500);
    expect(misses, `5xx seen: ${JSON.stringify(misses.map((m) => [m.method, m.path, m.status]))}`).toEqual([]);
    for (const t of trace) expect(t.headers['x-request-id'], t.path).toBeTruthy();

    const p50 = percentile(gets.map((t) => t.ms), 50);
    const p95 = percentile(gets.map((t) => t.ms), 95);
    const max = Math.max(...gets.map((t) => t.ms));
    // NFR-01 is p95 < 500 ms for reads. This is one process on loopback, so the
    // margin is not the point — the number being measured and printed is.
    expect(p95).toBeLessThan(500);
    console.log(
      `e2e latency (local, single process, n=${gets.length} GET): p50=${p50.toFixed(1)}ms ` +
      `p95=${p95.toFixed(1)}ms max=${max.toFixed(1)}ms over ${trace.length} requests`,
    );
  });

  it('settles the first scene inside the NFR-02 window', async () => {
    // A fresh account, because the free plan holds one active world
    // (glassHarbor.ts:11 `freeWorldQuota: 1`) and player_2 already owns one.
    const started = performance.now();
    const fresh = await call('POST', '/dev/token', { body: { userId: 'player_3' } });
    const id = commandId('gen3');
    const created = await call('POST', '/v1/worlds', {
      token: String(fresh.body.token),
      body: { schemaVersion: '1.0', commandId: id, mode: 'create', templateId: 'glass-harbor-2034' },
      idempotencyKey: id,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const episode = await call('GET', `/v1/worlds/${String(created.body.worldId)}/episodes/${String(created.body.episodeId)}`, {
      token: String(fresh.body.token),
    });
    const elapsed = performance.now() - started;
    expect(episode.body.status, JSON.stringify(episode.body)).toBe('published');
    // NFR-02 is p75 < 20 s from commit to published/fallback. Here the in-memory
    // canon narrates inline, so this measures the fastest legal shape; the queued
    // shape is timed in pg.test.ts, and neither is a production number.
    expect(elapsed).toBeLessThan(20_000);
    console.log(`e2e first scene (local, inline narration): ${elapsed.toFixed(1)}ms`);
  });
});
