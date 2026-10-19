// The play loop, as a plain class rather than screen code: loading a world,
// committing a choice and polling for its prose is where §11's rules actually bite
// (version binding, idempotent retry, pending episodes), and it deserves tests that
// do not need a device. React only subscribes to it.
//
// Three invariants the rest of the app relies on:
//   1. A command id is born with a user intent and survives every retry of that
//      intent, so a flaky network replays one command instead of two (§11).
//   2. `expectedWorldVersion` always comes from the server's last answer, never
//      from a local counter (T07).
//   3. Prose arrives by polling, and a `fallback` episode is shown as what it is
//      instead of being retried forever (ADR-006).

import { ApiClient, ApiError, type Episode, type ModerationReason, type MutationAck, type ReportAck, type WorldView, pollEpisode } from './api';
import { describe } from './session';
import { worldRef, telemetry } from './telemetry';

export type PlayPhase = 'idle' | 'loading' | 'reading' | 'submitting' | 'writing' | 'error';

export interface PlayState {
  phase: PlayPhase;
  world: WorldView | null;
  episode: Episode | null;
  /** Number of episodes visible in the list, used for the "Episode n" kicker. */
  episodeNumber: number;
  message: string | null;
  /** Set when the world moved on under us, so the screen can offer a reload. */
  conflict: boolean;
  /** The resources as they were on the version this screen showed last. Only a
   *  read that moved the world forward sets it, so the delta the HUD prints is the
   *  change the player's own decision caused — never a diff against a stale copy. */
  previousResources: Record<string, number> | null;
}

interface PendingIntent {
  commandId: string;
  kind: 'choice' | 'surprise' | 'resume';
  choiceId?: string;
  startedAt: number;
}

const NOT_WRITTEN = 'The scene is decided but not yet written. The narrator has not answered — retry reads the episode again and sends nothing new.';
const FALLBACK = 'This scene is told from stored state: the narrator did not return usable prose.';

export class PlayController {
  private state: PlayState = { phase: 'idle', world: null, episode: null, episodeNumber: 0, message: null, conflict: false, previousResources: null };
  private listeners = new Set<() => void>();
  private pending: PendingIntent | null = null;
  private abort: AbortController | null = null;
  private disposed = false;

  constructor(
    // The real client, not a structural copy of it: a test that wants to drive
    // this loop stubs `fetch`, so the wire layer stays inside what is tested.
    private readonly api: ApiClient,
    private readonly worldId: string,
  ) {}

  getSnapshot = (): PlayState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(patch: Partial<PlayState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  dispose(): void {
    this.disposed = true;
    this.abort?.abort();
    this.abort = null;
    this.listeners.clear();
  }

  private beginOperation(): AbortController {
    this.abort?.abort();
    const operation = new AbortController();
    this.abort = operation;
    return operation;
  }

  private isCurrent(operation: AbortController): boolean {
    return !this.disposed && this.abort === operation && !operation.signal.aborted;
  }

  private finishOperation(operation: AbortController): void {
    // An older request's finally must not clear a newer load's cancellation handle.
    if (this.abort === operation) this.abort = null;
  }

  /** GET world + GET episodes: the reading surface is the newest episode, while
   *  the choices always come from the world view, which the engine binds to the
   *  current version (§11).
   *
   *  `movedByOwnCommand` is what lets the HUD attribute a resource change to the
   *  player. It is only true on the read that follows a commit this client sent,
   *  and the delta is only kept when the world advanced by exactly the one version
   *  that command created. A reload after a *rejected* commit — a version conflict,
   *  where the player's decision committed nothing and someone else's moved the
   *  world — reads without it, so a change we did not cause is never printed as ours. */
  async load(movedByOwnCommand = false): Promise<void> {
    // An explicit load also starts a fresh subscription lifecycle after cleanup.
    this.disposed = false;
    const operation = this.beginOperation();
    try {
      await this.readWorld(operation, movedByOwnCommand);
    } finally {
      this.finishOperation(operation);
    }
  }

  private async readWorld(operation: AbortController, movedByOwnCommand = false): Promise<boolean> {
    const before = this.state.world;
    this.set({ phase: 'loading', message: null, conflict: false });
    try {
      const world = await this.api.getWorld(this.worldId);
      if (!this.isCurrent(operation)) return false;
      const list = await this.api.listEpisodes(this.worldId);
      if (!this.isCurrent(operation)) return false;
      let latest = list.items.at(-1) ?? null;
      this.set({
        world,
        episode: latest,
        episodeNumber: list.items.length,
        previousResources:
          movedByOwnCommand && before && world.stateVersion === before.stateVersion + 1
            ? before.summary.resources
            : null,
      });
      if (latest && latest.status !== 'published' && latest.status !== 'fallback') {
        latest = await this.waitForEpisode(latest.id, operation);
      }
      if (!this.isCurrent(operation)) return false;
      this.set({ phase: 'reading', episode: latest, message: latest?.status === 'fallback' ? FALLBACK : null });
      if (latest) {
        telemetry.track({
          name: 'episode_viewed',
          worldRef: worldRef(this.worldId),
          episodeSeq: latest.throughEventSequence,
          worldAgeDays: ageDays(world.world.worldTime),
          latencyMs: 0,
        });
      }
      return true;
    } catch (e) {
      if (this.isCurrent(operation)) this.set({ phase: 'error', message: describe(e) });
      return false;
    }
  }

  private async waitForEpisode(episodeId: string, operation: AbortController): Promise<Episode | null> {
    if (!this.isCurrent(operation)) return null;
    this.set({ phase: 'writing' });
    const polled = await pollEpisode(this.api, this.worldId, episodeId, { signal: operation.signal });
    if (!this.isCurrent(operation)) return null;
    // A failed job, a deadline, or a response without prose is not a readable scene.
    if ((polled.status !== 'published' && polled.status !== 'fallback') || !polled.episode) {
      throw new Error(NOT_WRITTEN);
    }
    telemetry.track({
      name: 'episode_generation_finished',
      worldRef: worldRef(this.worldId),
      success: polled.status === 'published',
      provider: 'gateway',
      model: 'unknown',
      tokens: 0,
      estimatedUsd: 0,
      retryCount: 0,
      fallbackReasonCode: polled.status === 'fallback' ? 'narrative_fallback' : null,
    });
    // The detail route carries status beside the prose, unlike the list route.
    return { ...polled.episode, status: polled.status };
  }

  /** UI06/US05: commit a choice, then wait for its prose. The command id is taken
   *  from the intent in flight if there is one, which is what makes a retry after
   *  a dropped response safe rather than duplicating a decision. */
  private async commit(kind: PendingIntent['kind'], choiceId?: string): Promise<void> {
    const world = this.state.world;
    const retrying = this.pending?.kind === kind && this.pending.choiceId === choiceId;
    if (!world || this.disposed || this.abort || world.world.status === 'archived') return;
    if (world.world.status === 'paused' && kind !== 'resume') return;
    if (this.state.phase !== 'reading' && !(this.state.phase === 'error' && retrying)) return;
    const operation = this.beginOperation();
    const intent: PendingIntent =
      retrying && this.pending
        ? this.pending
        : { commandId: this.api.newCommandId(), kind, ...(choiceId ? { choiceId } : {}), startedAt: Date.now() };
    this.pending = intent;
    this.set({ phase: 'submitting', message: null, conflict: false });
    if (kind === 'resume') {
      telemetry.track({ name: 'world_resumed', worldRef: worldRef(this.worldId), elapsedDays: ageDays(world.world.worldTime), catchupTicks: 0 });
    }

    try {
      const ctx = { worldId: this.worldId, actorIdentityId: world.identityId, expectedWorldVersion: world.stateVersion, commandId: intent.commandId };
      let ack: MutationAck;
      try {
        ack =
          kind === 'choice'
            ? await this.api.submitChoice({ ...ctx, choiceId: choiceId! })
            : kind === 'surprise'
              ? await this.api.requestSurprise(ctx)
              : await this.api.resumeWorld(ctx);
      } catch (e) {
        if (this.isCurrent(operation)) await this.handleCommitError(e, intent, operation);
        return;
      }
      if (!this.isCurrent(operation)) return;

      this.pending = null;
      const committed = ack.commandResult;
      telemetry.track({
        name: 'choice_committed',
        worldRef: worldRef(this.worldId),
        commandType: kind,
        newVersion: committed.newVersion,
        causalDeltaFlag: committed.eventIds.length > 0,
      });

      if (kind === 'surprise' && committed.outcome === 'no_op') {
        this.set({ phase: 'reading', message: 'Nothing eligible happened this beat. The world kept its cooldown.' });
        return;
      }

      if (!ack.episodeId) {
        await this.readWorld(operation, true);
        return;
      }

      const polled = await this.waitForEpisode(ack.episodeId, operation);
      if (!this.isCurrent(operation)) return;
      if (await this.readWorld(operation, true) && this.isCurrent(operation) && polled?.status === 'fallback') {
        this.set({ message: FALLBACK });
      }
    } catch (e) {
      if (this.isCurrent(operation)) {
        const message = describe(e);
        this.set({ phase: 'error', message: message === NOT_WRITTEN ? message : `The scene is decided but not yet written. ${message}` });
      }
    } finally {
      this.finishOperation(operation);
    }
  }

  /** A version conflict is not a failure to hide behind a retry: the world moved,
   *  so the client re-reads and the player chooses again against the new state.
   *  A rate limit keeps the intent so the replay is the same command. */
  private async handleCommitError(e: unknown, intent: PendingIntent, operation: AbortController): Promise<void> {
    if (e instanceof ApiError) {
      if (e.code === 'WORLD_VERSION_CONFLICT') {
        this.pending = null;
        telemetry.track({ name: 'choice_rejected', worldRef: worldRef(this.worldId), ruleCode: e.code, latencyMs: Date.now() - intent.startedAt });
        // Only explain the replacement scene if that scene was actually read.
        if (await this.readWorld(operation) && this.isCurrent(operation)) {
          this.set({ conflict: true, message: 'The world changed while you were deciding. Here is the newest scene.' });
        }
        return;
      }
      if (e.code === 'RULE_PRECONDITION_FAILED') {
        this.pending = null;
        telemetry.track({ name: 'choice_rejected', worldRef: worldRef(this.worldId), ruleCode: String(e.details.ruleCode ?? 'RULE'), latencyMs: Date.now() - intent.startedAt });
        this.set({ phase: 'reading', message: e.message });
        return;
      }
      if (e.code === 'WORLD_LIMIT_REACHED') {
        this.pending = null;
        this.set({ phase: 'error', message: 'The free quota is used up. Create fewer worlds or wait for your next one.' });
        return;
      }
      if (e.code === 'RATE_LIMITED') {
        // Keep the intent: the same command id on the next attempt is the point of
        // the key, and the server answers with the stored result if it already ran.
        this.pending = intent;
        const wait = e.retryAfterSeconds ?? 5;
        this.set({ phase: 'error', message: `Slow down — try again in ${wait} second${wait === 1 ? '' : 's'}.` });
        return;
      }
      if (e.code === 'NETWORK_ERROR') {
        this.pending = intent;
        this.set({ phase: 'error', message: 'The connection was lost before confirmation. Retry the same decision safely; it will not count twice.' });
        return;
      }
      telemetry.track({ name: 'choice_rejected', worldRef: worldRef(this.worldId), ruleCode: e.code, latencyMs: Date.now() - intent.startedAt });
    }
    this.set({ phase: 'error', message: describe(e) });
  }

  choose(choiceId: string): Promise<void> {
    return this.commit('choice', choiceId);
  }

  /** Replay an unacknowledged intent with its command id; otherwise only read. */
  retry(): Promise<void> {
    if (this.disposed || this.abort) return Promise.resolve();
    const intent = this.pending;
    if (!intent) return this.load();
    return this.commit(intent.kind, intent.choiceId);
  }

  surprise(): Promise<void> {
    return this.commit('surprise');
  }

  resume(): Promise<void> {
    return this.commit('resume');
  }

  /** UI07's housekeeping. Pausing and archiving are commands like any other —
   *  version-bound and idempotent — but they create no episode, so there is nothing
   *  to poll afterwards; the world view is re-read instead. */
  private async changeStatus(kind: 'pause' | 'archive'): Promise<void> {
    const world = this.state.world;
    if (!world || this.disposed || this.abort || this.state.phase !== 'reading' || world.world.status === 'archived') return;
    if (kind === 'pause' && world.world.status !== 'active') return;
    const operation = this.beginOperation();
    const ctx = { worldId: this.worldId, actorIdentityId: world.identityId, expectedWorldVersion: world.stateVersion, commandId: this.api.newCommandId() };
    this.set({ phase: 'submitting', message: null, conflict: false });
    try {
      await (kind === 'pause' ? this.api.pauseWorld(ctx) : this.api.archiveWorld(ctx));
      if (!this.isCurrent(operation)) return;
      if (await this.readWorld(operation) && this.isCurrent(operation)) {
        this.set({ message: kind === 'archive' ? 'World archived. It stays readable, never playable.' : 'World paused. Nothing advances until you resume it.' });
      }
    } catch (e) {
      if (this.isCurrent(operation)) this.set({ phase: 'error', message: describe(e) });
    } finally {
      this.finishOperation(operation);
    }
  }

  pause(): Promise<void> {
    return this.changeStatus('pause');
  }

  archive(): Promise<void> {
    return this.changeStatus('archive');
  }

  /** FR-11 / US13: the report is not a world command, so it does not touch the
   *  version — but it is idempotent, and this keeps the same report open if the
   *  sheet is submitted twice. */
  async report(reason: ModerationReason, note?: string): Promise<ReportAck> {
    const world = this.state.world;
    const episode = this.state.episode;
    if (!world || !episode) throw new ApiError(404, 'NOT_FOUND', 'There is no scene to report yet.');
    const ack = await this.api.reportEpisode({
      worldId: this.worldId,
      episodeId: episode.id,
      actorIdentityId: world.identityId,
      reason,
      ...(note ? { note } : {}),
      commandId: this.api.newCommandId(),
    });
    telemetry.track({ name: 'content_report_submitted', reportReasonCode: reason, contentType: 'episode' });
    return ack;
  }
}

function ageDays(worldTime: string | undefined): number {
  if (!worldTime) return 0;
  const t = Date.parse(worldTime);
  return Number.isNaN(t) ? 0 : Math.max(0, Math.round((Date.now() - t) / 86_400_000));
}
