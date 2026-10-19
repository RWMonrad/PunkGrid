// Postgres unit of work. Opt-in because it needs a real server:
//
//   PUNKGRID_DB_URL=postgres://... PUNKGRID_TEST_DB=1 npm test
//
// PUNKGRID_TEST_DB is a deliberate second confirmation: this suite TRUNCATEs the
// punkgrid schema. It refuses to run against any database that has not been
// declared disposable.
//
// The headline case plays the whole Glass Harbor opening through sessions and
// compares the replay hash with the in-memory golden anchor: the persisted path
// must be byte-for-byte the same simulation, only durable.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Api, InMemoryRunner, type ApiRequest, scopeOf } from '../src/api.js';
import { Engine } from '../src/engine.js';
import { GLASS_HARBOR } from '../src/glassHarbor.js';
import { CompliantProvider } from '../src/providers.js';
import { clip } from '../src/moderation.js';
import { makeIdFactory } from '../src/domain.js';
import { createPool, type PgPool } from '../src/db/client.js';
import { defaultMigrationDir, migrate } from '../src/db/migrate.js';
import { PgStore } from '../src/db/pgStore.js';
import { TokenBucket, type RateLimitDecision } from '../src/server/rateLimit.js';
import { Sessions } from '../src/db/session.js';
import { buildApp, type AppInstance } from '../src/server/app.js';

const SEED = 20261011;
const T0 = Date.parse('2026-10-11T12:00:00.000Z');
/** Same anchor as core/scripts/seed-glass-harbor.ts:120 (in-memory path). */
const GOLDEN_HASH = 'sha256:ba95bdda8cae86f80349812bc071df78a2e17a359bcf3291364f2c6a6d356247';

const url = process.env.PUNKGRID_DB_URL;
const enabled = Boolean(url && process.env.PUNKGRID_TEST_DB === '1');
describe.runIf(enabled)('Postgres unit of work', () => {
  let pool: ReturnType<typeof createPool>;
  let pg: PgStore;

  beforeAll(async () => {
    // The same connection setup the server uses, including the pinned
    // search_path that the trigger and policy functions rely on.
    pool = createPool({ connectionString: url!, maxConnections: 4, applicationName: 'punkgrid-test' });
    await migrate(pool, defaultMigrationDir());
    await wipe(pool);
    pg = new PgStore(pool);
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  // Each test starts from an empty schema. The id factory is deterministic, so
  // two sessions built from the same seed mint the same world ids; wiping keeps
  // that from looking like a collision in the next test.
  beforeEach(async () => {
    await wipe(pool);
  });

  const makeSessions = (provider = new CompliantProvider(), opts: { usdBudgetPerUserPerDay?: number; autoFlush?: boolean; seed?: number } = {}) => {
    const ids = makeIdFactory(opts.seed ?? SEED);
    const clock = { t: T0 };
    const sessions = new Sessions(pg, {
      pack: GLASS_HARBOR, provider, ids, now: () => clock.t,
      autoFlush: opts.autoFlush ?? true,
      ...(opts.usdBudgetPerUserPerDay === undefined ? {} : { usdBudgetPerUserPerDay: opts.usdBudgetPerUserPerDay }),
    });
    return { sessions, ids, clock, provider };
  };

  /** The request path the server will take: derive the scope, hydrate, route, persist. */
  const call = async (
    sessions: Sessions,
    actor: { userId: string },
    method: 'GET' | 'POST',
    path: string,
    body: Record<string, unknown> = {},
  ) => {
    const req: ApiRequest = {
      method, path, body, actor,
      headers: method === 'POST' ? { 'idempotency-key': String(body.commandId) } : {},
    };
    const { worldId } = scopeOf(req);
    const worldIds = worldId ? [worldId] : [];
    const run = (engine: Engine) => new Api(new InMemoryRunner(engine)).handle(req);
    if (method === 'GET') return sessions.query({ worldIds, userIds: [actor.userId] }, run);
    const result = worldIds.length
      ? sessions.command({ actorUserId: actor.userId, worldIds }, run)
      : sessions.command({ actorUserId: actor.userId }, run);
    return result;
  };

  const createUser = (sessions: Sessions, userId: string) =>
    sessions.globals({ userIds: [userId] }, (engine) => engine.registerUser(userId));

  /** Genesis plus the four opening decisions, then surprise and one resume. */
  async function playOpening(sessions: Sessions, ids: ReturnType<typeof makeIdFactory>, userId: string) {
    await createUser(sessions, userId);
    const created = await call(sessions, { userId }, 'POST', '/v1/worlds', {
      schemaVersion: '1.0', commandId: ids('cmd'), mode: 'create', templateId: 'glass-harbor-2034',
      setting: { era: '2034', location: 'singapore', role: 'founder-ceo', genre: 'speculative-corporate-mystery' },
    });
    const worldId = created.body.worldId as string;
    let version = created.body.version as number;

    const identity = await sessions.query({ worldIds: [worldId], userIds: [userId] }, (engine) => {
      const row = [...engine.store.memberships.values()].find((m) => m.worldId === worldId)!;
      return row.identityId;
    });

    const act = async (choiceId: string) => {
      const res = await call(sessions, { userId }, 'POST', `/v1/worlds/${worldId}/choices`, {
        schemaVersion: '1.0', commandId: ids('cmd'), actorIdentityId: identity, expectedWorldVersion: version, choiceId,
      });
      version = (res.body.commandResult as { newVersion: number }).newVersion;
    };
    await act('investigate_buyer');
    await act('confront_mara');
    await act('open_negotiation');
    await act('brief_staff');

    const surprise = await call(sessions, { userId }, 'POST', `/v1/worlds/${worldId}/surprises`, {
      schemaVersion: '1.0', commandId: ids('cmd'), actorIdentityId: identity, expectedWorldVersion: version,
    });
    version = (surprise.body.commandResult as { newVersion: number }).newVersion;
    return { worldId, identity, version };
  }

  it('replays the Glass Harbor opening to the golden hash through Postgres', async () => {
    const { sessions, ids, clock } = makeSessions();
    const { worldId, identity, version } = await playOpening(sessions, ids, 'user_seed');
    expect(version).toBe(6);

    clock.t = T0 + 540 * 60_000; // nine wall hours between visits
    const resumed = await call(sessions, { userId: 'user_seed' }, 'POST', `/v1/worlds/${worldId}/resume`, {
      schemaVersion: '1.0', commandId: ids('cmd'), actorIdentityId: identity, expectedWorldVersion: version,
    });
    expect((resumed.body.commandResult as { newVersion: number }).newVersion).toBe(7);

    // A completely fresh hydration: nothing from the writing session is reused.
    const replay = await sessions.query({ worldIds: [worldId], userIds: ['user_seed'] }, (engine) => ({
      ...engine.verifyReplay(worldId),
      events: engine.store.worldEvents(worldId).length,
    }));
    expect(replay.equal).toBe(true);
    expect(replay.replayedHash).toBe(GOLDEN_HASH);
    expect(replay.events).toBe(28);
  });

  it('survives a restart: budget and episode cursor come from rows, not memory', async () => {
    const provider = new CompliantProvider();
    const first = makeSessions(provider, { usdBudgetPerUserPerDay: 0.012 });
    await createUser(first.sessions, 'user_budget');
    const created = await call(first.sessions, { userId: 'user_budget' }, 'POST', '/v1/worlds', {
      schemaVersion: '1.0', commandId: first.ids('cmd'), mode: 'create', templateId: 'glass-harbor-2034',
      setting: { era: '2034', location: 'singapore', role: 'founder-ceo', genre: 'speculative-corporate-mystery' },
    });
    const worldId = created.body.worldId as string;
    const firstEpisode = created.body.episodeId as string;

    // A brand-new Sessions object (as if the process had been replaced) still
    // sees the spend it already made, so the third cap decision uses the ledger.
    const spend = await pg.dailySpendUsd('user_budget', new Date(T0).toISOString());
    expect(spend).toBeGreaterThan(0);

    const second = makeSessions(new CompliantProvider());
    const episodes = await call(second.sessions, { userId: 'user_budget' }, 'GET', `/v1/worlds/${worldId}/episodes`);
    const items = episodes.body.items as { id: string; status: string; fromEventSequence: number; throughEventSequence: number }[];
    expect(items.map((e) => e.id)).toContain(firstEpisode);
    expect(items.every((e) => e.status === 'published')).toBe(true);

    // The cursor is the persisted episode ceiling, so a new episode tiles on.
    const through = Math.max(...items.map((e) => e.throughEventSequence ?? e.fromEventSequence));
    expect(through).toBe(1);
  });

  it('returns the stored result for a replayed command after a reload', async () => {
    const { sessions, ids, clock } = makeSessions();
    const { worldId, identity, version } = await playOpening(sessions, ids, 'user_idem');

    clock.t = T0 + 540 * 60_000;
    const commandId = ids('cmd');
    const body = { schemaVersion: '1.0', commandId, actorIdentityId: identity, expectedWorldVersion: version };
    const first = await call(sessions, { userId: 'user_idem' }, 'POST', `/v1/worlds/${worldId}/resume`, body);
    const again = await call(makeSessions().sessions, { userId: 'user_idem' }, 'POST', `/v1/worlds/${worldId}/resume`, body);

    const a = first.body.commandResult as { newVersion: number; eventIds: string[] };
    const b = again.body.commandResult as { newVersion: number; eventIds: string[] };
    expect(b.eventIds).toEqual(a.eventIds);
    expect(b.newVersion).toBe(a.newVersion);

    const events = await pg.read({ worldIds: [worldId], userIds: ['user_idem'] }, (store) => store.worldEvents(worldId).length);
    expect(events).toBe(28);
  });

  it('rejects a stale expected version after reloading the aggregate', async () => {
    const { sessions, ids } = makeSessions();
    const { worldId, identity } = await playOpening(sessions, ids, 'user_conflict');
    const stale = await call(makeSessions().sessions, { userId: 'user_conflict' }, 'POST', `/v1/worlds/${worldId}/choices`, {
      schemaVersion: '1.0', commandId: 'cmd_stale', actorIdentityId: identity, expectedWorldVersion: 2, choiceId: 'investigate_buyer',
    });
    expect(stale.status).toBe(409);
    expect((stale.body.error as { code: string }).code).toBe('WORLD_VERSION_CONFLICT');

    // The failed command must not be recorded as if it had committed.
    const recorded = await pool.query(`select status from punkgrid.commands where command_id = 'cmd_stale'`);
    expect(recorded.rows.length).toBe(0);
  });

  it('refuses to overwrite published prose', async () => {
    const { sessions, ids } = makeSessions();
    const { worldId } = await playOpening(sessions, ids, 'user_immutable');
    const episodeId = await pg.read({ worldIds: [worldId], userIds: ['user_immutable'] }, (store) => {
      const row = [...store.episodes.values()].find((e) => e.episode.worldId === worldId)!;
      return row.episode.id;
    });

    // Simulate a worker that believes it may re-publish an episode.
    await expect(pg.unit({ worldIds: [worldId], userIds: ['user_immutable'] }, async (store, tx) => {
      const row = store.episodes.get(episodeId)!;
      row.episode = { ...row.episode, content: 'rewritten after publication' };
      await tx.save(store, [worldId], new Date(T0).toISOString());
    })).rejects.toThrow(/immutable/);

    const stored = await pool.query<{ narrative_text: string }>(
      `select narrative_text from punkgrid.narrative_episodes where id = $1`, [episodeId],
    );
    expect(stored.rows[0]!.narrative_text).not.toContain('rewritten');
  });

  it('persists the derived projections so SQL agrees with the snapshot', async () => {
    const { sessions, ids } = makeSessions();
    const { worldId } = await playOpening(sessions, ids, 'user_projection');

    const view = await sessions.query({ worldIds: [worldId], userIds: ['user_projection'] }, (engine) => {
      const world = engine.store.worlds.get(worldId)!;
      const snap = engine.store.latestSnapshot(worldId);
      return {
        version: world.stateVersion,
        relationships: Object.keys(snap.state.relationships).length,
        offers: engine.currentChoices(worldId).length,
        knowledge: Object.entries(snap.state.factualKnowledge).map(([c, f]) => [c, f.length] as const),
      };
    });

    const rels = await pool.query(`select count(*)::int as n from punkgrid.relationships where world_id = $1`, [worldId]);
    expect(rels.rows[0]!.n).toBe(view.relationships);

    const offers = await pool.query(
      `select choice_id from punkgrid.offered_choices where world_id = $1 and bound_version = $2 order by choice_id`,
      [worldId, view.version],
    );
    expect(offers.rows.length).toBe(view.offers);

    for (const [characterId, count] of view.knowledge) {
      const known = await pool.query(
        `select count(*)::int as n from punkgrid.character_knowledge where world_id = $1 and character_id = $2`,
        [worldId, characterId],
      );
      expect(known.rows[0]!.n).toBe(count);
    }
  });

  it('keeps every world-bound row inside its own world', async () => {
    const { sessions, ids } = makeSessions();
    const a = await playOpening(sessions, ids, 'user_cast_a');
    const b = await playOpening(sessions, ids, 'user_cast_b');
    expect(a.worldId).not.toBe(b.worldId);

    // Character ids are template constants shared by every world (char_player
    // exists in both), so a cross-world id join proves nothing. What matters is
    // that hydrating one aggregate never pulls in another world's rows — the
    // invariant that broke when world_facts had no key to worlds and stale fact
    // rows from a previous run were loaded as if this world already knew them.
    const hydrated = await pg.read({ worldIds: [a.worldId], userIds: ['user_cast_a'] }, (store) => ({
      events: [...store.events.values()].flat().map((e) => e.worldId),
      snapshots: [...store.snapshots.values()].map((s) => s.worldId),
      characters: [...store.characters.values()].map((c) => c.worldId),
      facts: [...store.facts.values()].map((f) => f.worldId),
      arcs: [...store.arcs.values()].map((x) => x.worldId),
      offers: [...store.offeredChoices.values()].map((o) => o.worldId),
      commands: [...store.commands.values()].map((c) => c.worldId),
      episodes: [...store.episodes.values()].map((e) => e.episode.worldId),
      scheduled: [...store.scheduledEvents.values()].map((s) => s.worldId),
    }));
    const foreign = Object.entries(hydrated)
      .flatMap(([kind, ids]) => ids.filter((id) => id !== a.worldId).map((id) => `${kind}=${id}`));
    expect(foreign).toEqual([]);
    // Both openings ran (27 events each: genesis, four choices, surprise), and
    // neither reached into the other's rows.
    expect(hydrated.events.length).toBe(27);

    // Arcs are the row kind the schema once keyed wrongly: their ids are template
    // constants, so with `id TEXT PRIMARY KEY` (003) the second opening upserted
    // the first world's three rows and left one world holding every arc in the
    // database. Both worlds must own their three rows, in SQL and in the map.
    const arcRows = await pool.query(
      `select world_id, count(*)::int as n from punkgrid.story_arcs group by world_id`,
    );
    expect(arcRows.rows.map((r) => r.n).sort()).toEqual([3, 3]);
    expect(new Set(arcRows.rows.map((r) => r.world_id))).toEqual(new Set([a.worldId, b.worldId]));

    const bothArcs = await pg.read({ worldIds: [a.worldId, b.worldId], userIds: ['user_cast_a', 'user_cast_b'] }, (store) =>
      [...store.arcs.values()].map((x) => `${x.worldId}|${x.id}`));
    expect(new Set(bothArcs).size).toBe(6);

    // Two direct schema negatives, because the hydrated scope alone cannot show
    // what the constraints reject:
    // 1. the foreign key this test suite is written against — a fact row must
    //    name a world that exists, which is what stopped orphan rows leaking.
    await expect(pool.query(
      `insert into punkgrid.world_facts (world_id, fact_id, label, verified, visibility, created_by_event_id)
       values ('world_ghost', 'fact_ghost', 'Belongs to no world', true, 'owner', 'evt_ghost')`,
    )).rejects.toThrow(/foreign key/);

    // 2. a borrowed character id is impossible to record: the sequence is legal
    //    and the command is real, so only cross-world ownership can stop this.
    const anchor = await pool.query<{ command_id: string; n: string }>(
      `select (select command_id from punkgrid.commands where world_id = $1 limit 1) as command_id,
              (select coalesce(max(world_seq),0) + 1 from punkgrid.world_events where world_id = $1)::text as n`,
      [a.worldId],
    );
    const { command_id: realCommand, n: nextSeq } = anchor.rows[0]!;
    await expect(pool.query(
      `insert into punkgrid.world_events
         (event_id, world_id, world_seq, command_id, event_type, actor_character_id, event_payload_json, visibility, occurred_world_time, recorded_at, rulepack_version)
       values ('evt_foreign', $1, $2, $3, 'choice.resolved', 'char_intruder', '{}'::jsonb, 'owner', now(), now(), '1.0')`,
      [a.worldId, Number(nextSeq), realCommand],
    )).rejects.toThrow(/foreign key/);
  });

  it('refuses a world id another process already claimed', async () => {
    // Task #23 measured a 500 on `POST /v1/worlds` in the deployed shape. Cause:
    // two `core/scripts/serve.ts` processes started in the same millisecond both
    // defaulted to `seed: Date.now()`, and `makeIdFactory` is a pure function of
    // the seed, so each minted the *same* ids in the same order. The fix is
    // `defaultSeed()`; this test pins the second line of defence, the owner guard
    // on the head upsert (`core/src/db/pgStore.ts:323`), which has to hold even
    // if two processes collide again.
    //
    // The shapes matter. A caller supplies its own idempotency key (contract
    // section 4), so the client keys come from a third factory and neither
    // process touches its engine stream before `world.create` — which is what
    // puts both world mints at position one, and both identity mints at
    // position two. Sharing the keys instead would replay the first command
    // before reaching the world write, and sharing the helper `playOpening`
    // would advance one stream past the other and silently cancel the collision.
    const ENGINE_SEED = 20261012;
    const keys = makeIdFactory(20261099);
    const open = (sessions: Sessions, userId: string) =>
      call(sessions, { userId }, 'POST', '/v1/worlds', {
        schemaVersion: '1.0', commandId: keys('cmd'), mode: 'create', templateId: 'glass-harbor-2034',
        setting: { era: '2034', location: 'singapore', role: 'founder-ceo', genre: 'speculative-corporate-mystery' },
      });

    const processA = makeSessions(new CompliantProvider(), { seed: ENGINE_SEED });
    await createUser(processA.sessions, 'user_claim_a');
    const created = await open(processA.sessions, 'user_claim_a');
    expect(created.status).toBe(201);
    const worldId = created.body.worldId as string;

    // Give the first world a state the intruder would overwrite: the head upsert
    // writes status, world time, version and sequence, so version 2 is the point.
    const identity = await processA.sessions.query({ worldIds: [worldId], userIds: ['user_claim_a'] }, (engine) =>
      [...engine.store.memberships.values()].find((m) => m.worldId === worldId)!.identityId);
    const played = await call(processA.sessions, { userId: 'user_claim_a' }, 'POST', `/v1/worlds/${worldId}/choices`, {
      schemaVersion: '1.0', commandId: keys('cmd'), actorIdentityId: identity, expectedWorldVersion: 1, choiceId: 'investigate_buyer',
    });
    expect(played.status).toBe(200);

    const headBefore = await pool.query(
      `select owner_user_id, status, version::int as version, last_event_seq::int as last_event_seq from punkgrid.worlds where id = $1`, [worldId],
    );
    expect(headBefore.rows[0]).toMatchObject({ owner_user_id: 'user_claim_a', version: 2 });

    // Second process, same seed, same first mint.
    const processB = makeSessions(new CompliantProvider(), { seed: ENGINE_SEED });
    await createUser(processB.sessions, 'user_claim_b');
    const fault = await open(processB.sessions, 'user_claim_b').then(() => null, (e) => e as Error);

    // Not a duplicate-key surprise from a later insert: the guard names the id,
    // which is what makes the incident diagnosable from the 500 log line, and
    // proves the two processes really did mint the same world.
    //
    // Falsified by deleting the `where worlds.owner_user_id = excluded.owner_user_id`
    // clause: this assertion then measured the original fault verbatim —
    // `duplicate key value violates unique constraint
    //  "world_memberships_world_id_identity_id_key"` — which is the 500
    // documented in task #23, now reproduced on demand.
    expect(fault).toBeInstanceOf(Error);
    expect(fault!.message).toBe(`world ${worldId} is already claimed by another owner — two processes minted the same id`);

    // The abort leaves the first world exactly as its owner wrote it. This is
    // more than the guard alone: the identity upsert runs BEFORE it
    // (`pgStore.ts:292`) and rewrote that row inside the same transaction, so
    // the equality below is the measurement that the unit rolled back fully.
    const headAfter = await pool.query(
      `select owner_user_id, status, version::int as version, last_event_seq::int as last_event_seq from punkgrid.worlds where id = $1`, [worldId],
    );
    expect(headAfter.rows).toEqual(headBefore.rows);
    const stolenIdentity = await pool.query<{ owner_user_id: string }>(
      `select owner_user_id from punkgrid.identities where id = $1`, [identity],
    );
    expect(stolenIdentity.rows[0]!.owner_user_id).toBe('user_claim_a');
    const intruders = await pool.query(
      `select count(*)::int as n from punkgrid.world_memberships where user_id = 'user_claim_b'`,
    );
    expect(intruders.rows[0]!.n).toBe(0);

    // The guard must not reject the true owner: its own next command re-saves
    // this head row through the same upsert and has to commit.
    const ownerGo = await call(processA.sessions, { userId: 'user_claim_a' }, 'POST', `/v1/worlds/${worldId}/resume`, {
      schemaVersion: '1.0', commandId: keys('cmd'), actorIdentityId: identity, expectedWorldVersion: 2,
    });
    expect(ownerGo.status).toBe(200);

    // And the aborted transaction left the pool usable: with a seed one step
    // away, the same store and connection create a world of their own.
    const retry = makeSessions(new CompliantProvider(), { seed: ENGINE_SEED + 1 });
    await createUser(retry.sessions, 'user_claim_b');
    const theirs = await open(retry.sessions, 'user_claim_b');
    expect(theirs.status).toBe(201);
    expect(theirs.body.worldId).not.toBe(worldId);
  });

  it('serialises two writers of the same world', async () => {
    const { sessions, ids } = makeSessions();
    const { worldId, identity, version } = await playOpening(sessions, ids, 'user_racy');
    const mk = (choiceId: string, commandId: string) => call(sessions, { userId: 'user_racy' }, 'POST', `/v1/worlds/${worldId}/choices`, {
      schemaVersion: '1.0', commandId, actorIdentityId: identity, expectedWorldVersion: version, choiceId,
    });

    const results = await Promise.all([mk('investigate_buyer', 'cmd_race_1'), mk('confront_mara', 'cmd_race_2')]);
    // Exactly one writer advances the world; the other is told to re-read it.
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);

    const view = await pg.read({ worldIds: [worldId], userIds: ['user_racy'] }, (store) => ({
      version: store.worlds.get(worldId)!.stateVersion,
      events: store.worldEvents(worldId).map((e) => e.sequence),
    }));
    expect(view.version).toBe(7);
    expect(view.events).toEqual(view.events.map((_, i) => i + 1));

    const recorded = await pool.query(
      `select command_id from punkgrid.commands where command_id in ('cmd_race_1','cmd_race_2')`,
    );
    expect(recorded.rows.length).toBe(1);
  });

  it('writes a report case to the database and reads it back after a reload', async () => {
    const { sessions, ids } = makeSessions();
    const { worldId, identity } = await playOpening(sessions, ids, 'user_report');
    const episodeId = await pg.read({ worldIds: [worldId], userIds: ['user_report'] }, (store) => {
      const row = [...store.episodes.values()].find((e) => e.episode.worldId === worldId)!;
      return row.episode.id;
    });

    const commandId = `cmd_report_${ids('cmd')}`;
    const res = await call(sessions, { userId: 'user_report' }, 'POST', `/v1/worlds/${worldId}/episodes/${episodeId}/reports`, {
      commandId, actorIdentityId: identity, reason: 'violence', note: 'This one reads wrong to me.',
    });
    expect(res.status).toBe(201);
    const reportId = res.body.reportId as string;
    expect(res.body.receipt).toMatch(/^PG-RPT-/);

    // A report is not canon: no command row, no new version.
    const versions = await pg.read({ worldIds: [worldId], userIds: ['user_report'] }, (store) => store.worlds.get(worldId)!.stateVersion);
    expect(versions).toBe(6);

    // A process that never saw the write still holds the case, with the excerpt
    // rather than the episode (§15) and the same report id.
    const reloaded = await pg.read({ worldIds: [worldId], userIds: ['user_report'] }, (store) => {
      const row = store.moderationCases.get(commandId);
      return row ? { id: row.id, reason: row.reason, excerpt: row.excerpt, note: row.reporterNote, episodeOf: row.episodeId, cases: store.moderationCases.size } : null;
    });
    expect(reloaded).not.toBeNull();
    expect(reloaded!.id).toBe(reportId);
    expect(reloaded!.reason).toBe('violence');
    expect(reloaded!.episodeOf).toBe(episodeId);
    expect(reloaded!.note).toBe('This one reads wrong to me.');
    expect(reloaded!.cases).toBe(1);

    const stored = await pool.query<{ excerpt: string; narrative: string }>(
      `select c.excerpt, e.narrative_text as narrative
         from punkgrid.moderation_cases c
         join punkgrid.narrative_episodes e on e.id = c.episode_id
        where c.command_id = $1`,
      [commandId],
    );
    const { excerpt, narrative } = stored.rows[0]!;
    // The case file holds the bounded fragment the engine wrote, not a copy of
    // the episode it can be read back out of (§15).
    expect(excerpt.startsWith(`${episodeId}: `)).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(260);
    expect(excerpt).toBe(`${episodeId}: ${clip(narrative, 180)}`);

    // The same commandId again reuses the case instead of opening a second one.
    const again = await call(makeSessions().sessions, { userId: 'user_report' }, 'POST', `/v1/worlds/${worldId}/episodes/${episodeId}/reports`, {
      commandId, actorIdentityId: identity, reason: 'violence', note: 'This one reads wrong to me.',
    });
    expect(again.body.status).toBe('duplicate');
    const counted = await pool.query<{ n: string }>(`select count(*)::text as n from punkgrid.moderation_cases`);
    expect(counted.rows[0]!.n).toBe('1');
  });

  // The deployed shape: real sockets, transactions per command, and narration as
  // a separate drain. What is under test is the seam the in-memory build hides —
  // a command answers 202 with the episode still pending, and only the queue in
  // the database carries it to published prose.
  describe('over HTTP with the outbox worker', () => {
    const SECRET = 'postgres-integration-secret-never-use-this-in-production';
    const clock = { t: T0 };
    let serving: AppInstance | null = null;
    let base = '';

    afterEach(async () => {
      if (serving) await serving.close().catch(() => {});
      serving = null;
      base = '';
    });

    async function start(seed = SEED, rateLimit?: { capacity: number; refillPerMinute: number }): Promise<string> {
      serving = buildApp({
        dbUrl: url!, secret: SECRET, seed, devUserIds: ['user_http'],
        now: () => clock.t,
        ...(rateLimit ? { rateLimit } : {}),
      });
      const server = await serving.listen({ port: 0 });
      base = server.url;
      return base;
    }

    async function req(
      method: 'GET' | 'POST',
      path: string,
      opts: { token?: string; body?: Record<string, unknown> } = {},
    ): Promise<{ status: number; body: Record<string, unknown>; headers: Record<string, string> }> {
      const headers: Record<string, string> = {};
      if (opts.token) headers.authorization = `Bearer ${opts.token}`;
      if (opts.body) {
        headers['content-type'] = 'application/json';
        if (opts.body.commandId !== undefined) headers['idempotency-key'] = String(opts.body.commandId);
      }
      const res = await fetch(base + path, { method, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
      return {
        status: res.status,
        body: (await res.json()) as Record<string, unknown>,
        headers: Object.fromEntries(res.headers.entries()),
      };
    }

    async function signIn(): Promise<string> {
      const res = await req('POST', '/dev/token', { body: { userId: 'user_http' } });
      if (res.status !== 200) throw new Error(`sign-in failed: ${res.status} ${JSON.stringify(res.body)}`);
      return res.body.token as string;
    }

    const episodeState = async (token: string, worldId: string, episodeId: string) =>
      req('GET', `/v1/worlds/${worldId}/episodes/${episodeId}`, { token });

    it('commits with the episode pending and lets the worker publish it', async () => {
      await start();
      const token = await signIn();
      const created = await req('POST', '/v1/worlds', {
        token,
        body: {
          schemaVersion: '1.0', commandId: 'cmd_http_world', mode: 'create', templateId: 'glass-harbor-2034',
          setting: { era: '2034', location: 'singapore', role: 'founder-ceo', genre: 'speculative-corporate-mystery' },
        },
      });
      expect(created.status).toBe(202);
      const worldId = created.body.worldId as string;
      const episodeId = created.body.episodeId as string;
      expect(created.body.episodeStatus).toBe('pending');

      // The commit is durable while the prose is not yet written: the ledger moved,
      // the episode row is pending, and the queue holds the job.
      const ledger = await pg.read({ worldIds: [worldId], userIds: ['user_http'] }, (store) => ({
        version: store.worlds.get(worldId)!.stateVersion,
        status: store.episodes.get(episodeId)!.status,
        queued: store.outbox.length,
      }));
      expect(ledger.version).toBe(1);
      expect(ledger.status).toBe('pending');
      expect(ledger.queued).toBe(1);

      const polling = await episodeState(token, worldId, episodeId);
      expect(polling.status).toBe(200);
      expect(polling.body.status).toBe('pending');
      expect(polling.body.episode).toBeUndefined();

      expect(await serving!.worker().drain()).toEqual({ completed: 1, retried: 0 });

      const published = await episodeState(token, worldId, episodeId);
      expect(published.body.status).toBe('published');
      const episode = published.body.episode as { content: string; allowedChoiceIds: string[] };
      expect(episode.content.length).toBeGreaterThan(0);
      expect(episode.allowedChoiceIds.length).toBeGreaterThan(0);

      // A second drain finds nothing: the job left the queue, so the worker cannot
      // re-narrate an episode whose prose is immutable.
      expect(await serving!.worker().drain()).toEqual({ completed: 0, retried: 0 });

      // And the turn continues over the same sockets the client used.
      const worlds = await req('GET', '/v1/worlds', { token });
      const rows = worlds.body.items as { worldId: string; identityId: string }[];
      expect(rows.map((i) => i.worldId)).toContain(worldId);
      // The list has to carry the identity too: it is the only place a client
      // that has not opened a world yet can read what a mutation must name.
      expect(rows.every((i) => i.identityId.length > 0)).toBe(true);

      const view = await req('GET', `/v1/worlds/${worldId}`, { token });
      expect(view.status).toBe(200);
      const identityId = view.body.identityId as string;
      expect(identityId.length).toBeGreaterThan(0);
      const offered = (view.body.choices as { choiceId: string }[])[0]!;

      const chosen = await req('POST', `/v1/worlds/${worldId}/choices`, {
        token,
        body: {
          schemaVersion: '1.0', commandId: 'cmd_http_choice', actorIdentityId: identityId,
          expectedWorldVersion: view.body.stateVersion as number, choiceId: offered.choiceId,
        },
      });
      expect(chosen.status).toBe(200);
      expect(chosen.body.episodeStatus).toBe('pending');
      // A client told `pending` must be given the id it polls — otherwise the
      // 202-then-poll contract has no second step.
      const nextEpisodeId = chosen.body.episodeId as string;
      expect(typeof nextEpisodeId).toBe('string');
      expect((await episodeState(token, worldId, nextEpisodeId)).body.status).toBe('pending');
      expect(await serving!.worker().drain()).toEqual({ completed: 1, retried: 0 });
      expect((await episodeState(token, worldId, nextEpisodeId)).body.status).toBe('published');

      const list = await req('GET', `/v1/worlds/${worldId}/episodes?limit=10`, { token });
      const items = list.body.items as { status: string }[];
      expect(items.length).toBe(2);
      expect(items.every((e) => e.status === 'published')).toBe(true);
    });

    // F-S10. Measured on a live dev process on 2026-10-12: the database behind a
    // running server was wiped, the server's `provisioned` memo still insisted it had
    // created the account, and every request from that account 401ed at `engine.ts:125`
    // until the process restarted. F15's account deletion reaches the same state on
    // purpose, so this is a product path and not only a fixture hazard.
    it('re-provisions an account whose row went away underneath the memo', async () => {
      await start();
      const token = await signIn();
      // The call that succeeds is the one that puts the account in the memo.
      expect((await req('GET', '/v1/worlds', { token })).status).toBe(200);

      await pool.query(`delete from punkgrid.users where id = 'user_http'`);

      // Without the fix this is 401 "Authentication required" for the rest of the
      // process's life, which a client reads as a bad token.
      const after = await req('GET', '/v1/worlds', { token });
      expect(after.status).toBe(200);
      // And the row is actually back, not merely absent in a way this read did not
      // happen to notice.
      const stored = await pool.query<{ n: string }>(
        `select count(*)::text as n from punkgrid.users where id = 'user_http'`,
      );
      expect(stored.rows[0]!.n).toBe('1');
    });

    it('recovers the job of a worker that died holding it', async () => {
      await start();
      const token = await signIn();
      const created = await req('POST', '/v1/worlds', {
        token,
        body: {
          schemaVersion: '1.0', commandId: 'cmd_http_crash', mode: 'create', templateId: 'glass-harbor-2034',
          setting: { era: '2034', location: 'singapore', role: 'founder-ceo', genre: 'speculative-corporate-mystery' },
        },
      });
      const worldId = created.body.worldId as string;
      const episodeId = created.body.episodeId as string;

      // A worker claims the job and dies with it. The row stays `claimed` and the
      // lease is the only statement in the database about who holds it: once the
      // lease has passed, no living worker holds it, and the work is open again.
      const held = await pg.claimJob();
      expect(held?.episodeId).toBe(episodeId);
      await pool.query(
        `update punkgrid.outbox_jobs set lease_until = now() - interval '1 second' where id = $1 and status = 'claimed'`,
        [held!.id],
      );
      expect((await pool.query(`select attempts from punkgrid.outbox_jobs where id = $1`, [held!.id])).rows[0]!.attempts).toBe(1);

      // Without this recovery a load run of 600 sessions against two API processes
      // left an episode `pending` with its job `claimed` and the lease passed.
      expect(await serving!.worker().drain()).toEqual({ completed: 1, retried: 0 });
      expect((await episodeState(token, worldId, episodeId)).body.status).toBe('published');
      expect((await pool.query(`select status from punkgrid.outbox_jobs where id = $1`, [held!.id])).rows[0]!.status).toBe('completed');
    });

    it('the queue survives the process: a restart still narrates', async () => {
      await start();
      const token = await signIn();
      const created = await req('POST', '/v1/worlds', {
        token,
        body: {
          schemaVersion: '1.0', commandId: 'cmd_http_crash', mode: 'create', templateId: 'glass-harbor-2034',
          setting: { era: '2034', location: 'singapore', role: 'founder-ceo', genre: 'speculative-corporate-mystery' },
        },
      });
      const worldId = created.body.worldId as string;
      const episodeId = created.body.episodeId as string;
      expect(created.body.episodeStatus).toBe('pending');

      // The API process dies before any worker pass. Nothing was narrated in it,
      // and nothing was narrated on close.
      await serving!.close();
      serving = null;

      // A replacement process, different id space, same database: the job it finds
      // is the one the dead process queued.
      await start(SEED + 1);
      const replays = await req('GET', `/v1/worlds/${worldId}/episodes/${episodeId}`, { token });
      expect(replays.body.status).toBe('pending');

      expect(await serving!.worker().drain()).toEqual({ completed: 1, retried: 0 });
      const after = await req('GET', `/v1/worlds/${worldId}/episodes/${episodeId}`, { token });
      expect(after.body.status).toBe('published');
      expect((after.body.episode as { content: string }).content.length).toBeGreaterThan(0);
    });

    // NFR-01 and NFR-02 (Master §6) measured on the shape a deployment has:
    // Postgres canon, the outbox worker in its own loop, and — since F-S6 — one
    // shared rate-limit round trip on every authenticated request. The numbers
    // in core/tests/e2e.test.ts are the in-memory path and say nothing about the
    // cost of this one.
    //
    // The policy here is wider than DEFAULT_POLICY because the clock this file
    // gives the app is frozen (`clock.t` never moves), so the in-process address
    // bucket would refill never and thirty reads would be a denial of service
    // rather than a measurement. Per-request cost is the same at any capacity.
    it('answers reads inside NFR-01 with the queue and the shared bucket on the path', async () => {
      await start(SEED, { capacity: 300, refillPerMinute: 300 });
      const token = await signIn();
      const created = await req('POST', '/v1/worlds', {
        token,
        body: {
          schemaVersion: '1.0', commandId: 'cmd_http_nfr01', mode: 'create', templateId: 'glass-harbor-2034',
          setting: { era: '2034', location: 'singapore', role: 'founder-ceo', genre: 'speculative-corporate-mystery' },
        },
      });
      expect(created.status).toBe(202);
      const worldId = created.body.worldId as string;
      expect(await serving!.worker().drain()).toEqual({ completed: 1, retried: 0 });

      // The three reads the app performs while a player simply looks at a world.
      const routes = ['/v1/worlds', `/v1/worlds/${worldId}`, `/v1/worlds/${worldId}/episodes?limit=10`];
      const ms: number[] = [];
      for (let i = 0; i < 30; i += 1) {
        const started = performance.now();
        const res = await req('GET', routes[i % routes.length]!, { token });
        ms.push(performance.now() - started);
        expect(res.status).toBe(200);
        expect(res.headers['x-request-id']).toBeTruthy();
      }

      const sorted = [...ms].sort((a, b) => a - b);
      const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p / 100) - 1)]!;
      expect(at(95)).toBeLessThan(500);
      console.log(`deployed-shape reads (Postgres + worker + shared bucket, n=${ms.length} GET): p50=${at(50).toFixed(1)}ms p95=${at(95).toFixed(1)}ms max=${sorted[sorted.length - 1]!.toFixed(1)}ms`);
    });

    it('settles the first episode inside the NFR-02 window through the queue', async () => {
      await start(SEED, { capacity: 300, refillPerMinute: 300 });
      const token = await signIn();
      const created = await req('POST', '/v1/worlds', {
        token,
        body: {
          schemaVersion: '1.0', commandId: 'cmd_http_nfr02', mode: 'create', templateId: 'glass-harbor-2034',
          setting: { era: '2034', location: 'singapore', role: 'founder-ceo', genre: 'speculative-corporate-mystery' },
        },
      });
      expect(created.status).toBe(202);
      const worldId = created.body.worldId as string;
      const episodeId = created.body.episodeId as string;

      // ADR-013: the clock starts at the commit, which is what the 202 means, and
      // stops when the opening episode reads published (or fallback). The worker
      // runs its own loop, so the number includes the idle wait a real instance
      // sleeps between passes — that wait is the reason this is not measured by
      // calling drain() by hand.
      const worker = serving!.worker();
      const looping = worker.run();
      const committed = performance.now();
      let seen = await episodeState(token, worldId, episodeId);
      while (seen.body.status === 'pending' && performance.now() - committed < 20_000) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        seen = await episodeState(token, worldId, episodeId);
      }
      const settled = performance.now() - committed;
      worker.stop();
      await looping;

      expect(seen.body.status).toBe('published');
      expect((seen.body.episode as { content: string }).content.length).toBeGreaterThan(0);
      expect(settled).toBeLessThan(20_000);
      console.log(`first episode commit→published (queue + worker loop, local CompliantProvider): ${(settled / 1000).toFixed(2)}s`);
    });
  });

  // Sprint 6 (§1.7, §14): the same questions the HTTP attacker suite asks, one
  // layer down. The server authorises first and RLS is the second line of
  // defence — so these cases do not test the API, they test what a request-path
  // bug would still not be able to read. Each one runs as the deployed role,
  // inside the transaction shape that role uses.
  describe('security negatives as the deployed roles', () => {
    /** `SET LOCAL ROLE` only binds while both the transaction and the connection
     *  live, which is exactly the request path's shape — so every probe gets its
     *  own client and rolls back. */
    async function queryAs<T>(role: string, userId: string | null, sql: string, params: unknown[] = []): Promise<{ rows: T[]; rowCount: number; code?: string; message?: string }> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SET LOCAL ROLE ${role}`);
        if (userId !== null) await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
        const res = await client.query(sql, params);
        await client.query('ROLLBACK');
        return { rows: res.rows as T[], rowCount: res.rowCount ?? 0 };
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        const err = e as { code?: string; message?: string };
        return { rows: [], rowCount: 0, code: err.code, message: err.message };
      } finally {
        client.release();
      }
    }

    it('shows the application role nothing until a session user is set, then only its own rows', async () => {
      const { sessions } = makeSessions();
      await createUser(sessions, 'rls_owner');
      const created = await call(sessions, { userId: 'rls_owner' }, 'POST', '/v1/worlds', {
        commandId: 'cmd_rls_world', mode: 'create', templateId: 'glass-harbor-2034',
      });
      const worldId = created.body.worldId as string;

      // No session variable: every policy is false, so the role reads an empty
      // database — including the tables RLS was never enabled on, which is why
      // the probe set is the world-scoped ones.
      for (const table of ['worlds', 'world_events', 'world_snapshots', 'narrative_episodes', 'characters', 'commands', 'moderation_cases']) {
        expect((await queryAs('punkgrid_app', null, `select * from punkgrid.${table}`)).rows, table).toEqual([]);
      }

      // An injection-shaped session value matches no membership row either.
      const injected = await queryAs('punkgrid_app', "rls_owner' OR '1'='1", 'select id from punkgrid.worlds');
      expect(injected.rows).toEqual([]);

      // The owner sees exactly its own world and the rows inside it.
      const mine = await queryAs<{ id: string }>('punkgrid_app', 'rls_owner', 'select id from punkgrid.worlds');
      expect(mine.rows.map((r) => r.id)).toEqual([worldId]);
      const events = await queryAs<{ world_id: string }>('punkgrid_app', 'rls_owner', 'select world_id from punkgrid.world_events');
      expect(events.rows.length).toBeGreaterThan(0);
      expect(new Set(events.rows.map((r) => r.world_id))).toEqual(new Set([worldId]));

      // Another account, same role, same connection pool: nothing.
      expect((await queryAs('punkgrid_app', 'rls_other', 'select id from punkgrid.worlds')).rows).toEqual([]);
      expect((await queryAs('punkgrid_app', 'rls_other', 'select * from punkgrid.world_events')).rows).toEqual([]);
    });

    it('gives the application role no write path into the canon at all', async () => {
      // Column lists are the real ones from 002/004/006: a statement that fails on
      // `undefined column` (42703) would prove nothing about privileges, because
      // the parser dies before the executor ever asks.
      const attempts = [
        "INSERT INTO punkgrid.worlds (id, owner_user_id, mode, visibility, status, rulepack_id, rulepack_version, blueprint_version, world_time, version, last_event_seq) VALUES ('w_app_forge', 'rls_owner', 'personal', 'private', 'active', 'glass-harbor-2034', '1', '1', '2034-01-01T00:00:00Z', 0, 0)",
        "UPDATE punkgrid.worlds SET status = 'archived'",
        'DELETE FROM punkgrid.worlds',
        'TRUNCATE punkgrid.world_events',
        "INSERT INTO punkgrid.world_events (event_id, world_id, world_seq, command_id, event_type, event_payload_json, visibility, occurred_world_time, recorded_at, rulepack_version) VALUES ('evt_app_forge', 'no_such_world', 1, 'cmd_app_forge', 'world.created', '{}'::jsonb, 'world', '2034-01-01T00:00:00Z', now(), '1')",
        'DELETE FROM punkgrid.operation_log',
        'DELETE FROM punkgrid.deletion_audit',
        'UPDATE punkgrid.entitlements SET plan = plan',
      ];
      for (const sql of attempts) {
        const res = await queryAs('punkgrid_app', 'rls_owner', sql);
        // 42501 = insufficient_privilege: the grant list, not the policy, is what
        // stops a handler bug from turning SQL into a mutation path (§1.3).
        expect(res.code, sql).toBe('42501');
      }
    });

    // 010 is the one table the request path writes (F-S6), so it is the exception
    // that proves 008's rule. Both halves are measured here: the take works as the
    // role that serves traffic, and the statements around it do not.
    it('lets the request path spend a rate-limit bucket and nothing more', async () => {
      const spent = await queryAs<{ allowed: boolean; remaining: number }>(
        'punkgrid_app',
        'rls_rate_limited',
        "SELECT allowed, remaining FROM punkgrid.punkgrid_rate_limit_take('user_rls', 2, 60)",
      );
      expect(spent.code, spent.message).toBeUndefined();
      expect(spent.rows[0]?.allowed).toBe(true);

      // Readable by the request path, and deliberately outside row security: the
      // table names no world, so there is no membership to filter on. Each probe
      // rolls back, so the bucket the take wrote is not left behind.
      const rows = await queryAs<{ bucket_key: string }>('punkgrid_app', null, 'select bucket_key from punkgrid.rate_limit_bucket');
      expect(rows.code, rows.message).toBeUndefined();
      expect(rows.rows).toEqual([]);

      // DELETE and TRUNCATE are not among the grants: a handler bug cannot erase
      // who has been throttled, and cannot drop the guard mid-request.
      for (const sql of ['DELETE FROM punkgrid.rate_limit_bucket', 'TRUNCATE punkgrid.rate_limit_bucket']) {
        expect((await queryAs('punkgrid_app', 'rls_rate_limited', sql)).code, sql).toBe('42501');
      }

      // UPDATE *is* granted — it is how a take writes its own row — so what stops a
      // forged full bucket is the constraint in 010 rather than the grant list.
      const forge = await queryAs(
        'punkgrid_app',
        'rls_rate_limited',
        "INSERT INTO punkgrid.rate_limit_bucket (bucket_key, capacity, refill_per_minute, tokens, updated_at) VALUES ('forged', 2, 60, 1, now());"
        + " UPDATE punkgrid.rate_limit_bucket SET tokens = 1e6 WHERE bucket_key = 'forged'",
      );
      expect(forge.code, forge.message).toBe('23514');

      // The narration worker never throttles anyone, so it holds no grants here. The
      // function is invoker-rights, so being able to call it buys nothing: the write
      // inside it runs as the worker and stops at the table.
      const workerTake = await queryAs('punkgrid_worker', null, "SELECT * FROM punkgrid.punkgrid_rate_limit_take('worker_probe', 2, 60)");
      expect(workerTake.code, workerTake.message).toBe('42501');
    });

    it('holds the ledger append-only against the identities that do have write grants', async () => {
      const { sessions } = makeSessions();
      await createUser(sessions, 'rls_writer');
      const created = await call(sessions, { userId: 'rls_writer' }, 'POST', '/v1/worlds', {
        commandId: 'cmd_rls_write', mode: 'create', templateId: 'glass-harbor-2034',
      });
      expect(created.status).toBe(201);

      // The worker may write the ledger — that is its job — but two guards stand in
      // front of it, and they are not the ones 008's comment names. Row security is
      // enabled on all three tables, the worker holds no policy of any kind, and a
      // role that is subject to RLS sees no rows unless a policy says otherwise. So
      // an UPDATE is not an error: it matches nothing and quietly changes nothing
      // (0 rows, and the prose still reads back as written). That is the shape RLS
      // takes here, and it is why the assertion is about the data, not the status.
      for (const table of ['world_events', 'world_snapshots', 'narrative_episodes'] as const) {
        const column = table === 'world_events' ? 'event_payload_json' : table === 'world_snapshots' ? 'state_hash' : 'narrative_text';
        const update = await queryAs('punkgrid_worker', null, `UPDATE punkgrid.${table} SET ${column} = NULL WHERE ${column} IS NOT NULL`);
        expect(update.code, `update ${table}`).toBeUndefined();
        expect(update.rowCount, `update ${table}`).toBe(0);

        // Removing history is not even a privilege the grant list discusses: 008
        // grants SELECT, INSERT, UPDATE and stops there, so this is 42501 on the ACL.
        const remove = await queryAs('punkgrid_worker', null, `DELETE FROM punkgrid.${table}`);
        expect(remove.code, `delete ${table}`).toBe('42501');
      }

      // Nothing was altered, as the identity that does own these tables can see.
      const untouched = await pool.query<{ n: string }>('select count(*)::text as n from punkgrid.world_events where event_payload_json is null');
      expect(Number(untouched.rows[0]!.n), 'a worker UPDATE wrote something').toBe(0);

      // `punkgrid_owner` owns these tables, so ownership lets it walk straight past
      // RLS. It still cannot rewrite history: the BEFORE triggers in 004/006 fire
      // for the owner too, and that is the only thing that stops it. If a future
      // migration adds FORCE ROW LEVEL SECURITY, or drops a trigger, this is the
      // case that notices.
      const guards: [string, string][] = [
        ["UPDATE punkgrid.world_events SET event_payload_json = '{}'::jsonb", 'append-only'],
        ['DELETE FROM punkgrid.world_events', 'append-only'],
        ["UPDATE punkgrid.world_snapshots SET state_hash = 'sha256:forged'", 'immutable'],
        ['DELETE FROM punkgrid.world_snapshots', 'immutable'],
        ["UPDATE punkgrid.narrative_episodes SET narrative_text = 'rewritten'", 'immutable'],
        ['DELETE FROM punkgrid.narrative_episodes', 'immutable'],
      ];
      for (const [sql, why] of guards) {
        const res = await queryAs('punkgrid_owner', null, sql);
        expect(res.message ?? '', sql).toContain(why);
      }
    });

    it('keeps the daily USD budget per account and across a process restart', async () => {
      // unitCost is 0.004 per narration: two episodes per day, then fallback.
      const provider = new CompliantProvider();
      const first = makeSessions(provider, { usdBudgetPerUserPerDay: 0.008 });
      await createUser(first.sessions, 'rls_budget');
      await createUser(first.sessions, 'rls_neighbour');

      /** One narration per call: genesis first, then a choice on the same line. */
      type Line = { worldId: string; identity: string; version: number; episodeId: string };
      const play = async (s: Sessions, userId: string, commandId: string, line?: Line): Promise<Line> => {
        if (!line) {
          const res = await call(s, { userId }, 'POST', '/v1/worlds', { commandId, mode: 'create', templateId: 'glass-harbor-2034' });
          const worldId = res.body.worldId as string;
          const view = await call(s, { userId }, 'GET', `/v1/worlds/${worldId}`);
          return { worldId, identity: view.body.identityId as string, version: view.body.stateVersion as number, episodeId: res.body.episodeId as string };
        }
        const res = await call(s, { userId }, 'POST', `/v1/worlds/${line.worldId}/choices`, {
          commandId, actorIdentityId: line.identity, expectedWorldVersion: line.version, choiceId: 'confront_mara',
        });
        return { ...line, version: (res.body.commandResult as { newVersion: number }).newVersion, episodeId: res.body.episodeId as string };
      };
      const status = async (s: Sessions, userId: string, w: Line) =>
        (await call(s, { userId }, 'GET', `/v1/worlds/${w.worldId}/episodes/${w.episodeId}`)).body.status;

      const mine = await play(first.sessions, 'rls_budget', 'cmd_budget_1');
      expect(provider.calls).toBe(1);
      expect(await status(first.sessions, 'rls_budget', mine)).toBe('published');

      const second = await play(first.sessions, 'rls_budget', 'cmd_budget_2', mine);
      expect(provider.calls).toBe(2);

      // The third episode is still delivered: the budget degrades the prose to
      // the templated fallback, it does not lock the account out or throw.
      const third = await play(first.sessions, 'rls_budget', 'cmd_budget_3', second);
      expect(provider.calls).toBe(2);
      expect(await status(first.sessions, 'rls_budget', third)).toBe('fallback');

      // A different account in the same database is untouched by it.
      const neighbour = await play(first.sessions, 'rls_neighbour', 'cmd_budget_neighbour');
      expect(provider.calls).toBe(3);
      expect(await status(first.sessions, 'rls_neighbour', neighbour)).toBe('published');

      // A new process — new engine, new id space, same rows — must remember what
      // the account already spent, or a restart would reset the cap. The fresh seed
      // is not decoration: `makeIdFactory` is deterministic, so a second Sessions
      // built from SEED mints event ids that already exist, `on conflict (event_id)
      // do nothing` quietly drops the row, and the ledger trigger then rejects the
      // next one as a gap. That is AppConfig.seed's rule, shown here as a failure.
      const restarted = makeSessions(provider, { usdBudgetPerUserPerDay: 0.008, seed: SEED + 7 });
      const afterRestart = await play(restarted.sessions, 'rls_budget', 'cmd_budget_4', third);
      expect(await status(restarted.sessions, 'rls_budget', afterRestart)).toBe('fallback');
      const neighbourAfter = await play(restarted.sessions, 'rls_neighbour', 'cmd_budget_neighbour_2', neighbour);
      expect(await status(restarted.sessions, 'rls_neighbour', neighbourAfter)).toBe('published');
    });
  });

  // F-S6. More than one instance behind the public edge has to share one answer to
  // "how much has this account already spent". Two `buildApp` objects, each with
  // its own pool, stand in for two processes: separate connections, separate
  // bucket objects, one table. The seeds differ because two processes over one
  // database may not share an id space (F-S5).
  describe('shared rate limit', () => {
    const SECRET = 'shared-bucket-secret-never-use-this-in-production';
    const policy = { capacity: 6, refillPerMinute: 1 };
    const opened: AppInstance[] = [];

    function instance(seedOffset: number, rateLimit = policy): AppInstance {
      const serving = buildApp({ dbUrl: url!, secret: SECRET, seed: SEED + seedOffset, rateLimit });
      opened.push(serving);
      return serving;
    }

    afterEach(async () => {
      for (const serving of opened.splice(0)) await serving.close();
    });

    const allowedOf = (d: RateLimitDecision) => d.allowed;
    const retryAfterOf = (d: RateLimitDecision) => (d.allowed ? 0 : d.retryAfterSeconds);

    it('gives two processes one allowance', async () => {
      const here = instance(0);
      const there = instance(11);
      const taken: RateLimitDecision[] = [];
      const ms: number[] = [];
      for (let i = 0; i < 10; i += 1) {
        const limiter = (i % 2 === 0 ? here : there).limiters.accounts;
        const started = performance.now();
        taken.push(await limiter.tryTake('user_shared'));
        ms.push(performance.now() - started);
      }

      // Six, not twelve: a second instance no longer doubles the budget.
      expect(taken.filter(allowedOf)).toHaveLength(policy.capacity);
      expect(Math.min(...taken.filter((d) => !d.allowed).map(retryAfterOf))).toBeGreaterThan(0);

      // What the shared bucket costs the customer: one round trip per
      // authenticated request, measured here rather than assumed in the docs.
      const sorted = [...ms].sort((a, b) => a - b);
      console.log(`shared bucket take (local Postgres, n=${ms.length}): p50=${sorted[Math.floor(ms.length / 2)]?.toFixed(2)}ms max=${sorted[sorted.length - 1]?.toFixed(2)}ms`);
    });

    it('does not overspend when two processes take at the same instant', async () => {
      const here = instance(0);
      const there = instance(11);
      // No sequencing between the calls: the row lock is the only thing keeping
      // the two from reading the same level and both spending it.
      const races = await Promise.all(
        Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? here : there).limiters.accounts.tryTake('user_race')),
      );
      expect(races.filter(allowedOf)).toHaveLength(policy.capacity);
    });

    it('decides the same sequence as the in-process bucket', async () => {
      // The shared bucket has to be the same rule with a different store, or the
      // single-process alpha and the deployed shape throttle differently. The
      // clocks differ (frozen here, the database's own there), which is why the
      // refill is one a minute and the run is six takes long.
      const here = instance(0, { capacity: 3, refillPerMinute: 1 });
      const shared = here.limiters.accounts;
      const local = new TokenBucket({ capacity: 3, refillPerMinute: 1, now: () => T0 });
      const sharedRun: boolean[] = [];
      const localRun: boolean[] = [];
      for (let i = 0; i < 6; i += 1) {
        sharedRun.push((await shared.tryTake('user_conform')).allowed);
        localRun.push((await local.tryTake('user_conform')).allowed);
      }
      expect(sharedRun).toEqual([true, true, true, false, false, false]);
      expect(sharedRun).toEqual(localRun);
    });

    it('re-states the policy on every take, so a shrunk capacity is not spendable', async () => {
      const wide = instance(0, { capacity: 8, refillPerMinute: 60 });
      expect((await wide.limiters.accounts.tryTake('user_policy')).allowed).toBe(true);

      // Seven tokens are in the row. The new capacity is one, so exactly one take
      // is spendable: a shrunken policy cannot hand out the old burst.
      const narrow = instance(11, { capacity: 1, refillPerMinute: 60 });
      expect((await narrow.limiters.accounts.tryTake('user_policy')).allowed).toBe(true);
      expect((await narrow.limiters.accounts.tryTake('user_policy')).allowed).toBe(false);
    });

    it('keeps the anonymous guard per process, by design', async () => {
      const here = instance(0);
      const there = instance(11);
      // Deliberate asymmetry with the account bucket: an unauthenticated request
      // must not cost a database write, so the address guard stays in the process
      // and spends its own capacity on each instance (rateLimit.ts).
      for (let i = 0; i < policy.capacity; i += 1) {
        expect((await here.limiters.addresses.tryTake('ip:198.51.100.7')).allowed).toBe(true);
      }
      expect((await there.limiters.addresses.tryTake('ip:198.51.100.7')).allowed).toBe(true);
      expect((await here.limiters.addresses.tryTake('ip:198.51.100.7')).allowed).toBe(false);
    });
  });
});

describe('Postgres suite guard', () => {
  it('states plainly whether the database suite ran', () => {
    expect(enabled).toBeTypeOf('boolean');
    if (!enabled) {
      // Loud in the reporter: without this line a green run would read as though
      // the persistence path had been exercised.
      process.stdout.write('\n  ! Postgres suite SKIPPED — set PUNKGRID_DB_URL and PUNKGRID_TEST_DB=1\n\n');
    }
  });
});

/** Empties the schema by naming every table, then proves it.
 *
 *  The earlier version truncated `users ... cascade` and looked correct until a
 *  replay started producing 22 events instead of 28: `world_facts` had no foreign
 *  key to `worlds`, so cascade never reached it, and facts from the previous run
 *  were hydrated as if this world already knew them. A projection table can be
 *  added later without an FK too, so the wipe lists tables from the catalog and
 *  fails loudly if any row survives.
 */
async function wipe(pool: PgPool) {
  const { rows } = await pool.query<{ tablename: string }>(
    `select tablename from pg_tables where schemaname = 'punkgrid' order by tablename`,
  );
  const names = rows.map((r) => r.tablename);
  if (names.length === 0) throw new Error('wipe found no punkgrid tables — did the migrations run?');
  await pool.query(`truncate table ${names.map((t) => `punkgrid.${quoteIdent(t)}`).join(', ')} cascade`);
  const counts = await pool.query<{ tablename: string; n: string }>(
    names.map((t) => `select '${t}' as tablename, count(*)::text as n from punkgrid.${quoteIdent(t)}`).join(' union all '),
  );
  const dirty = counts.rows.filter((c) => Number(c.n) > 0);
  if (dirty.length > 0) {
    throw new Error(`wipe left rows behind: ${dirty.map((d) => `${d.tablename}=${d.n}`).join(', ')}`);
  }
}

function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`unsafe table name: ${name}`);
  return `"${name}"`;
}
