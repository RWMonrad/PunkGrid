// Client for the eleven /v1 routes (contract §11, ADR-018). Deliberately free of
// React Native and Expo imports: the whole surface is `fetch` plus these types,
// so the same file runs in the vitest worker at the repository root and proves
// the wire contract without a device.

import type { SettingInput } from './setting';

export type EpisodeStatus =
  | 'none'
  | 'pending'
  | 'generating'
  | 'validated'
  | 'retrying'
  | 'published'
  | 'fallback'
  | 'failed';

export type ModerationReason =
  | 'sexual_content'
  | 'violence'
  | 'self_harm'
  | 'real_person'
  | 'offensive_language'
  | 'other';

export interface WorldSummary {
  worldId: string;
  identityId: string;
  /** Which rulepack the world runs on — the client's catalogue turns it into the
   *  title the player reads in UI07 (ADR-019). */
  rulepackId: string;
  status: 'active' | 'paused' | 'archived';
  worldTime: string;
  stateVersion: number;
}

export interface Episode {
  id: string;
  worldId: string;
  fromEventSequence: number;
  throughEventSequence: number;
  worldStateVersion: number;
  content: string;
  referencedEventIds: string[];
  allowedChoiceIds: string[];
  validationStatus: 'passed' | 'rejected' | 'fallback';
  status: EpisodeStatus;
}

export interface WorldView {
  world: { id: string; rulepackId: string; status: 'active' | 'paused' | 'archived'; worldTime: string; stateVersion: number };
  identityId: string;
  stateVersion: number;
  summary: { worldTime: string; arcs: Record<string, string>; resources: Record<string, number> };
  choices: { choiceId: string; label: string; copy: string }[];
}

export interface CommandResult {
  commandId: string;
  worldId: string;
  previousVersion: number;
  newVersion: number;
  outcome: string;
  eventIds: string[];
  stateHash: string;
}

export interface MutationAck {
  requestId: string;
  commandResult: CommandResult;
  episodeStatus: EpisodeStatus;
  episodeId?: string;
}

export interface CreatedWorld {
  requestId: string;
  worldId: string;
  version: number;
  episodeId: string;
  episodeStatus: EpisodeStatus;
}

export interface ReportAck {
  requestId: string;
  reportId: string;
  receipt: string;
  status: 'open' | 'duplicate';
}

/** The §11/§15 error vocabulary, as the server sends it. `retryAfterSeconds`
 *  arrives on 429, `currentVersion` on a version conflict. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get retryAfterSeconds(): number | null {
    const v = this.details.retryAfterSeconds;
    return typeof v === 'number' ? v : null;
  }

  get currentVersion(): number | null {
    const v = this.details.currentVersion;
    return typeof v === 'number' ? v : null;
  }
}

export interface ApiConfig {
  baseUrl: string;
  token: () => string | null;
  /** Injectable for tests and for the telemetry layer's request id trail. */
  fetchImpl?: typeof fetch;
  requestId?: () => string;
  commandId?: () => string;
}

const newRequestId = (): string => `req_${Math.random().toString(36).slice(2, 10)}`;

/** A command id is the idempotency key (§11), so it has to be created once per
 *  user intent and reused across retries of that intent — never per attempt. */
const newCommandId = (): string =>
  `cmd_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** The page size the client asks the episode list for. It is the engine's own default
 *  times five, which is every story this build can reach in one read — while the loop
 *  in `listEpisodes` still walks, because a page size is a request, not a promise. */
const EPISODE_PAGE = 100;

export class ApiClient {
  readonly newCommandId: () => string;
  private readonly newRequestId: () => string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly cfg: ApiConfig) {
    this.fetchImpl = cfg.fetchImpl ?? fetch;
    this.newRequestId = cfg.requestId ?? newRequestId;
    this.newCommandId = cfg.commandId ?? newCommandId;
  }

  get baseUrl(): string {
    return this.cfg.baseUrl;
  }

  private async call<T>(
    method: 'GET' | 'POST',
    path: string,
    opts: { body?: Record<string, unknown>; idempotencyKey?: string; signal?: AbortSignal } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { 'x-request-id': this.newRequestId() };
    const token = this.cfg.token();
    if (token) headers.authorization = `Bearer ${token}`;
    if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
    if (opts.body) headers['content-type'] = 'application/json';

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.cfg.baseUrl}${path}`, {
        method,
        headers,
        ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
    } catch (e) {
      // A rejected fetch is a transport fault, not a domain rejection: UI12 shows
      // "offline" and offers retry, and nothing here may look like a lost command.
      if (e instanceof Error && e.name === 'AbortError') throw e;
      throw new ApiError(0, 'NETWORK_ERROR', 'The Reality Engine could not be reached.');
    }

    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const error = (payload.error ?? {}) as { code?: string; message?: string; details?: Record<string, unknown> };
      throw new ApiError(res.status, error.code ?? 'INTERNAL_ERROR', error.message ?? 'Request failed', error.details ?? {});
    }
    return payload as T;
  }

  /** Dev sign-in (ADR-016). The route exists only when the server was started
   *  with an allowlist, so a 404 here means "this build has no dev port". */
  devToken(userId: string): Promise<{ requestId: string; userId: string; token: string }> {
    return this.call<{ requestId: string; userId: string; token: string }>('POST', '/dev/token', {
      body: { userId },
    });
  }

  health(signal?: AbortSignal): Promise<{ status: string; canon: string }> {
    return this.call<{ status: string; canon: string }>('GET', '/healthz', { ...(signal ? { signal } : {}) });
  }

  listWorlds(): Promise<{ requestId: string; items: WorldSummary[]; nextCursor: string | null }> {
    return this.call('GET', '/v1/worlds');
  }

  getWorld(worldId: string): Promise<WorldView & { requestId: string }> {
    return this.call('GET', `/v1/worlds/${worldId}`);
  }

  /** The world's visible episodes, in the order they happened — *every* page.
   *
   *  The play screen takes its newest scene from the end of this list and names the
   *  kicker by its length, so a caller that stops at one page is a world frozen on an
   *  old scene. Measured 2026-10-13 on a world at version 21: one page answered with
   *  episodes 1–20, and the player kept deciding against Episode 20. */
  async listEpisodes(worldId: string): Promise<{ requestId: string; items: Episode[]; nextCursor: string | null }> {
    const first = await this.episodePage(worldId);
    const items = [...first.items];
    for (let cursor = first.nextCursor; cursor; ) {
      const page = await this.episodePage(worldId, cursor);
      // An empty page is the server saying there is nothing more, whatever the cursor
      // claimed — the loop ends on what was read, never on what was promised.
      if (!page.items.length) break;
      items.push(...page.items);
      cursor = page.nextCursor;
    }
    return { requestId: first.requestId, items, nextCursor: null };
  }

  private episodePage(worldId: string, cursor?: string): Promise<{ requestId: string; items: Episode[]; nextCursor: string | null }> {
    const query = cursor ? `?limit=${EPISODE_PAGE}&cursor=${encodeURIComponent(cursor)}` : `?limit=${EPISODE_PAGE}`;
    return this.call('GET', `/v1/worlds/${worldId}/episodes${query}`);
  }

  getEpisode(worldId: string, episodeId: string, signal?: AbortSignal): Promise<{ requestId: string; status: EpisodeStatus; episode?: Episode }> {
    return this.call('GET', `/v1/worlds/${worldId}/episodes/${episodeId}`, { ...(signal ? { signal } : {}) });
  }

  createWorld(input: {
    mode: 'create' | 'surprise';
    templateId?: string;
    setting?: SettingInput;
    commandId: string;
  }): Promise<CreatedWorld> {
    return this.call<CreatedWorld>('POST', '/v1/worlds', {
      body: {
        schemaVersion: '1.0',
        commandId: input.commandId,
        mode: input.mode,
        ...(input.templateId ? { templateId: input.templateId } : {}),
        ...(input.setting ? { setting: input.setting } : {}),
      },
      idempotencyKey: input.commandId,
    });
  }

  private mutate<T>(path: string, body: Record<string, unknown>, commandId: string): Promise<T> {
    return this.call<T>('POST', path, {
      body: { schemaVersion: '1.0', commandId, ...body },
      idempotencyKey: commandId,
    });
  }

  submitChoice(input: { worldId: string; actorIdentityId: string; expectedWorldVersion: number; choiceId: string; commandId: string }): Promise<MutationAck> {
    return this.mutate<MutationAck>(`/v1/worlds/${input.worldId}/choices`, {
      actorIdentityId: input.actorIdentityId,
      expectedWorldVersion: input.expectedWorldVersion,
      choiceId: input.choiceId,
    }, input.commandId);
  }

  requestSurprise(input: { worldId: string; actorIdentityId: string; expectedWorldVersion: number; commandId: string }): Promise<MutationAck> {
    return this.mutate<MutationAck>(`/v1/worlds/${input.worldId}/surprises`, {
      actorIdentityId: input.actorIdentityId,
      expectedWorldVersion: input.expectedWorldVersion,
    }, input.commandId);
  }

  resumeWorld(input: { worldId: string; actorIdentityId: string; expectedWorldVersion: number; commandId: string }): Promise<MutationAck> {
    return this.mutate<MutationAck>(`/v1/worlds/${input.worldId}/resume`, {
      actorIdentityId: input.actorIdentityId,
      expectedWorldVersion: input.expectedWorldVersion,
    }, input.commandId);
  }

  pauseWorld(input: { worldId: string; actorIdentityId: string; expectedWorldVersion: number; commandId: string }): Promise<{ worldId: string; status: string; version: number }> {
    return this.mutate(`/v1/worlds/${input.worldId}/pause`, {
      actorIdentityId: input.actorIdentityId,
      expectedWorldVersion: input.expectedWorldVersion,
    }, input.commandId);
  }

  archiveWorld(input: { worldId: string; actorIdentityId: string; expectedWorldVersion: number; commandId: string }): Promise<{ worldId: string; status: string; version: number }> {
    return this.mutate(`/v1/worlds/${input.worldId}/archive`, {
      actorIdentityId: input.actorIdentityId,
      expectedWorldVersion: input.expectedWorldVersion,
    }, input.commandId);
  }

  /** FR-11 / US13, ADR-018: the eleventh route. Not a world command — no
   *  expectedWorldVersion, no event, no version bump. */
  reportEpisode(input: { worldId: string; episodeId: string; actorIdentityId: string; reason: ModerationReason; note?: string; commandId: string }): Promise<ReportAck> {
    return this.mutate<ReportAck>(`/v1/worlds/${input.worldId}/episodes/${input.episodeId}/reports`, {
      actorIdentityId: input.actorIdentityId,
      reason: input.reason,
      ...(input.note ? { note: input.note } : {}),
    }, input.commandId);
  }
}

const settled: EpisodeStatus[] = ['published', 'fallback'];

export function isPending(status: EpisodeStatus): boolean {
  return !settled.includes(status) && status !== 'none' && status !== 'failed';
}

export interface EpisodeReader {
  getEpisode(worldId: string, episodeId: string, signal?: AbortSignal): Promise<{ status: EpisodeStatus; episode?: Episode }>;
}

export interface PollOutcome {
  status: EpisodeStatus;
  episode?: Episode;
}

/** §10/ADR-006: narration is asynchronous and the client polls one stable
 *  interval until the episode settles. `onAttempt` lets the UI show progress and
 *  telemetry count polls without either changing the timing here. */
export async function pollEpisode(
  reader: EpisodeReader,
  worldId: string,
  episodeId: string,
  opts: { intervalMs?: number; maxMs?: number; signal?: AbortSignal; onAttempt?: (elapsedMs: number) => void } = {},
): Promise<PollOutcome> {
  const interval = opts.intervalMs ?? 1200;
  const deadline = Date.now() + (opts.maxMs ?? 120_000);
  for (;;) {
    const res = await reader.getEpisode(worldId, episodeId, opts.signal);
    if (!isPending(res.status) || Date.now() >= deadline) {
      return { status: res.status, ...(res.episode ? { episode: res.episode } : {}) };
    }
    opts.onAttempt?.(Date.now());
    await sleep(interval, opts.signal);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new Error('aborted'));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
