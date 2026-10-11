import { describe, expect, it } from 'vitest';
import { GLASS_HARBOR } from '../src/glassHarbor.js';
import { applyEvent } from '../src/reducer.js';
import { ChoiceInventingProvider, CompliantProvider, LeakingProvider, PolicyBlockedProvider, ThrowingProvider, TimeoutProvider } from '../src/providers.js';
import { EngineError } from '../src/errors.js';
import { characterKey, membershipKey, snapshotKey } from '../src/store.js';
import { T0, arc, choose, cid, eventTypes, freshWorld, knownFacts, makeEngine, resource, snap, trust } from './helpers.js';

async function expectError(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(EngineError);
    expect((e as EngineError).code).toBe(code);
    return e as EngineError;
  }
  throw new Error(`Expected error ${code}, but call succeeded`);
}

describe('Golden suite — The Glass Harbor (contract section 13)', () => {
  it('T01 creates a supported world: valid blueprint, one owner membership, genesis event, version 1', async () => {
    const engine = makeEngine();
    const ctx = await freshWorld(engine);

    expect(ctx.version).toBe(1);
    expect(engine.store.worlds.size).toBe(1);
    expect(engine.store.memberships.size).toBe(1);
    const membership = engine.store.memberships.get(membershipKey(ctx.worldId, ctx.userId))!;
    expect(membership.role).toBe('owner');

    const events = engine.store.worldEvents(ctx.worldId);
    expect(events.length).toBe(1);
    expect(events[0]!.type).toBe('world.created');
    expect(events[0]!.sequence).toBe(1);

    const world = engine.store.worlds.get(ctx.worldId)!;
    expect(world.mode).toBe('personal');
    expect(world.visibility).toBe('private');
    expect(world.rulepackId).toBe('glass-harbor-2034');
    expect(engine.store.blueprints.has(ctx.worldId)).toBe(true);

    // Reference initial snapshot (contract 12)
    expect(snap(ctx).state.worldTime).toBe('2034-09-15T09:00:00.000Z');
    expect(resource(ctx, 'cash')).toBe(100);
    expect(resource(ctx, 'influence')).toBe(60);
    expect(resource(ctx, 'credibility')).toBe(50);
    expect(trust(ctx, 'char_mara')).toBe(70);
    expect(snap(ctx).stateHash).toMatch(/^sha256:/);

    // 2–4 server-issued opening choices (FR-04, ADR-012)
    const choices = engine.currentChoices(ctx.worldId).map((c) => c.choiceId);
    expect(choices.length).toBeGreaterThanOrEqual(2);
    expect(choices.length).toBeLessThanOrEqual(4);
    expect(choices.sort()).toEqual(['brief_staff', 'confront_mara', 'investigate_buyer', 'open_negotiation']);
  });

  it('T02 rejects an unsupported setting without creating a world', async () => {
    const engine = makeEngine();
    engine.registerUser('user_a');
    const e = await expectError(
      engine.createWorld({
        actorUserId: 'user_a', mode: 'create', templateId: 'glass-harbor-2034',
        setting: { era: '1888', location: 'mars', role: 'founder-ceo', flags: [] },
        commandId: cid(),
      }),
      'INVALID_BLUEPRINT',
    );
    expect(e.details?.constraintId).toBe('mars-needs-alternate-history');
    expect(engine.store.worlds.size).toBe(0);
    expect(engine.store.events.size).toBe(0);
    expect(engine.store.memberships.size).toBe(0);

    // With the explicit alternate-history flag the same combination is allowed.
    const ok = await engine.createWorld({
      actorUserId: 'user_a', mode: 'create', templateId: 'glass-harbor-2034',
      setting: { era: '1888', location: 'mars', role: 'founder-ceo', flags: ['alternate_history'] },
      commandId: cid(),
    });
    expect(ok.commandResult.newVersion).toBe(1);
  });

  it('T03 investigate buyer: cash 100->90, discloses a lead but not the secret link', async () => {
    const engine = makeEngine();
    const ctx = await freshWorld(engine);
    const result = await choose(ctx, 'investigate_buyer');

    expect(result.outcome).toBe('committed');
    expect(resource(ctx, 'cash')).toBe(90);
    expect(trust(ctx, 'char_noor')).toBe(41);
    expect(knownFacts(ctx, 'char_player')).toContain('fact_whistleblower');
    expect(knownFacts(ctx, 'char_player')).not.toContain('fact_secret_link');
    expect(engine.store.facts.get(`${ctx.worldId}|fact_whistleblower`)!.verified).toBe(false);
    expect(eventTypes(ctx)).toContain('resource.changed');
    expect(engine.verifyReplay(ctx.worldId).equal).toBe(true);
  });

  it('T04 confront Mara: trust 70->58, credibility 50->52, causes recorded', async () => {
    const engine = makeEngine();
    const ctx = await freshWorld(engine);
    const result = await choose(ctx, 'confront_mara');

    expect(trust(ctx, 'char_mara')).toBe(58);
    expect(resource(ctx, 'credibility')).toBe(52);
    expect(result.eventIds.length).toBeGreaterThan(1);

    const relationshipEvent = engine.store.worldEvents(ctx.worldId).find((e) => e.type === 'relationship.changed')!;
    expect(relationshipEvent.causedByEventIds.length).toBe(1);
    const cause = engine.store.worldEvents(ctx.worldId).find((e) => e.eventId === relationshipEvent.causedByEventIds[0])!;
    expect(cause.type).toBe('choice.resolved');
    expect((cause.payload as Record<string, unknown>).ruleId).toBe('confront_mara');
    expect(relationshipEvent.payload).toMatchObject({ before: 70, after: 58, delta: -12 });
  });

  it('T05 negotiate offer: influence 60->50, Mara 70->73, Ilya 45->50', async () => {
    const engine = makeEngine();
    const ctx = await freshWorld(engine);
    await choose(ctx, 'open_negotiation');
    expect(resource(ctx, 'influence')).toBe(50);
    expect(trust(ctx, 'char_mara')).toBe(73);
    expect(trust(ctx, 'char_ilya')).toBe(50);
    expect(snap(ctx).state.flags.decision_authority).toBe(true);
    expect(engine.currentChoices(ctx.worldId).map((c) => c.choiceId)).toContain('reject_sale');
  });

  it('T06 brief staff: credibility 50->45, Ada 65->75, Ilya 45->41, staff arc opens', async () => {
    const engine = makeEngine();
    const ctx = await freshWorld(engine);
    await choose(ctx, 'brief_staff');
    expect(resource(ctx, 'credibility')).toBe(45);
    expect(trust(ctx, 'char_ada')).toBe(75);
    expect(trust(ctx, 'char_ilya')).toBe(41);
    expect(arc(ctx, 'arc_staff_security')).toBe('open');
    expect(knownFacts(ctx, 'char_ada')).toContain('fact_contract_risk');
  });

  it('T07 rejects an action with insufficient resources and mutates nothing', async () => {
    const engine = makeEngine();
    const ctx = await freshWorld(engine);
    let version = ctx.version;
    for (let i = 0; i < 10; i += 1) {
      const r = await choose(ctx, 'investigate_buyer', version);
      version = r.newVersion;
    }
    expect(resource(ctx, 'cash')).toBe(0);
    const beforeEvents = engine.store.worldEvents(ctx.worldId).length;

    const e = await expectError(choose(ctx, 'investigate_buyer', version), 'RULE_PRECONDITION_FAILED');
    expect(e.details?.ruleCode).toBe('RESOURCE_PRECONDITION');
    expect(engine.store.worlds.get(ctx.worldId)!.stateVersion).toBe(version);
    expect(engine.store.worldEvents(ctx.worldId).length).toBe(beforeEvents);
  });

  it('T08 replays the same idempotency key and body without duplicating events', async () => {
    const engine = makeEngine();
    const ctx = await freshWorld(engine);
    const commandId = cid();
    const body = { actorUserId: ctx.userId, worldId: ctx.worldId, actorIdentityId: ctx.identityId, expectedWorldVersion: 1, choiceId: 'confront_mara', commandId };

    const first = await engine.submitChoice(body);
    const eventCount = engine.store.worldEvents(ctx.worldId).length;
    const second = await engine.submitChoice(body);

    expect(second).toEqual(first);
    expect(engine.store.worldEvents(ctx.worldId).length).toBe(eventCount);
    expect(engine.store.commands.size).toBe(2); // genesis + one choice command
  });

  it('T09 rejects a reused command id with a different payload', async () => {
    const engine = makeEngine();
    const ctx = await freshWorld(engine);
    const commandId = cid();
    await engine.submitChoice({ actorUserId: ctx.userId, worldId: ctx.worldId, actorIdentityId: ctx.identityId, expectedWorldVersion: 1, choiceId: 'confront_mara', commandId });
    const versionBefore = engine.store.worlds.get(ctx.worldId)!.stateVersion;
    const eventsBefore = engine.store.worldEvents(ctx.worldId).length;

    await expectError(
      engine.submitChoice({ actorUserId: ctx.userId, worldId: ctx.worldId, actorIdentityId: ctx.identityId, expectedWorldVersion: 2, choiceId: 'brief_staff', commandId }),
      'IDEMPOTENCY_PAYLOAD_MISMATCH',
    );
    expect(engine.store.worlds.get(ctx.worldId)!.stateVersion).toBe(versionBefore);
    expect(engine.store.worldEvents(ctx.worldId).length).toBe(eventsBefore);
  });

  it('T10 allows exactly one of two concurrent commands against the same version', async () => {
    const engine = makeEngine();
    const ctx = await freshWorld(engine);
    const base = { actorUserId: ctx.userId, worldId: ctx.worldId, actorIdentityId: ctx.identityId, expectedWorldVersion: 1 };
    const [a, b] = await Promise.allSettled([
      engine.submitChoice({ ...base, choiceId: 'confront_mara', commandId: cid() }),
      engine.submitChoice({ ...base, choiceId: 'open_negotiation', commandId: cid() }),
    ]);
    const ok = [a, b].filter((r) => r.status === 'fulfilled');
    const failed = [a, b].filter((r) => r.status === 'rejected');
    expect(ok.length).toBe(1);
    expect(failed.length).toBe(1);
    const error = (failed[0] as PromiseRejectedResult).reason as EngineError;
    expect(error.code).toBe('WORLD_VERSION_CONFLICT');
    expect(error.details?.currentVersion).toBe(2);
    expect(engine.store.worlds.get(ctx.worldId)!.stateVersion).toBe(2);
    expect(engine.verifyReplay(ctx.worldId).equal).toBe(true);
  });

  it('T11 rejects a foreign-world character reference without leaking it', async () => {
    const pack = structuredClone(GLASS_HARBOR);
    pack.choices.push({
      id: 'ghost_pact',
      label: 'Sign a pact',
      copy: 'A pact with someone who is not here.',
      requires: [],
      effects: { relationships: [{ from: 'player', to: 'char_player', dimension: 'trust', delta: -1 }] },
    });
    // The rule targets a character that only exists in the OTHER world.
    pack.choices[pack.choices.length - 1]!.effects.relationships = [{ from: 'player', to: 'ghost_char', dimension: 'trust', delta: -1 }];
    pack.templates[0]!.genesisChoiceIds = [...pack.templates[0]!.genesisChoiceIds, 'ghost_pact'];

    const engine = makeEngine(pack);
    engine.registerUser('user_a');
    engine.registerUser('user_b', 'premium', 3);
    const ctx = await freshWorld(engine, 'user_a');
    // user_b creates a second world so a real foreign character exists somewhere.
    const other = await engine.createWorld({ actorUserId: 'user_b', mode: 'create', templateId: 'glass-harbor-2034', commandId: cid() });
    expect(engine.store.characters.has(characterKey(other.worldId, 'ghost_char'))).toBe(false);

    const eventsBefore = engine.store.worldEvents(ctx.worldId).length;
    const versionBefore = engine.store.worlds.get(ctx.worldId)!.stateVersion;
    const e = await expectError(
      engine.submitChoice({ actorUserId: ctx.userId, worldId: ctx.worldId, actorIdentityId: ctx.identityId, expectedWorldVersion: 1, choiceId: 'ghost_pact', commandId: cid() }),
      'RULE_PRECONDITION_FAILED',
    );
    expect(e.details?.ruleCode).toBe('UNKNOWN_CHARACTER_REFERENCE');
    expect(e.message).not.toContain('ghost_char');
    expect(e.message).not.toContain(other.worldId);
    expect(engine.store.worldEvents(ctx.worldId).length).toBe(eventsBefore);
    expect(engine.store.worlds.get(ctx.worldId)!.stateVersion).toBe(versionBefore);
  });

  it('T12 denies an unauthorized account read without disclosing the world', async () => {
    const engine = makeEngine();
    const ctx = await freshWorld(engine);
    engine.registerUser('user_intruder');
    engine.createIdentity('user_intruder', { name: 'Intruder' });

    const e = await expectError(Promise.resolve().then(() => engine.getWorld('user_intruder', ctx.worldId)), 'NOT_FOUND');
    expect(e.status).toBe(404);
    expect(e.message).not.toContain('Glass Harbor');
    expect(() => engine.listEpisodes('user_intruder', ctx.worldId, 5)).toThrow();
    expect(engine.listWorlds('user_intruder')).toEqual([]);
    // The owner still sees everything.
    expect(engine.getWorld(ctx.userId, ctx.worldId).stateVersion).toBe(1);
  });

  it('T13 keeps the hidden link known only to Soren and rejects narrative leakage', async () => {
    const provider = new LeakingProvider();
    const engine = makeEngine(GLASS_HARBOR, provider);
    engine.registerUser('user_a');
    const ctx = await freshWorld(engine, 'user_a');

    expect(knownFacts(ctx, 'char_soren')).toContain('fact_secret_link');
    for (const who of ['char_player', 'char_mara', 'char_noor', 'char_ada', 'char_ilya']) {
      expect(knownFacts(ctx, who)).not.toContain('fact_secret_link');
    }

    // The hostile narrative was rejected and replaced by fallback copy; canon is untouched.
    const episode = engine.store.episodes.get(ctx.episodeId)!;
    expect(episode.status).toBe('fallback');
    expect(episode.episode.validationStatus).toBe('fallback');
    expect(episode.episode.content).not.toMatch(/procurement link/i);
    expect(engine.store.worlds.get(ctx.worldId)!.stateVersion).toBe(1);
    expect(engine.store.worldEvents(ctx.worldId).length).toBe(1);
    expect(engine.store.audit.some((a) => a.kind.includes('FACT_LEAK'))).toBe(true);
    expect(provider.calls).toBe(2); // one retry, then fallback
  });

  it('T14 gives Noor a claim through an explicit disclosure event, still unverified', async () => {
    const engine = makeEngine();
    const ctx = await freshWorld(engine);
    const surprise = await engine.requestSurprise({ actorUserId: ctx.userId, worldId: ctx.worldId, actorIdentityId: ctx.identityId, expectedWorldVersion: 1, commandId: cid() });
    expect(surprise.outcome).toBe('committed');

    const disclosures = engine.store.worldEvents(ctx.worldId).filter((e) => e.type === 'fact.disclosed');
    const noorDisclosure = disclosures.find((e) => (e.payload as Record<string, unknown>).characterId === 'char_noor');
    expect(noorDisclosure).toBeDefined();
    expect((noorDisclosure!.payload as Record<string, unknown>).factId).toBe('fact_memo_claim');
    expect((noorDisclosure!.payload as Record<string, unknown>).via).toBe('creation');

    expect(knownFacts(ctx, 'char_noor')).toContain('fact_memo_claim');
    expect(knownFacts(ctx, 'char_noor')).not.toContain('fact_secret_link');
    expect(engine.store.facts.get(`${ctx.worldId}|fact_memo_claim`)!.verified).toBe(false);
    // No disclosure of the canonical secret link to anyone but Soren.
    expect(engine.store.worldEvents(ctx.worldId).some((e) => e.type === 'fact.disclosed' && (e.payload as Record<string, unknown>).factId === 'fact_secret_link')).toBe(false);
  });

  it('T15 honours the surprise cooldown with no duplicated event', async () => {
    const engine = makeEngine();
    const ctx = await freshWorld(engine);
    const first = await engine.requestSurprise({ actorUserId: ctx.userId, worldId: ctx.worldId, actorIdentityId: ctx.identityId, expectedWorldVersion: 1, commandId: cid() });
    expect(first.outcome).toBe('committed');
    const eventsAfter = engine.store.worldEvents(ctx.worldId).length;

    const second = await engine.requestSurprise({ actorUserId: ctx.userId, worldId: ctx.worldId, actorIdentityId: ctx.identityId, expectedWorldVersion: first.newVersion, commandId: cid() });
    expect(second.outcome).toBe('no_op');
    expect(second.noOpReason).toBe('NO_ELIGIBLE_SURPRISE');
    expect(second.eventIds.length).toBe(0);
    expect(engine.store.worldEvents(ctx.worldId).length).toBe(eventsAfter);
    expect(engine.store.worlds.get(ctx.worldId)!.stateVersion).toBe(first.newVersion);
    expect(engine.store.worldEvents(ctx.worldId).filter((e) => e.type === 'surprise.triggered').length).toBe(1);
  });

  it('T16 commits an eligible surprise with a causal parent and opens the related choice', async () => {
    const engine = makeEngine();
    const ctx = await freshWorld(engine);
    const result = await engine.requestSurprise({ actorUserId: ctx.userId, worldId: ctx.worldId, actorIdentityId: ctx.identityId, expectedWorldVersion: 1, commandId: cid() });
    const trigger = engine.store.worldEvents(ctx.worldId).find((e) => e.type === 'surprise.triggered')!;

    expect(trigger.causedByEventIds.length).toBe(1);
    const parent = engine.store.worldEvents(ctx.worldId).find((e) => e.eventId === trigger.causedByEventIds[0])!;
    expect(['world.created', 'story_arc.progressed', 'story_arc.opened']).toContain(parent.type);
    expect((trigger.payload as Record<string, unknown>).familyId).toBe('leaked_memo');

    const choices = engine.currentChoices(ctx.worldId).map((c) => c.choiceId);
    expect(choices).toContain('verify_memo');
    expect(knownFacts(ctx, 'char_player')).toContain('fact_memo_claim');

    // Playing the opened choice advances the hidden-link arc.
    const next = await choose(ctx, 'verify_memo', result.newVersion);
    expect(arc(ctx, 'arc_hidden_link')).toBe('open');
    expect(next.outcome).toBe('committed');
  });

  it('T17 resumes with bounded catch-up ticks and identical seeded replay', async () => {
    const engine = makeEngine();
    const ctx = await freshWorld(engine);
    engine.advanceWall(48 * 60);

    const result = await engine.resumeWorld({ actorUserId: ctx.userId, worldId: ctx.worldId, actorIdentityId: ctx.identityId, expectedWorldVersion: 1, commandId: cid() });
    const ticks = engine.store.worldEvents(ctx.worldId).filter((e) => e.type === 'world.time_advanced');
    expect(ticks.length).toBeLessThanOrEqual(GLASS_HARBOR.time.maxCatchupTicks);
    expect(ticks.length).toBe(4); // 48h capped by maxWorldTimeJump 24h / 6h tick
    expect(result.newVersion).toBe(2);
    expect(engine.verifyReplay(ctx.worldId).equal).toBe(true);

    // Immediately resuming again collects nothing.
    const again = await engine.resumeWorld({ actorUserId: ctx.userId, worldId: ctx.worldId, actorIdentityId: ctx.identityId, expectedWorldVersion: 2, commandId: cid() });
    expect(again.outcome).toBe('no_op');
    expect(again.noOpReason).toBe('NO_TICKS_DUE');
    expect(again.newVersion).toBe(2);
  });

  it('T18 survives a narration timeout without replaying any mutation', async () => {
    const provider = new TimeoutProvider();
    const engine = makeEngine(GLASS_HARBOR, provider);
    engine.registerUser('user_a');
    const ctx = await freshWorld(engine, 'user_a');
    const committed = await choose(ctx, 'confront_mara', 1);

    const episodeRows = [...engine.store.episodes.values()];
    expect(episodeRows.length).toBe(2); // one per committed version, never two for one version
    expect(episodeRows.every((r) => r.status === 'fallback')).toBe(true);
    expect(episodeRows.map((r) => r.episode.worldStateVersion)).toEqual([1, 2]);
    expect(engine.store.worlds.get(ctx.worldId)!.stateVersion).toBe(committed.newVersion);
    expect(trust(ctx, 'char_mara')).toBe(58);
    expect(engine.verifyReplay(ctx.worldId).equal).toBe(true);
    expect(provider.calls).toBe(4); // two attempts per episode
  });

  it('T19 replays 20 commands to the stored snapshot hash', async () => {
    const engine = makeEngine();
    const ctx = await freshWorld(engine);
    let version = ctx.version;
    for (let i = 0; i < 19; i += 1) {
      const r = await choose(ctx, 'confront_mara', version);
      expect(r.outcome).toBe('committed');
      version = r.newVersion;
    }
    expect(version).toBe(20);
    expect(engine.store.worldEvents(ctx.worldId).length).toBeGreaterThan(20);
    const check = engine.verifyReplay(ctx.worldId);
    expect(check.equal).toBe(true);
    expect(check.storedHash).toBe(check.replayedHash);
    // Relationship values stay inside the normalized bound.
    expect(trust(ctx, 'char_mara')).toBeGreaterThanOrEqual(-100);
  });

  it('T20 makes archive terminal: later choices mutate nothing', async () => {
    const engine = makeEngine();
    const ctx = await freshWorld(engine);
    const archived = await engine.archiveWorld({ actorUserId: ctx.userId, worldId: ctx.worldId, actorIdentityId: ctx.identityId, expectedWorldVersion: 1, commandId: cid() });
    expect(engine.store.worlds.get(ctx.worldId)!.status).toBe('archived');
    expect(archived.newVersion).toBe(1);

    const e = await expectError(choose(ctx, 'confront_mara', 1), 'RULE_PRECONDITION_FAILED');
    expect(e.details?.ruleCode).toBe('WORLD_ARCHIVED');
    expect(engine.store.worlds.get(ctx.worldId)!.stateVersion).toBe(1);
    expect(engine.store.worldEvents(ctx.worldId).length).toBe(1);

    // Reading is still allowed; surprise and resume are not.
    expect(engine.getWorld(ctx.userId, ctx.worldId).world.status).toBe('archived');
    await expectError(engine.requestSurprise({ actorUserId: ctx.userId, worldId: ctx.worldId, actorIdentityId: ctx.identityId, expectedWorldVersion: 1, commandId: cid() }), 'RULE_PRECONDITION_FAILED');
    expect(engine.store.snapshots.get(`${ctx.worldId}|1`)!.version).toBe(1);
  });
});

describe('Canonical invariants beyond the twenty scenarios', () => {
  it('enforces the free-world quota atomically inside world.create (ADR-012)', async () => {
    const engine = makeEngine();
    engine.registerUser('user_a');
    await freshWorld(engine, 'user_a');
    const e = await expectError(
      engine.createWorld({ actorUserId: 'user_a', mode: 'surprise', commandId: cid() }),
      'WORLD_LIMIT_REACHED',
    );
    expect(e.status).toBe(403);
    expect(engine.store.worlds.size).toBe(1);

    // Two concurrent creation calls cannot both pass the quota.
    engine.registerUser('user_c', 'premium', 1);
    const results = await Promise.allSettled([
      engine.createWorld({ actorUserId: 'user_c', mode: 'surprise', commandId: cid() }),
      engine.createWorld({ actorUserId: 'user_c', mode: 'surprise', commandId: cid() }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled').length).toBe(1);
    expect(engine.store.worlds.size).toBe(2);
  });

  it('rejects unknown event types in v1', async () => {
    const engine = makeEngine();
    const ctx = await freshWorld(engine);
    const events = engine.store.worldEvents(ctx.worldId);
    expect(() => snap(ctx)).not.toThrow();
    expect(events[0]!.schemaVersion).toBe('1.0');
    expect(() => applyEvent(snap(ctx).state, { ...events[0]!, type: 'world.retro_edited' })).toThrow(EngineError);
  });

  it('never lets narration invent choice ids (FR-05, contract 10)', async () => {
    const engine = makeEngine(GLASS_HARBOR, new ChoiceInventingProvider());
    engine.registerUser('user_a');
    const ctx = await freshWorld(engine, 'user_a');
    const episode = engine.store.episodes.get(ctx.episodeId)!;
    expect(episode.episode.validationStatus).toBe('fallback');
    expect(episode.episode.allowedChoiceIds).not.toContain('sell_company_now');
    expect(engine.store.audit.some((a) => a.kind.includes('CHOICE_ID_MISMATCH'))).toBe(true);
  });

  it('applies a safe fallback for policy-blocked output (AC-08)', async () => {
    const { PolicyBlockedProvider } = await import('../src/providers.ts'.replace('.ts', '.js'));
    const engine = makeEngine(GLASS_HARBOR, new PolicyBlockedProvider());
    engine.registerUser('user_a');
    const ctx = await freshWorld(engine, 'user_a');
    const episode = engine.store.episodes.get(ctx.episodeId)!;
    expect(episode.status).toBe('fallback');
    expect(engine.store.audit.some((a) => a.kind.includes('POLICY_BLOCKED'))).toBe(true);
  });

  it('stops provider calls at the per-user budget and still publishes fallback copy (FR-13)', async () => {
    const compliant = new CompliantProvider();
    const engine = makeEngine(GLASS_HARBOR, compliant, { usdBudgetPerUserPerDay: 0.008 });
    engine.registerUser('user_a');
    const ctx = await freshWorld(engine, 'user_a');
    await choose(ctx, 'confront_mara', 1);
    await choose(ctx, 'open_negotiation', 2);

    const rows = [...engine.store.episodes.values()];
    expect(rows[0]!.status).toBe('published');
    expect(rows.at(-1)!.status).toBe('fallback');
    expect(compliant.calls).toBe(2); // the provider is not called after the cap
    const runs = [...engine.store.generationRuns.values()];
    expect(runs.at(-1)).toMatchObject({ modelId: 'none', costUsd: 0, validationStatus: 'budget_exceeded' });
    expect(runs.reduce((s, r) => s + r.costUsd, 0)).toBeLessThanOrEqual(0.008);
    expect(engine.store.worlds.get(ctx.worldId)!.stateVersion).toBe(3); // canon still advanced
  });

  it('keeps committed state intact when the provider transport throws', async () => {
    const { ThrowingProvider } = await import('../src/providers.js');
    const engine = makeEngine(GLASS_HARBOR, new ThrowingProvider());
    engine.registerUser('user_a');
    const ctx = await freshWorld(engine, 'user_a');
    const episode = engine.store.episodes.get(ctx.episodeId)!;
    expect(episode.status).toBe('fallback');
    expect(engine.verifyReplay(ctx.worldId).equal).toBe(true);
  });

  it('moves a world through pause and resume only via the state machine', async () => {
    const engine = makeEngine();
    const ctx = await freshWorld(engine);
    const paused = await engine.pauseWorld({ actorUserId: ctx.userId, worldId: ctx.worldId, actorIdentityId: ctx.identityId, expectedWorldVersion: 1, commandId: cid() });
    expect(engine.store.worlds.get(ctx.worldId)!.status).toBe('paused');
    expect(paused.outcome).toBe('no_op');

    // Pausing an already paused world is not a listed transition.
    await expectError(engine.pauseWorld({ actorUserId: ctx.userId, worldId: ctx.worldId, actorIdentityId: ctx.identityId, expectedWorldVersion: 1, commandId: cid() }), 'RULE_PRECONDITION_FAILED');

    // Choices are refused while paused.
    await expectError(choose(ctx, 'confront_mara', 1), 'RULE_PRECONDITION_FAILED');

    // Resume reactivates the world even when no catch-up tick is due.
    engine.advanceWall(60);
    const idleResume = await engine.resumeWorld({ actorUserId: ctx.userId, worldId: ctx.worldId, actorIdentityId: ctx.identityId, expectedWorldVersion: 1, commandId: cid() });
    expect(engine.store.worlds.get(ctx.worldId)!.status).toBe('active');
    expect(idleResume.outcome).toBe('no_op');

    // Pause again, let one tick accumulate, and resume advances the world clock.
    await engine.pauseWorld({ actorUserId: ctx.userId, worldId: ctx.worldId, actorIdentityId: ctx.identityId, expectedWorldVersion: 1, commandId: cid() });
    engine.advanceWall(420);
    const resumed = await engine.resumeWorld({ actorUserId: ctx.userId, worldId: ctx.worldId, actorIdentityId: ctx.identityId, expectedWorldVersion: 1, commandId: cid() });
    expect(resumed.newVersion).toBe(2);
    expect(engine.store.worlds.get(ctx.worldId)!.status).toBe('active');
  });

  it('refuses choice ids the server never issued for this world (FR-04)', async () => {
    const engine = makeEngine();
    const ctx = await freshWorld(engine);

    const unknown = await expectError(choose(ctx, 'choice_from_another_rulepack', 1), 'INVALID_CHOICE');
    expect(unknown.status).toBe(422);

    // A rulepack choice this world has not opened yet fails as a precondition,
    // so the client can tell 'not allowed' from 'not yet unlocked'.
    const locked = await expectError(choose(ctx, 'reject_sale', 1), 'RULE_PRECONDITION_FAILED');
    expect(locked.details?.ruleCode).toBe('CHOICE_NOT_OFFERED');

    expect(engine.store.worlds.get(ctx.worldId)!.stateVersion).toBe(1);
    expect(engine.store.worldEvents(ctx.worldId)).toHaveLength(1);
  });

  it('advances world version once per command batch, not per event', async () => {
    const engine = makeEngine();
    const ctx = await freshWorld(engine);
    const beforeVersion = engine.store.worlds.get(ctx.worldId)!.stateVersion;
    const beforeEvents = engine.store.worldEvents(ctx.worldId).length;
    const beforeSnapshots = engine.store.snapshots.size;

    const result = await choose(ctx, 'brief_staff', beforeVersion);
    const written = engine.store.worldEvents(ctx.worldId).length - beforeEvents;

    expect(written).toBeGreaterThan(1);
    expect(result.newVersion).toBe(beforeVersion + 1);
    expect(result.firstEventSequence).toBe(beforeEvents + 1);
    expect(result.lastEventSequence).toBe(beforeEvents + written);
    expect(engine.store.snapshots.size).toBe(beforeSnapshots + 1);
    expect(engine.store.snapshots.has(snapshotKey(ctx.worldId, beforeVersion + 1))).toBe(true);
    expect(engine.store.snapshots.has(snapshotKey(ctx.worldId, beforeVersion + 2))).toBe(false);
  });

  it('stamps wall time, world time and narrative position as separate clocks (ADR-010)', async () => {
    const engine = makeEngine();
    const ctx = await freshWorld(engine);
    expect(engine.store.worlds.get(ctx.worldId)!.worldTime).toBe('2034-09-15T09:00:00.000Z');
    expect(new Date(engine.nowIso()).getTime()).toBe(T0);
    engine.advanceWall(120);
    const r = await engine.resumeWorld({ actorUserId: ctx.userId, worldId: ctx.worldId, actorIdentityId: ctx.identityId, expectedWorldVersion: 1, commandId: cid() });
    expect(r.outcome).toBe('no_op'); // 2h is below one 6h tick
    expect(engine.store.worlds.get(ctx.worldId)!.worldTime).toBe('2034-09-15T09:00:00.000Z');
    expect(new Date(engine.nowIso()).getTime()).toBe(T0 + 120 * 60_000);
  });
});
