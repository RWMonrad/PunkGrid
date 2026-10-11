// Domain vocabulary, versioned type contracts and canonical primitives.
// Implements REALITY_ENGINE_CORE_CONTRACT_v1.0 sections 2, 4, 6.

import { createHash } from 'node:crypto';

export type ID = string;
export type ISOTime = string;

export type WorldMode = 'personal' | 'shared';
export type WorldVisibility = 'private' | 'invite_only' | 'public';
export type WorldStatus = 'creating' | 'active' | 'paused' | 'archived';
export type Outcome = 'committed' | 'no_op';
export type EventVisibility = 'owner' | 'participants' | 'world';

export interface World {
  id: ID;
  ownerUserId: ID;
  mode: WorldMode;
  visibility: WorldVisibility;
  status: WorldStatus;
  rulepackId: string;
  rulepackVersion: string;
  blueprintVersion: string;
  stateVersion: number;
  lastEventSequence: number;
  worldTime: ISOTime;
  createdAt: ISOTime;
}

export interface CommandEnvelope<T extends string = string, P = unknown> {
  schemaVersion: '1.0';
  commandId: ID;
  worldId: ID;
  actorIdentityId: ID;
  expectedWorldVersion: number;
  commandType: T;
  payload: P;
}

export const COMMAND_TYPES = [
  'world.create',
  'choice.select',
  'world.resume',
  'surprise.request',
  'episode.acknowledge',
  'world.pause',
  'world.archive',
] as const;
export type CommandType = (typeof COMMAND_TYPES)[number];

export const EVENT_TYPES = [
  'world.created',
  'world.time_advanced',
  'identity.entered_world',
  'choice.resolved',
  'relationship.changed',
  'resource.changed',
  'fact.created',
  'fact.disclosed',
  'story_arc.opened',
  'story_arc.progressed',
  'story_arc.closed',
  'surprise.triggered',
  'scheduled_event.resolved',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface DomainEvent<T extends string = string, P = unknown> {
  schemaVersion: '1.0';
  eventId: ID;
  worldId: ID;
  sequence: number;
  commandId: ID;
  type: T;
  actorCharacterId: ID | null;
  causedByEventIds: ID[];
  payload: P;
  visibility: EventVisibility;
  worldTime: ISOTime;
  rulesetVersion: string;
}

export interface CommandResult {
  commandId: ID;
  worldId: ID;
  previousVersion: number;
  newVersion: number;
  firstEventSequence: number | null;
  lastEventSequence: number | null;
  outcome: Outcome;
  eventIds: ID[];
  stateHash: string;
  noOpReason?: string;
}

export interface NarrativeEpisode {
  id: ID;
  worldId: ID;
  fromEventSequence: number;
  throughEventSequence: number;
  worldStateVersion: number;
  content: string;
  referencedEventIds: ID[];
  allowedChoiceIds: ID[];
  validationStatus: 'passed' | 'rejected' | 'fallback';
}

// Canonical WorldState v1 — contract section 6.
export interface WorldState {
  schemaVersion: '1.0';
  worldTime: ISOTime;
  characters: Record<ID, {
    status: 'active' | 'unavailable' | 'removed';
    roleIds: string[];
    resources: Record<string, number>;
    goals: string[];
  }>;
  relationships: Record<string, number>;
  flags: Record<string, boolean | string | number>;
  arcStatuses: Record<ID, 'locked' | 'open' | 'resolved' | 'failed'>;
  factualKnowledge: Record<ID, ID[]>;
  futureEventIds: ID[];
}

export function emptyWorldState(worldTime: ISOTime): WorldState {
  return {
    schemaVersion: '1.0',
    worldTime,
    characters: {},
    relationships: {},
    flags: {},
    arcStatuses: {},
    factualKnowledge: {},
    futureEventIds: [],
  };
}

export function relationshipKey(actor: ID, target: ID, dimension: string): string {
  return `${actor}|${target}|${dimension}`;
}

export function clampRelationship(value: number): number {
  return Math.max(-100, Math.min(100, Math.round(value)));
}

// --- Deterministic identifiers -------------------------------------------
// Opaque, monotonic-sortable ids. Seeded for reproducible tests (contract 5).

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function makeIdFactory(seed: number) {
  const rng = mulberry32(seed);
  let counter = 0;
  return function nextId(prefix: string): ID {
    counter += 1;
    let s = '';
    for (let i = 0; i < 10; i += 1) s += B32[Math.floor(rng() * 32) % 32];
    return `${prefix}_${s}${counter.toString(36).toUpperCase().padStart(4, '0')}`;
  };
}

// --- Canonical JSON + hashing --------------------------------------------

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return 'null';
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function stateHash(state: WorldState): string {
  return `sha256:${sha256(canonicalJson(state))}`;
}

export function requestHash(input: unknown): string {
  return `sha256:${sha256(canonicalJson(input))}`;
}
