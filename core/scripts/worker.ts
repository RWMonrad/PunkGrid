// Runs the outbox drain as its own process: claims narration jobs, narrates the
// world each belongs to, and closes the job. Canonical state is written only by
// the API's command transactions, so this process can be restarted or scaled
// without changing what the simulation means (ADR-006). A crash between passes
// loses nothing: the job lease expires and the row becomes claimable again.
//
//   PUNKGRID_DB_URL      required
//   PUNKGRID_SEED        default fresh per start
//   PUNKGRID_BUDGET_USD  optional FR-13 daily cap per user
//   PUNKGRID_AI_BASE_URL / _API_KEY / _MODEL   optional gateway; this process is
//                       the one that calls it, so set them here for real prose

import { createAdminPool } from '../src/db/client.js';
import { defaultMigrationDir, pendingMigrations } from '../src/db/migrate.js';
import { defaultSeed } from '../src/domain.js';
import { providerFromEnv } from '../src/ai/env.js';
import { buildWorker } from '../src/server/app.js';

const dbUrl = process.env.PUNKGRID_DB_URL;
if (!dbUrl) {
  console.error('PUNKGRID_DB_URL is not set. The worker only runs against the canonical database.');
  process.exit(2);
}
await assertMigrationsApplied(dbUrl);

const budget = Number(process.env.PUNKGRID_BUDGET_USD ?? NaN);
const ai = providerFromEnv();
const handle = buildWorker({
  dbUrl,
  seed: Number(process.env.PUNKGRID_SEED ?? defaultSeed()),
  provider: ai.provider,
  ...(Number.isFinite(budget) ? { usdBudgetPerUserPerDay: budget } : {}),
  log: (line) => console.log(line),
});

console.log('PunkGrid narration worker: draining outbox');
console.log(`  narration: ${ai.description}`);
const running = handle.worker.run();
const stop = () => {
  handle.worker.stop();
  void running.finally(() => handle.close()).then(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
await running;

async function assertMigrationsApplied(url: string): Promise<void> {
  const pool = createAdminPool(url);
  try {
    const { records } = await pendingMigrations(pool, defaultMigrationDir());
    const pending = records.filter((r) => !r.applied);
    if (pending.length > 0) {
      console.error(`Schema is missing ${pending.length} migration(s): ${pending.map((m) => m.name).join(', ')}`);
      console.error('Run: npm run migrate');
      process.exit(2);
    }
  } finally {
    await pool.end();
  }
}
