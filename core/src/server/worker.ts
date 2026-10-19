// Outbox worker: the narration side of ADR-006.
//
// A command commits canonical state and leaves an outbox job; this loop claims
// jobs and narrates them afterwards, so the API response never waits on an AI
// call and a slow or dead provider cannot delay a commit. One process runs one
// sequential claim loop: Postgres serialises the worlds with an advisory lock,
// so parallelism is a throughput choice, not a correctness one, and it stays out
// of the alpha until there is evidence that it is needed.

import type { PgStore } from '../db/pgStore.js';
import type { ID } from '../domain.js';

export interface NarrationJob {
  id: string;
  worldId: ID;
  episodeId: ID;
  kind: string;
}

export type JobOutcome = 'completed' | 'retry' | 'failed';

export interface JobQueue {
  /** Atomically take the next unclaimed job, or null when the queue is empty. */
  claim(): Promise<NarrationJob | null>;
  finish(id: string, outcome: JobOutcome): Promise<void>;
}

export class PgJobQueue implements JobQueue {
  constructor(private readonly pg: PgStore) {}
  claim(): Promise<NarrationJob | null> {
    return this.pg.claimJob();
  }
  finish(id: string, outcome: JobOutcome): Promise<void> {
    return this.pg.finishJob(id, outcome);
  }
}

export interface WorkerOptions {
  queue: JobQueue;
  /** Narrate everything this world has pending. Idempotent: a job that is
   *  claimed twice after a crash finds its episode already published, and
   *  flushing a world whose outbox is settled writes nothing. */
  runWorld(worldId: ID): Promise<void>;
  onError(error: unknown, job: NarrationJob): void;
  /** Stop after this many jobs; a test or a cron tick uses a bounded pass. */
  maxJobs?: number;
  /** Pause between passes when the queue is empty. */
  idleDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface DrainReport {
  completed: number;
  /** Jobs put back for another attempt. The queue, not the worker, decides when
   *  a job is exhausted and becomes `failed`. */
  retried: number;
}

export class OutboxWorker {
  private readonly maxJobs: number;
  private readonly idleDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private stopped = false;

  constructor(private readonly opts: WorkerOptions) {
    this.maxJobs = opts.maxJobs ?? 100;
    this.idleDelayMs = opts.idleDelayMs ?? 500;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** One bounded pass over the queue. */
  async drain(): Promise<DrainReport> {
    const report: DrainReport = { completed: 0, retried: 0 };
    for (let taken = 0; taken < this.maxJobs; taken += 1) {
      const job = await this.opts.queue.claim();
      if (!job) break;
      try {
        await this.opts.runWorld(job.worldId);
        await this.opts.queue.finish(job.id, 'completed');
        report.completed += 1;
      } catch (e) {
        this.opts.onError(e, job);
        // A provider failure is already handled inside flush (one retry, then
        // templated fallback), so reaching here means the unit of work failed —
        // the commit rolled back and the world is unchanged. Retry unless the
        // row has spent its attempts.
        await this.opts.queue.finish(job.id, 'retry');
        report.retried += 1;
      }
    }
    return report;
  }

  /** Long-running loop; returns when stop() is called. */
  async run(): Promise<void> {
    while (!this.stopped) {
      const report = await this.drain();
      if (report.completed + report.retried === 0) await this.sleep(this.idleDelayMs);
    }
  }

  stop(): void {
    this.stopped = true;
  }
}
