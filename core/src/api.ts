// HTTP boundary for the ten normative /v1 endpoints (contract section 11).
// Framework-agnostic handler: a NestJS/Fastify adapter maps these onto routes
// without changing the contract (ADR-011). No parallel endpoints are introduced.

import { randomUUID } from 'node:crypto';
import type { Engine } from './engine.js';
import { EngineError, err } from './errors.js';
import type { ID } from './domain.js';
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

export class Api {
  constructor(private engine: Engine) {}

  async handle(req: ApiRequest): Promise<ApiResponse> {
    const requestId = req.headers?.['x-request-id'] ?? `req_${randomUUID().slice(0, 8)}`;
    const headers = { 'x-request-id': requestId };
    try {
      const route = await this.route(req, requestId);
      return { status: route.status, body: route.body, headers };
    } catch (e) {
      if (e instanceof EngineError) {
        return {
          status: e.status,
          body: { requestId, error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } },
          headers,
        };
      }
      throw e;
    }
  }

  private async route(req: ApiRequest, requestId: string): Promise<{ status: number; body: Record<string, unknown> }> {
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
        const res = await this.engine.createWorld({
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
      return { status: 200, body: { requestId, items: this.engine.listWorlds(userId), nextCursor: null } };
    }

    if (segments[0] !== 'worlds' || !segments[1]) throw err.notFound();
    const worldId = segments[1];
    const sub = segments[2];

    // GET /v1/worlds/{id}/episodes[/{episodeId}]
    if (req.method === 'GET' && sub === 'episodes') {
      if (segments[3]) {
        const res = this.engine.getEpisode(userId, worldId, segments[3]);
        return { status: 200, body: { requestId, status: res.status, ...(res.episode ? { episode: res.episode } : {}) } };
      }
      const page = this.engine.listEpisodes(userId, worldId, Number(body.limit ?? 20));
      return { status: 200, body: { requestId, items: page.items, nextCursor: page.nextCursor } };
    }

    // GET /v1/worlds/{id}
    if (req.method === 'GET' && !sub) {
      const view = this.engine.getWorld(userId, worldId);
      return { status: 200, body: { requestId, world: view.world, stateVersion: view.stateVersion, summary: view.summary, choices: view.choices } };
    }

    if (req.method !== 'POST' || !sub) throw err.notFound();
    const expectedVersion = Number(body.expectedWorldVersion);
    const actorIdentityId = body.actorIdentityId as ID;
    if (!commandId || !actorIdentityId || Number.isNaN(expectedVersion)) {
      throw err.invalidSchema('commandId, actorIdentityId and expectedWorldVersion are required');
    }
    const ctx = { actorUserId: userId, worldId, actorIdentityId, expectedWorldVersion: expectedVersion, commandId };

    if (sub === 'choices') {
      const commandResult = await this.engine.submitChoice({ ...ctx, choiceId: body.choiceId as ID });
      return { status: 200, body: { requestId, commandResult, ...this.episodeFor(worldId, commandResult.newVersion) } };
    }
    if (sub === 'surprises') {
      const commandResult = await this.engine.requestSurprise(ctx);
      return { status: 200, body: { requestId, commandResult, ...this.episodeFor(worldId, commandResult.newVersion) } };
    }
    if (sub === 'resume') {
      const commandResult = await this.engine.resumeWorld(ctx);
      return { status: 200, body: { requestId, commandResult, ...this.episodeFor(worldId, commandResult.newVersion) } };
    }
    if (sub === 'pause') {
      const commandResult = await this.engine.pauseWorld(ctx);
      return { status: 200, body: { requestId, worldId, status: 'paused', version: commandResult.newVersion, commandResult } };
    }
    if (sub === 'archive') {
      const commandResult = await this.engine.archiveWorld(ctx);
      return { status: 200, body: { requestId, worldId, status: 'archived', version: commandResult.newVersion, commandResult } };
    }
    throw err.notFound();
  }

  private episodeFor(worldId: ID, version: number): { episodeStatus: string; episodeId?: ID } {
    const rows = [...this.engine.store.episodes.values()].filter((e) => e.episode.worldId === worldId && e.episode.worldStateVersion === version);
    const row = rows.at(-1);
    if (!row) return { episodeStatus: 'none' };
    return row.status === 'published' || row.status === 'fallback'
      ? { episodeStatus: 'published', episodeId: row.episode.id }
      : { episodeStatus: row.status };
  }
}
