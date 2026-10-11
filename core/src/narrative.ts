// Narrative AI boundary — contract section 10.
// The provider is untrusted, nondeterministic content production. It receives a
// POV-filtered context and its output is schema- and canon-validated before it
// may be published. It never mutates canonical state.

import type { ID, ISOTime, World, WorldState } from './domain.js';

export interface NarrativeRequest {
  worldId: ID;
  committedVersion: number;
  eventIds: ID[];
  authorizedPovFacts: ID[];
  characterProfiles: { id: ID; name: string }[];
  allowedChoiceIds: ID[];
  promptVersion: string;
  tokenBudget: number;
  worldTime: ISOTime;
  eventExcerpts: { id: ID; type: string }[];
}

export interface NarrativeResponse {
  episode_text?: string;
  referenced_event_ids?: ID[];
  choice_copy_by_id?: Record<ID, string>;
  content_flags?: string[];
  mentioned_fact_ids?: ID[];
  modelId?: string;
  inputTokens?: number;
  outputTokens?: number;
  failure?: 'timeout' | 'error';
}

export interface NarrativeProvider {
  /** A real provider is an HTTP call, so it may be async; the engine awaits
   *  either form and always runs the result through validateNarrative. */
  narrate(request: NarrativeRequest): NarrativeResponse | Promise<NarrativeResponse>;
}

/** Deterministic, prebuilt copy used whenever the provider fails or is rejected.
 *  Rendered from committed state only. */
export function fallbackText(state: WorldState, eventIds: ID[], choiceIds: ID[], world: World, playerCharacterId: ID): string {
  const player = state.characters[playerCharacterId];
  const lines = [
    `${world.rulepackId} — world time ${state.worldTime}.`,
    player ? `Your position: cash ${player.resources.cash ?? 0}, influence ${player.resources.influence ?? 0}, credibility ${player.resources.credibility ?? 0}.` : 'Your position is unchanged.',
    `${eventIds.length} committed event(s) recorded.`,
    `Available actions: ${choiceIds.join(', ') || 'none'}.`,
  ];
  return lines.join('\n');
}

export function validateNarrative(response: NarrativeResponse, req: NarrativeRequest, secretMarkers: Map<ID, string>): string[] {
  const problems: string[] = [];
  if (typeof response.episode_text !== 'string' || response.episode_text.length === 0) problems.push('EMPTY_TEXT');

  const refs = response.referenced_event_ids;
  if (!Array.isArray(refs)) problems.push('MISSING_EVENT_REFS');
  else {
    const allowed = new Set(req.eventIds);
    if (refs.some((id) => !allowed.has(id))) problems.push('UNKNOWN_EVENT_REF');
    if (refs.length !== new Set(req.eventIds).size) problems.push('INCOMPLETE_EVENT_REFS');
  }

  // Choice ids come only from the simulation, never from narration.
  const copy = response.choice_copy_by_id ?? {};
  const want = [...req.allowedChoiceIds].sort().join('|');
  const got = Object.keys(copy).sort().join('|');
  if (want !== got) problems.push('CHOICE_ID_MISMATCH');

  // No inaccessible facts, and no prose claim of a fact the viewer may not know.
  const authorized = new Set(req.authorizedPovFacts);
  for (const fid of response.mentioned_fact_ids ?? []) if (!authorized.has(fid)) problems.push('FACT_LEAK');
  const text = response.episode_text ?? '';
  for (const [fid, marker] of secretMarkers) {
    if (authorized.has(fid) || !marker) continue;
    if (text.toLowerCase().includes(marker.toLowerCase())) { problems.push('FACT_LEAK'); break; }
  }

  if ((response.content_flags ?? []).includes('policy_blocked')) problems.push('POLICY_BLOCKED');
  return [...new Set(problems)];
}
