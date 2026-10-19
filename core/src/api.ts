// HTTP boundary for the eleven /v1 endpoints (contract section 11 — ten world
// routes and the ADR-018 report route).
// Framework-agnostic handler: the node:http adapter in core/src/server maps
// requests onto these routes, and a NestJS/Fastify adapter could do the same
// without changing the contract (ADR-011, ADR-016). No parallel endpoints are
// introduced here.

import { randomUUID } from 'node:crypto';
import type { Engine } from './engine.js';
import { EngineError, err } from './errors.js';
import type { ID } from './domain.js';
import type { ModerationReason } from './store.js';
import type { SettingInput } from './rulepack.js';

export interface ApiRequest {
  method: 'GET' | 'POST';
  path: string;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  /** resolved by the auth layer; never taken from the body */
  actor?: { userId: ID };
}

export interface ApiResponse {
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

/** Which world a request touches, without running the mutation. A Postgres
 *  server needs this before it can open its unit of work, because the aggregate
 *  has to be hydrated first (contract 3). POST /v1/worlds creates a world whose
 *  id the engine chooses, so it reports none. */
export function scopeOf(req: ApiRequest): { worldId: ID | null } {
  const segments = req.path.replace(/^\/v1/, '').split('/').filter(Boolean);
  if (segments[0] === 'worlds' && segments[1]) return { worldId: segments[1] };
  return { worldId: null };
}

/** How a request reaches an Engine that is authoritative for it. A test or a
 *  single-process server answers from one long-lived Engine; the Postgres
 *  server hydrates the aggregate inside a transaction per command (contract 3),
 *  so routing has to happen inside a callback rather than against an Engine the
 *  caller already holds. */
export interface EngineRunner {
  run<T>(req: ApiRequest, fn: (engine: Engine) => T | Promise<T>): Promise<T>;
}

export class InMemoryRunner implements EngineRunner {
  constructor(private readonly engine: Engine) {}
  async run<T>(_req: ApiRequest, fn: (engine: Engine) => T | Promise<T>): Promise<T> {
    return fn(this.engine);
  }
}

type RouteResult = { status: number; body: Record<string, unknown> };

export class Api {
  constructor(
    private readonly runner: EngineRunner,
    /** Called for anything the routing does not understand — a persistence or
     *  programming fault, not a domain rejection. The caller keeps the last word
     *  on the response status. */
    private readonly onUnhandled?: (error: unknown, info: ApiRequest) => void,
  ) {}

  async handle(req: ApiRequest): Promise<ApiResponse> {
    const requestId = req.headers?.['x-request-id'] ?? `req_${randomUUID().slice(0, 8)}`;
    const headers = { 'x-request-id': requestId };
    try {
      const route = await this.runner.run(req, (engine) => this.route(req, requestId, engine));
      return { status: route.status, body: route.body, headers };
    } catch (e) {
      if (e instanceof EngineError) {
        return {
          status: e.status,
          body: { requestId, error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } },
          headers,
        };
      }
      this.onUnhandled?.(e, req);
      return { status: 500, body: { requestId, error: { code: 'INTERNAL_ERROR', message: 'Request failed' } }, headers };
    }
  }

  private async route(req: ApiRequest, requestId: string, engine: Engine): Promise<RouteResult> {
    const userId = req.actor?.userId;
    if (!userId) throw err.unauthenticated();

    const segments = req.path.replace(/^\/v1/, '').split('/').filter(Boolean);
    const body = req.body ?? {};
    const commandId = body.commandId as ID | undefined;

    if (req.method === 'POST') {
      const key = req.headers?.['idempotency-key'];
      if (!key || !commandId) throw err.invalidSchema('Idempotency-Key and commandId are required for mutations');
      if (key !== commandId) throw err.invalidSchema('Idempotency-Key must equal commandId');
    }

    // POST /v1/worlds | GET /v1/worlds
    if (segments.length === 1 && segments[0] === 'worlds') {
      if (req.method === 'POST') {
        const res = await engine.createWorld({
          actorUserId: userId,
          mode: body.mode as 'create' | 'surprise',
          identityId: body.identityId as ID | undefined,
          templateId: body.templateId as string | undefined,
          setting: body.setting as SettingInput | undefined,
          commandId,
        });
        const pending = res.episodeStatus === 'pending' || res.episodeStatus === 'generating' || res.episodeStatus === 'retrying';
        return {
          status: pending ? 202 : 201,
          body: { requestId, worldId: res.worldId, version: res.commandResult.newVersion, episodeId: res.episodeId, episodeStatus: res.episodeStatus },
        };
      }
      return { status: 200, body: { requestId, items: engine.listWorlds(userId), nextCursor: null } };
    }

    if (segments[0] !== 'worlds' || !segments[1]) throw err.notFound();
    const worldId = segments[1];
    const sub = segments[2];

    // GET /v1/worlds/{id}/episodes[/{episodeId}]
    if (req.method === 'GET' && sub === 'episodes') {
      if (segments[3]) {
        const res = engine.getEpisode(userId, worldId, segments[3]);
        return { status: 200, body: { requestId, status: res.status, ...(res.episode ? { episode: res.episode } : {}) } };
      }
      const page = engine.listEpisodes(userId, worldId, Number(body.limit ?? 20), (body.cursor as string) ?? null);
      return { status: 200, body: { requestId, items: page.items, nextCursor: page.nextCursor } };
    }

    // POST /v1/worlds/{id}/episodes/{episodeId}/reports — FR-11 / US13 (ADR-018).
    // The eleventh route, and the only mutation that is not a world command: it
    // carries a commandId for deduplication but no expectedWorldVersion, because
    // reporting a story changes nothing about the story.
    if (req.method === 'POST' && sub === 'episodes' && segments[3] && segments[4] === 'reports') {
      if (!commandId) throw err.invalidSchema('commandId is required to report an episode');
      const reporter = body.actorIdentityId as ID;
      if (!reporter) throw err.invalidSchema('actorIdentityId is required to report an episode');
      const res = engine.reportEpisode({
        actorUserId: userId,
        worldId,
        episodeId: segments[3],
        reporterIdentityId: reporter,
        reason: body.reason as ModerationReason,
        ...(typeof body.note === 'string' ? { note: body.note } : {}),
        commandId,
      });
      return { status: 201, body: { requestId, reportId: res.reportId, receipt: res.receipt, status: res.status } };
    }

    // GET /v1/worlds/{id}
    if (req.method === 'GET' && !sub) {
      const view = engine.getWorld(userId, worldId);
      return { status: 200, body: { requestId, world: view.world, identityId: view.identityId, stateVersion: view.stateVersion, summary: view.summary, choices: view.choices } };
    }

    if (req.method !== 'POST' || !sub) throw err.notFound();
    const expectedVersion = Number(body.expectedWorldVersion);
    const actorIdentityId = body.actorIdentityId as ID;
    if (!commandId || !actorIdentityId || Number.isNaN(expectedVersion)) {
      throw err.invalidSchema('commandId, actorIdentityId and expectedWorldVersion are required');
    }
    const ctx = { actorUserId: userId, worldId, actorIdentityId, expectedWorldVersion: expectedVersion, commandId };

    if (sub === 'choices') {
      const commandResult = await engine.submitChoice({ ...ctx, choiceId: body.choiceId as ID });
      return { status: 200, body: { requestId, commandResult, ...this.episodeFor(engine, worldId, commandResult.newVersion) } };
    }
    if (sub === 'surprises') {
      const commandResult = await engine.requestSurprise(ctx);
      return { status: 200, body: { requestId, commandResult, ...this.episodeFor(engine, worldId, commandResult.newVersion) } };
    }
    if (sub === 'resume') {
      const commandResult = await engine.resumeWorld(ctx);
      return { status: 200, body: { requestId, commandResult, ...this.episodeFor(engine, worldId, commandResult.newVersion) } };
    }
    if (sub === 'pause') {
      const commandResult = await engine.pauseWorld(ctx);
      return { status: 200, body: { requestId, worldId, status: 'paused', version: commandResult.newVersion, commandResult } };
    }
    if (sub === 'archive') {
      const commandResult = await engine.archiveWorld(ctx);
      return { status: 200, body: { requestId, worldId, status: 'archived', version: commandResult.newVersion, commandResult } };
    }
    throw err.notFound();
  }

  private episodeFor(engine: Engine, worldId: ID, version: number): { episodeStatus: string; episodeId?: ID } {
    const rows = [...engine.store.episodes.values()].filter((e) => e.episode.worldId === worldId && e.episode.worldStateVersion === version);
    const row = rows.at(-1);
    if (!row) return { episodeStatus: 'none' };
    // The id travels with every state: a client that is told `pending` has to
    // know which episode to poll (§11 allows `episodeId?`, not `episodeId` only
    // once prose exists).
    const settled = row.status === 'published' || row.status === 'fallback';
    return { episodeStatus: settled ? 'published' : row.status, episodeId: row.episode.id };
  }
}
