// Produktanalyse — Master §8.3. The dictionary is the type: one entry per
// normative event with exactly the properties the table names, and no free-text
// property is expressible, because a story sentence must never reach an analytics
// stream (§15). `worldRef` follows the server's own operational pseudonym
// (`core/src/db/pgStore.ts:539`), so a client event joins the server log without
// either side carrying the world id in clear.
//
// There is no analytics endpoint in this build: the sink is attached by the
// session layer, and with no provider configured the events are kept in a
// bounded in-memory buffer and written to the console in development. Shipping
// them somewhere is a purchase decision, not a code decision.

export type AnalyticsEvent =
  | { name: 'app_opened'; userKey: string; platform: string; version: string; source: string }
  | { name: 'genesis_started'; entryMode: 'create' | 'surprise'; templateId: string | null }
  | { name: 'world_created'; worldRef: string; templateId: string | null; durationMs: number }
  | { name: 'episode_viewed'; worldRef: string; episodeSeq: number; worldAgeDays: number; latencyMs: number }
  | { name: 'choice_committed'; worldRef: string; commandType: string; newVersion: number; causalDeltaFlag: boolean }
  | { name: 'choice_rejected'; worldRef: string; ruleCode: string; latencyMs: number }
  | { name: 'surprise_requested'; worldRef: string; familyId: string | null; eligible: boolean; cooldownState: string }
  | { name: 'world_resumed'; worldRef: string; elapsedDays: number; catchupTicks: number }
  | { name: 'episode_generation_finished'; worldRef: string; success: boolean; provider: string; model: string; tokens: number; estimatedUsd: number; retryCount: number; fallbackReasonCode: string | null }
  | { name: 'content_report_submitted'; reportReasonCode: string; contentType: 'episode' }
  | { name: 'paywall_viewed'; planId: string; context: string }
  | { name: 'purchase_verified'; planId: string; store: string; billingPeriod: string }
  | { name: 'account_deletion_requested'; origin: string; completionState: string };

export type EventName = AnalyticsEvent['name'];

export type Sink = (event: AnalyticsEvent) => void;

const MAX_ENUM_LEN = 64;

/** A defensive pass over the payload: every property is a number, a boolean, or
 *  a short enumerated string. Prose cannot be added by a future call site without
 *  failing here first. */
export function assertNoFreeText(event: AnalyticsEvent): void {
  for (const [key, value] of Object.entries(event)) {
    if (key === 'name') continue;
    if (value === null || typeof value === 'number' || typeof value === 'boolean') continue;
    if (typeof value !== 'string') throw new Error(`telemetry ${event.name}.${key} is not a scalar`);
    if (value.length > MAX_ENUM_LEN) throw new Error(`telemetry ${event.name}.${key} looks like free text`);
  }
}

export class Telemetry {
  private sinks: Sink[] = [];
  private buffer: AnalyticsEvent[] = [];

  constructor(private readonly limit = 200) {}

  attach(sink: Sink): () => void {
    this.sinks.push(sink);
    return () => {
      this.sinks = this.sinks.filter((s) => s !== sink);
    };
  }

  track(event: AnalyticsEvent): void {
    assertNoFreeText(event);
    this.buffer.push(event);
    if (this.buffer.length > this.limit) this.buffer.shift();
    for (const sink of this.sinks) sink(event);
  }

  /** What the buffer holds, for the debug view in UI10 and for tests. */
  recent(): AnalyticsEvent[] {
    return [...this.buffer];
  }

  reset(): void {
    this.buffer = [];
  }
}

export const worldRef = (worldId: string): string => `w_${worldId.slice(-6)}`;

/** One instance per process: screens import it rather than threading it through
 *  props, because an analytics call is not part of a component's contract. */
export const telemetry = new Telemetry();
