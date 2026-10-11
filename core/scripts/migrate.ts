// Applies the SQL migrations to the database named by PUNKGRID_DB_URL.
// PUNKGRID_DB_URL is a DATABASE URL (not an arbitrary connection expression).

import { createAdminPool } from '../src/db/client.js';
import { defaultMigrationDir, migrate, pendingMigrations } from '../src/db/migrate.js';

const url = process.env.PUNKGRID_DB_URL;
if (!url) {
  console.error('PUNKGRID_DB_URL is not set.');
  process.exit(2);
}

const pool = createAdminPool(url);
const dir = defaultMigrationDir();
try {
  if (process.argv[2] === '--dry-run') {
    const state = await pendingMigrations(pool, dir);
    for (const r of state.records) console.log(`${r.applied ? 'applied ' : 'pending  '} ${r.name}  ${r.checksum.slice(0, 18)}…`);
  } else {
    const records = await migrate(pool, dir);
    for (const r of records) console.log(`${r.applied ? 'ok (already applied)' : 'migrated  '} ${r.name}`);
    console.log(`\n${records.filter((r) => !r.applied).length} migration(s) applied, ${dir}`);
  }
} finally {
  await pool.end();
}
