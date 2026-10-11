// Canonical persistence port plus an in-memory implementation.
// Rows mirror the relational model in contract section 1: world-bound records
// always carry world_id, the event log is append-only, and per-world writes are
// serialized so optimistic version checks behave like a row lock.

import {
  type CommandResult, type DomainEvent, type ID, type ISOTime,
  type World, type WorldState, type NarrativeEpisode,
} from './domain.js';
import { err } from './errors.js';

export interface SnapshotRow {
  worldId: ID; version: number; stateSchemaVersion: '1.0';
  state: WorldState; stateHash: string; lastEventSeq: number; createdAt: ISOTime;
}

export interface CommandRow {
  commandId: ID; worldId: ID; requestHash: string; actorUserId: ID;
  expectedWorldVersion: number; commandType: string; commandSchemaVersion: '1.0';
  status: 'committed' | 'no_op' | 'failed'; result: CommandResult | null; createdAt: ISOTime;
}

export interface IdentityRow { id: ID; ownerUserId: ID; personaSchemaVersion: string; profile: Record<string, unknown>; status: 'active' | 'archived' }
export interface MembershipRow { worldId: ID; userId: ID; identityId: ID; role: 'owner'; status: 'active' }
export interface CharacterRow { id: ID; worldId: ID; ownerIdentityId: ID | null; name: string; profile: Record<string, unknown> }
export interface FactRow { worldId: ID; factId: ID; label: string; verified: boolean; visibility: 'owner' | 'participants' | 'world'; sensitivePhrase?: string }
export interface ArcRow { id: ID; worldId: ID; arcType: string; status: 'locked' | 'open' | 'resolved' | 'failed' }
export interface EpisodeRow { episode: NarrativeEpisode; status: 'pending' | 'generating' | 'validated' | 'published' | 'retrying' | 'fallback' | 'failed' }
export interface GenerationRunRow { id: ID; worldId: ID; purpose: string; modelId: string; promptVersion: string; inputTokens: number; outputTokens: number; costUsd: number; validationStatus: string; createdAt: ISOTime }
export interface EntitlementRow { userId: ID; plan: 'free' | 'premium'; activeUntil: ISOTime | null; maxActiveWorlds: number }
export interface OfferedChoiceRow { choiceId: ID; worldId: ID; boundVersion: number; ruleId: string; copy: string }
export interface ScheduledEventRow { id: ID; worldId: ID; dueWorldTime: ISOTime; eventFamily: string; rulepackVersion: string; idempotencyKey: string; status: 'pending' | 'claimed' | 'completed' | 'failed'; attempts: number; maxAttempts: number }

export class Store {
  readonly users = new Map<ID, { id: ID; createdAt: ISOTime }>();
  readonly identities = new Map<ID, IdentityRow>();
  readonly worlds = new Map<ID, World>();
  readonly memberships = new Map<string, MembershipRow>();
  readonly blueprints = new Map<ID, { worldId: ID; schemaVersion: string; seed: number; setting: Record<string, unknown>; constraints: Record<string, unknown>; validatedAt: ISOTime }>();
  readonly characters = new Map<string, CharacterRow>();
  readonly facts = new Map<string, FactRow>();
  readonly arcs = new Map<ID, ArcRow>();
  readonly events = new Map<ID, DomainEvent[]>();
  readonly snapshots = new Map<string, SnapshotRow>();
  readonly commands = new Map<ID, CommandRow>();
  readonly episodes = new Map<ID, EpisodeRow>();
  readonly generationRuns = new Map<ID, GenerationRunRow>();
  readonly entitlements = new Map<ID, EntitlementRow>();
  readonly offeredChoices = new Map<ID, OfferedChoiceRow>();
  readonly scheduledEvents = new Map<ID, ScheduledEventRow>();
  readonly outbox: { worldId: ID; version: number; episodeId: ID; kind: string }[] = [];
  readonly audit: { kind: string; worldId: ID; at: ISOTime }[] = [];
  /** How many audit rows PgStore has already written to operation_log. Advanced
   *  only after a transaction commits, so a rolled back save re-emits them. */
  auditCursor = 0;

  private locks = new Map<ID, Promise<unknown>>();

  worldEvents(worldId: ID): DomainEvent[] {
    const list = this.events.get(worldId);
    if (!list) throw err.notFound();
    return list;
  }

  latestSnapshot(worldId: ID): SnapshotRow {
    const w = this.worlds.get(worldId);
    if (!w) throw err.notFound();
    const snap = this.snapshots.get(snapshotKey(worldId, w.stateVersion));
    if (!snap) throw err.notFound('Committed snapshot missing');
    return snap;
  }

  /** Serializes all mutations for one world; failure leaves the store untouched
   *  because callers stage writes and only this method commits them. */
  async withWorldLock<T>(worldId: ID, fn: () => T | Promise<T>): Promise<T> {
    const prev = this.locks.get(worldId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    this.locks.set(worldId, prev.then(() => gate));
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(worldId) === gate) this.locks.delete(worldId);
    }
  }

  recordCommand(row: CommandRow) { this.commands.set(row.commandId, row); }
}

export function membershipKey(worldId: ID, userId: ID) { return `${worldId}|${userId}`; }
export function factKey(worldId: ID, factId: ID) { return `${worldId}|${factId}`; }
export function characterKey(worldId: ID, characterId: ID) { return `${worldId}|${characterId}`; }
export function snapshotKey(worldId: ID, version: number) { return `${worldId}|${version}`; }
