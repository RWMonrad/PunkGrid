// Narrative AI boundary — contract section 10.
// The provider is untrusted, nondeterministic content production. It receives a
// POV-filtered context and its output is schema- and canon-validated before it
// may be published. It never mutates canonical state.

import type { EventType, ID, ISOTime, WorldState } from './domain.js';

/** Contract 10 `style_constraints`. Carried by the rulepack, never by a client,
 *  so prose style is a versioned part of the world definition like every other
 *  narrative input. */
export interface StyleConstraints {
  /** Narrative voice, e.g. `second person, present tense`. */
  pov: string;
  tone: string;
  language: string;
  /** Approximate word count the episode should aim for. */
  lengthTarget: number;
  /** Words or phrases the narration must never produce. */
  forbidden: string[];
}

export interface NarrativeRequest {
  worldId: ID;
  committedVersion: number;
  eventIds: ID[];
  authorizedPovFacts: ID[];
  characterProfiles: { id: ID; name: string }[];
  styleConstraints: StyleConstraints;
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
  /** Which prompt this provider actually sends, so `generation_runs` records the
   *  version that produced the text. Absent means the engine's built-in prompt. */
  readonly promptVersion?: string;
  /** A real provider is an HTTP call, so it may be async; the engine awaits
   *  either form and always runs the result through validateNarrative. */
  narrate(request: NarrativeRequest): NarrativeResponse | Promise<NarrativeResponse>;
}

/** The deterministic copy the app renders when no model has spoken: the engine's
 *  fallback (provider failed or was rejected) and the no-gateway provider.
 *  Rendered from committed state only.
 *
 *  The player reads this. It used to print the ledger ("2 committed event(s)
 *  recorded.", "Available actions: a_brief_staff, a_confront_mara"), which is the one
 *  sentence in the app that breaks the fiction — and the app already labels the row
 *  honestly ("Stored without narration", `cards.tsx`), so the prose does not have to
 *  sound like a receipt to be truthful. What is said here is still only what the
 *  ledger holds: the clock, the kinds of change committed at this version, and the
 *  names already visible in the character profiles. No ids, no payloads, no fact text,
 *  and the month table keeps the string identical on every machine and locale. */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const LEDGER_LINE: Record<EventType, string> = {
  'world.created': 'A world has been started, and it has a first hour.',
  'world.time_advanced': 'Time has passed, which is its own kind of news.',
  'identity.entered_world': 'Someone has arrived where you are.',
  'choice.resolved': 'You chose, and the choice came back answered.',
  'relationship.changed': 'Someone holds you at a different number than before.',
  'resource.changed': 'What you hold has changed.',
  'fact.created': 'There is a fact in this world that was not there an hour ago.',
  'fact.disclosed': 'A thing you did not know has been given to you.',
  'story_arc.opened': 'Something has begun that is not finished.',
  'story_arc.progressed': 'What had begun has moved.',
  'story_arc.closed': 'What had begun is finished.',
  'surprise.triggered': 'The world has done something nobody offered you.',
  'scheduled_event.resolved': 'A thing that was waiting has happened.',
};

function worldClock(iso: ISOTime): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${MONTHS[d.getUTCMonth()]} ${pad(d.getUTCDate())}, ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** The one deterministic voice the app has. Both no-AI paths are rendered through it:
 *  the engine's fallback copy (provider failed or was rejected) and the fake provider
 *  `providerFromEnv` installs when no gateway is configured, which is what a player
 *  without an AI key actually reads on UI04. Second person, because that is the style
 *  the rulepack asks the model for too. */
export function storedProse(input: { worldTime: ISOTime; eventTypes: string[]; cast?: string[] }): string {
  // Said once each, in ledger order: a version that committed the same kind of change
  // twice is one thing to a reader. `eventTypes` are ledger strings, so this table is
  // the one place that knows them all.
  const lines = [...new Set(input.eventTypes.map((t) => LEDGER_LINE[t as EventType] ?? 'The world has moved.'))];
  const cast = [...new Set(input.cast ?? [])].slice(0, 3);
  return [
    `${worldClock(input.worldTime)}, by the world clock. The ledger's own words, with nothing added.`,
    `${lines.join(' ')}${cast.length > 0 ? ` It names ${cast.join(', ')}.` : ''}`,
    'You stand where the record leaves you. The next offer comes from here.',
  ].join('\n\n');
}

export function fallbackText(
  state: WorldState,
  events: { type: string; actorCharacterId: ID | null }[],
  names: Record<ID, string>,
  playerCharacterId: ID,
): string {
  // Only the other actors are named: the reader is the second-person "you" of the
  // lines above, and naming them would say a thing the ledger does not say.
  const others = events
    .map((e) => (e.actorCharacterId && e.actorCharacterId !== playerCharacterId ? names[e.actorCharacterId] : undefined))
    .filter((n): n is string => !!n);
  return storedProse({ worldTime: state.worldTime, eventTypes: events.map((e) => e.type), cast: others });
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
