// Master §8.3 fixes the event dictionary and forbids free text, and §15 repeats the
// ban for anything that leaves the device. The type makes prose unrepresentable;
// these tests hold the line for the payloads a future call site could add.

import { describe, expect, it } from 'vitest';

import { Telemetry, assertNoFreeText, worldRef, type AnalyticsEvent } from './telemetry';

describe('assertNoFreeText', () => {
  it('accepts every shape in the dictionary', () => {
    const events: AnalyticsEvent[] = [
      { name: 'app_opened', userKey: 'u_1', platform: 'android', version: '0.1.0', source: 'icon' },
      { name: 'genesis_started', entryMode: 'surprise', templateId: null },
      { name: 'world_created', worldRef: 'w_abc123', templateId: 'glass-harbor-2034', durationMs: 1200 },
      { name: 'episode_generation_finished', worldRef: 'w_abc123', success: false, provider: 'gateway', model: 'gpt-x', tokens: 900, estimatedUsd: 0.004, retryCount: 2, fallbackReasonCode: 'narrative_fallback' },
      { name: 'content_report_submitted', reportReasonCode: 'real_person', contentType: 'episode' },
    ];
    for (const event of events) expect(() => assertNoFreeText(event)).not.toThrow();
  });

  it('rejects a string long enough to be a sentence', () => {
    expect(() => assertNoFreeText({ name: 'content_report_submitted', reportReasonCode: 'a'.repeat(65), contentType: 'episode' })).toThrow(/free text/);
  });

  it('rejects a nested value, which no enumerated field can be', () => {
    const sneaky = { name: 'choice_committed', worldRef: 'w_1', commandType: 'choice', newVersion: 1, causalDeltaFlag: false, prose: ['the harbor'] } as unknown as AnalyticsEvent;
    expect(() => assertNoFreeText(sneaky)).toThrow(/not a scalar/);
  });

  it('still allows null, which the dictionary uses for "did not happen"', () => {
    expect(() => assertNoFreeText({ name: 'surprise_requested', worldRef: 'w_1', familyId: null, eligible: false, cooldownState: 'cooling' })).not.toThrow();
  });
});

describe('Telemetry', () => {
  it('hands each event to every attached sink and stops on detach', () => {
    const t = new Telemetry(10);
    const a: string[] = [];
    const b: string[] = [];
    const offA = t.attach((e) => void a.push(e.name));
    t.attach((e) => void b.push(e.name));
    t.track({ name: 'paywall_viewed', planId: 'premium_m', context: 'quota' });
    offA();
    t.track({ name: 'purchase_verified', planId: 'premium_m', store: 'play', billingPeriod: 'monthly' });
    expect(a).toEqual(['paywall_viewed']);
    expect(b).toEqual(['paywall_viewed', 'purchase_verified']);
  });

  it('keeps a bounded buffer, newest last', () => {
    const t = new Telemetry(3);
    for (let i = 0; i < 6; i += 1) t.track({ name: 'account_deletion_requested', origin: `ui10_${i}`, completionState: 'started' });
    const recent = t.recent();
    expect(recent).toHaveLength(3);
    expect(recent.map((e) => (e as { origin: string }).origin)).toEqual(['ui10_3', 'ui10_4', 'ui10_5']);
    t.reset();
    expect(t.recent()).toEqual([]);
  });

  it('refuses to buffer an event it would refuse to send', () => {
    const t = new Telemetry(3);
    expect(() => t.track({ name: 'world_resumed', worldRef: 'w_1', elapsedDays: 1, catchupTicks: 0, note: 'x'.repeat(200) } as unknown as AnalyticsEvent)).toThrow(/free text/);
    expect(t.recent()).toEqual([]);
  });
});

describe('worldRef', () => {
  it('pseudonymises the same way the server log does', () => {
    // core/src/db/pgStore.ts:539 writes 'w_' + worldId.slice(-6) into operation_log.
    expect(worldRef('world_01ABCDEFGH')).toBe('w_CDEFGH');
  });

  it('is short enough to be an enumerated value, and never carries the id whole', () => {
    const ref = worldRef('world_01ABCDEFGH');
    expect(ref.length).toBeLessThanOrEqual(64);
    expect(ref).not.toContain('world_01');
  });
});
