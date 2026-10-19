// Deterministic fake providers. The real AI gateway is Sprint 3 (contract 10,
// ADR-008); these exercise the same boundary and are the only providers used by
// the golden suite, so tests never depend on nondeterministic prose.
//
// `CompliantProvider` is also what a shipped server runs when no gateway is
// configured (`providerFromEnv`), so its prose is read by a player and not only by
// a test: it renders through `storedProse`, the same deterministic voice as the
// engine's fallback copy, rather than a note about the ledger.

import type { NarrativeProvider, NarrativeRequest, NarrativeResponse } from './narrative.js';
import { storedProse } from './narrative.js';

export class CompliantProvider implements NarrativeProvider {
  calls = 0;
  lastRequest?: NarrativeRequest;

  narrate(req: NarrativeRequest): NarrativeResponse {
    this.calls += 1;
    this.lastRequest = req;
    const text = storedProse({
      worldTime: req.worldTime,
      eventTypes: req.eventExcerpts.map((e) => e.type),
      cast: req.characterProfiles.map((c) => c.name),
    });
    return {
      episode_text: text,
      referenced_event_ids: [...req.eventIds],
      choice_copy_by_id: Object.fromEntries(req.allowedChoiceIds.map((id) => [id, `Take action: ${id.replace(/_/g, ' ')}.`])),
      mentioned_fact_ids: [...req.authorizedPovFacts],
      content_flags: [],
      modelId: 'fake-compliant',
      inputTokens: 600,
      outputTokens: 300,
    };
  }
}

export class TimeoutProvider implements NarrativeProvider {
  calls = 0;
  narrate(_req: NarrativeRequest): NarrativeResponse {
    this.calls += 1;
    return { failure: 'timeout', modelId: 'fake-timeout' };
  }
}

export class ThrowingProvider implements NarrativeProvider {
  narrate(_req: NarrativeRequest): NarrativeResponse {
    throw new Error('provider transport error');
  }
}

/** Prompt-injection style output: narrates a fact the viewer may not know and
 *  invents a choice id. Must be rejected by schema + canon validation. */
export class LeakingProvider implements NarrativeProvider {
  calls = 0;
  narrate(req: NarrativeRequest): NarrativeResponse {
    this.calls += 1;
    return {
      episode_text: 'Everyone now knows about the procurement link between Soren and the earlier tender.',
      referenced_event_ids: [...req.eventIds],
      choice_copy_by_id: Object.fromEntries(req.allowedChoiceIds.map((id) => [id, 'x'])),
      mentioned_fact_ids: ['fact_secret_link'],
      content_flags: [],
      modelId: 'fake-leaking',
      inputTokens: 600,
      outputTokens: 300,
    };
  }
}

export class ChoiceInventingProvider implements NarrativeProvider {
  narrate(req: NarrativeRequest): NarrativeResponse {
    return {
      episode_text: 'A door appears that was never modelled.',
      referenced_event_ids: [...req.eventIds],
      choice_copy_by_id: { sell_company_now: 'Sell the company now', ...Object.fromEntries(req.allowedChoiceIds.map((id) => [id, 'x'])) },
      mentioned_fact_ids: [],
      content_flags: [],
      modelId: 'fake-inventor',
    };
  }
}

export class PolicyBlockedProvider implements NarrativeProvider {
  narrate(req: NarrativeRequest): NarrativeResponse {
    return {
      episode_text: 'The scene turns explicit.',
      referenced_event_ids: [...req.eventIds],
      choice_copy_by_id: Object.fromEntries(req.allowedChoiceIds.map((id) => [id, 'x'])),
      content_flags: ['policy_blocked'],
      modelId: 'fake-unsafe',
    };
  }
}

/** Schema-obedient and silent about its own output: no `content_flags` of its
 *  own, whatever text the test asks for. This is the shape that proves the
 *  engine's screen runs *in addition to* the provider's flags (§10) — a gateway
 *  that says nothing about what it produced is still stopped here. */
export class ScriptedTextProvider implements NarrativeProvider {
  calls = 0;
  constructor(private readonly text: string) {}

  narrate(req: NarrativeRequest): NarrativeResponse {
    this.calls += 1;
    return {
      episode_text: this.text,
      referenced_event_ids: [...req.eventIds],
      choice_copy_by_id: Object.fromEntries(req.allowedChoiceIds.map((id) => [id, `Take action: ${id}`])),
      mentioned_fact_ids: [],
      content_flags: [],
      modelId: 'fake-scripted',
      inputTokens: 600,
      outputTokens: 300,
    };
  }
}
