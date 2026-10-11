// Versioned rulepack contract and effect interpreter.
// Contract section 6: a v1 rulepack specifies command prerequisites, allowed
// state transitions, bounded numerical effects, event causes, visibility,
// cooldowns and time-advance behaviour. Narrative output can never supply these.

import type { ID } from './domain.js';

export type ActorRef = 'player' | ID;

export interface Precondition {
  resource?: { character: ActorRef; key: string; min: number };
  relationship?: { from: ActorRef; to: ID; dimension: string; min?: number; max?: number };
  characterActive?: ID;
  arcStatus?: { arc: ID; status: 'locked' | 'open' | 'resolved' | 'failed' };
  knowsFact?: { character: ActorRef; factId: ID };
  flag?: { key: string; equals: boolean | string | number };
  surpriseCooldown?: { family: ID; worldHours: number };
}

export interface Effect {
  resources?: { character: ActorRef; key: string; delta: number; allowsDebt?: boolean }[];
  relationships?: { from: ActorRef; to: ID; dimension: string; delta: number }[];
  createFacts?: { factId: ID; label: string; knownBy: ActorRef[]; verified?: boolean; visibility: 'owner' | 'participants' | 'world'; sensitivePhrase?: string }[];
  discloseFacts?: { factId: ID; to: ActorRef; via: 'disclosure' | 'observation' }[];
  arcs?: { arc: ID; action: 'open' | 'progress' | 'resolve' | 'fail'; when?: { relationshipBelow?: { from: ActorRef; to: ID; dimension: string; value: number } } }[];
  flags?: Record<string, boolean | string | number>;
  openChoices?: ID[];
}

export interface ChoiceRule {
  id: string;
  label: string;
  copy: string;
  requires: Precondition[];
  effects: Effect;
  availableFromGenesis?: boolean;
}

export interface SurpriseFamily {
  id: ID;
  cooldownWorldHours: number;
  requires: Precondition[];
  effects: Effect;
  copy: string;
  /** causal hook: an existing unresolved arc, goal, resource pressure or setting pressure */
  causalArc: ID;
}

export interface SettingInput {
  era: string;
  location: string;
  role: string;
  genre?: string;
  flags?: string[];
}

export interface SettingConstraint {
  id: string;
  if: Partial<Pick<SettingInput, 'era' | 'location' | 'role'>>;
  requireFlags: string[];
  message: string;
}

export interface WorldTemplate {
  id: string;
  version: string;
  allowedLocations: string[];
  allowedEras: string[];
  allowedRoles: string[];
  constraints: SettingConstraint[];
  playerCharacterId: ID;
  playerGoals: string[];
  characters: { id: ID; name: string; isPlayer: boolean; roleIds: string[]; goals: string[]; resources: Record<string, number>; profile: Record<string, unknown> }[];
  relationships: { from: ID; to: ID; dimension: string; value: number }[];
  facts: { id: ID; label: string; knownBy: ID[]; verified: boolean; visibility: 'owner' | 'participants' | 'world'; sensitivePhrase?: string }[];
  arcs: { id: ID; arcType: string; status: 'locked' | 'open' | 'resolved' | 'failed' }[];
  worldTime: string;
  genesisChoiceIds: ID[];
}

export interface TimePolicy {
  tickMinutes: number;
  maxCatchupTicks: number;
  maxWorldTimeJumpMinutes: number;
  /** deterministic ambient events per elapsed tick, driven by seed, never open-ended agents */
  ambientProgressPerTick: number;
}

export interface RulePack {
  id: string;
  version: string;
  time: TimePolicy;
  templates: WorldTemplate[];
  choices: ChoiceRule[];
  surprises: SurpriseFamily[];
  surpriseBudgetPerDay: number;
  freeWorldQuota: number;
}

export function findTemplate(pack: RulePack, id: string): WorldTemplate | undefined {
  return pack.templates.find((t) => t.id === id);
}

export function findChoice(pack: RulePack, id: ID): ChoiceRule | undefined {
  return pack.choices.find((c) => c.id === id);
}
