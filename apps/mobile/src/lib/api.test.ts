// The app talks to the server over §11, so the wire shapes belong in a test that
// needs no device: headers the contract names, the body each route requires, and
// the error fields UI12 branches on.

import { describe, expect, it } from 'vitest';

import { ApiClient, ApiError, isPending, pollEpisode, type Episode, type EpisodeStatus } from './api';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Record<string, unknown>;
}

function stub(responses: ({ status?: number; body?: Record<string, unknown> } | 'reject')[]): { client: ApiClient; calls: Call[] } {
  const calls: Call[] = [];
  let i = 0;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const next = responses[Math.min(i, responses.length - 1)];
    i += 1;
    calls.push({
      url,
      method: String(init.method),
      headers: init.headers as Record<string, string>,
      ...(typeof init.body === 'string' ? { body: JSON.parse(init.body) as Record<string, unknown> } : {}),
    });
    if (next === 'reject') throw new TypeError('fetch failed');
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  return {
    calls,
    client: new ApiClient({ baseUrl: 'http://srv.test', token: () => 'tok_1', fetchImpl, requestId: () => 'req_fixed', commandId: () => 'cmd_fixed' }),
  };
}

const ack = {
  requestId: 'r',
  commandResult: { commandId: 'c', worldId: 'w', previousVersion: 1, newVersion: 2, outcome: 'advanced', eventIds: ['e1'], stateHash: 'h' },
  episodeStatus: 'published',
  episodeId: 'ep_1',
};

describe('ApiClient over the §11 wire', () => {
  it('sends the bearer token and a request id on every call', async () => {
    const { client, calls } = stub([{ body: { requestId: 'r', items: [], nextCursor: null } }]);
    await client.listWorlds();
    expect(calls[0]!.url).toBe('http://srv.test/v1/worlds');
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.headers.authorization).toBe('Bearer tok_1');
    expect(calls[0]!.headers['x-request-id']).toBe('req_fixed');
    expect(calls[0]!.headers['idempotency-key']).toBeUndefined();
  });

  it('omits the authorization header before anyone signs in', async () => {
    const calls: Call[] = [];
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      calls.push({ url: '', method: 'GET', headers: init.headers as Record<string, string> });
      return new Response(JSON.stringify({ items: [], nextCursor: null }));
    }) as unknown as typeof fetch;
    const client = new ApiClient({ baseUrl: 'http://srv.test', token: () => null, fetchImpl });
    await client.listWorlds();
    expect(calls[0]!.headers.authorization).toBeUndefined();
  });

  it('binds every mutation to one command id used as both key and body field', async () => {
    const { client, calls } = stub([{ body: ack }]);
    await client.submitChoice({ worldId: 'w_1', actorIdentityId: 'idn_1', expectedWorldVersion: 3, choiceId: 'ch_1', commandId: 'cmd_42' });
    expect(calls[0]!.url).toBe('http://srv.test/v1/worlds/w_1/choices');
    expect(calls[0]!.headers['idempotency-key']).toBe('cmd_42');
    expect(calls[0]!.body).toEqual({
      schemaVersion: '1.0',
      commandId: 'cmd_42',
      actorIdentityId: 'idn_1',
      expectedWorldVersion: 3,
      choiceId: 'ch_1',
    });
  });

  it('creates a world without a version, and sends the setting only when given', async () => {
    const { client, calls } = stub([{ status: 201, body: { requestId: 'r', worldId: 'w_1', version: 0, episodeId: 'ep_1', episodeStatus: 'pending' } }]);
    await client.createWorld({ mode: 'create', templateId: 'glass-harbor-2034', commandId: 'cmd_7' });
    expect(calls[0]!.body).toEqual({ schemaVersion: '1.0', commandId: 'cmd_7', mode: 'create', templateId: 'glass-harbor-2034' });
    expect(calls[0]!.headers['idempotency-key']).toBe('cmd_7');
  });

  it('posts a report to the eleventh route with no expectedWorldVersion (ADR-018)', async () => {
    const { client, calls } = stub([{ status: 201, body: { requestId: 'r', reportId: 'rep_1', receipt: 'PG-RPT-ABCDEFGH', status: 'open' } }]);
    const res = await client.reportEpisode({ worldId: 'w_1', episodeId: 'ep_1', actorIdentityId: 'idn_1', reason: 'real_person', note: 'looks like a real firm', commandId: 'cmd_9' });
    expect(calls[0]!.url).toBe('http://srv.test/v1/worlds/w_1/episodes/ep_1/reports');
    expect(calls[0]!.body).toEqual({
      schemaVersion: '1.0',
      commandId: 'cmd_9',
      actorIdentityId: 'idn_1',
      reason: 'real_person',
      note: 'looks like a real firm',
    });
    expect(res.receipt).toBe('PG-RPT-ABCDEFGH');
  });

  it('walks the episode pages so the newest scene is reachable', async () => {
    // The play screen reads its scene off the end of this list, so a client that
    // stops after one page is a world frozen on an old scene. The route is the
    // contract's paginated one, and the cursor is the server's to hand out.
    const scene = (id: string, seq: number): Episode => ({
      id,
      worldId: 'w_1',
      fromEventSequence: seq,
      throughEventSequence: seq + 1,
      worldStateVersion: seq,
      content: 'Prose.',
      referencedEventIds: ['e1'],
      allowedChoiceIds: ['ch_1'],
      validationStatus: 'passed',
      status: 'published',
    });
    const { client, calls } = stub([
      { body: { requestId: 'r', items: [scene('ep_20', 20)], nextCursor: '20' } },
      { body: { requestId: 'r', items: [scene('ep_21', 21)], nextCursor: null } },
    ]);
    const res = await client.listEpisodes('w_1');
    expect(res.items.map((e) => e.id)).toEqual(['ep_20', 'ep_21']);
    expect(calls.map((c) => c.url)).toEqual([
      'http://srv.test/v1/worlds/w_1/episodes?limit=100',
      'http://srv.test/v1/worlds/w_1/episodes?limit=100&cursor=20',
    ]);
    expect(res.nextCursor).toBeNull();
  });

  it('stops paging on an empty page rather than trusting the cursor it was given', async () => {
    // A server that promises a cursor and then answers with nothing would otherwise
    // keep this client asking forever — the loop ends on what was read.
    const { client, calls } = stub([
      { body: { requestId: 'r', items: [], nextCursor: '9' } },
      { body: { requestId: 'r', items: [], nextCursor: '9' } },
    ]);
    const res = await client.listEpisodes('w_1');
    expect(res.items).toEqual([]);
    expect(calls).toHaveLength(2);
  });

  it('carries the §11 error details through as typed fields', async () => {
    const { client } = stub([{ status: 409, body: { requestId: 'r', error: { code: 'WORLD_VERSION_CONFLICT', message: 'stale', details: { currentVersion: 7 } } } }]);
    const e = await client.getWorld('w_1').catch((err: unknown) => err as ApiError);
    expect(e).toBeInstanceOf(ApiError);
    const api = e as ApiError;
    expect(api.status).toBe(409);
    expect(api.code).toBe('WORLD_VERSION_CONFLICT');
    expect(api.currentVersion).toBe(7);
    expect(api.retryAfterSeconds).toBeNull();
  });

  it('reads retryAfterSeconds off a 429', async () => {
    const { client } = stub([{ status: 429, body: { error: { code: 'RATE_LIMITED', message: 'slow down', details: { retryAfterSeconds: 3 } } } }]);
    const api = await client.listWorlds().catch((err: unknown) => err as ApiError);
    expect(api).toBeInstanceOf(ApiError);
    expect((api as ApiError).retryAfterSeconds).toBe(3);
  });

  it('turns an unreadable error body into INTERNAL_ERROR rather than a JSON crash', async () => {
    const fetchImpl = (async () => new Response('<html>gateway</html>', { status: 502 })) as unknown as typeof fetch;
    const client = new ApiClient({ baseUrl: 'http://srv.test', token: () => 't', fetchImpl });
    const api = await client.health().catch((err: unknown) => err as ApiError);
    expect((api as ApiError).code).toBe('INTERNAL_ERROR');
    expect((api as ApiError).status).toBe(502);
  });

  it('reports a transport failure as NETWORK_ERROR with status 0', async () => {
    const { client } = stub(['reject']);
    const api = await client.listWorlds().catch((err: unknown) => err as ApiError);
    expect((api as ApiError).code).toBe('NETWORK_ERROR');
    expect((api as ApiError).status).toBe(0);
  });

  it('lets an abort pass through untouched, so a disposed screen stops polling', async () => {
    const fetchImpl = (async () => {
      const err = new Error('The operation was aborted.');
      err.name = 'AbortError';
      throw err;
    }) as unknown as typeof fetch;
    const client = new ApiClient({ baseUrl: 'http://srv.test', token: () => 't', fetchImpl });
    await expect(client.getEpisode('w_1', 'ep_1')).rejects.toThrow(/aborted/i);
  });
});

describe('isPending', () => {
  it('treats only published and fallback as settled', () => {
    const pending: EpisodeStatus[] = ['pending', 'generating', 'validated', 'retrying'];
    for (const status of pending) expect(isPending(status)).toBe(true);
    for (const status of ['published', 'fallback'] as EpisodeStatus[]) expect(isPending(status)).toBe(false);
    for (const status of ['none', 'failed'] as EpisodeStatus[]) expect(isPending(status)).toBe(false);
  });
});

describe('pollEpisode', () => {
  const episode: Episode = {
    id: 'ep_1',
    worldId: 'w_1',
    fromEventSequence: 1,
    throughEventSequence: 2,
    worldStateVersion: 2,
    content: 'Prose.',
    referencedEventIds: ['e1'],
    allowedChoiceIds: ['ch_1'],
    validationStatus: 'passed',
    status: 'published',
  };

  it('returns the first settled answer and stops', async () => {
    let reads = 0;
    const res = await pollEpisode({ getEpisode: async () => (reads += 1, { status: 'published', episode }) }, 'w_1', 'ep_1', { intervalMs: 1 });
    expect(reads).toBe(1);
    expect(res.episode?.content).toBe('Prose.');
  });

  it('keeps reading while the engine writes, then hands back the prose', async () => {
    let reads = 0;
    const reader = {
      getEpisode: async () => {
        reads += 1;
        return reads < 3 ? { status: 'pending' as EpisodeStatus } : { status: 'published' as EpisodeStatus, episode };
      },
    };
    const seen: number[] = [];
    const res = await pollEpisode(reader, 'w_1', 'ep_1', { intervalMs: 1, onAttempt: () => void seen.push(reads) });
    expect(reads).toBe(3);
    expect(seen.length).toBe(2);
    expect(res.status).toBe('published');
  });

  it('gives up at the deadline instead of polling forever', async () => {
    let reads = 0;
    const res = await pollEpisode({ getEpisode: async () => (reads += 1, { status: 'pending' as EpisodeStatus }) }, 'w_1', 'ep_1', {
      intervalMs: 1,
      maxMs: 20,
    });
    expect(res.status).toBe('pending');
    expect(reads).toBeGreaterThan(1);
  });
});
