// Moderering — Contract §10 (AI output is subject to moderation), §15
// ("Moderation at input and output; safe bounded age-appropriate scenario
// policy", "Maintain prompt injection isolation: story content is untrusted
// data, not instructions") and Master FR-11 / US13.
//
// This is a deterministic lexical gate, deliberately not a model: the same text
// must produce the same verdict in a golden test, in replay, and in the security
// suite. A real provider's `content_flags` is checked *in addition* to this
// screen, never instead of it — a gateway that stays silent about its own output
// is still screened here.

import type { ID } from './domain.js';

/** Categories that never reach a reader. The list is the MVP policy from §15:
 *  bounded and age-appropriate, with the 18+ gate in ADR-009. */
export type BlockedCategory =
  | 'sexual_minor'
  | 'sexual_violence'
  | 'self_harm_instruction'
  | 'real_person_defamation';

/** Categories that publish but belong in the operations record, so a human review
 *  queue can see what the world is actually producing (FR-11). */
export type FlaggedCategory = 'graphic_violence' | 'substance_abuse' | 'extremism' | 'gambling';

export interface ContentFlag {
  category: BlockedCategory | FlaggedCategory;
  blocked: boolean;
}

export interface ModerationVerdict {
  flags: ContentFlag[];
  /** True when any flag is in the blocked set: the text must not be published. */
  blocked: boolean;
  /** Which patterns fired. Never echoed to a client — it goes to the audit, and
   *  the audit is the reason code §15 asks for. */
  matched: string[];
}

interface Pattern {
  category: BlockedCategory | FlaggedCategory;
  blocked: boolean;
  /** Word-bounded case-insensitive match, so "ass" inside "assumption" is quiet. */
  re: RegExp;
}

const WORD = (terms: string[]): RegExp => new RegExp(`\\b(?:${terms.join('|')})\\b`, 'i');

/** The vocabulary below is the filter list itself. It is written as stems rather
 *  than sentences so a paraphrase in another language is out of scope for the
 *  MVP — the provider's own `content_flags` and the reviewer queue cover that. */
const PATTERNS: Pattern[] = [
  {
    category: 'sexual_minor',
    blocked: true,
    // An age word only counts when the sentence is sexual too: the Glass Harbor
    // cast is described by their jobs and their histories, not by this.
    re: /(?:child|children|kid|teen|teenager|minor|student|pupil)[\s\S]{0,40}\b(?:sexual|sexually|nude|nudity|naked|strip|striptease|erotic|rape|assault)\b|\b(?:sexual|sexually|nude|nudity|naked|strip|striptease|erotic|rape|assault)[\s\S]{0,40}\b(?:child|children|kid|teen|teenager|minor|student|pupil)\b/i,
  },
  { category: 'sexual_violence', blocked: true, re: WORD(['rape', 'raped', 'raping', 'molest', 'molested', 'sexual assault', 'sexually assaulted']) },
  { category: 'self_harm_instruction', blocked: true, re: WORD(['suicide', 'suicidal', 'self-harm', 'overdose', 'kill myself', 'cut my wrists']) },
  // Living people only. An office title — "the prime minister", "the president" —
  // is a dramatic role like any other, and blocking it would censor the genre.
  { category: 'real_person_defamation', blocked: true, re: WORD(['elon musk', 'jeff bezos', 'vladimir putin', 'donald trump', 'kamala harris', 'wolodymyr zelensky']) },
  // Flags publish. The vocabulary is deliberately narrow: "blood" and "drunk"
  // belong to noir prose, and a screen that fires on every episode tells the
  // reviewer queue nothing.
  { category: 'graphic_violence', blocked: false, re: WORD(['gore', 'corpse', 'dismember', 'dismembered', 'beheaded', 'mutilated']) },
  { category: 'substance_abuse', blocked: false, re: WORD(['heroin', 'cocaine', 'methamphetamine', 'crack cocaine']) },
  { category: 'extremism', blocked: false, re: WORD(['jihad', 'supremacist', 'terrorist', 'radicalised', 'radicalized']) },
  { category: 'gambling', blocked: false, re: WORD(['casino', 'betting', 'wager', 'wagering', 'lottery']) },
];

/** A phrase that tells the model to abandon its role. It is not a blocked
 *  category — story text is allowed to *contain* such a line — but it is always
 *  recorded, because §15 asks for injection isolation to be observable. */
const INJECTION = /(?:ignore|disregard|forget|override)\s+(?:all\s+|the\s+|any\s+)?(?:previous\s+|prior\s+|above\s+)?(?:instructions|rules|policy|system\s+prompt)|you\s+are\s+now|new\s+instruction|system\s*:\s*/i;

export function screenText(text: string): ModerationVerdict {
  const flags: ContentFlag[] = [];
  const matched: string[] = [];
  let blocked = false;
  for (const p of PATTERNS) {
    if (!p.re.test(text)) continue;
    flags.push({ category: p.category, blocked: p.blocked });
    matched.push(p.category);
    if (p.blocked) blocked = true;
  }
  return { flags, blocked, matched };
}

export function containsInjectionAttempt(text: string): boolean {
  return INJECTION.test(text);
}

/** Collapse whitespace and bound the length. §15's operational records carry a
 *  fragment, never the text itself, and every stored field has a size the
 *  database enforces. */
export function clip(text: string, limit: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= limit) return collapsed;
  return `${collapsed.slice(0, limit).trimEnd()}…`;
}

/** The §15 observability rule: operational records carry a reason code and a
 *  pseudonymous reference, never the private story text itself. US13 wants the
 *  same shape for a report: enough for a reviewer to act on, not the episode. */
export function minimiseForCase(text: string, episodeId: ID, limit = 180): string {
  return `${episodeId}: ${clip(text, limit)}`;
}
