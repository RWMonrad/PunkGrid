// The outbox drain. Two things are being proved: the loop keeps its promises
// (claim, narrate, close; a failure costs an attempt and never a commit), and
// narrating after the commit changes no canonical state — the same Engine flush
// that the Postgres worker runs is driven here over an in-memory store, so the
// 202-then-poll flow is testable without a database.

import { describe, expect, it } from 'vitest';
import { Engine } from '../src/engine.js';
import { GLASS_HARBOR } from '../src/glassHarbor.js';
import { CompliantProvider, TimeoutProvider } from '../src/providers.js';
import type { NarrativeRequest } from '../src/narrative.js';
import type { ID } from '../src/domain.js';
import { OutboxWorker, type JobOutcome, type NarrationJob } from '../src/server/worker.js';
import { T0, choose, cid, freshWorld, makeEngine } from './helpers.js';

interface Closing { id: string; outcome: JobOutcome }

class FakeQueue {
  readonly closing: Closing[] = [];
  constructor(private jobs: NarrationJob[]) {}
  claim(): Promise<NarrationJob | null> {
    return Promise.resolve(this.jobs.shift() ?? null);
  }
  finish(id: string, outcome: JobOutcome): Promise<void> {
    this.closing.push({ id, outcome });
    return Promise.resolve();
  }
}

const job = (n: number, worldId = 'world_1'): NarrationJob => ({ id: `job_${n}`, worldId, episodeId: `ep_${n}`, kind: 'episode.generate' });

describe('OutboxWorker loop', () => {
  it('narrates every claimed world once and closes the job', async () => {
    const queue = new FakeQueue([job(1), job(2, 'world_2'), job(3, 'world_2')]);
    const seen: ID[] = [];
    const worker = new OutboxWorker({
      queue,
      runWorld: async (worldId) => { seen.push(worldId); },
      onError: () => { throw new Error('must not fail'); },
    });

    expect(await worker.drain()).toEqual({ completed: 3, retried: 0 });
    expect(seen).toEqual(['world_1', 'world_2', 'world_2']);
    expect(queue.closing).toEqual([
      { id: 'job_1', outcome: 'completed' },
      { id: 'job_2', outcome: 'completed' },
      { id: 'job_3', outcome: 'completed' },
    ]);
  });

  it('returns a failed job for another attempt instead of dropping it', async () => {
    const queue = new FakeQueue([job(1)]);
    const errors: unknown[] = [];
    const worker = new OutboxWorker({
      queue,
      runWorld: () => Promise.reject(new Error('connection dropped mid-transaction')),
      onError: (e) => { errors.push(e); },
    });

    expect(await worker.drain()).toEqual({ completed: 0, retried: 1 });
    expect(queue.closing).toEqual([{ id: 'job_1', outcome: 'retry' }]);
    expect(String(errors[0])).toContain('connection dropped');
  });

  it('takes a bounded pass and leaves the rest of the queue alone', async () => {
    const queue = new FakeQueue([job(1), job(2), job(3)]);
    const worker = new OutboxWorker({ queue, runWorld: () => Promise.resolve(), onError: () => {}, maxJobs: 2 });
    expect(await worker.drain()).toEqual({ completed: 2, retried: 0 });
    expect(queue.closing.map((c) => c.id)).toEqual(['job_1', 'job_2']);
  });

  it('sleeps when there is nothing to do and stops on request', async () => {
    const queue = new FakeQueue([]);
    let idleTicks = 0;
    // The sleep must yield to the timer phase: an instantly-resolving sleep turns
    // run() into a microtask loop that starves every setTimeout in the process.
    const worker = new OutboxWorker({
      queue,
      runWorld: () => Promise.resolve(),
      onError: () => {},
      idleDelayMs: 1,
      sleep: async (ms) => {
        await new Promise((r) => setTimeout(r, ms));
        idleTicks += 1;
      },
    });
    const running = worker.run();
    for (let i = 0; i < 200 && idleTicks < 3; i += 1) await new Promise((r) => setTimeout(r, 1));
    worker.stop();
    await running;
    expect(idleTicks).toBeGreaterThanOrEqual(3);
  });
});

describe('narration after the commit', () => {
  function pendingWorld(provider = new CompliantProvider()) {
    const engine = new Engine(GLASS_HARBOR, provider, { now: () => T0, seed: 20261011, autoFlush: false });
    return { engine, provider };
  }

  it('a command commits with the episode pending, and a flush publishes it', async () => {
    const { engine, provider } = pendingWorld();
    const ctx = await freshWorld(engine);
    expect(provider.calls).toBe(0);
    expect(engine.store.episodes.get(ctx.episodeId)!.status).toBe('pending');
    expect(engine.store.outbox.length).toBe(1);

    await engine.flush();
    expect(provider.calls).toBe(1);
    expect(engine.store.outbox.length).toBe(0);
    const row = engine.store.episodes.get(ctx.episodeId)!;
    expect(row.status).toBe('published');
    expect(row.episode.content.length).toBeGreaterThan(0);

    // Nothing canonical moved: the ledger and the snapshot are what the command
    // committed, and narration cannot add to them (contract section 10).
    const version = engine.store.worlds.get(ctx.worldId)!.stateVersion;
    const events = engine.store.worldEvents(ctx.worldId).length;
    await engine.flush();
    expect(engine.store.worlds.get(ctx.worldId)!.stateVersion).toBe(version);
    expect(engine.store.worldEvents(ctx.worldId).length).toBe(events);
  });

  it('a provider that never answers ends in templated prose, not a missing episode', async () => {
    const { engine } = pendingWorld(new TimeoutProvider());
    const ctx = await freshWorld(engine);
    await engine.flush();
    const row = engine.store.episodes.get(ctx.episodeId)!;
    expect(row.status).toBe('fallback');
    expect(row.episode.content).toContain('own words, with nothing added');
    expect(row.episode.content).not.toMatch(/[a-z]+_[a-z]+/);
  });

  it('the worker path can serve a whole turn: command, drain, then read the prose', async () => {
    const { engine } = pendingWorld();
    const ctx = await freshWorld(engine);
    // The queue mirrors the outbox but does not consume it: `flush()` is what
    // drains, so a claim that shifted the row would strand the job it ate.
    const worker = new OutboxWorker({
      queue: {
        claim: async () => {
          const next = engine.store.outbox[0];
          if (!next) return null;
          return { id: `job_${next.episodeId}`, worldId: next.worldId, episodeId: next.episodeId, kind: next.kind };
        },
        finish: async () => {},
      },
      runWorld: () => engine.flush(),
      onError: () => { throw new Error('flush failed'); },
    });

    const before = engine.store.episodes.size;
    const offered = engine.currentChoices(ctx.worldId)[0]!;
    await ctx.engine.submitChoice({
      actorUserId: ctx.userId, worldId: ctx.worldId, actorIdentityId: ctx.identityId,
      expectedWorldVersion: ctx.version, choiceId: offered.choiceId, commandId: cid(),
    });
    expect(engine.store.episodes.size).toBe(before + 1);

    expect(await worker.drain()).toEqual({ completed: 1, retried: 0 });
    const published = [...engine.store.episodes.values()].filter((e) => e.status === 'published');
    expect(published.length).toBe(2);
  });

  it('an episode narrated after the world advanced is built from its own committed version', async () => {
    class Recorder extends CompliantProvider {
      readonly seen: NarrativeRequest[] = [];
      override narrate(req: NarrativeRequest) {
        this.seen.push(req);
        return super.narrate(req);
      }
    }
    const provider = new Recorder();
    const engine = makeEngine(undefined, provider, { autoFlush: false });
    const ctx = await freshWorld(engine);
    const factsV1 = [...engine.store.latestSnapshot(ctx.worldId).state.factualKnowledge.char_player!];
    const offersV1 = engine.currentChoices(ctx.worldId).map((c) => c.choiceId);

    // `open_negotiation` is the choice that moves the very context the next
    // narration reads: it grants a fact and opens an offer that did not exist
    // at version 1.
    await choose(ctx, 'open_negotiation');
    expect(engine.store.worlds.get(ctx.worldId)!.stateVersion).toBe(2);

    // Episode 1 is still in the queue while the world is at version 2 — the
    // deployed shape, where the worker lags behind the API.
    await engine.flush();
    const [first, second] = provider.seen;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first!.committedVersion).toBe(1);
    expect(first!.allowedChoiceIds).toEqual(offersV1);
    expect(first!.authorizedPovFacts).toEqual(factsV1);
    expect(first!.worldTime).toBe(engine.store.snapshotAt(ctx.worldId, 1).state.worldTime);

    // The pin is per episode, not a fixed snapshot: episode 2 does see what
    // version 2 added.
    expect(second!.committedVersion).toBe(2);
    expect(second!.allowedChoiceIds).toContain('reject_sale');
    expect(second!.authorizedPovFacts).toContain('fact_exclusivity_demand');

    const ep1 = engine.store.episodes.get(ctx.episodeId)!.episode;
    expect(ep1.worldStateVersion).toBe(1);
    expect(ep1.allowedChoiceIds).toEqual(offersV1);
    expect(ep1.allowedChoiceIds).not.toContain('reject_sale');
  });
});
