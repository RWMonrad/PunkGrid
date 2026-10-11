// Postgres-backed unit of work for the canonical store.
//
// The engine works against the in-memory Store (contract 3 keeps one canonical
// write point, and the golden tests pin its behaviour). PgStore hydrates that
// Store from Postgres, then writes the aggregate back inside one transaction, so
// the database stays authoritative while the engine stays pure.
//
// Serialisation: every unit of work takes a transaction-scoped advisory lock on
// the world id before hydrating, so two processes can never interleave a
// read-modify-write on the same world. The engine's optimistic version check is
// therefore evaluated against data no other writer can change mid-flight.

import type { PoolClient } from 'pg';
import type { PgPool } from './client.js';
import {
  type CommandResult, type DomainEvent, type ID, type ISOTime, type World, type WorldState,
} from '../domain.js';
import { err } from '../errors.js';
import {
  Store, characterKey, factKey, membershipKey, snapshotKey,
  type CommandRow, type EpisodeRow, type FactRow, type ScheduledEventRow, type SnapshotRow,
} from '../store.js';

export interface LoadScope {
  /** Worlds whose full aggregate (ledger, snapshots, cast, episodes) is loaded. */
  worldIds?: ID[];
  /** Accounts whose users, identities and entitlements are loaded, together with
   *  the header rows of every world they own (needed for quota checks). */
  userIds?: ID[];
  /** Load every row. Development and test scope only — never on a request path. */
  everything?: boolean;
}

export interface SaveScope {
  worldIds: ID[];
  /** Wall clock stamped on events and audit rows; supplied by the caller so a
   *  replay reproduces identical rows (contract 6, NFR-04). */
  recordedAt: ISOTime;
  userIds?: ID[];
}

/** The transaction a unit of work runs in. Handlers must use `client` for any
 *  extra read so it sees the locked, pre-commit state. */
export interface Tx {
  client: PoolClient;
  save(store: Store, worldIds: ID[], recordedAt: ISOTime): Promise<void>;
}

export class PgStore {
  constructor(private readonly pool: PgPool) {}

  /** Runs fn inside one transaction holding the world's advisory lock. */
  async unit<T>(scope: LoadScope, fn: (store: Store, tx: Tx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const worldId of scope.worldIds ?? []) {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', [worldId]);
      }
      const store = await this.load(scope, client);
      const tx: Tx = { client, save: (s, worldIds, recordedAt) => this.save(s, { worldIds, recordedAt }, client) };
      const result = await fn(store, tx);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /** A read-only hydration; no lock and no write path. */
  async read<T>(scope: LoadScope, fn: (store: Store) => T | Promise<T>): Promise<T> {
    const store = await this.load(scope);
    return fn(store);
  }

  // =========================================================================
  // Hydration
  // =========================================================================
  async load(scope: LoadScope, client: PgPool | PoolClient = this.pool): Promise<Store> {
    const store = new Store();
    const worldIds = scope.worldIds ?? [];
    const userIds = scope.userIds ?? [];
    const all = Boolean(scope.everything);

    const q = <T>(sql: string, params: unknown[] = []) => client.query(sql, params).then((r) => r.rows as T[]);

    const users = await q<{ id: string; created_at: Date }>(
      all ? `select id, created_at from punkgrid.users`
        : `select id, created_at from punkgrid.users where id = any($1) or id in (select owner_user_id from punkgrid.worlds where id = any($1))`,
      [userIds],
    );
    for (const u of users) store.users.set(u.id, { id: u.id, createdAt: u.created_at.toISOString() });

    const identities = await q<{ id: string; owner_user_id: string; persona_schema_version: string; profile_json: Record<string, unknown>; status: 'active' | 'archived' }>(
      all ? `select * from punkgrid.identities`
        : `select * from punkgrid.identities where owner_user_id = any($1) or id = any(select identity_id from punkgrid.world_memberships where world_id = any($1))`,
      [[...userIds, ...worldIds]],
    );
    for (const i of identities) {
      store.identities.set(i.id, { id: i.id, ownerUserId: i.owner_user_id, personaSchemaVersion: i.persona_schema_version, profile: i.profile_json ?? {}, status: i.status });
      store.users.set(i.owner_user_id, store.users.get(i.owner_user_id) ?? { id: i.owner_user_id, createdAt: this.wallFallback() });
    }

    const entitlements = await q<{ user_id: string; plan: 'free' | 'premium'; active_until: Date | null; max_active_worlds: number }>(
      all ? `select * from punkgrid.entitlements` : `select * from punkgrid.entitlements where user_id = any($1)`,
      [[...userIds, ...identities.map((i) => i.owner_user_id)]],
    );
    for (const e of entitlements) {
      store.entitlements.set(e.user_id, { userId: e.user_id, plan: e.plan, activeUntil: e.active_until?.toISOString() ?? null, maxActiveWorlds: e.max_active_worlds });
    }

    const worlds = await q<WorldRow>(
      all ? `select * from punkgrid.worlds`
        : `select * from punkgrid.worlds where id = any($1) or owner_user_id = any($2)`,
      [worldIds, [...new Set([...userIds, ...identities.map((i) => i.owner_user_id)])]],
    );
    const loadedWorldIds = [...new Set([...worldIds, ...worlds.map((w) => w.id)])];
    for (const w of worlds) {
      store.worlds.set(w.id, {
        id: w.id, ownerUserId: w.owner_user_id, mode: w.mode, visibility: w.visibility, status: w.status,
        rulepackId: w.rulepack_id, rulepackVersion: w.rulepack_version, blueprintVersion: w.blueprint_version,
        stateVersion: Number(w.version), lastEventSequence: Number(w.last_event_seq),
        worldTime: w.world_time.toISOString(), createdAt: w.created_at.toISOString(),
      } as World);
      store.users.set(w.owner_user_id, store.users.get(w.owner_user_id) ?? { id: w.owner_user_id, createdAt: w.created_at.toISOString() });
    }

    const detail = all ? loadedWorldIds : worldIds;
    if (detail.length === 0) {
      this.finishOutbox(store, []);
      return store;
    }

    const memberships = await q<MembershipRow>(`select * from punkgrid.world_memberships where world_id = any($1)`, [detail]);
    for (const m of memberships) store.memberships.set(membershipKey(m.world_id, m.user_id), { worldId: m.world_id, userId: m.user_id, identityId: m.identity_id, role: m.role, status: m.status as 'active' });

    const blueprints = await q<BlueprintRow>(`select * from punkgrid.world_blueprints where world_id = any($1)`, [detail]);
    for (const b of blueprints) {
      store.blueprints.set(b.world_id, { worldId: b.world_id, schemaVersion: b.schema_version, seed: Number(b.seed), setting: b.setting_json, constraints: b.world_constraints_json, validatedAt: b.validated_at.toISOString() });
    }

    const characters = await q<CharacterRowTs>(`select * from punkgrid.characters where world_id = any($1) order by id`, [detail]);
    for (const c of characters) store.characters.set(characterKey(c.world_id, c.id), { id: c.id, worldId: c.world_id, ownerIdentityId: c.owner_identity_id, name: c.name, profile: c.npc_profile_json ?? {} });

    const facts = await q<FactRowTs>(`select * from punkgrid.world_facts where world_id = any($1)`, [detail]);
    for (const f of facts) {
      store.facts.set(factKey(f.world_id, f.fact_id), { worldId: f.world_id, factId: f.fact_id, label: f.label, verified: f.verified, visibility: f.visibility, sensitivePhrase: f.sensitive_phrase ?? undefined });
    }

    const arcs = await q<ArcRowTs>(`select * from punkgrid.story_arcs where world_id = any($1)`, [detail]);
    for (const a of arcs) store.arcs.set(a.id, { id: a.id, worldId: a.world_id, arcType: a.arc_type, status: a.status });

    const offers = await q<OfferRowTs>(`select * from punkgrid.offered_choices where world_id = any($1)`, [detail]);
    for (const o of offers) store.offeredChoices.set(`${o.world_id}|${o.choice_id}`, { choiceId: o.choice_id, worldId: o.world_id, boundVersion: Number(o.bound_version), ruleId: o.rule_id, copy: o.copy });

    const events = await q<EventRowTs>(`select * from punkgrid.world_events where world_id = any($1) order by world_seq`, [detail]);
    for (const e of events) {
      const list = store.events.get(e.world_id) ?? [];
      list.push(evtFromRow(e));
      store.events.set(e.world_id, list);
    }

    const snapshots = await q<SnapshotRowTs>(`select * from punkgrid.world_snapshots where world_id = any($1) order by version`, [detail]);
    for (const s of snapshots) {
      store.snapshots.set(snapshotKey(s.world_id, Number(s.version)), {
        worldId: s.world_id, version: Number(s.version), stateSchemaVersion: '1.0',
        state: s.state_json as WorldState, stateHash: s.state_hash,
        lastEventSeq: Number(s.last_event_seq), createdAt: s.created_at.toISOString(),
      } as SnapshotRow);
    }

    const commands = await q<CommandRowTs>(`select * from punkgrid.commands where world_id = any($1) order by created_at`, [detail]);
    for (const c of commands) {
      store.commands.set(c.command_id, {
        commandId: c.command_id, worldId: c.world_id, requestHash: c.request_hash, actorUserId: c.actor_user_id,
        expectedWorldVersion: Number(c.expected_world_version), commandType: c.command_type, commandSchemaVersion: c.command_schema_version,
        status: c.status, result: (c.result_json ?? null) as CommandResult | null, createdAt: c.created_at.toISOString(),
      } as CommandRow);
    }

    const episodes = await q<EpisodeRowTs>(`select * from punkgrid.narrative_episodes where world_id = any($1) order by from_seq`, [detail]);
    for (const e of episodes) {
      store.episodes.set(e.id, {
        status: e.status,
        episode: {
          id: e.id, worldId: e.world_id, fromEventSequence: Number(e.from_seq), throughEventSequence: Number(e.through_seq),
          worldStateVersion: Number(e.world_version), content: e.narrative_text, referencedEventIds: e.referenced_event_ids,
          allowedChoiceIds: e.allowed_choice_ids, validationStatus: e.quality_status === 'passed' ? 'passed' : e.quality_status,
        },
      } as EpisodeRow);
    }

    const runs = await q<RunRowTs>(`select * from punkgrid.generation_runs where world_id = any($1) order by created_at`, [detail]);
    for (const r of runs) {
      store.generationRuns.set(r.id, {
        id: r.id, worldId: r.world_id, purpose: r.purpose, modelId: r.model_id, promptVersion: r.prompt_version,
        inputTokens: r.input_tokens, outputTokens: r.output_tokens, costUsd: Number(r.cost_usd),
        validationStatus: r.validation_status, createdAt: r.created_at.toISOString(),
      });
    }

    const scheduled = await q<ScheduledRowTs>(`select * from punkgrid.scheduled_events where world_id = any($1)`, [detail]);
    for (const s of scheduled) {
      store.scheduledEvents.set(s.id, {
        id: s.id, worldId: s.world_id, dueWorldTime: s.due_world_time.toISOString(), eventFamily: s.event_family,
        rulepackVersion: s.rulepack_version, idempotencyKey: s.idempotency_key, status: s.status,
        attempts: s.attempts, maxAttempts: s.max_attempts,
      } as ScheduledEventRow);
    }

    const jobs = await q<{ world_id: string; episode_id: string | null; command_id: string | null; kind: string }>(
      `select world_id, episode_id, command_id, kind from punkgrid.outbox_jobs where status = 'pending' and world_id = any($1) order by id`,
      [detail],
    );
    this.finishOutbox(store, jobs);
    return store;
  }

  private finishOutbox(store: Store, jobs: { world_id: string; episode_id: string | null; command_id: string | null; kind: string }[]) {
    for (const j of jobs) {
      if (!j.episode_id) continue;
      const world = store.worlds.get(j.world_id);
      store.outbox.push({ worldId: j.world_id, version: world?.stateVersion ?? 0, episodeId: j.episode_id, kind: j.kind });
    }
  }

  private wallFallback(): ISOTime { return new Date(0).toISOString(); }

  // =========================================================================
  // Persisting the aggregate
  // =========================================================================
  async save(store: Store, scope: SaveScope, client: PgPool | PoolClient = this.pool): Promise<void> {
    const recorded = new Date(scope.recordedAt);
    const userIds = scope.userIds ?? [...store.users.keys()];

    for (const id of userIds) {
      const u = store.users.get(id);
      if (!u) continue;
      await client.query(
        `insert into punkgrid.users (id, created_at) values ($1, $2) on conflict (id) do nothing`,
        [id, new Date(u.createdAt)],
      );
      const ent = store.entitlements.get(id);
      if (ent) {
        await client.query(
          `insert into punkgrid.entitlements (user_id, plan, active_until, source, max_active_worlds, verified_at)
           values ($1, $2, $3, 'manual_grant', $4, $5)
           on conflict (user_id) do update
             set plan = excluded.plan, active_until = excluded.active_until, max_active_worlds = excluded.max_active_worlds`,
          [id, ent.plan, ent.activeUntil ? new Date(ent.activeUntil) : null, ent.maxActiveWorlds, recorded],
        );
      }
    }

    for (const i of store.identities.values()) {
      await client.query(
        `insert into punkgrid.users (id, created_at) values ($1, $2) on conflict (id) do nothing`,
        [i.ownerUserId, recorded],
      );
      await client.query(
        `insert into punkgrid.identities (id, owner_user_id, persona_schema_version, profile_json, status)
         values ($1, $2, $3, $4::jsonb, $5)
         on conflict (id) do update set profile_json = excluded.profile_json, status = excluded.status`,
        [i.id, i.ownerUserId, i.personaSchemaVersion, JSON.stringify(i.profile), i.status],
      );
    }

    for (const worldId of scope.worldIds) {
      const world = store.worlds.get(worldId);
      if (!world) throw err.notFound(`Cannot persist unknown world ${worldId}`);
      await this.saveWorld(store, world, recorded, client);
    }

    await this.saveAudit(store, scope.worldIds, recorded, client);
  }

  private async saveWorld(store: Store, world: World, recorded: Date, client: PgPool | PoolClient) {
    const id = world.id;

    await client.query(
      `insert into punkgrid.worlds (id, owner_user_id, mode, visibility, status, rulepack_id, rulepack_version, blueprint_version, world_time, version, last_event_seq, created_at)
       values ($1,$2,'personal','private',$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (id) do update set
         status = excluded.status, world_time = excluded.world_time,
         version = excluded.version, last_event_seq = excluded.last_event_seq`,
      [id, world.ownerUserId, world.status, world.rulepackId, world.rulepackVersion, world.blueprintVersion,
        new Date(world.worldTime), world.stateVersion, world.lastEventSequence, new Date(world.createdAt)],
    );

    const membership = [...store.memberships.values()].find((m) => m.worldId === id);
    if (membership) {
      await client.query(
        `insert into punkgrid.world_memberships (world_id, user_id, identity_id, role, status)
         values ($1,$2,$3,'owner',$4) on conflict (world_id, user_id) do update set status = excluded.status`,
        [id, membership.userId, membership.identityId, membership.status],
      );
    }

    const bp = store.blueprints.get(id);
    if (bp) {
      await client.query(
        `insert into punkgrid.world_blueprints (world_id, schema_version, seed, setting_json, world_constraints_json, template_id, validated_at)
         values ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7)
         on conflict (world_id) do update set setting_json = excluded.setting_json, world_constraints_json = excluded.world_constraints_json`,
        [id, bp.schemaVersion, bp.seed, JSON.stringify(bp.setting), JSON.stringify(bp.constraints), String(bp.constraints.templateId ?? ''), new Date(bp.validatedAt)],
      );
    }

    for (const c of [...store.characters.values()].filter((c) => c.worldId === id)) {
      await client.query(
        `insert into punkgrid.characters (id, world_id, owner_identity_id, name, npc_profile_json)
         values ($1,$2,$3,$4,$5::jsonb)
         on conflict (world_id, id) do update set name = excluded.name, npc_profile_json = excluded.npc_profile_json`,
        [c.id, id, c.ownerIdentityId, c.name, JSON.stringify(c.profile ?? {})],
      );
    }

    const events = store.events.get(id) ?? [];
    // A BEFORE INSERT trigger enforces sequence discipline, so re-sending an
    // existing event is rejected before ON CONFLICT can ignore it. Only the rows
    // this transaction appended are sent.
    const highWater = await client.query<{ n: string }>(
      `select coalesce(max(world_seq), 0)::text as n from punkgrid.world_events where world_id = $1`, [id],
    );
    const lastPersistedSeq = Number(highWater.rows[0]?.n ?? 0);
    for (const e of events.filter((e) => e.sequence > lastPersistedSeq)) {
      await client.query(
        `insert into punkgrid.world_events
           (event_id, world_id, world_seq, command_id, event_type, event_schema_version, actor_character_id,
            caused_by_event_ids, event_payload_json, visibility, occurred_world_time, recorded_at, rulepack_version)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13)
         on conflict (event_id) do nothing`,
        [e.eventId, id, e.sequence, e.commandId, e.type, e.schemaVersion, e.actorCharacterId,
          e.causedByEventIds, JSON.stringify(e.payload ?? {}), e.visibility,
          new Date(e.worldTime), recorded, e.rulesetVersion],
      );
    }

    const snapshots = [...store.snapshots.values()].filter((s) => s.worldId === id).sort((a, b) => a.version - b.version);
    for (const s of snapshots) {
      await client.query(
        `insert into punkgrid.world_snapshots (world_id, version, state_schema_version, state_json, state_hash, last_event_seq, created_at)
         values ($1,$2,$3,$4::jsonb,$5,$6,$7) on conflict (world_id, version) do nothing`,
        [id, s.version, s.stateSchemaVersion, JSON.stringify(s.state), s.stateHash, s.lastEventSeq, new Date(s.createdAt)],
      );
    }

    for (const c of [...store.commands.values()].filter((c) => c.worldId === id)) {
      await client.query(
        `insert into punkgrid.commands
           (command_id, world_id, request_hash, actor_user_id, expected_world_version, command_type, command_schema_version, status, result_json, no_op_reason, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11) on conflict (command_id) do nothing`,
        [c.commandId, id, c.requestHash, c.actorUserId, c.expectedWorldVersion, c.commandType, c.commandSchemaVersion,
          c.status, JSON.stringify(c.result ?? {}), c.result?.noOpReason ?? null, new Date(c.createdAt)],
      );
    }

    // The derived projections (ADR-015) are rebuilt from the committed snapshot,
    // never patched, so they can never disagree with the ledger.
    const snap = store.snapshots.get(snapshotKey(id, world.stateVersion));
    if (!snap) throw err.notFound(`Cannot persist world ${id} without its snapshot for version ${world.stateVersion}`);

    const closedBy = eventPayloadIndex(events, 'story_arc.closed', 'arcId');
    for (const a of [...store.arcs.values()].filter((a) => a.worldId === id)) {
      const resolver = a.status === 'resolved' || a.status === 'failed' ? closedBy.get(a.id) : undefined;
      if ((a.status === 'resolved' || a.status === 'failed') && !resolver) {
        throw new Error(`Arc ${a.id} is ${a.status} but no story_arc.closed event exists`);
      }
      await client.query(
        `insert into punkgrid.story_arcs (id, world_id, arc_type, status, resolved_by_event_id)
         values ($1,$2,$3,$4,$5)
         on conflict (id) do update set status = excluded.status, resolved_by_event_id = excluded.resolved_by_event_id`,
        [a.id, id, a.arcType, a.status, resolver ?? null],
      );
    }

    const createdBy = eventPayloadIndex(events, 'fact.created', 'factId');
    const genesisEvent = events.find((e) => e.type === 'world.created')?.eventId ?? events[0]?.eventId;
    if (!genesisEvent) throw err.notFound(`Cannot persist facts of world ${id} with an empty ledger`);
    for (const f of [...store.facts.values()].filter((f) => f.worldId === id)) {
      await client.query(
        `insert into punkgrid.world_facts (world_id, fact_id, label, verified, visibility, sensitive_phrase, created_by_event_id)
         values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (world_id, fact_id) do update set label = excluded.label, verified = excluded.verified, visibility = excluded.visibility`,
        [id, f.factId, f.label, f.verified, f.visibility, f.sensitivePhrase ?? null, createdBy.get(f.factId) ?? genesisEvent],
      );
    }

    await client.query(`delete from punkgrid.character_knowledge where world_id = $1`, [id]);
    for (const [characterId, factIds] of Object.entries(snap.state.factualKnowledge)) {
      for (const factId of factIds) {
        const fact = store.facts.get(factKey(id, factId));
        const learned = eventPayloadIndex(events, 'fact.disclosed', 'factId', 'characterId').get(`${factId}|${characterId}`) ?? genesisEvent;
        await client.query(
          `insert into punkgrid.character_knowledge (world_id, character_id, fact_id, belief_state, confidence, learned_by_event_id, visibility)
           values ($1,$2,$3,'knows',100,$4,$5) on conflict do nothing`,
          [id, characterId, factId, learned, fact?.visibility ?? 'world'],
        );
      }
    }

    await client.query(`delete from punkgrid.relationships where world_id = $1`, [id]);
    for (const [key, value] of Object.entries(snap.state.relationships)) {
      const parts = key.split('|');
      const from = parts[0]!, to = parts[1]!, dimension = parts[2] ?? 'attitude';
      if (from === to) continue;
      await client.query(
        `insert into punkgrid.relationships (world_id, from_character_id, to_character_id, dimension, value)
         values ($1,$2,$3,$4,$5) on conflict do nothing`,
        [id, from, to, dimension, Math.round(value)],
      );
    }

    await client.query(`delete from punkgrid.offered_choices where world_id = $1`, [id]);
    for (const o of [...store.offeredChoices.values()].filter((o) => o.worldId === id)) {
      await client.query(
        `insert into punkgrid.offered_choices (world_id, choice_id, bound_version, rule_id, copy) values ($1,$2,$3,$4,$5)`,
        [id, o.choiceId, o.boundVersion, o.ruleId, o.copy],
      );
    }

    for (const s of [...store.scheduledEvents.values()].filter((s) => s.worldId === id)) {
      await client.query(
        `insert into punkgrid.scheduled_events (id, world_id, due_world_time, event_family, rulepack_version, idempotency_key, status, attempts, max_attempts)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         on conflict (id) do update set status = excluded.status, attempts = excluded.attempts`,
        [s.id, id, new Date(s.dueWorldTime), s.eventFamily, s.rulepackVersion, s.idempotencyKey, s.status, s.attempts, s.maxAttempts],
      );
    }

    // Generation runs must exist before the episodes that cite them.
    for (const r of [...store.generationRuns.values()].filter((r) => r.worldId === id)) {
      await client.query(
        `insert into punkgrid.generation_runs (id, world_id, purpose, model_id, prompt_version, input_tokens, output_tokens, cost_usd, validation_status, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (id) do nothing`,
        [r.id, id, r.purpose, r.modelId, r.promptVersion, r.inputTokens, r.outputTokens, r.costUsd, r.validationStatus, new Date(r.createdAt)],
      );
    }

    for (const row of [...store.episodes.values()].filter((e) => e.episode.worldId === id)) {
      await this.saveEpisode(row, recorded, client);
    }

    await this.syncOutbox(store, id, client);
  }

  /** Published prose is immutable (contract 7): an episode already published in
   *  the database may not be overwritten, so a divergence is an error, not a
   *  silent drop. */
  private async saveEpisode(row: EpisodeRow, recorded: Date, client: PgPool | PoolClient) {
    const e = row.episode;
    const quality = e.validationStatus === 'passed' ? 'passed' : e.validationStatus === 'fallback' ? 'fallback' : 'rejected';
    await client.query(
      `insert into punkgrid.narrative_episodes
         (id, world_id, from_seq, through_seq, world_version, narrative_text, referenced_event_ids, allowed_choice_ids, status, quality_status, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict (id) do nothing`,
      [e.id, e.worldId, e.fromEventSequence, e.throughEventSequence, e.worldStateVersion, e.content,
        e.referencedEventIds, e.allowedChoiceIds, row.status, quality, recorded],
    );
    const updated = await client.query(
      `update punkgrid.narrative_episodes
         set narrative_text = $2, referenced_event_ids = $3, allowed_choice_ids = $4,
             status = $5, quality_status = $6
       where id = $1 and status not in ('published','fallback')`,
      [e.id, e.content, e.referencedEventIds, e.allowedChoiceIds, row.status, quality],
    );
    if (updated.rowCount && updated.rowCount > 0) return;
    const { rows } = await client.query<{ status: string; narrative_text: string }>(
      `select status, narrative_text from punkgrid.narrative_episodes where id = $1`, [e.id],
    );
    const stored = rows[0];
    if (!stored) throw new Error(`Episode ${e.id} disappeared`);
    if (stored.narrative_text === e.content && stored.status === row.status) return;
    throw new Error(`Episode ${e.id} is ${stored.status} in the database and is immutable; publish a corrected episode instead`);
  }

  /** Outbox job lifecycle is derived from episode state: an episode awaiting
   *  narration has a pending job, a settled one has a completed job. */
  private async syncOutbox(store: Store, worldId: ID, client: PgPool | PoolClient) {
    for (const row of [...store.episodes.values()].filter((e) => e.episode.worldId === worldId)) {
      const needsWork = row.status !== 'published' && row.status !== 'fallback';
      if (needsWork) {
        await client.query(
          `insert into punkgrid.outbox_jobs (world_id, command_id, episode_id, kind, payload_json)
           select $1, $2, $3, 'episode.generate', '{}'::jsonb
           where not exists (
             select 1 from punkgrid.outbox_jobs where episode_id = $3 and status in ('pending','claimed')
           )`,
          [worldId, null, row.episode.id],
        );
      } else {
        await client.query(
          `update punkgrid.outbox_jobs set status = 'completed' where episode_id = $1 and status in ('pending','claimed')`,
          [row.episode.id],
        );
      }
    }
  }

  private async saveAudit(store: Store, worldIds: ID[], recorded: Date, client: PgPool | PoolClient) {
    const pending = store.audit.slice(store.auditCursor);
    for (const a of pending) {
      if (!worldIds.includes(a.worldId)) continue;
      const pseudonym = 'w_' + a.worldId.slice(-6);
      await client.query(
        `insert into punkgrid.operation_log (request_id, world_pseudonym, operation, reason_code, recorded_at)
         values ($1,$2,$3,$4,$5)`,
        [`sys_${store.auditCursor + 1}`, pseudonym, a.kind.split(':')[0] ?? a.kind, a.kind.includes(':') ? a.kind.split(':').slice(1).join(':') : null, recorded],
      );
    }
    store.auditCursor = store.audit.length;
  }

  // =========================================================================
  // Queries the engine cannot answer from a hydrated aggregate
  // =========================================================================

  /** FR-13 daily spend, read from the persisted ledger so a restart cannot
   *  reset a user's budget. */
  async dailySpendUsd(ownerUserId: ID, dayStartIso: ISOTime, client: PgPool | PoolClient = this.pool): Promise<number> {
    const { rows } = await client.query<{ total: string | null }>(
      `select coalesce(sum(r.cost_usd), 0) as total
         from punkgrid.generation_runs r
         join punkgrid.worlds w on w.id = r.world_id
        where w.owner_user_id = $1 and r.created_at >= $2`,
      [ownerUserId, new Date(dayStartIso)],
    );
    return Number(rows[0]?.total ?? 0);
  }

  /** The wall clock of the last genesis or resume for this world, which is the
   *  catch-up anchor (contract 8). Persisted, so it survives a restart. */
  async resumeAnchor(worldId: ID, client: PgPool | PoolClient = this.pool): Promise<number | null> {
    const { rows } = await client.query<{ created_at: Date | null }>(
      `select greatest(
         (select max(created_at) from punkgrid.commands where world_id = $1 and command_type in ('world.create','world.resume')),
         (select created_at from punkgrid.worlds where id = $1)
       ) as created_at`,
      [worldId],
    );
    const at = rows[0]?.created_at;
    return at ? at.getTime() : null;
  }

  async claimJob(): Promise<{ id: string; worldId: ID; episodeId: ID; kind: string } | null> {
    const { rows } = await this.pool.query<{ id: string; world_id: string; episode_id: string | null; kind: string }>(
      `update punkgrid.outbox_jobs j
          set status = 'claimed', attempts = j.attempts + 1, lease_until = now() + interval '60 seconds'
        from (
          select id from punkgrid.outbox_jobs
           where status = 'pending' and (lease_until is null or lease_until < now()) and attempts < max_attempts
           order by id limit 1 for update skip locked
        ) s
        where j.id = s.id
        returning j.id, j.world_id, j.episode_id, j.kind`,
    );
    const r = rows[0];
    if (!r || !r.episode_id) return null;
    return { id: r.id, worldId: r.world_id, episodeId: r.episode_id, kind: r.kind };
  }

  async finishJob(id: string, ok: boolean): Promise<void> {
    await this.pool.query(
      `update punkgrid.outbox_jobs set status = $2, lease_until = null where id = $1`,
      [id, ok ? 'completed' : 'failed'],
    );
  }
}

// --- row shapes (local to this module; the DB interface is for Kysely) ------
type WorldRow = { id: string; owner_user_id: string; mode: string; visibility: string; status: string; rulepack_id: string; rulepack_version: string; blueprint_version: string; world_time: Date; version: string; last_event_seq: string; created_at: Date };
type MembershipRow = { world_id: string; user_id: string; identity_id: string; role: 'owner'; status: string };
type BlueprintRow = { world_id: string; schema_version: string; seed: string; setting_json: Record<string, unknown>; world_constraints_json: Record<string, unknown>; validated_at: Date };
type CharacterRowTs = { id: string; world_id: string; owner_identity_id: string | null; name: string; npc_profile_json: Record<string, unknown> };
type FactRowTs = { world_id: string; fact_id: string; label: string; verified: boolean; visibility: 'owner' | 'participants' | 'world'; sensitive_phrase: string | null };
type ArcRowTs = { id: string; world_id: string; arc_type: string; status: 'locked' | 'open' | 'resolved' | 'failed' };
type OfferRowTs = { world_id: string; choice_id: string; bound_version: string; rule_id: string; copy: string };
type EventRowTs = { event_id: string; world_id: string; world_seq: string; command_id: string; event_type: string; event_schema_version: string; actor_character_id: string | null; caused_by_event_ids: string[]; event_payload_json: Record<string, unknown>; visibility: 'owner' | 'participants' | 'world'; occurred_world_time: Date; rulepack_version: string };
type SnapshotRowTs = { world_id: string; version: string; state_json: WorldState; state_hash: string; last_event_seq: string; created_at: Date };
type CommandRowTs = { command_id: string; world_id: string; request_hash: string; actor_user_id: string; expected_world_version: string; command_type: string; command_schema_version: string; status: 'committed' | 'no_op' | 'failed'; result_json: CommandResult | null; created_at: Date };
type EpisodeRowTs = { id: string; world_id: string; from_seq: string; through_seq: string; world_version: string; narrative_text: string; referenced_event_ids: string[]; allowed_choice_ids: string[]; status: EpisodeRow['status']; quality_status: 'passed' | 'rejected' | 'fallback'; created_at: Date };
type RunRowTs = { id: string; world_id: string; purpose: string; model_id: string; prompt_version: string; input_tokens: number; output_tokens: number; cost_usd: string; validation_status: string; created_at: Date };
type ScheduledRowTs = { id: string; world_id: string; due_world_time: Date; event_family: string; rulepack_version: string; idempotency_key: string; status: ScheduledEventRow['status']; attempts: number; max_attempts: number };

function evtFromRow(r: EventRowTs): DomainEvent {
  return {
    schemaVersion: '1.0', eventId: r.event_id, worldId: r.world_id, sequence: Number(r.world_seq),
    commandId: r.command_id, type: r.event_type, actorCharacterId: r.actor_character_id,
    causedByEventIds: r.caused_by_event_ids, payload: r.event_payload_json, visibility: r.visibility,
    worldTime: r.occurred_world_time.toISOString(), rulesetVersion: r.rulepack_version,
  };
}

function eventPayloadIndex(events: DomainEvent[], type: string, key: string, extraKey?: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of events) {
    if (e.type !== type) continue;
    const p = e.payload as Record<string, unknown> | null;
    const value = p?.[key];
    if (typeof value !== 'string') continue;
    const extra = extraKey ? String(p?.[extraKey] ?? '') : '';
    const id = extra ? `${value}|${extra}` : value;
    if (!out.has(id)) out.set(id, e.eventId);
  }
  return out;
}

