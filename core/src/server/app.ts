// Composition root: what the running server and the narration worker are.
//
// One place decides the wiring (store, pack, provider, budget, auth port, rate
// limiter, flush policy) so the dev scripts, the emulator run and the security
// suite all start the same object. The choice that matters is where canon lives:
// without `dbUrl` the process holds one Engine and narrates inline (autoFlush);
// with a database every command is a transaction and narration is the worker's
// job (ADR-006), which is the deployed shape.

import { GLASS_HARBOR } from '../glassHarbor.js';
import { Engine } from '../engine.js';
import { makeIdFactory, type ID } from '../domain.js';
import { Api, InMemoryRunner } from '../api.js';
import { CompliantProvider } from '../providers.js';
import type { NarrativeProvider } from '../narrative.js';
import type { RulePack } from '../rulepack.js';
import { createPool, type PgPool } from '../db/client.js';
import { PgStore } from '../db/pgStore.js';
import { Sessions } from '../db/session.js';
import { HmacDevAuth, type AuthPort } from './auth.js';
import { SessionRunner } from './runner.js';
import { TokenBucket, type Limiters } from './rateLimit.js';
import { PgTokenBucket } from './pgRateLimit.js';
import { MAX_BODY_BYTES, startAppServer, type AppServer, type HttpOptions } from './http.js';
import { OutboxWorker, PgJobQueue } from './worker.js';

export interface AppConfig {
  /** Canonical store. Absent means a single-process in-memory engine. */
  dbUrl?: string;
  /** HMAC secret for dev bearer tokens; at least 32 characters. */
  secret: string;
  /** Every id the process mints derives from this seed. A server must not reuse
   *  a previous process's seed against a database that still holds those rows,
   *  so the start script uses a fresh value. */
  seed: number;
  /** Accounts this process knows by name: registered at boot in memory, and the
   *  only ids the dev token mint will sign. */
  devUserIds?: ID[];
  pack?: RulePack;
  provider?: NarrativeProvider;
  now?: () => number;
  usdBudgetPerUserPerDay?: number;
  maxBodyBytes?: number;
  rateLimit?: { capacity?: number; refillPerMinute?: number };
  /** Set only when every request arrives through one proxy you control; see
   *  `peerAddress` in http.ts. Off means the socket peer decides which address
   *  bucket a caller lands in. */
  trustProxy?: boolean;
  log?: (line: string) => void;
}

/** Everything a worker needs, minus what only an HTTP listener uses. */
export type WorkerConfig = Omit<AppConfig, 'secret' | 'devUserIds' | 'maxBodyBytes' | 'rateLimit' | 'trustProxy'> & { dbUrl: string };

export interface AppInstance {
  readonly auth: AuthPort;
  /** The two guards http.ts applies per request. Exposed so a test can read the
   *  bucket a request spent without reaching into the transport. */
  readonly limiters: Limiters;
  readonly api: Api;
  /** Present with a database: the request path and the worker share it. */
  readonly sessions: Sessions | null;
  /** Present without a database: the whole canon lives in this process. */
  readonly engine: Engine | null;
  listen(listen?: { port?: number; host?: string }): Promise<AppServer>;
  /** The outbox drain. Only meaningful with a database, where a command commits
   *  before narration runs. */
  worker(): OutboxWorker;
  close(): Promise<void>;
}

export interface WorkerHandle {
  worker: OutboxWorker;
  close(): Promise<void>;
}

export function buildApp(config: AppConfig): AppInstance {
  const log = config.log ?? silent;
  const core = engineCore(config);
  const auth = new HmacDevAuth(config.secret);
  const ratePolicy = {
    ...(config.rateLimit?.capacity === undefined ? {} : { capacity: config.rateLimit.capacity }),
    ...(config.rateLimit?.refillPerMinute === undefined ? {} : { refillPerMinute: config.rateLimit.refillPerMinute }),
  };
  // The anonymous guard is in-process in every build: a database row per
  // unauthenticated request would make the limiter itself the denial of service.
  const addresses = new TokenBucket({ ...ratePolicy, now: core.now });
  const http = (limiters: Limiters): Omit<HttpOptions, 'api'> => ({
    auth,
    limiters,
    maxBodyBytes: config.maxBodyBytes ?? MAX_BODY_BYTES,
    log,
    ...(config.trustProxy ? { trustProxy: true } : {}),
    ...(config.devUserIds?.length ? { devAuth: { secret: config.secret, userIds: config.devUserIds } } : {}),
  });

  if (!config.dbUrl) {
    const engine = new Engine(core.pack, core.provider, {
      seed: config.seed,
      now: core.now,
      autoFlush: true,
      ...(config.usdBudgetPerUserPerDay === undefined ? {} : { usdBudgetPerUserPerDay: config.usdBudgetPerUserPerDay }),
    });
    // Without a database there is no account table to provision from, so the
    // named dev accounts are the only ones this process can serve.
    for (const userId of config.devUserIds ?? []) engine.registerUser(userId);
    const api = new Api(new InMemoryRunner(engine), unhandled(log));
    // One process has no second instance to share with, so the account guard is
    // the same bucket map. Keys never collide: addresses are prefixed `ip:`.
    const limiters: Limiters = { addresses, accounts: addresses };
    return {
      auth,
      limiters,
      api,
      sessions: null,
      engine,
      listen: (listen) => startAppServer({ ...http(limiters), api }, listen),
      worker: () => {
        throw new Error('This build has no database: the in-memory engine narrates inline (autoFlush). Give the config a dbUrl to run a worker.');
      },
      close: async () => {},
    };
  }

  const pool = createPool({ connectionString: config.dbUrl, applicationName: 'punkgrid-api' });
  const sessions = openSessions(pool, core);
  const api = new Api(new SessionRunner(sessions), unhandled(log));
  // The deployed shape: a second instance spends the same account allowance,
  // because the bucket is a row rather than a map (F-S6).
  const limiters: Limiters = { addresses, accounts: new PgTokenBucket(pool, ratePolicy) };
  return {
    auth,
    limiters,
    api,
    sessions,
    engine: null,
    listen: (listen) => startAppServer({ ...http(limiters), api }, listen),
    worker: () => narrationWorker(sessions, pool, log),
    close: () => pool.end().then(() => {}),
  };
}

export function buildWorker(config: WorkerConfig): WorkerHandle {
  const log = config.log ?? silent;
  const pool = createPool({ connectionString: config.dbUrl, applicationName: 'punkgrid-worker' });
  const sessions = openSessions(pool, engineCore(config));
  return { worker: narrationWorker(sessions, pool, log), close: () => pool.end().then(() => {}) };
}

/** The part of the configuration that decides how the engine behaves. Both the
 *  app and the worker pass it, so the two can never disagree about the pack, the
 *  prompt source, the id space or the daily budget. */
interface CoreInput extends Pick<AppConfig, 'seed' | 'pack' | 'provider' | 'now' | 'usdBudgetPerUserPerDay'> {}

interface Core {
  pack: RulePack;
  provider: NarrativeProvider;
  ids: (prefix: string) => ID;
  now: () => number;
  usdBudgetPerUserPerDay?: number;
}

function engineCore(config: CoreInput): Core {
  return {
    pack: config.pack ?? GLASS_HARBOR,
    provider: config.provider ?? new CompliantProvider(),
    ids: makeIdFactory(config.seed),
    now: config.now ?? Date.now,
    ...(config.usdBudgetPerUserPerDay === undefined ? {} : { usdBudgetPerUserPerDay: config.usdBudgetPerUserPerDay }),
  };
}

function openSessions(pool: PgPool, core: Core): Sessions {
  return new Sessions(new PgStore(pool), {
    pack: core.pack,
    provider: core.provider,
    ids: core.ids,
    now: core.now,
    // A command may not wait on a provider call (ADR-006); the worker narrates.
    autoFlush: false,
    ...(core.usdBudgetPerUserPerDay === undefined ? {} : { usdBudgetPerUserPerDay: core.usdBudgetPerUserPerDay }),
  });
}

function narrationWorker(sessions: Sessions, pool: PgPool, log: (line: string) => void): OutboxWorker {
  return new OutboxWorker({
    queue: new PgJobQueue(new PgStore(pool)),
    runWorld: (worldId) => sessions.forWorld(worldId, (engine) => engine.flush()),
    onError: (error, job) => log(`job ${job.id} world ${job.worldId} failed: ${String(error)}`),
  });
}

function unhandled(log: (line: string) => void): (error: unknown, req: { path: string }) => void {
  return (error, req) => log(`unhandled fault on ${req.path}: ${String(error)}`);
}

function silent(): void {}
