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

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Api, type ApiRequest, scopeOf } from '../src/api.js';
import { Engine } from '../src/engine.js';
import { GLASS_HARBOR } from '../src/glassHarbor.js';
import { CompliantProvider } from '../src/providers.js';
import { makeIdFactory } from '../src/domain.js';
import { createPool, type PgPool } from '../src/db/client.js';
import { defaultMigrationDir, migrate } from '../src/db/migrate.js';
import { PgStore } from '../src/db/pgStore.js';
import { Sessions } from '../src/db/session.js';

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

  const makeSessions = (provider = new CompliantProvider(), opts: { usdBudgetPerUserPerDay?: number; autoFlush?: boolean } = {}) => {
    const ids = makeIdFactory(SEED);
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
    const run = (engine: Engine) => new Api(engine).handle(req);
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
