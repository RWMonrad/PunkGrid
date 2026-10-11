import { describe, expect, it } from 'vitest';
import { GLASS_HARBOR } from '../src/glassHarbor.js';
import { CompliantProvider } from '../src/providers.js';
import { Engine } from '../src/engine.js';
import { Api, type ApiRequest } from '../src/api.js';
import { membershipKey } from '../src/store.js';
import type { ID } from '../src/domain.js';
import { cid } from './helpers.js';

const T0 = Date.parse('2026-10-11T12:00:00.000Z');

function harness() {
  const engine = new Engine(GLASS_HARBOR, new CompliantProvider(), { now: () => T0, seed: 20261011 });
  const api = new Api(engine);
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

function get(api: Api, userId: ID, path: string) {
  return api.handle({ method: 'GET', path, headers: {}, actor: { userId } });
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

  it('answers a non-owner with 404 on reads and never discloses existence', async () => {
    const { api, engine, owner, intruder } = harness();
    const { worldId } = await createWorld(api, owner);

    expect((await get(api, intruder, `/v1/worlds/${worldId}`)).status).toBe(404);
    expect((await get(api, intruder, `/v1/worlds/${worldId}/episodes`)).status).toBe(404);
    expect((await get(api, intruder, '/v1/worlds')).body.items).toEqual([]);

    const write = await post(api, intruder, `/v1/worlds/${worldId}/choices`, { choiceId: 'confront_mara', actorIdentityId: 'idn_x', expectedWorldVersion: 1 });
    expect(write.status).toBe(403);
    expect(write.body.error).toMatchObject({ code: 'WORLD_ACCESS_DENIED' });
    expect(engine.store.worlds.get(worldId)!.stateVersion).toBe(1);
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
