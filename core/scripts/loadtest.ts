// NFR-12: capacity, measured. Master §6 asks for a load test of 1 000 concurrent
// sessions with simulated generation, run with bounded workers — this file is
// that test, and the only thing it adds to the composition root is volume.
//
//   npm run loadtest                        # 1000 sessions, 64 workers, 4 beats
//   npm run loadtest -- --sessions=200 --workers=32 --rounds=2
//   npm run loadtest -- --db=<url to a scratch database, migrated first>
//
// One command, two processes: `--serve` builds the app and listens, and the
// client spawns it, so a saturated server never shares an event loop with the
// thing measuring it. What is on the path: the same `buildApp` the server and the
// security suite start, the same routes and bearer tokens, real sockets on an
// ephemeral port, and the `CompliantProvider` that stands in for a narration
// gateway (§10's payload without the invoice).
//
// Without `--db` the build is the in-memory one, and what is *not* on the path is
// PostgreSQL, a second API instance and a real model. It narrates inside the
// command, so those numbers are request-path capacity, not deployed ones.
//
// `--db=<url>` is the deployed shape: the same routes over `PgStore` and
// `SessionRunner`, a command that commits while its episode is still `pending`
// (ADR-006), and the outbox worker draining the queue in the server process. The
// sessions then poll for `published` the way the app does, and the run reports
// the time from commit to published prose as well — NFR-02 measured with the
// queue loaded, which the one-request-at-a-time measurement in
// `core/tests/pg.test.ts` cannot say. That build writes 1 000 accounts and
// 1 000 worlds, so point it at a database you are willing to fill, migrated
// first: `PUNKGRID_DB_URL=<url> npm run migrate`.
//
// The rate limiter is set above what the whole run can spend, on purpose: a
// limiter on the measured path would measure the limiter. Its own behaviour
// belongs to `core/tests/server.test.ts` and the shared-bucket block in
// `core/tests/pg.test.ts`. The large default is not tuning, it is a fact about
// this shape: every session connects from 127.0.0.1, and in the in-memory build
// the address and account buckets are the same map, so 1 000 sessions drain one
// shared bucket. An inline session spends 16 requests, a queued one many more
// because it polls for prose, so the production capacity of 30 answers 429 after
// the first thirty requests either way, and a capacity of 5 000 — the figure that
// first ran here — drains after roughly 300 inline sessions. Both measured.
// `--bucket=30` reproduces the guard: the run reports FAILED with 429s,
// which is the limiter doing its job, not a capacity result.

import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defaultSeed } from '../src/domain.js';
import { buildApp } from '../src/server/app.js';

const SECRET = 'loadtest-secret-never-use-this-anywhere-real';
// The budget NFR-01 sets for a GET. Asserted, so a run that is fast enough to
// finish but too slow to serve is a failure rather than a printed number.
const NFR01_GET_P95_MS = 500;
// The budget NFR-02 sets for the first scene: p75 from commit to published prose.
// Asserted in the queued build only, because that is where the wait is a queue
// rather than a provider call inside the command.
const NFR02_PUBLISH_P75_MS = 20_000;
// The app's own cadence, from `pollEpisode` in `apps/mobile/src/lib/api.ts:303`:
// 1 200 ms between reads, 120 s of patience. The load has to spend the reads a
// real client spends — a tighter loop here would be measuring the instrument,
// and a 100 ms poll turned one 1 000 session run into 140 000 requests.
const POLL_MS = 1_200;
const POLL_DEADLINE_MS = 120_000;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface Options {
  sessions: number;
  workers: number;
  rounds: number;
  port: number;
  bucket: number;
  /** Set with `--db=<url>`: run the deployed shape (PostgreSQL canon, narration
   *  through the outbox worker) instead of the in-memory one. */
  dbUrl: string | null;
  /** Seed the id space mints from, and the tag every account and intent id
   *  carries. Fresh per run by design: `AppConfig.seed` says a process must not
   *  reuse a previous process's seed against a database that still holds those
   *  rows, and a repeat run against the same database would otherwise collide on
   *  both the ids it mints and the one-active-world-per-account limit. Give
   *  `--seed=` and `--run=` together for a reproducible run. */
  seed: number;
  run: string;
  /** Set by the client on the `--serve` child: exit when that process is gone. */
  parentPid: number | null;
}

function parseArgs(argv: string[]): Options {
  const read = (name: string, fallback: number): number => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    if (!hit) return fallback;
    const n = Number(hit.slice(name.length + 3));
    if (!Number.isFinite(n) || n < 0) throw new Error(`--${name} wants a non-negative integer, got ${hit}`);
    return Math.trunc(n);
  };
  const text = (name: string, fallback: string): string =>
    argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
  const seed = read('seed', defaultSeed());
  return {
    sessions: read('sessions', 1000),
    workers: read('workers', 64),
    rounds: read('rounds', 4),
    port: read('port', 0),
    // Default: more tokens than the whole run can spend, so the guard is provably
    // not what answers. `--bucket=30` reproduces the production policy instead.
    bucket: read('bucket', 200_000),
    dbUrl: argv.find((a) => a.startsWith('--db='))?.slice('--db='.length) ?? null,
    seed,
    run: text('run', seed.toString(36).slice(-6)),
    parentPid: read('parent', 0) || null,
  };
}

/** The account and intent ids of one run. Per-run for the reason in `Options`. */
function accountId(opts: Options, index: number): string {
  return `user_load_${opts.run}_${index}`;
}

/** The process under test: the same composition root `serve.ts` starts, with the
 *  load's accounts registered. */
async function serve(opts: Options): Promise<void> {
  if (opts.parentPid) watchParent(opts.parentPid);
  const app = buildApp({
    secret: SECRET,
    seed: opts.seed,
    devUserIds: Array.from({ length: opts.sessions }, (_, i) => accountId(opts, i)),
    rateLimit: { capacity: opts.bucket, refillPerMinute: opts.bucket },
    // `buildApp` logs three kinds of line: one per response, shaped `<requestId>
    // <status>` (`http.ts:212`), one per failed job, and one per unhandled fault
    // with the error's own text (`app.ts:189`, `:194`). The first is a write on
    // the measured path for every request of the run, so it stays silent; the
    // other two are what a 5xx in this report is made of, and on a clean run they
    // are absent. Forwarding only those turns a FAILED verdict into a diagnosis
    // without moving the numbers.
    log: (line) => {
      if (!/ \d{3}$/.test(line)) console.error(`[server] ${line}`);
    },
    ...(opts.dbUrl ? { dbUrl: opts.dbUrl } : {}),
  });
  const server = await app.listen({ port: opts.port, host: '127.0.0.1' });
  console.log(`PunkGrid API on ${server.url}`);
  if (app.sessions) {
    // The deployed shape keeps prose out of the command (ADR-006), so without a
    // drainer in this process every episode would sit `pending` forever. `serve.ts`
    // does the same; a separate worker process is what the second instance is for.
    const worker = app.worker();
    void worker.run();
  }
}

function spawnServer(opts: Options): ChildProcess {
  const args = [
    fileURLToPath(import.meta.url),
    '--serve',
    `--sessions=${opts.sessions}`,
    `--bucket=${opts.bucket}`,
    `--seed=${opts.seed}`,
    `--run=${opts.run}`,
    `--parent=${process.pid}`,
  ];
  if (opts.dbUrl) args.push(`--db=${opts.dbUrl}`);
  return spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'inherit'] });
}

/** Windows gives the child no process group to belong to, and a client that is
 *  killed hard runs no cleanup of its own — so the server watches the pid that
 *  started it and leaves with it. `process.kill(pid, 0)` is measured here to be a
 *  pure existence check (it does not terminate the target), and only `ESRCH`
 *  counts as gone: a protected-but-live pid must not end the run. An orphaned
 *  `--serve` otherwise keeps a port, a pool and an outbox worker pointed at the
 *  same database as the next measurement. */
function watchParent(pid: number): void {
  const timer = setInterval(() => {
    try {
      process.kill(pid, 0);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ESRCH') process.exit(0);
    }
  }, 1_000);
  timer.unref();
}

/** `serve` prints one line and then stays up. Fail loudly if it dies before it
 *  says anything, rather than let the client time out a thousand times. */
function waitForUrl(child: ChildProcess, ms = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error(`the server process did not answer within ${ms} ms`)), ms);
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      buffer += chunk;
      const url = /PunkGrid API on (http:\/\/\S+)/.exec(buffer)?.[1];
      if (url) {
        clearTimeout(timer);
        child.stdout?.removeAllListeners('data');
        resolve(url);
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`the server process exited with ${String(code)} before it served: ${buffer.trim()}`));
    });
  });
}

/** Route shape, so 1 000 worlds do not become 1 000 histogram buckets. */
function template(path: string): string {
  return path.replace(/\/worlds\/[^/]+/, '/worlds/:id').replace(/\/episodes\/[^/]+/, '/episodes/:id');
}

interface Sample {
  ms: number;
  status: number;
  requestId: boolean;
  get: boolean;
}

class Ledger {
  private readonly samples = new Map<string, Sample[]>();

  record(method: string, path: string, sample: Sample): void {
    const key = `${method} ${template(path)}`;
    const list = this.samples.get(key);
    if (list) list.push(sample);
    else this.samples.set(key, [sample]);
  }

  get count(): number {
    return [...this.samples.values()].reduce((n, s) => n + s.length, 0);
  }

  get all(): Sample[] {
    return [...this.samples.values()].flat();
  }

  static percentileOf(values: number[], p: number): number {
    if (values.length === 0) return NaN;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
  }

  /** Not `Math.max(...values)`: a spread of the 140 000 samples a queued 1 000
   *  session run produces overflows the argument list. */
  static maxOf(values: number[]): number {
    let max = NaN;
    for (const v of values) if (!(v <= max)) max = v;
    return max;
  }

  report(): void {
    console.log('route'.padEnd(34) + 'n'.padStart(7) + ' p50 ms'.padStart(9) + ' p95 ms'.padStart(9) + ' p99 ms'.padStart(9) + ' max'.padStart(9));
    for (const key of [...this.samples.keys()].sort()) {
      const ms = this.samples.get(key)!.map((s) => s.ms);
      console.log(
        key.padEnd(34) +
          String(ms.length).padStart(7) +
          Ledger.percentileOf(ms, 50).toFixed(1).padStart(9) +
          Ledger.percentileOf(ms, 95).toFixed(1).padStart(9) +
          Ledger.percentileOf(ms, 99).toFixed(1).padStart(9) +
          Ledger.maxOf(ms).toFixed(1).padStart(9),
      );
    }
  }
}

async function drive(opts: Options, base: string): Promise<void> {
  const ledger = new Ledger();
  let next = 0;
  const failures: string[] = [];
  // The number NFR-12 actually asks for is concurrency, and 64 workers is not
  // 64 open requests — a session waits on its own responses. Counting the real
  // in-flight high-water mark says what the sockets carried instead of what the
  // pool was sized at.
  let inFlight = 0;
  let peak = 0;
  const queued = opts.dbUrl !== null;
  // Commit → published prose, per episode. This is the app's own wait, and in the
  // inline build it is ~0 by construction: the command narrates before it answers.
  const publishes: number[] = [];
  // The poll loop is traffic the inline build never generates, and it is most of
  // the request count in the queued one, so it is counted separately and the
  // throughput line says which.
  let polls = 0;

  /** Read the episode until prose exists, the way `apps/mobile/src/lib/play.ts`
   *  polls it. A `fallback` counts as settled: NFR-02 budgets the wait for *a*
   *  scene, and the templated scene is the documented answer when a provider fails. */
  async function publishedAt(token: string, worldId: string, episodeId: string, committedAt: number): Promise<number> {
    let reads = 0;
    for (;;) {
      reads += 1;
      const episode = await call('GET', `/v1/worlds/${worldId}/episodes/${episodeId}`, token);
      const waited = performance.now() - committedAt;
      // The first read is the one the inline build spends too; only what comes
      // after it is the queue being waited on.
      if (episode.status === 'published' || episode.status === 'fallback') {
        polls += reads - 1;
        return waited;
      }
      if (waited > POLL_DEADLINE_MS) {
        throw new Error(`episode ${episodeId} is still ${String(episode.status)} after ${waited.toFixed(0)} ms`);
      }
      await sleep(POLL_MS);
    }
  }

  async function call(
    method: 'GET' | 'POST',
    path: string,
    token: string | null,
    body?: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<Record<string, any>> {
    const headers: Record<string, string> = { 'x-request-id': `req_load_${ledger.count + 1}` };
    if (token) headers.authorization = `Bearer ${token}`;
    if (body) headers['content-type'] = 'application/json';
    // The app sends the intent id in both places (§11); a mutation without the
    // header is refused with 400, so the load has to carry it like a real client.
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
    const started = performance.now();
    inFlight += 1;
    if (inFlight > peak) peak = inFlight;
    let res: Response;
    try {
      res = await fetch(base + path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    } catch (e) {
      inFlight -= 1;
      ledger.record(method, path, { ms: performance.now() - started, status: 0, requestId: false, get: method === 'GET' });
      throw new Error(`${method} ${path} never answered: ${String(e)}`);
    }
    const ms = performance.now() - started;
    const text = await res.text();
    inFlight -= 1;
    ledger.record(method, path, {
      ms,
      status: res.status,
      requestId: res.headers.get('x-request-id') !== null,
      get: method === 'GET',
    });
    if (res.status === 429) {
      throw new Error(`${method} ${path} → 429: the limiter answered (capacity ${opts.bucket}, one shared bucket for every loopback address)`);
    }
    if (res.status >= 400) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 120)}`);
    return text.length > 0 ? (JSON.parse(text) as Record<string, any>) : {};
  }

  /** One player's session, in the order the app takes it. */
  async function session(index: number): Promise<void> {
    const userId = accountId(opts, index);
    const signed = await call('POST', '/dev/token', null, { userId });
    const token = String(signed.token);
    const createId = `gen_${opts.run}_${index}`;
    const world = await call(
      'POST',
      '/v1/worlds',
      token,
      { schemaVersion: '1.0', commandId: createId, mode: 'create', templateId: 'glass-harbor-2034' },
      createId,
    );
    const worldId = String(world.worldId);
    // The inline build owes the client prose in the command; the queued build
    // owes it a `pending` and a drainer, and either way the session ends up
    // reading a published episode.
    if (!queued && world.episodeStatus !== 'published') {
      throw new Error(`${userId}: the first episode is ${String(world.episodeStatus)}`);
    }
    publishes.push(await publishedAt(token, worldId, String(world.episodeId), performance.now()));
    const identityId = String((await call('GET', `/v1/worlds/${worldId}`, token)).identityId);
    for (let round = 0; round < opts.rounds; round += 1) {
      const open = await call('GET', `/v1/worlds/${worldId}`, token);
      const choices = open.choices as { choiceId: string }[];
      if (choices.length === 0) throw new Error(`${userId}: the world ran out of offered choices at beat ${round}`);
      const commandId = `cho_load_${index}_${round}`;
      const ack = await call(
        'POST',
        `/v1/worlds/${worldId}/choices`,
        token,
        {
          schemaVersion: '1.0',
          commandId,
          actorIdentityId: identityId,
          expectedWorldVersion: Number(open.stateVersion),
          choiceId: choices[round % choices.length]!.choiceId,
        },
        commandId,
      );
      const result = ack.commandResult as { newVersion: number; previousVersion: number };
      if (result.newVersion !== result.previousVersion + 1) {
        throw new Error(`${userId}: version went ${result.previousVersion} → ${result.newVersion}`);
      }
      publishes.push(await publishedAt(token, worldId, String(ack.episodeId), performance.now()));
    }
    await call('GET', `/v1/worlds/${worldId}/episodes`, token);
  }

  // The bounded pool NFR-12 asks for: `workers` tasks take the next session index
  // until none is left, rather than 1 000 promises opened at once.
  const running: Promise<void>[] = [];
  for (let w = 0; w < Math.min(opts.workers, opts.sessions); w += 1) {
    running.push(
      (async () => {
        for (;;) {
          const index = next;
          next += 1;
          if (index >= opts.sessions) return;
          try {
            await session(index);
          } catch (e) {
            failures.push(`session ${index}: ${(e as Error).message}`);
          }
        }
      })(),
    );
  }
  const wall = performance.now();
  await Promise.all(running);
  const elapsed = (performance.now() - wall) / 1000;

  const samples = ledger.all;
  const statusCounts = new Map<number, number>();
  for (const s of samples) statusCounts.set(s.status, (statusCounts.get(s.status) ?? 0) + 1);
  const fives = samples.filter((s) => s.status >= 500).length;
  const noId = samples.filter((s) => !s.requestId).length;
  const getMs = samples.filter((s) => s.get && s.status >= 200 && s.status < 300).map((s) => s.ms);

  console.log(`\n${opts.sessions} sessions × ${opts.rounds} beats, ${opts.workers} workers, server on ${base}`);
  console.log(`canon: ${queued ? `PostgreSQL at ${opts.dbUrl}, narration through the outbox worker in the server process` : 'in-memory (single process), narration inside the command'}`);
  console.log(`rate limiter: capacity ${opts.bucket}, refill ${opts.bucket}/min, one shared bucket for every loopback address`);
  console.log(`${ledger.count} requests in ${elapsed.toFixed(1)} s = ${(ledger.count / elapsed).toFixed(0)} req/s, ${(opts.sessions / elapsed).toFixed(1)} sessions/s${queued ? ` (${polls} of those requests are the poll loop waiting for the queue)` : ''}`);
  console.log(`peak concurrent requests on the server: ${peak} (the pool holds ${Math.min(opts.workers, opts.sessions)} sessions at a time)`);
  console.log(`status: ${[...statusCounts.entries()].sort((a, b) => a[0] - b[0]).map(([c, n]) => `${c}×${n}`).join('  ')}`);
  ledger.report();
  console.log(
    queued
      ? 'PostgreSQL canon and a queued outbox on loopback, one API process and one drainer: deployed shape, one machine, and no real model.'
      : 'In-memory canon, loopback, one process: request-path capacity, not deployed capacity.',
  );

  // NFR-02 is the wait the queue owes the player, so it is only measured and
  // asserted where a queue exists. In the inline build the same read happens
  // after the prose already exists — the narration was inside the command — and
  // the line says so rather than printing a budget the build cannot miss.
  const publishP75 = Ledger.percentileOf(publishes, 75);
  const publishNumbers =
    `p50 ${Ledger.percentileOf(publishes, 50).toFixed(1)} ms, p75 ${publishP75.toFixed(1)} ms, ` +
    `p95 ${Ledger.percentileOf(publishes, 95).toFixed(1)} ms, ` +
    `max ${publishes.length ? Ledger.maxOf(publishes).toFixed(1) : 'n/a'} ms over ${publishes.length} episodes`;
  const publishSummary = queued
    ? `commit → read as published (NFR-02 budget p75 <${NFR02_PUBLISH_P75_MS} ms; quantised to the ${POLL_MS} ms poll the client waits on, so this is an upper bound on the queue): ${publishNumbers}`
    : `read of an episode the command already narrated (no queue in this build): ${publishNumbers}`;
  console.log(publishSummary);

  const problems = [...failures];
  if (fives > 0) problems.push(`${fives} responses were 5xx`);
  if (noId > 0) problems.push(`${noId} responses carried no x-request-id (NFR-09)`);
  const p95 = Ledger.percentileOf(getMs, 95);
  const getSummary =
    `GET (NFR-01 budget p95 <${NFR01_GET_P95_MS} ms): p50 ${Ledger.percentileOf(getMs, 50).toFixed(1)} ms, ` +
    `p95 ${Ledger.percentileOf(getMs, 95).toFixed(1)} ms, max ${getMs.length ? Ledger.maxOf(getMs).toFixed(1) : 'n/a'} ms`;
  // A capacity figure that misses the latency budget is not a pass, so NFR-01 is
  // asserted here rather than printed and hoped over.
  if (p95 >= NFR01_GET_P95_MS) {
    problems.push(`NFR-01: ${getSummary} at ${peak} concurrent requests`);
  }
  if (queued && publishP75 >= NFR02_PUBLISH_P75_MS) {
    problems.push(`NFR-02: ${publishSummary} with ${peak} concurrent requests`);
  }
  console.log(getSummary);
  if (problems.length > 0) {
    console.error(`\nFAILED (${problems.length}):`);
    for (const p of problems.slice(0, 20)) console.error(`  ${p}`);
    if (problems.length > 20) console.error(`  … and ${problems.length - 20} more`);
    process.exitCode = 1;
  } else {
    console.log('\nPASSED: every session finished, no 5xx, every response carries a request id, GET p95 inside budget.');
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (process.argv.includes('--serve')) return serve(opts);
  const child = spawnServer(opts);
  // Windows gives the child no process group of its own, so a client that is
  // interrupted leaves its `--serve` behind: a live API and outbox worker on a
  // port and a database the next run does not know about. Killing on `exit` and
  // on the signals we can see is the only cleanup that happens.
  const killChild = (): void => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  };
  process.on('exit', killChild);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      killChild();
      process.exit(signal === 'SIGINT' ? 130 : 143);
    });
  }
  try {
    await drive(opts, await waitForUrl(child));
  } finally {
    killChild();
  }
}

main().catch((e) => {
  console.error(`load test stopped: ${(e as Error).stack ?? e}`);
  process.exitCode = 1;
});
