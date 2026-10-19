// The Postgres request path: one unit of work per request, with the Api routing
// against an Engine that only exists inside that transaction (contract 3,
// ADR-006). The in-memory path needs none of this and uses InMemoryRunner.

import type { Engine } from '../engine.js';
import type { ID } from '../domain.js';
import { EngineError, err } from '../errors.js';
import { scopeOf, type ApiRequest, type EngineRunner } from '../api.js';
import type { Sessions } from '../db/session.js';

export class SessionRunner implements EngineRunner {
  /** Subjects this process has already seen, so provisioning costs one extra
   *  transaction per account instead of per request. The entry is dropped when a
   *  request 401s for that account, because the row can go away underneath the memo
   *  (a reset database, and from F15 on an account deletion). With Supabase Auth the
   *  user row is created by the auth trigger and this whole method disappears. */
  private readonly provisioned = new Set<ID>();

  constructor(private readonly sessions: Sessions) {}

  async run<T>(req: ApiRequest, fn: (engine: Engine) => T | Promise<T>): Promise<T> {
    const userId = req.actor?.userId;
    if (!userId) throw err.unauthenticated();
    const { worldId } = scopeOf(req);
    const worldIds = worldId ? [worldId] : [];
    // An authenticated subject with no account row would otherwise get 401 from
    // the engine, which reads as "your token is bad" to the client.
    await this.ensureAccount(userId);
    const exec = () =>
      req.method === 'GET'
        ? this.sessions.query({ worldIds, userIds: [userId] }, fn)
        : this.sessions.command({ actorUserId: userId, worldIds }, (engine) => Promise.resolve(fn(engine)));
    try {
      return await exec();
    } catch (e) {
      // The memo is only as true as the row it stands for. Measured on 2026-10-12: a
      // database reset left the process certain it had provisioned an account that was
      // no longer there, so every request from that account 401ed at `engine.ts:117`
      // for the life of the process — and F15's deletion route produces the same
      // state on purpose. Drop the memo and run the request once more; a second 401 is
      // the caller's problem, not ours, so it surfaces unchanged.
      if (!(e instanceof EngineError) || e.code !== 'UNAUTHENTICATED' || !this.provisioned.delete(userId)) throw e;
      await this.ensureAccount(userId);
      return exec();
    }
  }

  private async ensureAccount(userId: ID): Promise<void> {
    if (this.provisioned.has(userId)) return;
    await this.sessions.globals({ userIds: [userId] }, (engine, store) => {
      if (!store.users.has(userId)) engine.registerUser(userId);
    });
    this.provisioned.add(userId);
  }
}
