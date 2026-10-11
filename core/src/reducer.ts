// Canonical event reducer — the sole authority for WorldState evolution.
// A state is defined as the fold of committed events; replay equivalence
// (contract section 3, T19) therefore holds by construction and is asserted by tests.

import {
  type DomainEvent, type ID, type WorldState, type EventType,
  emptyWorldState, relationshipKey, clampRelationship,
} from './domain.js';
import { err } from './errors.js';

export interface GenesisPayload {
  templateId: string;
  worldTime: string;
  characters: { id: ID; status: 'active' | 'unavailable' | 'removed'; roleIds: string[]; goals: string[]; resources: Record<string, number> }[];
  relationships: { from: ID; to: ID; dimension: string; value: number }[];
  arcs: { id: ID; status: 'locked' | 'open' | 'resolved' | 'failed' }[];
  facts: { id: ID; knownBy: ID[] }[];
  flags?: Record<string, boolean | string | number>;
  futureEventIds?: ID[];
}

/** Choices and flags become available through committed event payloads only —
 *  never through narrative text (contract section 10). */
function applyAvailability(state: WorldState, payload: Record<string, unknown>) {
  const opens = payload.opensChoices as ID[] | undefined;
  if (opens) for (const choiceId of opens) state.flags[`offerable:${choiceId}`] = true;
  const flags = payload.flags as Record<string, boolean | string | number> | undefined;
  if (flags) Object.assign(state.flags, flags);
}

function asType(e: DomainEvent): EventType {
  if (!(
    e.type === 'world.created' || e.type === 'world.time_advanced' || e.type === 'identity.entered_world'
    || e.type === 'choice.resolved' || e.type === 'relationship.changed' || e.type === 'resource.changed'
    || e.type === 'fact.created' || e.type === 'fact.disclosed' || e.type === 'story_arc.opened'
    || e.type === 'story_arc.progressed' || e.type === 'story_arc.closed' || e.type === 'surprise.triggered'
    || e.type === 'scheduled_event.resolved'
  )) {
    // v1 MUST reject unknown event types (contract section 4).
    throw err.unknownEvent(String(e.type));
  }
  return e.type;
}

export function applyEvent(state: WorldState, event: DomainEvent): WorldState {
  const type = asType(event);
  const next: WorldState = structuredClone(state);
  const p = event.payload as never as Record<string, unknown>;

  switch (type) {
    case 'world.created': {
      const g = p as unknown as GenesisPayload;
      next.worldTime = g.worldTime;
      for (const c of g.characters) {
        next.characters[c.id] = { status: c.status, roleIds: c.roleIds, resources: { ...c.resources }, goals: [...c.goals] };
      }
      for (const r of g.relationships) {
        next.relationships[relationshipKey(r.from, r.to, r.dimension)] = clampRelationship(r.value);
      }
      for (const a of g.arcs) next.arcStatuses[a.id] = a.status;
      for (const f of g.facts) {
        for (const who of f.knownBy) {
          const known = next.factualKnowledge[who] ?? [];
          if (!known.includes(f.id)) next.factualKnowledge[who] = [...known, f.id].sort();
        }
      }
      if (g.flags) Object.assign(next.flags, g.flags);
      if (g.futureEventIds) next.futureEventIds = [...g.futureEventIds];
      break;
    }
    case 'world.time_advanced': {
      next.worldTime = p.newWorldTime as string;
      break;
    }
    case 'identity.entered_world': {
      const cid = p.characterId as ID;
      if (!next.characters[cid]) next.characters[cid] = { status: 'active', roleIds: [], resources: {}, goals: [] };
      break;
    }
    case 'resource.changed': {
      const ch = next.characters[p.characterId as ID];
      if (!ch) throw err.precondition('UNKNOWN_CHARACTER', 'Resource change references an unknown character');
      const key = p.key as string;
      ch.resources[key] = (ch.resources[key] ?? 0) + (p.delta as number);
      break;
    }
    case 'relationship.changed': {
      const k = relationshipKey(p.fromCharacterId as ID, p.toCharacterId as ID, p.dimension as string);
      next.relationships[k] = clampRelationship((next.relationships[k] ?? 0) + (p.delta as number));
      break;
    }
    case 'fact.created': {
      const who = p.characterId as ID | undefined;
      const factId = p.factId as ID;
      if (who) {
        const known = next.factualKnowledge[who] ?? [];
        if (!known.includes(factId)) next.factualKnowledge[who] = [...known, factId].sort();
      }
      break;
    }
    case 'fact.disclosed': {
      const who = p.characterId as ID;
      const factId = p.factId as ID;
      const known = next.factualKnowledge[who] ?? [];
      if (!known.includes(factId)) next.factualKnowledge[who] = [...known, factId].sort();
      break;
    }
    case 'story_arc.opened': next.arcStatuses[p.arcId as ID] = 'open'; break;
    case 'story_arc.progressed': break;
    case 'story_arc.closed': next.arcStatuses[p.arcId as ID] = p.status as 'resolved' | 'failed'; break;
    case 'surprise.triggered': {
      next.flags[`surprise:${p.familyId as string}`] = event.sequence;
      applyAvailability(next, p);
      break;
    }
    case 'scheduled_event.resolved': {
      const id = p.scheduledEventId as ID;
      next.futureEventIds = next.futureEventIds.filter((x) => x !== id);
      applyAvailability(next, p);
      break;
    }
    case 'choice.resolved': {
      next.flags.lastChoice = event.sequence;
      applyAvailability(next, p);
      break;
    }
  }
  return next;
}

export function replay(events: DomainEvent[], startTime: string): WorldState {
  return events.reduce((s, e) => applyEvent(s, e), emptyWorldState(startTime));
}
