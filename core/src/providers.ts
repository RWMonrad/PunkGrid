// Deterministic fake providers. The real AI gateway is Sprint 3 (contract 10,
// ADR-008); these exercise the same boundary and are the only providers used by
// the golden suite, so tests never depend on nondeterministic prose.

import type { NarrativeProvider, NarrativeRequest, NarrativeResponse } from './narrative.js';

export class CompliantProvider implements NarrativeProvider {
  calls = 0;
  lastRequest?: NarrativeRequest;

  narrate(req: NarrativeRequest): NarrativeResponse {
    this.calls += 1;
    this.lastRequest = req;
    const names = req.characterProfiles.map((c) => c.name).slice(0, 3).join(', ');
    const text = [
      `Episode for world time ${req.worldTime}.`,
      `${req.eventExcerpts.length} event(s) describe what changed around ${names}.`,
      'The offer still sits unanswered, and the harbour keeps its accounts.',
    ].join(' ');
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
