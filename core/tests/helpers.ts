import { Engine } from '../src/engine.js';
import { GLASS_HARBOR } from '../src/glassHarbor.js';
import { CompliantProvider } from '../src/providers.js';
import type { RulePack } from '../src/rulepack.js';
import type { NarrativeProvider } from '../src/narrative.js';
import type { ID } from '../src/domain.js';
import type { SnapshotRow } from '../src/store.js';
import { membershipKey } from '../src/store.js';
import { relationshipKey } from '../src/domain.js';

export const T0 = Date.parse('2026-10-11T12:00:00.000Z');
let counter = 0;
export const cid = (p = 'cmd') => `${p}_${(++counter).toString(36).padStart(4, '0')}`;

export function makeEngine(pack: RulePack = GLASS_HARBOR, provider: NarrativeProvider = new CompliantProvider(), opts: { usdBudgetPerUserPerDay?: number; autoFlush?: boolean } = {}) {
  return new Engine(pack, provider, { now: () => T0, seed: 20261011, ...opts });
}

export interface Ctx {
  engine: Engine;
  userId: ID;
  identityId: ID;
  worldId: ID;
  version: number;
  episodeId: ID;
}

export async function freshWorld(engine: Engine, userId: ID = 'user_a'): Promise<Ctx> {
  if (!engine.store.users.has(userId)) engine.registerUser(userId);
  const res = await engine.createWorld({ actorUserId: userId, mode: 'create', templateId: 'glass-harbor-2034', commandId: cid('gen') });
  return { engine, userId, identityId: res.identityId, worldId: res.worldId, version: res.commandResult.newVersion, episodeId: res.episodeId };
}

export async function choose(ctx: Ctx, choiceId: ID, expectedVersion = ctx.version) {
  return ctx.engine.submitChoice({
    actorUserId: ctx.userId, worldId: ctx.worldId, actorIdentityId: ctx.identityId,
    expectedWorldVersion: expectedVersion, choiceId, commandId: cid(),
  });
}

export function snap(ctx: Ctx): SnapshotRow {
  return ctx.engine.store.latestSnapshot(ctx.worldId);
}

export function trust(ctx: Ctx, target: ID, from: ID = 'char_player'): number {
  return snap(ctx).state.relationships[relationshipKey(from, target, 'trust')] ?? NaN;
}

export function resource(ctx: Ctx, key: string, character: ID = 'char_player'): number {
  return snap(ctx).state.characters[character]?.resources[key] ?? NaN;
}

export function knownFacts(ctx: Ctx, character: ID): ID[] {
  return snap(ctx).state.factualKnowledge[character] ?? [];
}

export function arc(ctx: Ctx, arcId: ID) {
  return snap(ctx).state.arcStatuses[arcId];
}

export function eventTypes(ctx: Ctx): string[] {
  return ctx.engine.store.worldEvents(ctx.worldId).map((e) => e.type);
}

export function ownerIdentityOf(ctx: Ctx): ID {
  return ctx.engine.store.memberships.get(membershipKey(ctx.worldId, ctx.userId))!.identityId;
}
