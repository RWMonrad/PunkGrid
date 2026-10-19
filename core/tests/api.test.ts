import { describe, expect, it } from 'vitest';
import { GLASS_HARBOR } from '../src/glassHarbor.js';
import { CompliantProvider } from '../src/providers.js';
import { Engine } from '../src/engine.js';
import { Api, InMemoryRunner, type ApiRequest } from '../src/api.js';
import { membershipKey } from '../src/store.js';
import type { ID } from '../src/domain.js';
import { cid } from './helpers.js';

const T0 = Date.parse('2026-10-11T12:00:00.000Z');

function harness() {
  const engine = new Engine(GLASS_HARBOR, new CompliantProvider(), { now: () => T0, seed: 20261011 });
  const api = new Api(new InMemoryRunner(engine));
  const owner = engine.registerUser('user_a');
  const intruder = engine.registerUser('user_b');
  return { engine, api, owner, intruder };
}

function post(api: Api, userId: ID, path: string, body: Record<string, unknown>, commandId = cid()) {
  return api.handle({
    method: 'POST',
    path,
    body: { schemaVersion: '1.0', commandId, ...body },
    headers: { 'idempotency-key': commandId, 'x-request-id': 'req_test' },
    actor: { userId },
  });
}

function get(api: Api, userId: ID, path: string, query?: Record<string, string>) {
  // A GET carries its parameters in the query string, which `http.ts` hands the
  // router as the body — so a test that means `?cursor=` says it the same way.
  return api.handle({ method: 'GET', path, ...(query ? { body: query } : {}), headers: {}, actor: { userId } });
}

async function createWorld(api: Api, owner: ID) {
  const res = await post(api, owner, '/v1/worlds', { mode: 'create', templateId: 'glass-harbor-2034' });
  return { res, worldId: res.body.worldId as ID, episodeId: res.body.episodeId as ID };
}

describe('HTTP boundary — contract section 11', () => {
  it('returns 201 with worldId, version and episode for a completed genesis', async () => {
    const { api, owner } = harness();
    const res = await post(api, owner, '/v1/worlds', { mode: 'create', templateId: 'glass-harbor-2034' });
    expect(res.status).toBe(201);
    expect(res.headers['x-request-id']).toBe('req_test');
    expect(res.body.requestId).toBe('req_test');
    expect(res.body.version).toBe(1);
    expect(res.body.episodeStatus).toBe('published');
  });

  it('returns 202 when narration is still pending', async () => {
    const { api, engine, owner } = harness();
    engine.setAutoFlush(false);
    const res = await post(api, owner, '/v1/worlds', { mode: 'create', templateId: 'glass-harbor-2034' });
    expect(res.status).toBe(202);
    expect(res.body.episodeStatus).toBe('pending');
  });

  it('rejects anonymous requests with 401 and mutations without an idempotency key with 400', async () => {
    const { api } = harness();
    const anonymous = await api.handle({ method: 'GET', path: '/v1/worlds' });
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error).toMatchObject({ code: 'UNAUTHENTICATED' });

    const noKey = await api.handle({
      method: 'POST', path: '/v1/worlds', body: { commandId: cid(), mode: 'create', templateId: 'glass-harbor-2034' },
      headers: {}, actor: { userId: 'user_a' },
    });
    expect(noKey.status).toBe(400);
    expect(noKey.body.error).toMatchObject({ code: 'INVALID_SCHEMA' });

    const mismatchedKey = await api.handle({
      method: 'POST', path: '/v1/worlds', body: { commandId: cid(), mode: 'create', templateId: 'glass-harbor-2034' },
      headers: { 'idempotency-key': 'some_other_key' }, actor: { userId: 'user_a' },
    });
    expect(mismatchedKey.status).toBe(400);
  });

  it('answers a non-owner with 404 on reads and writes alike, and never discloses existence', async () => {
    const { api, engine, owner, intruder } = harness();
    const { worldId } = await createWorld(api, owner);

    expect((await get(api, intruder, `/v1/worlds/${worldId}`)).status).toBe(404);
    expect((await get(api, intruder, `/v1/worlds/${worldId}/episodes`)).status).toBe(404);
    expect(((await get(api, intruder, '/v1/worlds')).body.items as unknown[])).toEqual([]);

    // A write to a world you cannot see is answered exactly like a read of it:
    // 403 here would tell the caller the world exists (§14 leakage baseline).
    const write = await post(api, intruder, `/v1/worlds/${worldId}/choices`, { choiceId: 'confront_mara', actorIdentityId: 'idn_x', expectedWorldVersion: 1 });
    expect(write.status).toBe(404);
    expect(write.body.error).toMatchObject({ code: 'NOT_FOUND' });
    expect(engine.store.worlds.get(worldId)!.stateVersion).toBe(1);
  });

  it('serves the whole story through the cursor instead of stopping at twenty', async () => {
    // The play screen takes its newest scene from the end of this list, so a page
    // that ends early without saying so is a world frozen on an old scene — measured
    // on the dev world at version 21, where the route returned episodes 1–20 and
    // `nextCursor: null`, which is the contract's `{items,nextCursor}` only in shape.
    const { engine, api, owner } = harness();
    const { worldId } = await createWorld(api, owner);
    const genesis = [...engine.store.episodes.values()][0]!;
    const scenes = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
    for (const v of scenes(2, 25)) {
      engine.store.episodes.set(`ep_page_${v}`, {
        episode: { ...genesis.episode, id: `ep_page_${v}`, worldId, fromEventSequence: v, throughEventSequence: v, worldStateVersion: v },
        status: 'published',
      });
    }

    const first = await get(api, owner, `/v1/worlds/${worldId}/episodes`, { limit: '20' });
    expect(first.status).toBe(200);
    const head = (first.body.items as { worldStateVersion: number }[]).map((e) => e.worldStateVersion);
    expect(head).toEqual(scenes(1, 20));
    expect(first.body.nextCursor).toBe('20');

    const tail = await get(api, owner, `/v1/worlds/${worldId}/episodes`, { limit: '20', cursor: String(first.body.nextCursor) });
    const rest = (tail.body.items as { worldStateVersion: number }[]).map((e) => e.worldStateVersion);
    expect(rest).toEqual(scenes(21, 25));
    expect(tail.body.nextCursor).toBeNull();

    // A cursor is the ledger's own sequence, not a client's invention: garbage is a
    // rejected request, not an empty page a reader would take as "the story ends here".
    const junk = await get(api, owner, `/v1/worlds/${worldId}/episodes`, { cursor: 'not-a-sequence' });
    expect(junk.status).toBe(400);
    expect(junk.body.error).toMatchObject({ code: 'INVALID_SCHEMA' });

    // Same for the page size — `slice(0, NaN)` answers with an empty list, which reads
    // as a world with no story at all.
    const badSize = await get(api, owner, `/v1/worlds/${worldId}/episodes`, { limit: 'plenty' });
    expect(badSize.status).toBe(400);
    expect(badSize.body.error).toMatchObject({ code: 'INVALID_SCHEMA' });
  });

  it('names a listed world by its rulepack so UI07 never prints a raw id (ADR-019)', async () => {
    const { api, owner } = harness();
    const { worldId } = await createWorld(api, owner);

    const items = (await get(api, owner, '/v1/worlds')).body.items as Record<string, unknown>[];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ worldId, rulepackId: 'glass-harbor-2034', status: 'active' });
  });

  it('maps a stale version to 409 with the current version in details', async () => {
    const { api, engine, owner } = harness();
    const { worldId } = await createWorld(api, owner);
    const identityId = engine.store.memberships.get(membershipKey(worldId, owner))!.identityId;

    const first = await post(api, owner, `/v1/worlds/${worldId}/choices`, { choiceId: 'confront_mara', actorIdentityId: identityId, expectedWorldVersion: 1 });
    expect(first.status).toBe(200);
    expect((first.body.commandResult as { newVersion: number }).newVersion).toBe(2);

    const stale = await post(api, owner, `/v1/worlds/${worldId}/choices`, { choiceId: 'investigate_buyer', actorIdentityId: identityId, expectedWorldVersion: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({ code: 'WORLD_VERSION_CONFLICT', details: { currentVersion: 2 } });
  });

  it('enforces the free world quota through 403 WORLD_LIMIT_REACHED', async () => {
    const { api, owner } = harness();
    await createWorld(api, owner);
    const second = await post(api, owner, '/v1/worlds', { mode: 'create', templateId: 'glass-harbor-2034' });
    expect(second.status).toBe(403);
    expect(second.body.error).toMatchObject({ code: 'WORLD_LIMIT_REACHED' });
  });

  it('serves the normative routes and no others', async () => {
    const { api, engine, owner } = harness();
    const { worldId, episodeId } = await createWorld(api, owner);
    const identityId = engine.store.memberships.get(membershipKey(worldId, owner))!.identityId;

    for (const path of ['/v1/worlds', `/v1/worlds/${worldId}`, `/v1/worlds/${worldId}/episodes`, `/v1/worlds/${worldId}/episodes/${episodeId}`]) {
      expect((await get(api, owner, path)).status, path).toBe(200);
    }

    const ctx = { actorIdentityId: identityId };
    let version = 1;
    const step = async (sub: string, extra: Record<string, unknown> = {}) => {
      const res = await post(api, owner, `/v1/worlds/${worldId}/${sub}`, { ...ctx, expectedWorldVersion: version, ...extra });
      expect(res.status, sub).toBe(200);
      version = (res.body.commandResult as { newVersion: number }).newVersion;
      expect(engine.verifyReplay(worldId).equal, sub).toBe(true);
      return res;
    };

    await step('choices', { choiceId: 'investigate_buyer' });
    await step('surprises');
    await step('resume');
    await step('pause');
    await step('archive');

    const offContract = await post(api, owner, `/v1/worlds/${worldId}/acknowledge`, { ...ctx, expectedWorldVersion: version });
    expect(offContract.status).toBe(404);
  });
});
