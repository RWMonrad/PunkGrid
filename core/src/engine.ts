// Command pipeline, genesis, world clock and surprise engine.
// Implements contract sections 5–8. Every mutation is a validated, idempotent
// command; events, world version and snapshot are written at one commit point,
// and narrative materialization happens only afterwards.

import {
  type CommandResult, type DomainEvent, type ID, type ISOTime, type World, type WorldState,
  emptyWorldState, makeIdFactory, mulberry32, relationshipKey, requestHash, stateHash, clampRelationship,
} from './domain.js';
import { err } from './errors.js';
import { applyEvent } from './reducer.js';
import type { GenesisPayload } from './reducer.js';
import type { Effect, Precondition, RulePack, SettingInput, SurpriseFamily, WorldTemplate } from './rulepack.js';
import { findChoice } from './rulepack.js';
import {
  Store, characterKey, factKey, arcKey, membershipKey, snapshotKey,
  type EpisodeRow, type FactRow, type ModerationCaseRow, type ModerationReason, type OfferedChoiceRow, type ScheduledEventRow,
} from './store.js';
import { fallbackText, validateNarrative, type NarrativeProvider, type NarrativeRequest } from './narrative.js';
import { containsInjectionAttempt, clip, minimiseForCase, screenText } from './moderation.js';
import { DEFAULT_STYLE } from './ai/prompt.js';

/** The reasons a player can choose when reporting (FR-11). They are the client's
 *  vocabulary, deliberately coarser than the screen's categories, and the same
 *  six values the `moderation_reason` enum admits (ADR-018). */
const REASON_CODES = new Set<ModerationReason>([
  'sexual_content', 'violence', 'self_harm', 'real_person', 'offensive_language', 'other',
]);

/** US13 asks for a receipt the player can quote to support. It is derived from
 *  the case id, so a re-sent report gives the same receipt rather than a new one. */
function receiptFor(c: ModerationCaseRow): string {
  return `PG-RPT-${c.id.replace(/^case_/, '').slice(-8).toUpperCase()}`;
}

export interface StagedEvent {
  eventId: ID;
  type: DomainEvent['type'];
  payload: Record<string, unknown>;
  actorCharacterId: ID | null;
  causedByEventIds: ID[];
  visibility: DomainEvent['visibility'];
}

export interface WorldView {
  world: World;
  /** The caller's own identity in this world: the value a mutation body has to
   *  name as `actorIdentityId`. No normative route let a client learn it before
   *  ADR-016, which made the /v1 mutations unusable. */
  identityId: ID;
  stateVersion: number;
  summary: { worldTime: ISOTime; arcs: Record<ID, string>; resources: Record<string, number> };
  choices: IssuedChoice[];
}

/** One server-issued choice in a scene. A client may render these and submit
 *  their ids, and nothing outside this list exists for the player (FR-04). */
export interface IssuedChoice {
  choiceId: ID;
  label: string;
  copy: string;
}

/** State the engine cannot keep in process memory, because a server starts a
 *  fresh engine per command. Absent ports fall back to the hydrated Store, so
 *  the in-memory golden path is unchanged. */
export interface EnginePorts {
  dailySpendUsd(userId: ID, dayStartIso: ISOTime): Promise<number>;
  resumeAnchor(worldId: ID): Promise<number | null>;
}

/** What one command stages for commit. Canonical state changes only inside
 *  commit(); a mutation callback may not write the store directly. */
export interface MutationOutcome {
  events: StagedEvent[];
  noOpReason?: string;
  newFacts?: FactRow[];
  statusChange?: 'paused' | 'archived';
}

const DAY_MS = 86_400_000;

/** The largest page any list route will answer with. A client asks for a size, the
 *  engine decides whether it can afford it. */
const MAX_PAGE = 200;

export class Engine {
  readonly store: Store;
  readonly ids: (prefix: string) => ID;

  private wallNow: number;
  private resumeFallback = new Map<ID, number>();
  private usdBudgetPerUserPerDay: number;
  private seed: number;
  private autoFlush: boolean;
  private ports: EnginePorts | undefined;

  constructor(
    public readonly pack: RulePack,
    public readonly provider: NarrativeProvider,
    opts: {
      seed?: number; now?: () => number; usdBudgetPerUserPerDay?: number; autoFlush?: boolean;
      store?: Store; ids?: (prefix: string) => ID; ports?: EnginePorts;
    } = {},
  ) {
    this.seed = opts.seed ?? 20261011;
    this.wallNow = opts.now ? opts.now() : Date.parse('2026-10-11T12:00:00.000Z');
    this.usdBudgetPerUserPerDay = opts.usdBudgetPerUserPerDay ?? 2;
    this.autoFlush = opts.autoFlush ?? true;
    this.ports = opts.ports;
    this.store = opts.store ?? new Store();
    // An injected id factory is required on the server, where ids come from ULIDs
    // and a seeded sequence would restart and collide on every request (1.6).
    this.ids = opts.ids ?? makeIdFactory(this.seed);
  }

  // --- deterministic helpers for tests -----------------------------------
  nowIso(): ISOTime { return new Date(this.wallNow).toISOString(); }
  advanceWall(minutes: number) { this.wallNow += minutes * 60_000; }
  setAutoFlush(v: boolean) { this.autoFlush = v; }

  registerUser(userId: ID, plan: 'free' | 'premium' = 'free', maxActiveWorlds = plan === 'free' ? this.pack.freeWorldQuota : 5): ID {
    this.store.users.set(userId, { id: userId, createdAt: this.nowIso() });
    this.store.entitlements.set(userId, { userId, plan, activeUntil: null, maxActiveWorlds });
    return userId;
  }

  createIdentity(userId: ID, persona: Record<string, unknown>, identityId?: ID): ID {
    if (!this.store.users.has(userId)) throw err.unauthenticated();
    const id = identityId ?? this.ids('idn');
    this.store.identities.set(id, { id, ownerUserId: userId, personaSchemaVersion: '1.0', profile: persona, status: 'active' });
    return id;
  }

  // --- reads --------------------------------------------------------------
  listWorlds(userId: ID) {
    if (!this.store.users.has(userId)) throw err.unauthenticated();
    return [...this.store.worlds.values()]
      .filter((w) => w.ownerUserId === userId)
      .map((w) => ({
        worldId: w.id,
        identityId: this.identityOf(userId, w.id),
        // UI07 has to name the world without printing its id, and the list is the
        // only read a resumed player makes before opening a world (ADR-019).
        rulepackId: w.rulepackId,
        status: w.status,
        worldTime: w.worldTime,
        stateVersion: w.stateVersion,
      }));
  }

  getWorld(userId: ID, worldId: ID): WorldView {
    const world = this.authorizeRead(userId, worldId);
    const snap = this.store.latestSnapshot(worldId);
    const player = this.playerCharacter(worldId)!;
    return {
      world: { ...world, status: this.store.worlds.get(worldId)!.status },
      identityId: this.identityOf(userId, worldId),
      stateVersion: world.stateVersion,
      summary: {
        worldTime: snap.state.worldTime,
        arcs: Object.fromEntries(Object.entries(snap.state.arcStatuses)),
        resources: { ...snap.state.characters[player]?.resources },
      },
      choices: this.currentChoices(worldId),
    };
  }

  /** The contract's «paginated visible episodes» (API table, `GET
   *  /v1/worlds/{id}/episodes`): a page of the story in the order it happened, and a
   *  cursor that says whether another page exists.
   *
   *  The cursor is the `fromEventSequence` of the last episode on the page, because
   *  that is the column the story is already ordered by and the index is on it.
   *  Measured 2026-10-13 on the dev world at version 21: this method returned the
   *  first twenty episodes and `nextCursor: null`, and the play screen — whose newest
   *  scene is the last item of the list it fetches (`play.ts`) — read Episode 20 for
   *  every decision after that. A list that ends early without saying so is not a
   *  truncated read, it is a lost ending. */
  listEpisodes(userId: ID, worldId: ID, limit = 20, cursor: string | null = null) {
    this.authorizeRead(userId, worldId);
    const want = Number(limit);
    if (!Number.isFinite(want) || want < 1) throw err.invalidSchema('limit must be a page size of at least one');
    const size = Math.min(MAX_PAGE, Math.trunc(want));
    const after = cursor === null || cursor === '' ? 0 : Number(cursor);
    if (!Number.isFinite(after)) throw err.invalidSchema('cursor must be an episode sequence');
    const rest = [...this.store.episodes.values()]
      .filter((e) => e.episode.worldId === worldId && e.episode.fromEventSequence > after)
      .sort((a, b) => a.episode.fromEventSequence - b.episode.fromEventSequence);
    const page = rest.slice(0, size);
    const items = page.map((e) => ({ ...e.episode, status: e.status }));
    const last = items[items.length - 1];
    return { items, nextCursor: rest.length > size && last ? String(last.fromEventSequence) : null as string | null };
  }

  getEpisode(userId: ID, worldId: ID, episodeId: ID) {
    this.authorizeRead(userId, worldId);
    const row = this.store.episodes.get(episodeId);
    if (!row || row.episode.worldId !== worldId) throw err.notFound();
    return { status: row.status, episode: row.status === 'published' || row.status === 'fallback' ? row.episode : undefined };
  }

  /** FR-11 / US13 (ADR-018): report an episode from inside the app.
   *
   *  Deliberately not a canonical command: a report changes no world state, so it
   *  takes no `expectedWorldVersion` and writes no event. What it does write is a
   *  moderation case whose content is a bounded excerpt, because §15 keeps
   *  operational records to a reason code and a pseudonymous reference. The
   *  commandId is the dedupe key, so a double-tapped report button yields the
   *  case it already opened rather than a second one. */
  reportEpisode(input: {
    actorUserId: ID; worldId: ID; episodeId: ID; reporterIdentityId: ID;
    reason: ModerationReason; note?: string; commandId: ID;
  }): { reportId: ID; receipt: string; status: 'open' | 'duplicate' } {
    // Same ordering as the command path: the dedupe key is only readable to the
    // account that owns the world the episode lives in.
    this.authorizeRead(input.actorUserId, input.worldId);
    const existing = this.store.moderationCases.get(input.commandId);
    if (existing) {
      if (existing.episodeId !== input.episodeId || existing.reason !== input.reason) throw err.idempotencyMismatch();
      return { reportId: existing.id, receipt: receiptFor(existing), status: 'duplicate' };
    }

    if (!REASON_CODES.has(input.reason)) {
      throw err.invalidSchema(`reason must be one of ${[...REASON_CODES].join(', ')}`, { reason: input.reason });
    }
    this.assertActorIdentity(input.worldId, input.reporterIdentityId);
    const row = this.store.episodes.get(input.episodeId);
    if (!row || row.episode.worldId !== input.worldId) throw err.notFound();
    if (row.status !== 'published' && row.status !== 'fallback') {
      throw err.precondition('EPISODE_NOT_PUBLISHED', 'There is no story text to report yet');
    }

    const caseRow: ModerationCaseRow = {
      id: this.ids('case'),
      commandId: input.commandId,
      worldId: input.worldId,
      episodeId: input.episodeId,
      reporterUserId: input.actorUserId,
      reporterIdentityId: input.reporterIdentityId,
      reason: input.reason,
      categories: screenText(row.episode.content).matched,
      excerpt: minimiseForCase(row.episode.content, input.episodeId),
      reporterNote: input.note === undefined ? null : clip(input.note, 200),
      status: 'open',
      createdAt: this.nowIso(),
    };
    this.store.moderationCases.set(input.commandId, caseRow);
    this.store.audit.push({ kind: `episode_reported:${input.reason}`, worldId: input.worldId, at: this.nowIso() });
    return { reportId: caseRow.id, receipt: receiptFor(caseRow), status: 'open' };
  }

  /** The reviewer queue, read by the operations surface rather than the game. */
  listModerationCases(worldId?: ID) {
    return [...this.store.moderationCases.values()]
      .filter((c) => worldId === undefined || c.worldId === worldId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** POV filter (FR-08): facts a character is authorized to know. */
  authorizedFacts(userId: ID, worldId: ID, characterId: ID): ID[] {
    this.authorizeRead(userId, worldId);
    const snap = this.store.latestSnapshot(worldId);
    return [...(snap.state.factualKnowledge[characterId] ?? [])];
  }

  /** Golden-test support: recompute state from the ledger and compare hashes. */
  verifyReplay(worldId: ID): { storedHash: string; replayedHash: string; equal: boolean } {
    const world = this.requireWorld(worldId);
    const events = this.store.worldEvents(worldId);
    const first = events[0];
    if (!first) throw err.notFound('World has no event ledger');
    const startWorldTime = (first.payload as unknown as GenesisPayload).worldTime ?? first.worldTime;
    const replayed = events.reduce((s, e) => applyEvent(s, e), emptyWorldState(startWorldTime));
    const stored = this.store.snapshots.get(snapshotKey(worldId, world.stateVersion))!;
    return { storedHash: stored.stateHash, replayedHash: stateHash(replayed), equal: stored.stateHash === stateHash(replayed) };
  }

  // =======================================================================
  // world.create — contract section 5
  // =======================================================================
  async createWorld(input: {
    actorUserId: ID; mode: 'create' | 'surprise'; identityId?: ID;
    templateId?: string; setting?: SettingInput; seed?: number; commandId?: ID;
  }): Promise<{ worldId: ID; identityId: ID; commandResult: CommandResult; episodeId: ID; episodeStatus: EpisodeRow['status'] | 'unknown' }> {
    if (!this.store.users.has(input.actorUserId)) throw err.unauthenticated();
    if (input.mode !== 'create' && input.mode !== 'surprise') throw err.invalidSchema('mode must be create or surprise');

    const commandId = input.commandId ?? this.ids('cmd');
    const hash = requestHash({ kind: 'world.create', body: input });
    const replayed = this.store.commands.get(commandId);
    // The stored command is read by the account that wrote it and by nobody else —
    // the same order `choose` keeps, where membership is tested before the lookup
    // (SECURITY.md F-S8). The hash covers the whole input including `actorUserId`, so
    // a foreign account already fails the comparison below, but that is a property of
    // the hash and not of this route: a narrower hash would return another account's
    // world id and `CommandResult` here, and the create below would then write its own
    // row over theirs.
    if (replayed && replayed.actorUserId !== input.actorUserId) throw err.idempotencyMismatch();
    if (replayed) {
      if (replayed.requestHash !== hash) throw err.idempotencyMismatch();
      const episodeId = [...this.store.episodes.values()].find((e) => e.episode.worldId === replayed.worldId)?.episode.id ?? '';
      const membership = [...this.store.memberships.values()].find((m) => m.worldId === replayed.worldId && m.userId === input.actorUserId);
      return { worldId: replayed.worldId, identityId: membership?.identityId ?? '', commandResult: replayed.result!, episodeId, episodeStatus: 'published' };
    }

    // Quota and genesis commit share one per-owner critical section (ADR-012).
    return this.store.withWorldLock(`user:${input.actorUserId}`, async () => {
      const template = this.selectTemplate(input);
      const setting = this.validateSetting(template, input.setting ?? defaultSetting(template));
      const ent = this.entitlement(input.actorUserId);
      const activeCount = [...this.store.worlds.values()].filter(
        (w) => w.ownerUserId === input.actorUserId && (w.status === 'active' || w.status === 'paused') && w.mode === 'personal',
      ).length;
      if (activeCount >= ent.maxActiveWorlds) throw err.worldLimit(`Active personal world limit reached (${ent.maxActiveWorlds})`);

      const worldId = this.ids('world');
      const newIdentity = input.identityId === undefined;
      const identityId = input.identityId ?? this.createIdentity(input.actorUserId, { name: 'Alex Vale', template: template.id });
      const owned = this.store.identities.get(identityId);
      if (!owned || owned.ownerUserId !== input.actorUserId) throw err.precondition('IDENTITY_NOT_OWNED', 'Identity is not owned by this account');

      // The setting the pipeline validated is what the world opens on, not the
      // template's reference defaults (Master US03, ADR-023). `validateSetting`
      // admits only values that carry a start, so these lookups cannot miss.
      const eraStart = template.eraStarts.find((e) => e.era === setting.era)!;
      const roleGrant = template.roleGrants.find((g) => g.role === setting.role)!;
      const genesisTime = new Date(Date.parse(eraStart.worldTime)).toISOString();
      const offerFlags = Object.fromEntries(template.genesisChoiceIds.map((c) => [`offerable:${c}`, true]));

      const genesis: GenesisPayload = {
        templateId: template.id,
        worldTime: genesisTime,
        characters: template.characters.map((c) => ({
          id: c.id, status: 'active' as const,
          roleIds: c.id === template.playerCharacterId ? [...roleGrant.roleIds] : c.roleIds,
          goals: c.goals, resources: { ...c.resources },
        })),
        relationships: template.relationships,
        arcs: template.arcs,
        facts: template.facts.map((f) => ({ id: f.id, knownBy: f.knownBy })),
        flags: { ...offerFlags, decision_authority: false },
        futureEventIds: [],
      };

      const scheduled: ScheduledEventRow = {
        id: this.ids('sched'), worldId, dueWorldTime: new Date(Date.parse(genesisTime) + 24 * 3600_000).toISOString(),
        eventFamily: 'arc_pressure', rulepackVersion: this.pack.version, idempotencyKey: `${worldId}:sched:1`,
        status: 'pending', attempts: 0, maxAttempts: 3,
      };
      genesis.futureEventIds = [scheduled.id];

      const events: StagedEvent[] = [{
        eventId: this.ids('evt'), type: 'world.created', payload: genesis as unknown as Record<string, unknown>,
        actorCharacterId: null, causedByEventIds: [], visibility: 'world',
      }];
      // An identity reused from an existing account announces its entry (contract 2).
      if (!newIdentity) {
        events.push({
          eventId: this.ids('evt'), type: 'identity.entered_world',
          payload: { identityId, characterId: template.playerCharacterId },
          actorCharacterId: template.playerCharacterId, causedByEventIds: [events[0]!.eventId], visibility: 'owner',
        });
      }

      const pendingWorld: World = {
        id: worldId, ownerUserId: input.actorUserId, mode: 'personal', visibility: 'private',
        status: 'creating', rulepackId: this.pack.id, rulepackVersion: this.pack.version,
        blueprintVersion: template.version, stateVersion: 0, lastEventSequence: 0,
        worldTime: genesisTime, createdAt: this.nowIso(),
      };
      this.store.worlds.set(worldId, pendingWorld);

      const commandResult = this.commit({ worldId, events, commandId, commandType: 'world.create', actorUserId: input.actorUserId, hash, expectedVersion: 0 });

      this.store.memberships.set(membershipKey(worldId, input.actorUserId), { worldId, userId: input.actorUserId, identityId, role: 'owner', status: 'active' });
      this.store.blueprints.set(worldId, {
        worldId, schemaVersion: '1.0', seed: input.seed ?? this.seed,
        setting: setting as unknown as Record<string, unknown>,
        constraints: { templateId: template.id, flags: setting.flags ?? [] }, validatedAt: this.nowIso(),
      });
      for (const c of template.characters) {
        const isPlayer = c.id === template.playerCharacterId;
        this.store.characters.set(characterKey(worldId, c.id), {
          id: c.id, worldId, ownerIdentityId: isPlayer ? identityId : null, name: c.name,
          profile: isPlayer ? { ...c.profile, title: roleGrant.title } : c.profile,
        });
      }
      for (const f of template.facts) {
        this.store.facts.set(factKey(worldId, f.id), { worldId, factId: f.id, label: f.label, verified: f.verified, visibility: f.visibility, sensitivePhrase: f.sensitivePhrase });
      }
      for (const a of template.arcs) this.store.arcs.set(arcKey(worldId, a.id), { id: a.id, worldId, arcType: a.arcType, status: a.status });
      this.store.scheduledEvents.set(scheduled.id, scheduled);
      this.resumeFallback.set(worldId, this.wallNow);

      const episode = this.refreshOffersAndQueue(worldId);
      this.writeCommandRow(commandId, worldId, hash, input.actorUserId, 'world.create', 0, commandResult);
      if (this.autoFlush) await this.flush();
      return { worldId, identityId, commandResult, episodeId: episode.episode.id, episodeStatus: episode.status };
    });
  }

  private selectTemplate(input: { mode: 'create' | 'surprise'; templateId?: string; seed?: number }): WorldTemplate {
    if (input.mode === 'create') {
      if (!input.templateId) throw err.invalidSchema('templateId is required for Create a Life');
      const t = this.pack.templates.find((x) => x.id === input.templateId);
      if (!t) throw err.invalidBlueprint('Unknown world template', { templateId: input.templateId });
      return t;
    }
    const rng = mulberry32(input.seed ?? this.seed);
    return this.pack.templates[Math.floor(rng() * this.pack.templates.length) % this.pack.templates.length]!;
  }

  private validateSetting(template: WorldTemplate, setting: SettingInput): SettingInput {
    const flags = new Set(setting.flags ?? []);
    if (!template.allowedLocations.includes(setting.location)) throw err.invalidBlueprint('Location is not supported', { location: setting.location });
    if (!template.allowedEras.includes(setting.era)) throw err.invalidBlueprint('Era is not supported', { era: setting.era });
    if (!template.allowedRoles.includes(setting.role)) throw err.invalidBlueprint('Role is not supported', { role: setting.role });
    // A supported value the pack cannot start a world with is a broken pack, not a
    // player error: fail loudly instead of opening on the reference era's clock.
    if (!template.eraStarts.some((e) => e.era === setting.era)) throw err.invalidBlueprint('Era has no opening time in this world', { era: setting.era });
    if (!template.roleGrants.some((g) => g.role === setting.role)) throw err.invalidBlueprint('Role grants no capabilities in this world', { role: setting.role });
    for (const c of template.constraints) {
      const matches = Object.entries(c.if).every(([k, v]) => (setting as unknown as Record<string, string>)[k] === v);
      if (matches && !c.requireFlags.every((f) => flags.has(f))) {
        throw err.invalidBlueprint(c.message, { constraintId: c.id, requires: c.requireFlags });
      }
    }
    // §15 screens input as well as output. Everything above is an enum check, so
    // the only text a player contributes is the genre and the flags — and that
    // text goes into the narration prompt as data.
    const freeText = [setting.genre ?? '', ...(setting.flags ?? [])].join(' ');
    const verdict = screenText(freeText);
    if (verdict.blocked) throw err.invalidBlueprint('Setting is outside the content policy', { contentPolicy: verdict.matched });
    if (containsInjectionAttempt(freeText)) {
      throw err.invalidBlueprint('Setting may not contain instructions for the narrator', { contentPolicy: ['prompt_injection'] });
    }
    return setting;
  }

  // =======================================================================
  // choice.select — contract section 6
  // =======================================================================
  async submitChoice(input: {
    actorUserId: ID; worldId: ID; actorIdentityId: ID; expectedWorldVersion: number; choiceId: ID; commandId: ID;
  }): Promise<CommandResult> {
    const hash = requestHash({ kind: 'choice.select', worldId: input.worldId, actorIdentityId: input.actorIdentityId, expectedWorldVersion: input.expectedWorldVersion, choiceId: input.choiceId });
    return this.executeCommand(input, 'choice.select', hash, (world, state) => {
      // An id the rulepack never defines cannot have been server-issued (FR-04).
      const rule = findChoice(this.pack, input.choiceId);
      if (!rule) throw err.invalidChoice(input.choiceId);
      this.assertActorIdentity(world.id, input.actorIdentityId);
      // Offerability lives in world state, so it is scoped by world and version.
      if (state.flags[`offerable:${input.choiceId}`] !== true) {
        throw err.precondition('CHOICE_NOT_OFFERED', `Choice ${input.choiceId} is not offered in this world version`);
      }
      const failing = this.failingPrecondition(state, rule.requires, world.id);
      if (failing) throw err.precondition(failing, `Choice ${rule.id} is not currently possible`);
      this.assertReferencedCharacters(world.id, rule.effects);
      // Being unlocked and payable is not enough: the server issues the scene, so
      // the scene is also the only thing the player may act on. An offer the
      // engine trimmed away to stay inside FR-04's interval was never on screen
      // (ADR-022). The checks above run first, so a client learns 'not allowed'
      // and 'this rule is broken' before it learns 'not part of this scene'.
      const issued = this.choicesAt(world.id, world.stateVersion);
      if (!issued.some((c) => c.choiceId === input.choiceId)) {
        throw err.precondition('CHOICE_NOT_OFFERED', 'That choice is not in the current scene.');
      }
      const built = this.buildEffectEvents(state, rule.effects, rule.id, world.id);
      this.assertSceneFloor(state, world.id, input.choiceId, issued, built.events);
      return built;
    });
  }

  // =======================================================================
  // world.resume — bounded catch-up, contract section 8
  // =======================================================================
  async resumeWorld(input: { actorUserId: ID; worldId: ID; actorIdentityId: ID; expectedWorldVersion: number; commandId: ID }): Promise<CommandResult> {
    const hash = requestHash({ kind: 'world.resume', worldId: input.worldId, actorIdentityId: input.actorIdentityId, expectedWorldVersion: input.expectedWorldVersion });
    // Read before the command opens: the catch-up anchor is persisted, so a
    // server that rebuilt the engine between commands still bounds catch-up
    // correctly (contract 8).
    const anchor = (await this.anchors(input.worldId)) ?? this.wallNow;
    const result = await this.executeCommand(input, 'world.resume', hash, (world, state) => {
      const elapsed = Math.max(0, Math.floor((this.wallNow - anchor) / 60_000));
      const ticks = Math.min(
        Math.floor(elapsed / this.pack.time.tickMinutes),
        this.pack.time.maxCatchupTicks,
        Math.floor(this.pack.time.maxWorldTimeJumpMinutes / this.pack.time.tickMinutes),
      );
      if (ticks <= 0) return { events: [], noOpReason: 'NO_TICKS_DUE' };
      this.resumeFallback.set(world.id, this.wallNow);
      this.assertActorIdentity(world.id, input.actorIdentityId);

      const events: StagedEvent[] = [];
      let cursor = Date.parse(state.worldTime);
      for (let i = 0; i < ticks; i += 1) {
        cursor += this.pack.time.tickMinutes * 60_000;
        const newWorldTime = new Date(cursor).toISOString();
        const tickEventId = this.ids('evt');
        events.push({
          eventId: tickEventId, type: 'world.time_advanced',
          payload: { deltaMinutes: this.pack.time.tickMinutes, newWorldTime, tickIndex: i },
          actorCharacterId: null, causedByEventIds: [], visibility: 'world',
        });
        for (const s of [...this.store.scheduledEvents.values()]) {
          if (s.worldId !== world.id || s.status !== 'pending') continue;
          if (Date.parse(s.dueWorldTime) > cursor) continue;
          s.status = 'completed';
          s.attempts += 1;
          events.push({
            eventId: this.ids('evt'), type: 'scheduled_event.resolved',
            payload: { scheduledEventId: s.id, eventFamily: s.eventFamily },
            actorCharacterId: null, causedByEventIds: [tickEventId], visibility: 'world',
          });
        }
      }
      return { events };
    });
    // A resume brings a paused simulation back to active (contract 7), whether
    // or not any catch-up tick was actually due.
    const live = this.store.worlds.get(input.worldId)!;
    if (live.status === 'paused') this.store.worlds.set(input.worldId, { ...live, status: 'active' });
    return result;
  }

  // =======================================================================
  // surprise.request — eligibility, cooldown, causal hook
  // =======================================================================
  async requestSurprise(input: { actorUserId: ID; worldId: ID; actorIdentityId: ID; expectedWorldVersion: number; commandId: ID }): Promise<CommandResult> {
    const hash = requestHash({ kind: 'surprise.request', worldId: input.worldId, actorIdentityId: input.actorIdentityId, expectedWorldVersion: input.expectedWorldVersion });
    return this.executeCommand(input, 'surprise.request', hash, (world, state) => {
      this.assertActorIdentity(world.id, input.actorIdentityId);
      const eligible = this.pack.surprises.filter((f) => this.surpriseEligible(state, f, world));
      if (eligible.length === 0) return { events: [], noOpReason: 'NO_ELIGIBLE_SURPRISE' };
      const rng = mulberry32((this.seed ^ (world.stateVersion * 2654435761)) >>> 0);
      const family = eligible[Math.floor(rng() * eligible.length) % eligible.length]!;
      const parentEventId = this.causalParentEvent(world.id, family);
      if (!parentEventId) return { events: [], noOpReason: 'NO_CAUSAL_HOOK' };

      const missing = this.failingPrecondition(state, family.requires, world.id);
      if (missing) return { events: [], noOpReason: 'NO_ELIGIBLE_SURPRISE' };
      this.assertReferencedCharacters(world.id, family.effects);
      const built = this.buildEffectEvents(state, family.effects, `surprise:${family.id}`, world.id);
      const surpriseEventId = this.ids('evt');
      const trigger: StagedEvent = {
        eventId: surpriseEventId, type: 'surprise.triggered',
        payload: {
          familyId: family.id, causalArc: family.causalArc, copy: family.copy,
          opensChoices: family.effects.openChoices ?? [],
          flags: { ...family.effects.flags, [`surprise:${family.id}:at`]: state.worldTime },
        },
        actorCharacterId: null, causedByEventIds: [parentEventId], visibility: 'world',
      };
      // The surprise is the causal parent of everything it produces; it is not a
      // player choice, so the generic choice.resolved event is dropped.
      const caused = built.events.filter((e) => e.type !== 'choice.resolved').map((e) => ({ ...e, causedByEventIds: [surpriseEventId] }));
      return { events: [trigger, ...caused], newFacts: built.newFacts };
    });
  }

  // =======================================================================
  // pause / archive / acknowledge — state machines, contract section 7
  // =======================================================================
  async pauseWorld(input: CommandInput) { return this.transition(input, 'world.pause', 'paused'); }
  async archiveWorld(input: CommandInput) { return this.transition(input, 'world.archive', 'archived'); }

  private async transition(input: CommandInput, commandType: 'world.pause' | 'world.archive', target: 'paused' | 'archived'): Promise<CommandResult> {
    const hash = requestHash({ kind: commandType, worldId: input.worldId, expectedWorldVersion: input.expectedWorldVersion });
    const result = await this.executeCommand(input, commandType, hash, (world) => {
      const allowed = target === 'paused' ? world.status === 'active' : world.status === 'active' || world.status === 'paused';
      if (!allowed) throw err.precondition('WORLD_STATUS_INVALID', `Cannot move from ${world.status} to ${target}`);
      this.assertActorIdentity(input.worldId, input.actorIdentityId);
      return { events: [], noOpReason: `STATUS:${target.toUpperCase()}`, statusChange: target };
    });
    const live = this.store.worlds.get(input.worldId)!;
    this.store.worlds.set(input.worldId, { ...live, status: target });
    this.store.audit.push({ kind: `world.${target}`, worldId: input.worldId, at: this.nowIso() });
    return result;
  }

  async acknowledgeEpisode(input: CommandInput & { episodeId: ID }): Promise<CommandResult> {
    const hash = requestHash({ kind: 'episode.acknowledge', worldId: input.worldId, episodeId: input.episodeId, expectedWorldVersion: input.expectedWorldVersion });
    return this.executeCommand(input, 'episode.acknowledge', hash, (world) => {
      const row = this.store.episodes.get(input.episodeId);
      if (!row || row.episode.worldId !== world.id) throw err.notFound();
      if (row.status !== 'published' && row.status !== 'fallback') throw err.precondition('EPISODE_NOT_PUBLISHED', 'Episode is not published yet');
      return { events: [], noOpReason: 'ACKNOWLEDGED' };
    });
  }

  // =======================================================================
  // Shared command machinery
  // =======================================================================
  private async executeCommand(
    input: CommandInput,
    commandType: 'choice.select' | 'world.resume' | 'surprise.request' | 'world.pause' | 'world.archive' | 'episode.acknowledge',
    hash: string,
    mutate: (world: World, state: WorldState) => Promise<MutationOutcome> | MutationOutcome,
  ): Promise<CommandResult> {
    if (!this.store.users.has(input.actorUserId)) throw err.unauthenticated();

    // Replay is a read of stored server state, so it sits behind the same
    // membership check as the command itself (§1.7: authorisation first). In
    // front of it, a borrowed commandId would hand one account another
    // account's CommandResult — and a 409 where everyone else sees 404 would
    // say which ids exist.
    return this.store.withWorldLock(input.worldId, async () => {
      const world = this.authorizeWrite(input.actorUserId, input.worldId);
      const existing = this.store.commands.get(input.commandId);
      if (existing) {
        if (existing.requestHash !== hash || existing.worldId !== input.worldId) throw err.idempotencyMismatch();
        if (!existing.result) throw err.notFound('Command has no stored result');
        return existing.result;
      }
      if (world.status === 'creating') throw err.precondition('WORLD_NOT_READY', 'World is still being created');
      if (world.status === 'archived') throw err.precondition('WORLD_ARCHIVED', 'Archived worlds are terminal in v1');
      if (world.status === 'paused' && (commandType === 'choice.select' || commandType === 'surprise.request')) {
        throw err.precondition('WORLD_PAUSED', 'Resume the world before acting in it');
      }
      if (world.stateVersion !== input.expectedWorldVersion) throw err.versionConflict(world.stateVersion);

      const state = this.store.latestSnapshot(world.id).state;
      const { events, noOpReason, newFacts } = await mutate(world, state);
      const result = this.commit({ worldId: world.id, events, commandId: input.commandId, commandType, actorUserId: input.actorUserId, hash, expectedVersion: world.stateVersion, noOpReason });
      for (const f of newFacts ?? []) this.store.facts.set(factKey(world.id, f.factId), f);
      if (!this.store.commands.has(input.commandId)) {
        this.writeCommandRow(input.commandId, world.id, hash, input.actorUserId, commandType, input.expectedWorldVersion, result);
      }
      if (events.length > 0) this.refreshOffersAndQueue(world.id);
      if (this.autoFlush) await this.flush();
      return result;
    });
  }

  /** The single canonical write point. */
  private commit(params: {
    worldId: ID; events: StagedEvent[]; commandId: ID; commandType: string;
    actorUserId: ID; hash: string; expectedVersion: number; noOpReason?: string;
  }): CommandResult {
    const live = this.requireWorld(params.worldId);
    const isNoOp = params.events.length === 0;
    const base: WorldState = live.stateVersion === 0
      ? emptyWorldState(live.worldTime)
      : this.store.snapshots.get(snapshotKey(live.id, live.stateVersion))!.state;

    const stamped: DomainEvent[] = [];
    let acc = base;
    let seq = live.lastEventSequence;
    for (const staged of params.events) {
      if (typeof staged.type !== 'string') throw err.invalidSchema('event type must be a string');
      seq += 1;
      const evt: DomainEvent = {
        schemaVersion: '1.0', eventId: staged.eventId, worldId: live.id, sequence: seq,
        commandId: params.commandId, type: staged.type, actorCharacterId: staged.actorCharacterId,
        causedByEventIds: staged.causedByEventIds, payload: staged.payload, visibility: staged.visibility,
        worldTime: acc.worldTime, rulesetVersion: this.pack.version,
      };
      acc = applyEvent(acc, evt);
      stamped.push(evt);
    }

    const newVersion = isNoOp ? live.stateVersion : live.stateVersion + 1;
    const hash = stateHash(acc);
    const firstEventSequence = isNoOp ? null : live.lastEventSequence + 1;

    // All validation passed — commit rows.
    const ledger = this.store.events.get(live.id) ?? [];
    ledger.push(...stamped);
    this.store.events.set(live.id, ledger);
    if (!isNoOp) {
      this.store.snapshots.set(snapshotKey(live.id, newVersion), {
        worldId: live.id, version: newVersion, stateSchemaVersion: '1.0',
        state: acc, stateHash: hash, lastEventSeq: seq, createdAt: this.nowIso(),
      });
    }
    this.store.worlds.set(live.id, {
      ...live,
      status: live.status === 'creating' ? 'active' : live.status,
      stateVersion: newVersion,
      lastEventSequence: seq,
      worldTime: acc.worldTime,
    });

    return {
      commandId: params.commandId, worldId: live.id,
      previousVersion: live.stateVersion, newVersion,
      firstEventSequence, lastEventSequence: isNoOp ? null : seq,
      outcome: isNoOp ? 'no_op' : 'committed',
      eventIds: stamped.map((e) => e.eventId),
      stateHash: hash,
      ...(isNoOp ? { noOpReason: params.noOpReason ?? 'NO_EFFECT' } : {}),
    };
  }

  private writeCommandRow(commandId: ID, worldId: ID, hash: string, actorUserId: ID, commandType: string, expectedVersion: number, result: CommandResult) {
    this.store.commands.set(commandId, {
      commandId, worldId, requestHash: hash, actorUserId, expectedWorldVersion: expectedVersion,
      commandType, commandSchemaVersion: '1.0', status: result.outcome, result, createdAt: this.nowIso(),
    });
  }

  private assertActorIdentity(worldId: ID, identityId: ID) {
    const identity = this.store.identities.get(identityId);
    if (!identity) throw err.accessDenied();
    const owner = this.requireWorld(worldId).ownerUserId;
    if (identity.ownerUserId !== owner) throw err.accessDenied();
  }

  // --- effect compilation -------------------------------------------------
  /** `ids` is injectable so a read-only guard can compile a hypothetical move
   *  without drawing from the deterministic id sequence. */
  private buildEffectEvents(
    state: WorldState, effects: Effect, ruleId: string, worldId: ID,
    ids: (prefix: string) => ID = this.ids,
  ): { events: StagedEvent[]; newFacts: FactRow[] } {
    const working = structuredClone(state);
    const player = this.playerCharacter(worldId)!;
    const alias = (ref: 'player' | ID): ID => (ref === 'player' ? player : this.resolveCharacter(worldId, ref));
    const out: StagedEvent[] = [];
    const newFacts: FactRow[] = [];
    const primary = ids('evt');

    out.push({
      eventId: primary, type: 'choice.resolved',
      payload: { ruleId, opensChoices: effects.openChoices ?? [], flags: effects.flags ?? {} },
      actorCharacterId: alias('player'), causedByEventIds: [], visibility: 'owner',
    });

    for (const r of effects.resources ?? []) {
      const characterId = alias(r.character);
      const before = working.characters[characterId]?.resources[r.key] ?? 0;
      const after = before + r.delta;
      if (after < 0 && !r.allowsDebt) throw err.precondition('NON_NEGATIVE_RESOURCE', `${r.key} cannot go below zero without a debt mechanism`);
      working.characters[characterId]!.resources[r.key] = after;
      out.push({ eventId: ids('evt'), type: 'resource.changed', payload: { characterId, key: r.key, delta: r.delta, before, after }, actorCharacterId: characterId, causedByEventIds: [primary], visibility: 'owner' });
    }

    for (const rel of effects.relationships ?? []) {
      const from = alias(rel.from);
      const to = this.resolveCharacter(worldId, rel.to);
      const key = relationshipKey(from, to, rel.dimension);
      const before = working.relationships[key] ?? 0;
      const after = clampRelationship(before + rel.delta);
      working.relationships[key] = after;
      out.push({ eventId: ids('evt'), type: 'relationship.changed', payload: { fromCharacterId: from, toCharacterId: to, dimension: rel.dimension, delta: rel.delta, before, after }, actorCharacterId: from, causedByEventIds: [primary], visibility: 'participants' });
    }

    for (const arc of effects.arcs ?? []) {
      if (arc.when?.relationshipBelow) {
        const wb = arc.when.relationshipBelow;
        const value = working.relationships[relationshipKey(alias(wb.from), wb.to, wb.dimension)] ?? 0;
        if (value >= wb.value) continue;
      }
      const current = working.arcStatuses[arc.arc];
      if (arc.action === 'progress') {
        if (current !== 'open') continue;
        out.push({ eventId: ids('evt'), type: 'story_arc.progressed', payload: { arcId: arc.arc, ruleId }, actorCharacterId: player, causedByEventIds: [primary], visibility: 'owner' });
      } else if (arc.action === 'open') {
        if (current !== 'locked') continue;
        working.arcStatuses[arc.arc] = 'open';
        out.push({ eventId: ids('evt'), type: 'story_arc.opened', payload: { arcId: arc.arc, ruleId }, actorCharacterId: player, causedByEventIds: [primary], visibility: 'owner' });
      } else {
        if (current === 'resolved' || current === 'failed') continue;
        working.arcStatuses[arc.arc] = arc.action === 'resolve' ? 'resolved' : 'failed';
        out.push({ eventId: ids('evt'), type: 'story_arc.closed', payload: { arcId: arc.arc, status: arc.action === 'resolve' ? 'resolved' : 'failed', ruleId }, actorCharacterId: player, causedByEventIds: [primary], visibility: 'owner' });
      }
    }

    for (const f of effects.createFacts ?? []) {
      if (this.store.facts.has(factKey(worldId, f.factId))) continue;
      out.push({ eventId: ids('evt'), type: 'fact.created', payload: { factId: f.factId, label: f.label, verified: f.verified ?? false }, actorCharacterId: null, causedByEventIds: [primary], visibility: f.visibility });
      newFacts.push({ worldId, factId: f.factId, label: f.label, verified: f.verified ?? false, visibility: f.visibility, sensitivePhrase: f.sensitivePhrase });
      for (const raw of f.knownBy) {
        const who = alias(raw);
        out.push({ eventId: ids('evt'), type: 'fact.disclosed', payload: { factId: f.factId, characterId: who, via: 'creation' }, actorCharacterId: who, causedByEventIds: [primary], visibility: f.visibility });
        working.factualKnowledge[who] = [...new Set([...(working.factualKnowledge[who] ?? []), f.factId])].sort();
      }
    }

    for (const d of effects.discloseFacts ?? []) {
      const who = alias(d.to);
      const known = working.factualKnowledge[who] ?? [];
      if (known.includes(d.factId)) continue;
      const factRow = this.store.facts.get(factKey(worldId, d.factId));
      if (!factRow) throw err.precondition('UNKNOWN_FACT', 'Disclosure references an unknown fact');
      out.push({ eventId: ids('evt'), type: 'fact.disclosed', payload: { factId: d.factId, characterId: who, via: d.via }, actorCharacterId: who, causedByEventIds: [primary], visibility: factRow.visibility });
      working.factualKnowledge[who] = [...known, d.factId].sort();
    }

    return { events: out, newFacts };
  }

  private assertReferencedCharacters(worldId: ID, effects: Effect) {
    for (const rel of effects.relationships ?? []) this.resolveCharacter(worldId, rel.to);
    for (const r of effects.resources ?? []) if (r.character !== 'player') this.resolveCharacter(worldId, r.character);
    for (const d of effects.discloseFacts ?? []) if (d.to !== 'player') this.resolveCharacter(worldId, d.to);
    for (const f of effects.createFacts ?? []) for (const who of f.knownBy) if (who !== 'player') this.resolveCharacter(worldId, who);
  }

  private failingPrecondition(state: WorldState, requires: Precondition[], worldId: ID): string | null {
    const player = this.playerCharacter(worldId);
    if (!player) return 'NO_PLAYER_CHARACTER';
    for (const r of requires) {
      if (r.resource) {
        const cid = r.resource.character === 'player' ? player : r.resource.character;
        const v = state.characters[cid]?.resources[r.resource.key];
        if (v === undefined || v < r.resource.min) return 'RESOURCE_PRECONDITION';
      }
      if (r.relationship) {
        const from = r.relationship.from === 'player' ? player : r.relationship.from;
        const v = state.relationships[relationshipKey(from, r.relationship.to, r.relationship.dimension)];
        if (v === undefined) return 'RELATIONSHIP_PRECONDITION';
        if (r.relationship.min !== undefined && v < r.relationship.min) return 'RELATIONSHIP_PRECONDITION';
        if (r.relationship.max !== undefined && v > r.relationship.max) return 'RELATIONSHIP_PRECONDITION';
      }
      if (r.characterActive && state.characters[r.characterActive]?.status !== 'active') return 'CHARACTER_UNAVAILABLE';
      if (r.arcStatus && state.arcStatuses[r.arcStatus.arc] !== r.arcStatus.status) return 'ARC_PRECONDITION';
      if (r.knowsFact) {
        const who = r.knowsFact.character === 'player' ? player : r.knowsFact.character;
        if (!(state.factualKnowledge[who] ?? []).includes(r.knowsFact.factId)) return 'KNOWLEDGE_PRECONDITION';
      }
      if (r.flag && state.flags[r.flag.key] !== r.flag.equals) return 'FLAG_PRECONDITION';
      if (r.surpriseCooldown) {
        const at = state.flags[`surprise:${r.surpriseCooldown.family}:at`];
        if (typeof at === 'string' && (Date.parse(state.worldTime) - Date.parse(at)) / 3600_000 < r.surpriseCooldown.worldHours) return 'SURPRISE_COOLDOWN';
      }
    }
    return null;
  }

  private surpriseEligible(state: WorldState, family: SurpriseFamily, world: World): boolean {
    if (world.status !== 'active') return false;
    if (this.failingPrecondition(state, family.requires, world.id) !== null) return false;
    const at = state.flags[`surprise:${family.id}:at`];
    if (typeof at === 'string' && (Date.parse(state.worldTime) - Date.parse(at)) / 3600_000 < family.cooldownWorldHours) return false;
    // Budget is derived from canonical events, not from operational counters.
    const dayAgo = Date.parse(state.worldTime) - 24 * 3600_000;
    const used = this.store.worldEvents(world.id).filter(
      (e) => e.type === 'surprise.triggered' && Date.parse(e.worldTime) > dayAgo,
    ).length;
    return used < this.pack.surpriseBudgetPerDay;
  }

  private causalParentEvent(worldId: ID, family: SurpriseFamily): ID | null {
    const events = this.store.worldEvents(worldId);
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const p = events[i]!.payload as Record<string, unknown>;
      if (p.arcId === family.causalArc) return events[i]!.eventId;
    }
    // Genesis establishes the opening arcs, so it is a valid causal parent.
    for (let i = events.length - 1; i >= 0; i -= 1) {
      if (events[i]!.type === 'world.created') return events[i]!.eventId;
    }
    return null;
  }

  // --- offered choices ----------------------------------------------------
  private refreshOffersAndQueue(worldId: ID): EpisodeRow {
    const world = this.requireWorld(worldId);
    const choices = this.choicesAt(worldId, world.stateVersion);
    for (const [key, row] of this.store.offeredChoices) {
      if (row.worldId === worldId) this.store.offeredChoices.delete(key);
    }
    for (const choice of choices) {
      const row: OfferedChoiceRow = { choiceId: choice.choiceId, worldId, boundVersion: world.stateVersion, ruleId: choice.choiceId, copy: choice.copy };
      this.store.offeredChoices.set(offerKey(worldId, choice.choiceId), row);
    }
    const through = world.lastEventSequence;
    const from = (this.lastEpisodeThrough(worldId)) + 1;
    if (from > through) {
      // A no-effect command produced no new material to narrate.
      const existing = [...this.store.episodes.values()].filter((e) => e.episode.worldId === worldId).at(-1);
      if (existing) return existing;
    }
    return this.queueEpisode(worldId, world.stateVersion, from, through);
  }

  /** The episode cursor lives in the persisted episode rows, not in engine
   *  memory, so tiling continues correctly after a process restart. */
  private lastEpisodeThrough(worldId: ID): number {
    let max = 0;
    for (const e of this.store.episodes.values()) {
      if (e.episode.worldId === worldId && e.episode.throughEventSequence > max) max = e.episode.throughEventSequence;
    }
    return max;
  }

  private async anchors(worldId: ID): Promise<number | null> {
    if (this.ports) return this.ports.resumeAnchor(worldId);
    return this.resumeFallback.get(worldId) ?? null;
  }

  private async spentToday(userId: ID): Promise<number> {
    if (this.ports) return this.ports.dailySpendUsd(userId, this.dayStartIso());
    let total = 0;
    for (const r of this.store.generationRuns.values()) {
      const owner = this.store.worlds.get(r.worldId)?.ownerUserId;
      if (owner !== userId) continue;
      if (Date.parse(r.createdAt) < this.dayStart()) continue;
      total += r.costUsd;
    }
    return total;
  }

  private dayStart(): number { return Math.floor(this.wallNow / DAY_MS) * DAY_MS; }
  private dayStartIso(): ISOTime { return new Date(this.dayStart()).toISOString(); }

  currentChoices(worldId: ID): IssuedChoice[] {
    return this.choicesAt(worldId, this.requireWorld(worldId).stateVersion);
  }

  /** The offers a player held at one committed version, recomputed from that
   *  version's snapshot. `offeredChoices` only ever mirrors these same flags and
   *  preconditions (see `refreshOffersAndQueue`), so the row is not needed here —
   *  and reading the snapshot instead of the live offer table is what lets an
   *  episode that is still in the queue be narrated against its own version
   *  after the world has moved on (§10: prose is validated against the version
   *  it was committed for). */
  private choicesAt(worldId: ID, version: number): IssuedChoice[] {
    const snap = this.store.snapshotAt(worldId, version);
    return this.capOffers(this.eligibleOffers(snap.state, worldId), worldId, snap.lastEventSeq);
  }

  /** Every choice this world has unlocked and the player can currently pay for —
   *  which is not the same set as what a scene may show (see `capOffers`). */
  private eligibleOffers(state: WorldState, worldId: ID): IssuedChoice[] {
    const out: IssuedChoice[] = [];
    for (const key of Object.keys(state.flags)) {
      if (!key.startsWith('offerable:') || state.flags[key] !== true) continue;
      const id = key.slice('offerable:'.length);
      const rule = findChoice(this.pack, id);
      if (!rule) continue;
      if (this.failingPrecondition(state, rule.requires, worldId) !== null) continue;
      out.push({ choiceId: id, label: rule.label, copy: rule.copy });
    }
    return out.sort((a, b) => a.choiceId.localeCompare(b.choiceId));
  }

  /** FR-04 bounds what a scene shows; the rulepack bounds what a world has
   *  unlocked. Only the first is what the player may act on, so an over-cap scene
   *  is trimmed here rather than issued in full (ADR-022). The trim is a view over
   *  committed state and writes no flags, so replay equivalence and every stored
   *  world's hash are untouched. */
  private capOffers(list: IssuedChoice[], worldId: ID, upToSequence: number): IssuedChoice[] {
    const { max } = this.pack.offerPolicy;
    if (list.length <= max) return list;
    const history = this.offerHistory(worldId, upToSequence);
    const declared = new Map(this.pack.choices.map((c, i) => [c.id, i]));
    const rank = (id: ID) => ({
      opened: history.opened.get(id) ?? 0,
      used: history.used.get(id) ?? 0,
      declared: declared.get(id) ?? this.pack.choices.length,
    });
    const kept = [...list].sort((a, b) => {
      const ra = rank(a.choiceId);
      const rb = rank(b.choiceId);
      // What the world just unlocked leads the scene; a move the player just made
      // trails; otherwise §12's own ordering of the moves decides who is dropped.
      return rb.opened - ra.opened || ra.used - rb.used || ra.declared - rb.declared;
    }).slice(0, max);
    return kept.sort((a, b) => a.choiceId.localeCompare(b.choiceId));
  }

  /** When each choice became offerable and when the player last took it, read off
   *  the event log instead of off `WorldState.flags`: a flag records that a choice
   *  can be offered, never when, and an `offerSeq` flag would be canonical state —
   *  which would break replay for every stored world (contract §3, T19). */
  private offerHistory(worldId: ID, upToSequence: number): { opened: Map<ID, number>; used: Map<ID, number> } {
    const opened = new Map<ID, number>();
    const used = new Map<ID, number>();
    for (const e of this.store.worldEvents(worldId)) {
      if (e.sequence > upToSequence) break;
      const p = e.payload as Record<string, unknown>;
      for (const id of (p.opensChoices as ID[] | undefined) ?? []) opened.set(id, e.sequence);
      for (const [k, v] of Object.entries((p.flags as Record<string, unknown> | undefined) ?? {})) {
        if (k.startsWith('offerable:') && v === true) opened.set(k.slice('offerable:'.length), e.sequence);
      }
      if (e.type === 'choice.resolved') used.set(p.ruleId as ID, e.sequence);
    }
    return { opened, used };
  }

  /** The state a staged batch would produce, folded through the reducer. The
   *  guard below has to predict what `commit` will write, so it reads the same
   *  authority rather than repeating the effect arithmetic (contract §3). */
  private project(state: WorldState, staged: StagedEvent[]): WorldState {
    return staged.reduce((s, e) => applyEvent(s, { ...e, sequence: 0 } as unknown as DomainEvent), structuredClone(state));
  }

  /** The lower half of FR-04's interval. A move can spend the resource that kept
   *  the other offers payable, and a one-button scene is not a scene — but §8
   *  forbids inventing content to fill one, so the engine refuses the draining
   *  move only when another issued move holds the floor, and never refuses the
   *  last move the player has. A world can therefore stall at one offer; it can
   *  never deadlock (ADR-022). */
  private assertSceneFloor(state: WorldState, worldId: ID, choiceId: ID, issued: IssuedChoice[], staged: StagedEvent[]) {
    const { min } = this.pack.offerPolicy;
    if (this.eligibleOffers(this.project(state, staged), worldId).length >= min) return;
    for (const other of issued) {
      if (other.choiceId === choiceId) continue;
      const rule = findChoice(this.pack, other.choiceId);
      if (!rule) continue;
      let alt: StagedEvent[];
      try {
        // A simulation must not draw ids from the deterministic sequence: an
        // offer that cannot even compile is not an escape hatch either.
        alt = this.buildEffectEvents(state, rule.effects, rule.id, worldId, () => 'evt_simulated').events;
      } catch {
        continue;
      }
      if (this.eligibleOffers(this.project(state, alt), worldId).length >= min) {
        throw err.precondition('SCENE_CHOICE_FLOOR', 'That move would leave you with nowhere to go. Try another one.');
      }
    }
  }

  // --- episode materialization -------------------------------------------
  private queueEpisode(worldId: ID, version: number, fromSeq: number, throughSeq: number): EpisodeRow {
    const row: EpisodeRow = {
      status: 'pending',
      episode: {
        id: this.ids('ep'), worldId, fromEventSequence: fromSeq, throughEventSequence: throughSeq,
        worldStateVersion: version, content: '', referencedEventIds: [], allowedChoiceIds: [], validationStatus: 'rejected',
      },
    };
    this.store.episodes.set(row.episode.id, row);
    this.store.outbox.push({ worldId, version, episodeId: row.episode.id, kind: 'episode.generate' });
    return row;
  }

  /** Bounded worker pass over the outbox. Never touches canonical state. */
  async flush(): Promise<void> {
    let guard = 0;
    while (this.store.outbox.length > 0 && guard++ < 1000) {
      const job = this.store.outbox.shift()!;
      const row = this.store.episodes.get(job.episodeId);
      if (row) await this.generateEpisode(row);
    }
  }

  private async generateEpisode(row: EpisodeRow) {
    const world = this.requireWorld(row.episode.worldId);
    // Everything the narration is built from — facts, clock, offers — is read at
    // the version this episode was committed for, not at the live head: the
    // worker can lag behind several commands (§10).
    const version = row.episode.worldStateVersion;
    const snap = this.store.snapshotAt(world.id, version);
    const player = this.playerCharacter(world.id)!;
    const events = this.store.worldEvents(world.id).filter((e) => e.sequence >= row.episode.fromEventSequence && e.sequence <= row.episode.throughEventSequence);
    const eventIds = events.map((e) => e.eventId);
    const allowedChoiceIds = this.choicesAt(world.id, version).map((c) => c.choiceId);
    const authorizedPovFacts = snap.state.factualKnowledge[player] ?? [];
    const secretMarkers = new Map<ID, string>();
    for (const f of this.store.facts.values()) if (f.worldId === world.id) secretMarkers.set(f.factId, f.sensitivePhrase ?? f.label);

    // Enrichment: build the data the prompt needs to write scene prose.
    // All fields are read from the snapshot at the episode's committed version,
    // POV-filtered, and no key comes from a client. The payload stops being a skeleton.
    const authorizedFactLabels: Record<ID, string> = {};
    for (const factId of authorizedPovFacts) {
      const fact = this.store.facts.get(`${world.id}|${factId}`);
      if (fact) authorizedFactLabels[factId] = fact.label;
    }
    const characterTitlesAndGoals: Record<ID, { title?: string; goals: string[] }> = {};
    for (const char of this.store.characters.values()) {
      if (char.worldId !== world.id) continue;
      const state = snap.state.characters[char.id];
      if (!state) continue;
      const cast = this.pack.templates[0]?.characters.find((c) => c.id === char.id);
      if (cast) characterTitlesAndGoals[char.id] = { title: cast.profile?.title, goals: state.goals };
    }
    const relationshipValues: Record<ID, { dimension: string; value: number }> = {};
    for (const [key, value] of Object.entries(snap.state.relationships)) {
      const parts = key.split('|');
      if (parts.length !== 3) continue;
      const [actor, target, dimension] = parts;
      if (actor === player) relationshipValues[target] = { dimension, value };
    }
    const resourceValues = snap.state.characters[player]?.resources ?? {};
    const arcStatuses: Record<ID, string> = {};
    for (const [arcId, status] of Object.entries(snap.state.arcStatuses)) {
      if (status !== 'locked') arcStatuses[arcId] = status;
    }

    const unitCost = 0.004;
    // Which prompt the process will actually send; a fake provider that names no
    // version stays attributed to the engine's built-in placeholder.
    const promptVersion = this.provider.promptVersion ?? 'p1';
    // The spend ledger is the persisted generation_runs table, so a restart
    // cannot hand the user a fresh daily budget (FR-13).
    const spent = await this.spentToday(world.ownerUserId);

    row.status = 'generating';

    // Budget is checked before the provider request (contract 10).
    if (spent + unitCost > this.usdBudgetPerUserPerDay) {
      this.publishFallback(row, snap.state, events, allowedChoiceIds, world, player, 'budget_exceeded');
      this.registerRun(world.ownerUserId, world.id, 'narrate', 'none', promptVersion, 0, 0, 0, 'budget_exceeded');
      return;
    }

    const req: NarrativeRequest = {
      worldId: world.id, committedVersion: row.episode.worldStateVersion, eventIds, authorizedPovFacts,
      characterProfiles: [...this.store.characters.values()].filter((c) => c.worldId === world.id).map((c) => ({ id: c.id, name: c.name })),
      styleConstraints: this.pack.style ?? DEFAULT_STYLE,
      allowedChoiceIds, promptVersion, tokenBudget: 2000, worldTime: snap.state.worldTime,
      eventExcerpts: events.map((e) => ({ id: e.eventId, type: e.type })),
      authorizedFactLabels, characterTitlesAndGoals, relationshipValues, resourceValues, arcStatuses,
    };

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      let response;
      try {
        response = await this.provider.narrate(req);
      } catch {
        response = { failure: 'timeout' as const };
      }
      if (response.failure) {
        this.registerRun(world.ownerUserId, world.id, 'narrate', response.modelId ?? 'unknown', promptVersion, response.inputTokens ?? 0, response.outputTokens ?? 0, unitCost, 'provider_failure');
        if (attempt === 2) {
          this.publishFallback(row, snap.state, events, allowedChoiceIds, world, player, 'provider_timeout');
          return;
        }
        row.status = 'retrying';
        continue;
      }

      const problems = validateNarrative(response, req, secretMarkers);
      // §10 and §15: the provider's own `content_flags` are already covered by
      // POLICY_BLOCKED above. This screen runs on every answer, including one
      // from a gateway that says nothing about its own output.
      const verdict = screenText(response.episode_text ?? '');
      // §15 asks that prompt-injection isolation be observable. Story text is
      // allowed to *contain* an instruction — nothing here acts on it — but the
      // attempt belongs in the operations record so a reviewer can see it.
      if (containsInjectionAttempt(response.episode_text ?? '')) {
        this.store.audit.push({ kind: 'narrative_injection_attempt', worldId: world.id, at: this.nowIso() });
      }
      const reasons = verdict.blocked ? [...problems, `content_policy:${verdict.matched.join('|')}`] : problems;
      // The ledger records the validation outcome, not only the call: section 10
      // asks for validation failures to be tracked, and a rejected attempt is
      // still one the user paid for.
      this.registerRun(world.ownerUserId, world.id, 'narrate', response.modelId ?? 'unknown', promptVersion, response.inputTokens ?? 0, response.outputTokens ?? 0, unitCost, reasons.length > 0 ? `rejected:${reasons.join(',')}` : 'checked');

      if (reasons.length > 0) {
        this.store.audit.push({ kind: `narrative_rejected:${reasons.join(',')}`, worldId: world.id, at: this.nowIso() });
        if (attempt === 2) {
          this.publishFallback(row, snap.state, events, allowedChoiceIds, world, player, reasons[0]!);
          return;
        }
        row.status = 'retrying';
        continue;
      }

      // A flag publishes: §15 keeps it age-appropriate and bounded, but the
      // reviewer queue is what turns a flag into a policy decision (§10).
      if (verdict.flags.length > 0) {
        this.store.audit.push({ kind: `narrative_flagged:${verdict.matched.join('|')}`, worldId: world.id, at: this.nowIso() });
      }

      row.episode = {
        ...row.episode,
        content: response.episode_text!,
        referencedEventIds: [...response.referenced_event_ids!].sort(),
        allowedChoiceIds: [...allowedChoiceIds].sort(),
        validationStatus: 'passed',
      };
      row.status = 'published';
      return;
    }
  }

  private publishFallback(row: EpisodeRow, state: WorldState, events: DomainEvent[], choiceIds: ID[], world: World, player: ID, reason: string) {
    // The names are the ones `characterProfiles` already hands the provider — a
    // character record the player can see — so the fallback introduces nothing the
    // narration would not have been given.
    const names = Object.fromEntries(
      [...this.store.characters.values()].filter((c) => c.worldId === world.id).map((c) => [c.id, c.name]),
    );
    row.episode = {
      ...row.episode,
      content: fallbackText(state, events.map((e) => ({ type: e.type, actorCharacterId: e.actorCharacterId })), names, player),
      referencedEventIds: events.map((e) => e.eventId), allowedChoiceIds: choiceIds, validationStatus: 'fallback',
    };
    row.status = 'fallback';
    this.store.audit.push({ kind: `narrative_fallback:${reason}`, worldId: world.id, at: this.nowIso() });
  }

  private registerRun(userId: ID, worldId: ID, purpose: string, modelId: string, promptVersion: string, inputTokens: number, outputTokens: number, costUsd: number, validationStatus: string) {
    const id = this.ids('run');
    this.store.generationRuns.set(id, { id, worldId, purpose, modelId, promptVersion, inputTokens, outputTokens, costUsd, validationStatus, createdAt: this.nowIso() });
  }

  // --- small accessors ----------------------------------------------------
  private entitlement(userId: ID) {
    const e = this.store.entitlements.get(userId);
    if (!e) throw err.unauthenticated();
    return e;
  }

  private requireWorld(worldId: ID): World {
    const w = this.store.worlds.get(worldId);
    if (!w) throw err.notFound();
    return w;
  }

  private authorizeRead(userId: ID, worldId: ID): World {
    const w = this.requireWorld(worldId);
    if (w.ownerUserId !== userId) throw err.notFound();
    return w;
  }

  /** The caller's identity row for a world, as the membership recorded it. */
  private identityOf(userId: ID, worldId: ID): ID {
    return this.store.memberships.get(membershipKey(worldId, userId))?.identityId ?? '';
  }

  /** Writes answer the read question first: a world you cannot see is a world
   *  that is not there. 403 here would be an existence oracle — §14's leakage
   *  baseline is about status codes as much as about payloads. 403 stays
   *  reserved for `assertActorIdentity`, which runs inside a world the caller
   *  demonstrably can see. */
  private authorizeWrite(userId: ID, worldId: ID): World {
    const w = this.requireWorld(worldId);
    if (w.ownerUserId !== userId) throw err.notFound();
    const m = this.store.memberships.get(membershipKey(worldId, userId));
    if (!m || m.status !== 'active') throw err.notFound();
    return w;
  }

  resolveCharacter(worldId: ID, characterId: ID): ID {
    const row = this.store.characters.get(characterKey(worldId, characterId));
    if (!row || row.worldId !== worldId) throw err.precondition('UNKNOWN_CHARACTER_REFERENCE', 'Character reference is not valid for this world');
    return characterId;
  }

  private playerCharacter(worldId: ID): ID | null {
    for (const c of this.store.characters.values()) {
      if (c.worldId === worldId && c.ownerIdentityId !== null) return c.id;
    }
    return null;
  }
}

export interface CommandInput {
  actorUserId: ID; worldId: ID; actorIdentityId: ID; expectedWorldVersion: number; commandId: ID;
}

function offerKey(worldId: ID, choiceId: ID) { return `${worldId}|${choiceId}`; }

function defaultSetting(template: WorldTemplate): SettingInput {
  return { era: template.allowedEras[0]!, location: template.allowedLocations[0]!, role: template.allowedRoles[0]!, flags: [] };
}
