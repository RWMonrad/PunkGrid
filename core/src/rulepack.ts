// Versioned rulepack contract and effect interpreter.
// Contract section 6: a v1 rulepack specifies command prerequisites, allowed
// state transitions, bounded numerical effects, event causes, visibility,
// cooldowns and time-advance behaviour. Narrative output can never supply these.

import type { ID } from './domain.js';
import type { StyleConstraints } from './narrative.js';

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

/** FR-04 (Master) and contract §5 step 5, harmonised by ADR-012: one interval for
 *  every scene, genesis included. The engine issues the scene, so the engine is
 *  what has to keep it inside the interval — narration cannot add a choice and a
 *  client may not remove one (ADR-022). */
export interface OfferPolicy {
  min: number;
  max: number;
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
  /** The opening clock for each supported era (ADR-023). A validated setting has to
   *  move the world it creates — Master US03 — so the era cannot be a filter that
   *  the genesis step ignores. Contract §12 fixes only the reference era's value,
   *  which is therefore also `worldTime`. */
  eraStarts: { era: string; worldTime: string }[];
  /** What each supported role grants the player at genesis: the role capabilities
   *  written into the snapshot and the title the cast is listed under (ADR-023). */
  roleGrants: { role: string; roleIds: string[]; title: string }[];
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
  offerPolicy: OfferPolicy;
  templates: WorldTemplate[];
  choices: ChoiceRule[];
  surprises: SurpriseFamily[];
  surpriseBudgetPerDay: number;
  freeWorldQuota: number;
  /** Contract 10 `style_constraints`. Absent means the prompt module's default. */
  style?: StyleConstraints;
}

export function findTemplate(pack: RulePack, id: string): WorldTemplate | undefined {
  return pack.templates.find((t) => t.id === id);
}

export function findChoice(pack: RulePack, id: ID): ChoiceRule | undefined {
  return pack.choices.find((c) => c.id === id);
}
