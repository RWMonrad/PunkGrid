// Starts the HTTP API. Reads configuration from the environment and changes
// nothing outside the process — it never migrates and never provisions a cloud
// service.
//
//   PUNKGRID_DEV_SECRET   required, >= 32 chars (openssl rand -hex 32)
//   PUNKGRID_PORT         default 3000
//   PUNKGRID_HOST         default 127.0.0.1 (use 0.0.0.0 for an emulator)
//   PUNKGRID_DB_URL       optional; absent = single-process in-memory canon
//   PUNKGRID_DEV_USERS    optional comma list; enables POST /dev/token for these ids
//   PUNKGRID_SEED         default fresh per start; set only for a reproducible run
//   PUNKGRID_BUDGET_USD   optional FR-13 daily cap per user
//   PUNKGRID_TRUST_PROXY  set 1 only behind one proxy you control, so the address
//                             bucket keys on x-forwarded-for instead of the socket
//   PUNKGRID_NO_WORKER    set 1 to keep narration out of this process
//   PUNKGRID_AI_BASE_URL / _API_KEY / _MODEL   optional gateway; without all
//                             three the process narrates with the deterministic
//                             fake provider and makes no paid request

import { createAdminPool } from '../src/db/client.js';
import { defaultMigrationDir, pendingMigrations } from '../src/db/migrate.js';
import { defaultSeed } from '../src/domain.js';
import { providerFromEnv } from '../src/ai/env.js';
import { buildApp } from '../src/server/app.js';

const secret = process.env.PUNKGRID_DEV_SECRET;
if (!secret) {
  console.error('PUNKGRID_DEV_SECRET is not set. Generate one with: openssl rand -hex 32');
  process.exit(2);
}
const port = Number(process.env.PUNKGRID_PORT ?? 3000);
const host = process.env.PUNKGRID_HOST ?? '127.0.0.1';
const dbUrl = process.env.PUNKGRID_DB_URL;
const devUserIds = (process.env.PUNKGRID_DEV_USERS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const budget = Number(process.env.PUNKGRID_BUDGET_USD ?? NaN);
const ai = providerFromEnv();

if (dbUrl) await assertSchemaCurrent();

const app = buildApp({
  secret,
  seed: Number(process.env.PUNKGRID_SEED ?? defaultSeed()),
  ...(dbUrl ? { dbUrl } : {}),
  ...(devUserIds.length ? { devUserIds } : {}),
  ...(Number.isFinite(budget) ? { usdBudgetPerUserPerDay: budget } : {}),
  ...(process.env.PUNKGRID_TRUST_PROXY === '1' ? { trustProxy: true } : {}),
  provider: ai.provider,
  log: (line) => console.log(line),
});

const server = await app.listen({ port, host });
console.log(`PunkGrid API on ${server.url}`);
console.log(`  canon: ${app.engine ? 'in-memory (single process)' : 'PostgreSQL'}`);
console.log(`  narration: ${ai.description}`);
console.log(`  sign-in: ${devUserIds.length ? `dev tokens for ${devUserIds.join(', ')}` : 'bearer tokens only (no /dev/token)'}`);
console.log(`  address bucket: ${process.env.PUNKGRID_TRUST_PROXY === '1' ? 'last hop of x-forwarded-for' : 'socket peer'}; account bucket: ${dbUrl ? 'shared in PostgreSQL' : 'this process only'}`);

let worker: ReturnType<typeof app.worker> | null = null;
if (app.sessions && process.env.PUNKGRID_NO_WORKER !== '1') {
  worker = app.worker();
  console.log('  narration worker: started in this process');
  void worker.run();
}

const stop = async () => {
  worker?.stop();
  await server.close();
  await app.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

/** The server has no migration path by design (an application role must not be
 *  able to alter its own schema), so it refuses to serve a database it would
 *  write into half-built tables. */
async function assertSchemaCurrent(): Promise<void> {
  const pool = createAdminPool(dbUrl!);
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
