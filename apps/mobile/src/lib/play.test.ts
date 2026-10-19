// The play loop is where §11 actually bites, so it is tested without a device: a
// stubbed fetch serves the routes, and the assertions are the three invariants the
// screens depend on — one command id per intent (T08/§11), the version always read
// from the server (T07), and prose only ever by polling (ADR-006).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClient, ApiError, type Episode, type WorldView } from './api';
import { PlayController } from './play';
import { telemetry, type AnalyticsEvent } from './telemetry';

const BASE = 'http://srv.test';
const WORLD_ID = 'w_01HARBOR';

type Reply = { status?: number; body: Record<string, unknown> } | 'reject';
type Step = Reply | Promise<Reply>;
type Script = Record<string, Step[]>;

function deferredReply() {
  let resolve!: (reply: Reply) => void;
  const promise = new Promise<Reply>((done) => { resolve = done; });
  return { promise, resolve };
}

interface Call {
  key: string;
  method: string;
  body: Record<string, unknown> | null;
  idempotencyKey: string | null;
  signal: AbortSignal | null;
}

/** Each call to `newCommandId` hands back a fresh id, so a test can tell "the same
 *  intent replayed" apart from "a second intent invented" — the distinction the
 *  idempotency key exists for. */
function harness(script: Script) {
  const calls: Call[] = [];
  const seen: Record<string, number> = {};
  let commandCounter = 0;

  const fetchImpl = (async (url: string, init: RequestInit) => {
    const method = String(init.method);
    const key = `${method} ${new URL(url).pathname}`;
    const headers = init.headers as Record<string, string>;
    calls.push({
      key,
      method,
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null,
      idempotencyKey: headers['idempotency-key'] ?? null,
      signal: init.signal ?? null,
    });
    const queue = script[key];
    const index = seen[key] ?? 0;
    seen[key] = index + 1;
    const step = await (queue?.[Math.min(index, queue.length - 1)] ?? {
      status: 404,
      body: { error: { code: 'NOT_FOUND', message: `nothing scripted for ${key}` } },
    });
    if (step === 'reject') throw new TypeError('fetch failed');
    return new Response(JSON.stringify(step.body), { status: step.status ?? 200 });
  }) as unknown as typeof fetch;

  const client = new ApiClient({
    baseUrl: BASE,
    token: () => 'tok_1',
    fetchImpl,
    requestId: () => 'req_1',
    commandId: () => `cmd_${(commandCounter += 1)}`,
  });
  return { calls, client };
}

function controller(script: Script) {
  const h = harness(script);
  return { ...h, ctrl: new PlayController(h.client, WORLD_ID) };
}

const episode = (over: Partial<Episode> = {}): Episode => ({
  id: 'ep_1',
  worldId: WORLD_ID,
  fromEventSequence: 1,
  throughEventSequence: 2,
  worldStateVersion: 3,
  content: 'The harbor fog holds its breath.',
  referencedEventIds: ['ev_1'],
  allowedChoiceIds: ['ch_1'],
  validationStatus: 'passed',
  status: 'published',
  ...over,
});

const worldView = (version: number, resources: Record<string, number> = { trust: 70 }, status: WorldView['world']['status'] = 'active') => ({
  requestId: 'req_1',
  world: { id: WORLD_ID, rulepackId: 'glass-harbor-2034', status, worldTime: '2034-05-01T08:00:00.000Z', stateVersion: version },
  identityId: 'idn_1',
  stateVersion: version,
  summary: { worldTime: '2034-05-01T08:00:00.000Z', arcs: { main: 'opening' }, resources },
  choices: [{ choiceId: 'ch_1', label: 'Ask the cofounder', copy: 'Direct, now.' }],
});

const posted = (over: Record<string, unknown> = {}) => ({
  requestId: 'req_1',
  commandResult: { commandId: 'cmd', worldId: WORLD_ID, previousVersion: 3, newVersion: 4, outcome: 'advanced', eventIds: ['ev_new'], stateHash: 'sha256:x' },
  episodeStatus: 'published',
  episodeId: 'ep_2',
  ...over,
});

// The detail route puts status on the envelope, not inside its episode payload.
const episodeReply = (value: Episode) => {
  const { status, ...prose } = value;
  return { body: { requestId: 'req_1', status, episode: prose } };
};
const published = episodeReply(episode({ id: 'ep_2' }));

const reading = {
  [`GET /v1/worlds/${WORLD_ID}`]: [{ body: worldView(3) }],
  [`GET /v1/worlds/${WORLD_ID}/episodes`]: [{ body: { requestId: 'req_1', items: [episode()], nextCursor: null } }],
};

const posts = (calls: Call[], path: string) => calls.filter((c) => c.method === 'POST' && c.key.endsWith(path));

let events: AnalyticsEvent[] = [];
let detach: () => void = () => {};

beforeEach(() => {
  telemetry.reset();
  events = [];
  detach = telemetry.attach((e) => void events.push(e));
});

// The singleton is shared with every other test file in this process, so the sink
// has to leave when the block ends.
afterEach(() => {
  detach();
  vi.useRealTimers();
});

describe('PlayController.load', () => {
  it('shows the newest committed episode and keeps the choices from the world view', async () => {
    const { ctrl, calls } = controller(reading);
    await ctrl.load();
    const state = ctrl.getSnapshot();
    expect(state.phase).toBe('reading');
    expect(state.episode?.id).toBe('ep_1');
    expect(state.episodeNumber).toBe(1);
    expect(state.world?.choices.map((c) => c.choiceId)).toEqual(['ch_1']);
    expect(calls.map((c) => c.key)).toEqual([`GET /v1/worlds/${WORLD_ID}`, `GET /v1/worlds/${WORLD_ID}/episodes`]);
    expect(events.map((e) => e.name)).toEqual(['episode_viewed']);
  });

  it.each([
    { reentry: false, status: 'published' as const },
    { reentry: true, status: 'published' as const },
    { reentry: false, status: 'fallback' as const },
    { reentry: true, status: 'fallback' as const },
  ])('waits for $status prose before reading or viewing telemetry (reentry: $reentry)', async ({ reentry, status }) => {
    vi.useFakeTimers();
    const pending = episode({ id: 'ep_2', content: '', status: 'pending', throughEventSequence: 4, worldStateVersion: 4 });
    const ready = episode({ ...pending, status, content: 'The next scene is ready.', validationStatus: status === 'fallback' ? 'fallback' : 'passed' });
    const initialList = { body: { items: [episode()], nextCursor: null } };
    const pendingList = { body: { items: reentry ? [episode(), pending] : [pending], nextCursor: null } };
    const { ctrl, calls } = controller({
      [`GET /v1/worlds/${WORLD_ID}`]: reentry ? [{ body: worldView(3) }, { body: worldView(4, { trust: 58 }) }] : [{ body: worldView(4) }],
      [`GET /v1/worlds/${WORLD_ID}/episodes`]: reentry ? [initialList, pendingList] : [pendingList],
      [`GET /v1/worlds/${WORLD_ID}/episodes/ep_2`]: [{ body: { status: 'pending' } }, episodeReply(ready)],
    });
    if (reentry) await ctrl.load();
    events.length = 0;
    const phases: string[] = [];
    ctrl.subscribe(() => phases.push(ctrl.getSnapshot().phase));
    const loading = ctrl.load(reentry);
    await vi.advanceTimersByTimeAsync(0);
    expect(ctrl.getSnapshot()).toMatchObject({ phase: 'writing', episode: pending, episodeNumber: reentry ? 2 : 1 });
    expect(phases).not.toContain('reading');
    expect(events).toEqual([]);
    const poll = calls.find((c) => c.key.endsWith('/episodes/ep_2'))!;
    expect(poll.signal).toBeInstanceOf(AbortSignal);
    expect(poll.signal?.aborted).toBe(false);
    await Promise.all([ctrl.choose('ch_1'), ctrl.surprise(), ctrl.resume(), ctrl.pause(), ctrl.archive(), ctrl.retry()]);
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
    await vi.advanceTimersByTimeAsync(1200);
    await loading;
    expect(ctrl.getSnapshot()).toMatchObject({ phase: 'reading', episode: ready, previousResources: reentry ? { trust: 70 } : null });
    expect(ctrl.getSnapshot().message).toBe(status === 'fallback' ? 'This scene is told from stored state: the narrator did not return usable prose.' : null);
    expect(events.filter((e) => e.name === 'episode_viewed')).toEqual([
      expect.objectContaining({ episodeSeq: 4 }),
    ]);
    expect(calls.filter((c) => c.key.endsWith('/episodes/ep_2'))).toHaveLength(2);
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
  });

  it('labels an already stored fallback without polling it again', async () => {
    const fallback = episode({ status: 'fallback', validationStatus: 'fallback' });
    const { ctrl, calls } = controller({
      ...reading,
      [`GET /v1/worlds/${WORLD_ID}/episodes`]: [{ body: { items: [fallback], nextCursor: null } }],
    });
    await ctrl.load();
    expect(ctrl.getSnapshot()).toMatchObject({ phase: 'reading', episode: fallback });
    expect(ctrl.getSnapshot().message).toContain('the narrator did not return usable prose');
    expect(calls).toHaveLength(2);
    expect(events.map((e) => e.name)).toEqual(['episode_viewed']);
  });

  it.each(['timeout', 'network', 'failed', 'missing prose'] as const)('exposes a read-only retry after a pending load encounters %s', async (failure) => {
    vi.useFakeTimers();
    const pending = episode({ id: 'ep_2', content: '', status: 'pending' });
    const script: Script = {
      ...reading,
      [`GET /v1/worlds/${WORLD_ID}/episodes`]: [{ body: { items: [pending], nextCursor: null } }],
      [`GET /v1/worlds/${WORLD_ID}/episodes/ep_2`]: [failure === 'network' ? 'reject' : { body: { status: failure === 'timeout' ? 'pending' : failure === 'failed' ? 'failed' : 'published' } }],
    };
    const { ctrl, calls } = controller(script);
    const loading = ctrl.load();
    await vi.advanceTimersByTimeAsync(failure === 'timeout' ? 121_000 : 0);
    await loading;
    expect(ctrl.getSnapshot().phase).toBe('error');
    expect(ctrl.getSnapshot().message).toContain(failure === 'network' ? 'could not be reached' : 'not yet written');
    expect(events).toEqual([]);
    script[`GET /v1/worlds/${WORLD_ID}/episodes/ep_2`] = [published];
    const beforeRetry = calls.length;
    await ctrl.retry();
    expect(calls.slice(beforeRetry).map((c) => c.key)).toEqual([
      `GET /v1/worlds/${WORLD_ID}`, `GET /v1/worlds/${WORLD_ID}/episodes`, `GET /v1/worlds/${WORLD_ID}/episodes/ep_2`,
    ]);
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
    expect(ctrl.getSnapshot()).toMatchObject({ phase: 'reading', episode: { id: 'ep_2', status: 'published' }, message: null });
    expect(events.filter((e) => e.name === 'episode_viewed')).toHaveLength(1);
  });

  it.each(['world', 'list', 'poll'] as const)('does not publish an old %s response or error over a newer load', async (stage) => {
    const delayed = deferredReply();
    const pending = episode({ id: 'ep_2', status: 'pending', content: '' });
    const { ctrl, calls } = controller({
      [`GET /v1/worlds/${WORLD_ID}`]: stage === 'world' ? [delayed.promise, { body: worldView(9) }] : [{ body: worldView(3) }, { body: worldView(9) }],
      [`GET /v1/worlds/${WORLD_ID}/episodes`]: stage === 'list' ? [delayed.promise, { body: { items: [episode({ id: 'ep_9' })] } }] : [
        { body: { items: [stage === 'poll' ? pending : episode({ id: 'ep_9' })] } },
        { body: { items: [episode({ id: 'ep_9' })] } },
      ],
      [`GET /v1/worlds/${WORLD_ID}/episodes/ep_2`]: [delayed.promise],
    });
    const older = ctrl.load();
    await vi.waitFor(() => expect(calls).toHaveLength(stage === 'world' ? 1 : stage === 'list' ? 2 : 3));
    const poll = calls.find((c) => c.key.endsWith('/episodes/ep_2'));
    await ctrl.load();
    const newer = ctrl.getSnapshot();
    expect(newer).toMatchObject({ phase: 'reading', world: { stateVersion: 9 }, episode: { id: 'ep_9' } });
    if (poll) expect(poll.signal?.aborted).toBe(true);
    delayed.resolve(stage === 'world' ? { body: worldView(3) } : stage === 'list' ? 'reject' : published);
    await older;
    expect(ctrl.getSnapshot()).toBe(newer);
    expect(events.map((e) => e.name)).toEqual(['episode_viewed']);
  });

  it.each(['world', 'list', 'poll'] as const)('ignores the pending %s read after dispose', async (stage) => {
    const delayed = deferredReply();
    const { ctrl, calls } = controller({
      ...reading,
      [`GET /v1/worlds/${WORLD_ID}`]: stage === 'world' ? [delayed.promise] : reading[`GET /v1/worlds/${WORLD_ID}`],
      [`GET /v1/worlds/${WORLD_ID}/episodes`]: stage === 'list' ? [delayed.promise] : [{ body: { items: [episode({ status: 'pending', content: '' })] } }],
      [`GET /v1/worlds/${WORLD_ID}/episodes/ep_1`]: [delayed.promise],
    });
    const loading = ctrl.load();
    await vi.waitFor(() => expect(calls).toHaveLength(stage === 'world' ? 1 : stage === 'list' ? 2 : 3));
    const snapshot = ctrl.getSnapshot();
    ctrl.dispose();
    const poll = calls.find((c) => c.key.endsWith('/episodes/ep_1'));
    if (poll) expect(poll.signal?.aborted).toBe(true);
    delayed.resolve(stage === 'world' ? { body: worldView(3) } : stage === 'list' ? 'reject' : published);
    await loading;
    await Promise.all([ctrl.retry(), ctrl.choose('ch_1'), ctrl.resume(), ctrl.archive()]);
    expect(ctrl.getSnapshot()).toBe(snapshot);
    expect(events).toEqual([]);
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
  });

  it('aborts a pending load poll during its interval when disposed', async () => {
    vi.useFakeTimers();
    const { ctrl, calls } = controller({
      ...reading,
      [`GET /v1/worlds/${WORLD_ID}/episodes`]: [{ body: { items: [episode({ status: 'pending', content: '' })] } }],
      [`GET /v1/worlds/${WORLD_ID}/episodes/ep_1`]: [{ body: { status: 'pending' } }],
    });
    const loading = ctrl.load();
    await vi.advanceTimersByTimeAsync(0);
    expect(ctrl.getSnapshot().phase).toBe('writing');
    const snapshot = ctrl.getSnapshot();
    ctrl.dispose();
    await loading;
    expect(ctrl.getSnapshot()).toBe(snapshot);
    expect(calls.at(-1)?.signal?.aborted).toBe(true);
    expect(events).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('surfaces a read failure as an error phase rather than an empty world', async () => {
    const { ctrl } = controller({
      [`GET /v1/worlds/${WORLD_ID}`]: [{ status: 403, body: { error: { code: 'WORLD_ACCESS_DENIED', message: 'That world is not yours.' } } }],
    });
    await ctrl.load();
    expect(ctrl.getSnapshot()).toMatchObject({ phase: 'error', message: 'That world is not yours.', world: null });
  });

  it('loads an episode-less world into a readable empty state', async () => {
    const { ctrl } = controller({ ...reading, [`GET /v1/worlds/${WORLD_ID}/episodes`]: [{ body: { requestId: 'req_1', items: [], nextCursor: null } }] });
    await ctrl.load();
    expect(ctrl.getSnapshot()).toMatchObject({ phase: 'reading', episode: null, episodeNumber: 0 });
    expect(events).toEqual([]);
  });

  it('keeps the resources of the version before, only for a read that follows our own command', async () => {
    const { ctrl } = controller({
      [`GET /v1/worlds/${WORLD_ID}`]: [
        { body: worldView(3) },
        { body: worldView(4, { trust: 58 }) },
      ],
      [`GET /v1/worlds/${WORLD_ID}/episodes`]: [{ body: { requestId: 'req_1', items: [episode()], nextCursor: null } }],
      [`POST /v1/worlds/${WORLD_ID}/choices`]: [{ body: posted() }],
      [`GET /v1/worlds/${WORLD_ID}/episodes/ep_2`]: [published],
    });
    // A plain read has nothing to attribute, and must not invent a change.
    await ctrl.load();
    expect(ctrl.getSnapshot().previousResources).toBeNull();
    // Our command moved version 3 to 4, so the difference is the player's own doing.
    await ctrl.choose('ch_1');
    expect(ctrl.getSnapshot().previousResources).toEqual({ trust: 70 });
    // Re-reading the same version changes nothing, so the chip clears rather than
    // staying on screen attributed to a decision that has not happened since.
    await ctrl.load();
    expect(ctrl.getSnapshot().previousResources).toBeNull();
  });

  it('shows no delta after a version conflict, because a rejected decision committed nothing', async () => {
    const { ctrl } = controller({
      [`GET /v1/worlds/${WORLD_ID}`]: [
        { body: worldView(3) },
        { body: worldView(9, { trust: 20 }) },
      ],
      [`GET /v1/worlds/${WORLD_ID}/episodes`]: [{ body: { requestId: 'req_1', items: [episode()], nextCursor: null } }],
      [`POST /v1/worlds/${WORLD_ID}/choices`]: [{ status: 409, body: { error: { code: 'WORLD_VERSION_CONFLICT', message: 'The world moved.', details: { currentVersion: 9 } } } }],
    });
    await ctrl.load();
    await ctrl.choose('ch_1');
    const state = ctrl.getSnapshot();
    // The world jumped six versions and trust fell 50 — all of it someone else's
    // command. Printing that as our decision's effect would be the bug.
    expect(state).toMatchObject({ conflict: true, previousResources: null });
    expect(state.world?.stateVersion).toBe(9);
  });
});

describe('PlayController.choose', () => {
  it('commits once, polls the episode, then re-reads the world', async () => {
    const { ctrl, calls } = controller({
      ...reading,
      [`POST /v1/worlds/${WORLD_ID}/choices`]: [{ body: posted() }],
      [`GET /v1/worlds/${WORLD_ID}/episodes/ep_2`]: [published],
    });
    await ctrl.load();
    await ctrl.choose('ch_1');
    expect(ctrl.getSnapshot().phase).toBe('reading');

    const commit = posts(calls, '/choices');
    expect(commit).toHaveLength(1);
    expect(commit[0]!.idempotencyKey).toBe('cmd_1');
    expect(commit[0]!.body).toMatchObject({ schemaVersion: '1.0', commandId: 'cmd_1', actorIdentityId: 'idn_1', expectedWorldVersion: 3, choiceId: 'ch_1' });
    expect(calls.filter((c) => c.key.endsWith('/episodes/ep_2'))).toHaveLength(1);
    expect(events.map((e) => e.name)).toEqual(['episode_viewed', 'choice_committed', 'episode_generation_finished', 'episode_viewed']);
  });

  it('takes expectedWorldVersion from the server answer, never a local counter', async () => {
    const { ctrl, calls } = controller({
      ...reading,
      [`GET /v1/worlds/${WORLD_ID}`]: [{ body: worldView(9) }],
      [`POST /v1/worlds/${WORLD_ID}/choices`]: [{ body: posted({ commandResult: { commandId: 'c', worldId: WORLD_ID, previousVersion: 9, newVersion: 10, outcome: 'advanced', eventIds: ['e'], stateHash: 'h' } }) }],
      [`GET /v1/worlds/${WORLD_ID}/episodes/ep_2`]: [published],
    });
    await ctrl.load();
    await ctrl.choose('ch_1');
    expect(posts(calls, '/choices')[0]!.body).toMatchObject({ expectedWorldVersion: 9 });
  });

  it('does nothing before a world is loaded', async () => {
    const { ctrl, calls } = controller(reading);
    await ctrl.choose('ch_1');
    expect(calls).toEqual([]);
    expect(ctrl.getSnapshot().phase).toBe('idle');
  });

  it('keeps the intent after a dropped connection so retry sends the decision once', async () => {
    const { ctrl, calls } = controller({
      ...reading,
      [`POST /v1/worlds/${WORLD_ID}/choices`]: ['reject', { body: posted() }],
      [`GET /v1/worlds/${WORLD_ID}/episodes/ep_2`]: [published],
    });
    await ctrl.load();
    await ctrl.choose('ch_1');
    expect(ctrl.getSnapshot()).toMatchObject({ phase: 'error' });
    expect(ctrl.getSnapshot().message).toContain('before confirmation');
    expect(ctrl.getSnapshot().message).toContain('will not count twice');
    expect(ctrl.getSnapshot().message).not.toContain('has not been sent');

    await ctrl.retry();
    const commit = posts(calls, '/choices');
    expect(commit).toHaveLength(2);
    expect(commit.map((c) => c.body?.commandId)).toEqual(['cmd_1', 'cmd_1']);
    expect(commit.map((c) => c.idempotencyKey)).toEqual(['cmd_1', 'cmd_1']);
    expect(commit[1]!.body).toEqual(commit[0]!.body);
    expect(ctrl.getSnapshot().phase).toBe('reading');
  });

  it('keeps the same command id across a rate limit, and says how long to wait', async () => {
    const { ctrl, calls } = controller({
      ...reading,
      [`POST /v1/worlds/${WORLD_ID}/choices`]: [
        { status: 429, body: { error: { code: 'RATE_LIMITED', message: 'Too many requests', details: { retryAfterSeconds: 3 } } } },
        { body: posted() },
      ],
      [`GET /v1/worlds/${WORLD_ID}/episodes/ep_2`]: [published],
    });
    await ctrl.load();
    await ctrl.choose('ch_1');
    expect(ctrl.getSnapshot().message).toBe('Slow down — try again in 3 seconds.');
    await ctrl.retry();
    expect(posts(calls, '/choices').map((c) => c.body?.commandId)).toEqual(['cmd_1', 'cmd_1']);
  });

  it('reads the newest scene on a version conflict and commits against that version', async () => {
    const { ctrl, calls } = controller({
      [`GET /v1/worlds/${WORLD_ID}`]: [{ body: worldView(3) }, { body: worldView(5) }],
      [`GET /v1/worlds/${WORLD_ID}/episodes`]: [{ body: { requestId: 'req_1', items: [episode()], nextCursor: null } }],
      [`POST /v1/worlds/${WORLD_ID}/choices`]: [
        { status: 409, body: { error: { code: 'WORLD_VERSION_CONFLICT', message: 'stale', details: { currentVersion: 5 } } } },
        { body: posted() },
      ],
      [`GET /v1/worlds/${WORLD_ID}/episodes/ep_2`]: [published],
    });
    await ctrl.load();
    await ctrl.choose('ch_1');
    // The reload happens inside the rejected commit, so the player is looking at the
    // newest scene by the time the tap settles — with the conflict still explained.
    const state = ctrl.getSnapshot();
    expect(state.conflict).toBe(true);
    expect(state.phase).toBe('reading');
    expect(state.world?.world.stateVersion).toBe(5);
    expect(posts(calls, '/choices')).toHaveLength(1);

    await ctrl.choose('ch_1');
    const commit = posts(calls, '/choices');
    expect(commit.map((c) => c.body?.expectedWorldVersion)).toEqual([3, 5]);
    // A conflict is a new intent, not a replay: the old command was rejected outright.
    expect(commit.map((c) => c.body?.commandId)).toEqual(['cmd_1', 'cmd_2']);
    expect(events.map((e) => e.name)).toContain('choice_rejected');
  });

  it('leaves a rule rejection on the reading surface with the engine wording', async () => {
    const { ctrl, calls } = controller({
      ...reading,
      [`POST /v1/worlds/${WORLD_ID}/choices`]: [
        { status: 422, body: { error: { code: 'RULE_PRECONDITION_FAILED', message: 'Trust is too low for that.', details: { ruleCode: 'TRUST_FLOOR' } } } },
      ],
    });
    await ctrl.load();
    await ctrl.choose('ch_1');
    expect(ctrl.getSnapshot()).toMatchObject({ phase: 'reading', message: 'Trust is too low for that.', conflict: false });
    await ctrl.retry();
    expect(posts(calls, '/choices')).toHaveLength(1);
    expect(calls.some((c) => c.key.endsWith(`/episodes/ep_2`))).toBe(false);
  });

  it('names the free quota when the server refuses a new world', async () => {
    const { ctrl } = controller({
      ...reading,
      [`POST /v1/worlds/${WORLD_ID}/choices`]: [{ status: 403, body: { error: { code: 'WORLD_LIMIT_REACHED', message: 'quota' } } }],
    });
    await ctrl.load();
    await ctrl.choose('ch_1');
    expect(ctrl.getSnapshot().message).toContain('free quota');
  });
});

describe('PlayController surprise, resume and fallback', () => {
  it('shows the cooldown instead of polling when a surprise is a no-op', async () => {
    const { ctrl, calls } = controller({
      ...reading,
      [`POST /v1/worlds/${WORLD_ID}/surprises`]: [{ body: posted({ commandResult: { commandId: 'c', worldId: WORLD_ID, previousVersion: 3, newVersion: 4, outcome: 'no_op', eventIds: [], stateHash: 'h' }, episodeId: 'ep_2' }) }],
    });
    await ctrl.load();
    await ctrl.surprise();
    expect(ctrl.getSnapshot()).toMatchObject({ phase: 'reading' });
    expect(ctrl.getSnapshot().message).toContain('cooldown');
    expect(calls.filter((c) => c.key.endsWith('/episodes/ep_2'))).toHaveLength(0);
  });

  it('re-reads the world when a command commits without an episode', async () => {
    const { ctrl, calls } = controller({
      ...reading,
      [`POST /v1/worlds/${WORLD_ID}/surprises`]: [{ body: posted({ episodeId: undefined, episodeStatus: 'none' }) }],
    });
    await ctrl.load();
    calls.length = 0;
    await ctrl.surprise();
    expect(calls.map((c) => c.key)).toEqual([`POST /v1/worlds/${WORLD_ID}/surprises`, `GET /v1/worlds/${WORLD_ID}`, `GET /v1/worlds/${WORLD_ID}/episodes`]);
  });

  it('calls a fallback scene what it is, and reports the reason to telemetry', async () => {
    const { ctrl, calls } = controller({
      ...reading,
      [`POST /v1/worlds/${WORLD_ID}/resume`]: [{ body: posted() }],
      [`GET /v1/worlds/${WORLD_ID}/episodes/ep_2`]: [{ body: { requestId: 'req_1', status: 'fallback', episode: episode({ id: 'ep_2', validationStatus: 'fallback', status: 'fallback' }) } }],
    });
    await ctrl.load();
    await ctrl.resume();
    const state = ctrl.getSnapshot();
    expect(state.phase).toBe('reading');
    expect(state.message).toContain('the narrator did not return usable prose');
    const generation = events.find((e) => e.name === 'episode_generation_finished') as { success: boolean; fallbackReasonCode: string } | undefined;
    expect(generation).toMatchObject({ success: false, fallbackReasonCode: 'narrative_fallback' });
    expect(posts(calls, '/resume')[0]!.body).toMatchObject({ expectedWorldVersion: 3 });
    expect(events.map((e) => e.name)).toContain('world_resumed');
  });

  it('stops an in-flight poll when the screen goes away, without an error message', async () => {
    const { ctrl } = controller({
      ...reading,
      [`POST /v1/worlds/${WORLD_ID}/choices`]: [{ body: posted() }],
      [`GET /v1/worlds/${WORLD_ID}/episodes/ep_2`]: [{ body: { requestId: 'req_1', status: 'pending' } }],
    });
    await ctrl.load();
    const pending = ctrl.choose('ch_1');
    await vi.waitFor(() => expect(ctrl.getSnapshot().phase).toBe('writing'));
    ctrl.dispose();
    await pending;
    const state = ctrl.getSnapshot();
    expect(state.phase).toBe('writing');
    expect(state.message).toBeNull();
  });

  it.each(['timeout', 'network'] as const)('keeps an acknowledged decision read-only on retry after a poll %s', async (failure) => {
    vi.useFakeTimers();
    const script: Script = {
      ...reading,
      [`GET /v1/worlds/${WORLD_ID}`]: [{ body: worldView(3) }, { body: worldView(4) }],
      [`GET /v1/worlds/${WORLD_ID}/episodes`]: [
        { body: { items: [episode()] } },
        { body: { items: [episode(), episode({ id: 'ep_2', status: 'pending', content: '' })] } },
      ],
      [`POST /v1/worlds/${WORLD_ID}/choices`]: [{ body: posted({ episodeStatus: 'pending' }) }],
      [`GET /v1/worlds/${WORLD_ID}/episodes/ep_2`]: [failure === 'network' ? 'reject' : { body: { status: 'pending' } }],
    };
    const { ctrl, calls } = controller(script);
    await ctrl.load();
    const chosen = ctrl.choose('ch_1');
    await vi.advanceTimersByTimeAsync(failure === 'timeout' ? 121_000 : 0);
    await chosen;
    expect(ctrl.getSnapshot().phase).toBe('error');
    expect(ctrl.getSnapshot().message).toContain('not yet written');
    expect(events.filter((e) => e.name === 'episode_viewed')).toHaveLength(1);
    script[`GET /v1/worlds/${WORLD_ID}/episodes/ep_2`] = [published];
    await ctrl.retry();
    expect(posts(calls, '/choices')).toHaveLength(1);
    expect(ctrl.getSnapshot()).toMatchObject({ phase: 'reading', episode: { id: 'ep_2', status: 'published' }, episodeNumber: 2 });
    expect(events.filter((e) => e.name === 'episode_viewed')).toHaveLength(2);
  });

  it.each(['published', 'fallback', 'none'] as const)('preserves a failed authoritative reload after a %s commit', async (status) => {
    const { ctrl, calls } = controller({
      ...reading,
      [`GET /v1/worlds/${WORLD_ID}`]: [{ body: worldView(3) }, 'reject', { body: worldView(4) }],
      [`POST /v1/worlds/${WORLD_ID}/choices`]: [{ body: posted({ episodeId: status === 'none' ? undefined : 'ep_2', episodeStatus: status }) }],
      [`GET /v1/worlds/${WORLD_ID}/episodes/ep_2`]: [episodeReply(episode({ id: 'ep_2', status: status === 'fallback' ? 'fallback' : 'published' }))],
    });
    await ctrl.load();
    await ctrl.choose('ch_1');
    expect(ctrl.getSnapshot()).toMatchObject({ phase: 'error', message: 'The Reality Engine could not be reached.' });
    await ctrl.choose('ch_1');
    expect(posts(calls, '/choices')).toHaveLength(1);
    await ctrl.retry();
    expect(ctrl.getSnapshot()).toMatchObject({ phase: 'reading', world: { stateVersion: 4 } });
    expect(posts(calls, '/choices')).toHaveLength(1);
  });
});

describe('PlayController pause and archive', () => {
  it('pauses with a version-bound command and re-reads the world instead of polling', async () => {
    const { ctrl, calls } = controller({
      ...reading,
      [`GET /v1/worlds/${WORLD_ID}`]: [{ body: worldView(3) }, { body: worldView(4, { trust: 70 }, 'paused') }],
      [`POST /v1/worlds/${WORLD_ID}/pause`]: [{ body: { requestId: 'req_1', worldId: WORLD_ID, status: 'paused', version: 4, commandResult: { commandId: 'cmd_1', worldId: WORLD_ID, previousVersion: 3, newVersion: 4, outcome: 'no_op', eventIds: [], stateHash: 'h' } } }],
    });
    await ctrl.load();
    await ctrl.pause();
    const pause = posts(calls, '/pause');
    expect(pause).toHaveLength(1);
    expect(pause[0]!.body).toMatchObject({ commandId: 'cmd_1', actorIdentityId: 'idn_1', expectedWorldVersion: 3 });
    expect(pause[0]!.idempotencyKey).toBe('cmd_1');
    expect(calls.filter((c) => c.key.endsWith('/episodes/ep_2'))).toHaveLength(0);
    expect(ctrl.getSnapshot()).toMatchObject({ phase: 'reading', world: { stateVersion: 4, world: { status: 'paused' } } });
    expect(ctrl.getSnapshot().message).toContain('Nothing advances until you resume it');
    await Promise.all([ctrl.choose('ch_1'), ctrl.surprise(), ctrl.pause()]);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    // §8.3 has no pause event, so the dictionary stays closed: nothing is tracked.
    expect(events.map((e) => e.name)).toEqual(['episode_viewed', 'episode_viewed']);
  });

  it.each(['active', 'paused'] as const)('refreshes the authoritative archived world after archiving from %s', async (status) => {
    const { ctrl, calls } = controller({
      ...reading,
      [`GET /v1/worlds/${WORLD_ID}`]: [{ body: worldView(3, { trust: 70 }, status) }, { body: worldView(5, { trust: 58 }, 'archived') }],
      [`POST /v1/worlds/${WORLD_ID}/archive`]: [{ body: { requestId: 'req_1', worldId: WORLD_ID, status: 'archived', version: 4 } }],
    });
    await ctrl.load();
    calls.length = 0;
    await ctrl.archive();
    expect(calls.map((c) => c.key)).toEqual([
      `POST /v1/worlds/${WORLD_ID}/archive`, `GET /v1/worlds/${WORLD_ID}`, `GET /v1/worlds/${WORLD_ID}/episodes`,
    ]);
    expect(ctrl.getSnapshot()).toMatchObject({ phase: 'reading', world: { stateVersion: 5, world: { status: 'archived' }, summary: { resources: { trust: 58 } } }, previousResources: null });
    expect(ctrl.getSnapshot().message).toContain('never playable');
    await Promise.all([ctrl.choose('ch_1'), ctrl.surprise(), ctrl.resume(), ctrl.pause(), ctrl.archive()]);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    expect(events.map((e) => e.name)).not.toContain('world_resumed');
  });

  it('keeps an initially archived world readable but never playable', async () => {
    const { ctrl, calls } = controller({ ...reading, [`GET /v1/worlds/${WORLD_ID}`]: [{ body: worldView(3, {}, 'archived') }] });
    await ctrl.load();
    await Promise.all([ctrl.choose('ch_1'), ctrl.surprise(), ctrl.resume(), ctrl.pause(), ctrl.archive()]);
    expect(ctrl.getSnapshot()).toMatchObject({ phase: 'reading', episode: { id: 'ep_1' } });
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
    expect(events.map((e) => e.name)).toEqual(['episode_viewed']);
  });

  it('allows a paused world to resume before offering gameplay again', async () => {
    const { ctrl, calls } = controller({
      ...reading,
      [`GET /v1/worlds/${WORLD_ID}`]: [{ body: worldView(3, { trust: 70 }, 'paused') }, { body: worldView(4) }],
      [`POST /v1/worlds/${WORLD_ID}/resume`]: [{ body: posted({ episodeId: undefined, episodeStatus: 'none' }) }],
      [`POST /v1/worlds/${WORLD_ID}/choices`]: [{ body: posted() }],
      [`GET /v1/worlds/${WORLD_ID}/episodes/ep_2`]: [published],
    });
    await ctrl.load();
    await Promise.all([ctrl.choose('ch_1'), ctrl.surprise(), ctrl.pause()]);
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
    await ctrl.resume();
    expect(posts(calls, '/resume')[0]!.body).toMatchObject({ expectedWorldVersion: 3, commandId: 'cmd_1' });
    expect(ctrl.getSnapshot()).toMatchObject({ phase: 'reading', world: { stateVersion: 4, world: { status: 'active' } } });
    await ctrl.choose('ch_1');
    expect(posts(calls, '/choices')[0]!.body).toMatchObject({ expectedWorldVersion: 4, commandId: 'cmd_2' });
  });

  it.each(['pause', 'archive'] as const)('does not replace a failed %s reload with a success message', async (kind) => {
    const status = kind === 'pause' ? 'paused' : 'archived';
    const { ctrl, calls } = controller({
      ...reading,
      [`GET /v1/worlds/${WORLD_ID}`]: [{ body: worldView(3) }, 'reject', { body: worldView(4, {}, status) }],
      [`POST /v1/worlds/${WORLD_ID}/${kind}`]: [{ body: { worldId: WORLD_ID, status, version: 4 } }],
    });
    await ctrl.load();
    await ctrl[kind]();
    expect(ctrl.getSnapshot()).toMatchObject({ phase: 'error', message: 'The Reality Engine could not be reached.' });
    await Promise.all([ctrl.choose('ch_1'), ctrl.surprise(), ctrl.resume(), ctrl.pause(), ctrl.archive()]);
    await ctrl.retry();
    expect(ctrl.getSnapshot()).toMatchObject({ phase: 'reading', world: { stateVersion: 4, world: { status } } });
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('reports the engine reason when the world cannot change state again', async () => {
    const { ctrl } = controller({
      ...reading,
      [`POST /v1/worlds/${WORLD_ID}/pause`]: [{ status: 422, body: { error: { code: 'RULE_PRECONDITION_FAILED', message: 'Cannot move from archived to paused', details: { ruleCode: 'WORLD_STATUS_INVALID' } } } }],
    });
    await ctrl.load();
    await ctrl.pause();
    expect(ctrl.getSnapshot()).toMatchObject({ phase: 'error', message: 'Cannot move from archived to paused' });
  });
});

describe('PlayController operation guards', () => {
  it('blocks gameplay and housekeeping until a committed episode finishes writing', async () => {
    vi.useFakeTimers();
    const { ctrl, calls } = controller({
      ...reading,
      [`POST /v1/worlds/${WORLD_ID}/choices`]: [{ body: posted({ episodeStatus: 'pending' }) }],
      [`GET /v1/worlds/${WORLD_ID}/episodes/ep_2`]: [{ body: { status: 'pending' } }, published],
    });
    await ctrl.load();
    const chosen = ctrl.choose('ch_1');
    await vi.advanceTimersByTimeAsync(0);
    expect(ctrl.getSnapshot().phase).toBe('writing');
    await Promise.all([ctrl.choose('ch_1'), ctrl.surprise(), ctrl.resume(), ctrl.pause(), ctrl.archive(), ctrl.retry()]);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1200);
    await chosen;
    expect(ctrl.getSnapshot().phase).toBe('reading');
    expect(posts(calls, '/choices')).toHaveLength(1);
  });

  it.each(['choice', 'pause', 'archive'] as const)('blocks duplicate and competing actions throughout a %s command and reload', async (kind) => {
    const command = deferredReply();
    const reload = deferredReply();
    const path = kind === 'choice' ? 'choices' : kind;
    const { ctrl, calls } = controller({
      ...reading,
      [`GET /v1/worlds/${WORLD_ID}`]: [{ body: worldView(3) }, reload.promise],
      [`POST /v1/worlds/${WORLD_ID}/${path}`]: [command.promise],
    });
    await ctrl.load();
    const action = kind === 'choice' ? ctrl.choose('ch_1') : ctrl[kind]();
    expect(ctrl.getSnapshot().phase).toBe('submitting');
    const duplicates = () => Promise.all([ctrl.choose('ch_1'), ctrl.choose('ch_2'), ctrl.surprise(), ctrl.resume(), ctrl.pause(), ctrl.archive(), ctrl.retry()]);
    await duplicates();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    command.resolve({ body: kind === 'choice' ? posted({ episodeId: undefined, episodeStatus: 'none' }) : { worldId: WORLD_ID, status: kind === 'pause' ? 'paused' : 'archived', version: 4 } });
    await vi.waitFor(() => expect(ctrl.getSnapshot().phase).toBe('loading'));
    await duplicates();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    reload.resolve({ body: worldView(4, {}, kind === 'choice' ? 'active' : kind === 'pause' ? 'paused' : 'archived') });
    await action;
    expect(ctrl.getSnapshot().phase).toBe('reading');
    expect(posts(calls, `/${path}`)[0]!.idempotencyKey).toBe('cmd_1');
  });

  it.each(['choice', 'pause', 'archive'] as const)('ignores a late %s acknowledgement after disposal', async (kind) => {
    const command = deferredReply();
    const path = kind === 'choice' ? 'choices' : kind;
    const { ctrl, calls } = controller({ ...reading, [`POST /v1/worlds/${WORLD_ID}/${path}`]: [command.promise] });
    await ctrl.load();
    const action = kind === 'choice' ? ctrl.choose('ch_1') : ctrl[kind]();
    const snapshot = ctrl.getSnapshot();
    ctrl.dispose();
    command.resolve({ body: kind === 'choice' ? posted() : { worldId: WORLD_ID, status: kind === 'pause' ? 'paused' : 'archived', version: 4 } });
    await action;
    expect(ctrl.getSnapshot()).toBe(snapshot);
    expect(calls).toHaveLength(3);
    expect(events.map((e) => e.name)).toEqual(['episode_viewed']);
  });

  it('does not let an older poll cleanup remove the newer poll abort handle', async () => {
    vi.useFakeTimers();
    const oldPoll = deferredReply();
    const { ctrl, calls } = controller({
      ...reading,
      [`GET /v1/worlds/${WORLD_ID}/episodes`]: [{ body: { items: [episode({ id: 'ep_2', status: 'pending', content: '' })] } }],
      [`GET /v1/worlds/${WORLD_ID}/episodes/ep_2`]: [oldPoll.promise, { body: { status: 'pending' } }],
    });
    const older = ctrl.load();
    await vi.advanceTimersByTimeAsync(0);
    const newer = ctrl.load();
    await vi.advanceTimersByTimeAsync(0);
    const polls = calls.filter((c) => c.key.endsWith('/episodes/ep_2'));
    expect(polls).toHaveLength(2);
    expect(polls[0]!.signal?.aborted).toBe(true);
    oldPoll.resolve(published);
    await older;
    expect(ctrl.getSnapshot().phase).toBe('writing');
    ctrl.dispose();
    expect(polls[1]!.signal?.aborted).toBe(true);
    await newer;
    expect(events).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('PlayController.report', () => {
  it('files the eleventh route against the episode on screen and keeps the version', async () => {
    const { ctrl, calls } = controller({
      ...reading,
      [`POST /v1/worlds/${WORLD_ID}/episodes/ep_1/reports`]: [{ status: 201, body: { requestId: 'req_1', reportId: 'rep_1', receipt: 'PG-RPT-ABCDEFGH', status: 'open' } }],
    });
    await ctrl.load();
    const ack = await ctrl.report('real_person', 'reads like a named company');
    expect(ack).toMatchObject({ receipt: 'PG-RPT-ABCDEFGH', status: 'open' });
    const report = posts(calls, '/reports');
    expect(report[0]!.body).toMatchObject({ commandId: 'cmd_1', actorIdentityId: 'idn_1', reason: 'real_person', note: 'reads like a named company' });
    expect(report[0]!.body).not.toHaveProperty('expectedWorldVersion');
    expect(report[0]!.idempotencyKey).toBe('cmd_1');
    expect(ctrl.getSnapshot().world?.stateVersion).toBe(3);
    expect(events.map((e) => e.name)).toContain('content_report_submitted');
  });

  it('refuses to report before anything is on screen', async () => {
    const { ctrl, calls } = controller(reading);
    const err = await ctrl.report('violence').catch((e: unknown) => e as ApiError);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('NOT_FOUND');
    expect(calls).toEqual([]);
  });
});
