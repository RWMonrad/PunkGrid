// Request-scoped engine sessions over Postgres.
//
// A server cannot keep one long-lived Engine: contract 3 gives the database the
// canonical write point, and ADR-006 puts narration after the commit. So each
// command hydrates a Store, runs a fresh Engine against it, and writes the
// aggregate back in the same transaction. Everything the engine used to hold in
// process memory (catch-up anchor, episode cursor, daily spend) now comes from
// persisted rows or from EnginePorts.

import type { ID, ISOTime } from '../domain.js';
import { Engine, type EnginePorts } from '../engine.js';
import type { RulePack } from '../rulepack.js';
import type { NarrativeProvider } from '../narrative.js';
import type { Store } from '../store.js';
import type { LoadScope, PgStore, Tx } from './pgStore.js';

export interface SessionContext {
  pack: RulePack;
  /** A factory lets each command get a fresh provider; a shared instance is fine
   *  when the caller wants one call counter or one stub. */
  provider: NarrativeProvider | (() => NarrativeProvider);
  /** One id factory for the whole process. A seeded factory is deterministic but
   *  must never be re-created per request, or ids repeat and collide. */
  ids: (prefix: string) => ID;
  now: () => number;
  usdBudgetPerUserPerDay?: number;
  /** False on the server: the command commits, a worker narrates afterwards. */
  autoFlush?: boolean;
}

export interface CommandScope {
  actorUserId: ID;
  /** Worlds whose full aggregate is loaded and written back. */
  worldIds?: ID[];
}

export class Sessions {
  constructor(private readonly pg: PgStore, private readonly ctx: SessionContext) {}

  /** One canonical write point: hydrate, mutate, persist, commit. */
  async command<T>(scope: CommandScope, fn: (engine: Engine, store: Store) => Promise<T>): Promise<T> {
    const loadScope: LoadScope = { worldIds: scope.worldIds, userIds: [scope.actorUserId] };
    return this.pg.unit(loadScope, async (store, tx) => {
      const engine = this.build(store, tx);
      const before = new Set(store.worlds.keys());
      const result = await fn(engine, store);
      const created = [...store.worlds.keys()].filter((id) => !before.has(id) && store.worlds.get(id)!.ownerUserId === scope.actorUserId);
      const persist = [...new Set([...(scope.worldIds ?? []), ...created])];
      await tx.save(store, persist, engine.nowIso());
      return result;
    });
  }

  /** Account bootstrap. Users, identities and entitlements are globals rather
   *  than a world aggregate, so they are written in their own transaction. */
  async globals<T>(scope: LoadScope, fn: (engine: Engine, store: Store) => Promise<T> | T): Promise<T> {
    return this.pg.unit(scope, async (store, tx) => {
      const engine = this.build(store, tx);
      const result = await fn(engine, store);
      await tx.save(store, [], engine.nowIso());
      return result;
    });
  }

  /** A read-only view: no lock, nothing is written back. */
  async query<T>(scope: LoadScope, fn: (engine: Engine) => T | Promise<T>): Promise<T> {
    const store = await this.pg.load(scope);
    return fn(this.build(store, null));
  }

  private build(store: Store, tx: Tx | null): Engine {
    const pg = this.pg;
    const ports: EnginePorts = {
      resumeAnchor: (worldId) => pg.resumeAnchor(worldId, tx?.client),
      dailySpendUsd: (userId, dayStart) => pg.dailySpendUsd(userId, dayStart, tx?.client),
    };
    const provider = typeof this.ctx.provider === 'function' ? this.ctx.provider() : this.ctx.provider;
    return new Engine(this.ctx.pack, provider, {
      store,
      ids: this.ctx.ids,
      ports,
      now: this.ctx.now,
      autoFlush: this.ctx.autoFlush ?? false,
      ...(this.ctx.usdBudgetPerUserPerDay === undefined ? {} : { usdBudgetPerUserPerDay: this.ctx.usdBudgetPerUserPerDay }),
    });
  }

  /** Wall clock the sessions use for stamped rows. */
  nowIso(): ISOTime { return new Date(this.ctx.now()).toISOString(); }
}
