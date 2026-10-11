// Migration runner.
// There is no psql on this host, and the deploy target (Supabase) is reached
// over the wire, so migrations are applied from Node. Each file runs as one
// transaction and is recorded with a SHA-256 of its contents: re-running is a
// no-op, and editing an already-applied file is a hard error rather than a
// silent skip (contract 3 — schema changes are versioned and ordered).

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PgPool } from './client.js';


export interface MigrationRecord {
  name: string;
  applied: boolean;
  checksum: string;
}

export interface MigrationState {
  dir: string;
  files: string[];
  records: MigrationRecord[];
}

const LEDGER = 'public.punkgrid_migrations';

async function ensureLedger(pool: PgPool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${LEDGER} (
      name        TEXT PRIMARY KEY,
      checksum    TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

/** Normalise line endings before hashing so a CRLF checkout on Windows does not
 *  read as a schema change. */
export function checksum(sql: string): string {
  return 'sha256:' + createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}

export async function pendingMigrations(pool: PgPool, dir: string): Promise<MigrationState> {
  await ensureLedger(pool);
  const entries = await readdir(dir);
  const files = entries.filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
  const { rows } = await pool.query(`SELECT name, checksum FROM ${LEDGER}`);
  const applied = new Map<string, string>(rows.map((r) => [r.name as string, r.checksum as string]));

  const records: MigrationRecord[] = [];
  for (const file of files) {
    const sql = await readFile(join(dir, file), 'utf8');
    const sum = checksum(sql);
    const prior = applied.get(file);
    if (prior && prior !== sum) {
      throw new Error(`Migration ${file} has changed since it was applied (${prior} -> ${sum}). Add a new migration instead.`);
    }
    records.push({ name: file, applied: Boolean(prior), checksum: sum });
  }
  return { dir, files, records };
}

/** Applies every not-yet-recorded migration in filename order. */
export async function migrate(pool: PgPool, dir: string): Promise<MigrationRecord[]> {
  const state = await pendingMigrations(pool, dir);
  for (const record of state.records) {
    if (record.applied) continue;
    const sql = await readFile(join(dir, record.name), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        `INSERT INTO ${LEDGER} (name, checksum) VALUES ($1, $2)`,
        [record.name, record.checksum],
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${record.name} failed: ${(e as Error).message}`);
    } finally {
      client.release();
    }
  }
  return state.records;
}

/** Default migration directory. Walks up from this module until the DDL folder
 *  is found, because the compiled file sits at a different depth than the
 *  source. PUNKGRID_MIGRATIONS_DIR overrides it for containerised deploys. */
export function defaultMigrationDir(): string {
  const override = process.env.PUNKGRID_MIGRATIONS_DIR;
  if (override) return override;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dir, 'docs', 'architecture', 'migrations');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not locate docs/architecture/migrations; set PUNKGRID_MIGRATIONS_DIR.');
}
