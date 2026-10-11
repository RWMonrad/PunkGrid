// Connection plumbing for the Postgres-backed store.
// A single search_path is pinned on every pooled connection so the application
// role can never accidentally read or write the public schema (contract 3), and
// so trigger and policy functions resolve the same objects the DDL created.

import { Pool } from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { DB } from './schema.js';

/** The pooled connection type the persistence modules accept. */
export type PgPool = Pool;

export interface DbOptions {
  connectionString: string;
  maxConnections?: number;
  applicationName?: string;
  /** Role to assume for every connection (SET ROLE). Used to exercise the
   *  NOLOGIN application roles without a separate login. */
  assumeRole?: string;
}

export function createPool(opts: DbOptions): PgPool {
  const params = ['-c search_path=punkgrid,public'];
  if (opts.assumeRole) params.push(`-c role=${quoteIdent(opts.assumeRole)}`);
  return new Pool({
    connectionString: addOptions(opts.connectionString, params.join(' ')),
    max: opts.maxConnections ?? 10,
    application_name: opts.applicationName ?? 'punkgrid-core',
  });
}

/** Startup parameters are applied by the server before the first statement. A
 *  connect listener would race the borrower's first query, which is how a
 *  trigger body ends up resolving an unqualified name against the wrong schema. */
function addOptions(connectionString: string, options: string): string {
  const sep = connectionString.includes('?') ? '&' : '?';
  return `${connectionString}${sep}options=${encodeURIComponent(options)}`;
}

export function createDb(opts: DbOptions): Kysely<DB> {
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool: createPool(opts) }) });
}

/** A bare owner connection used only by the migration runner; the application
 *  never receives one. */
export function createAdminPool(connectionString: string): PgPool {
  return new Pool({ connectionString, max: 1, application_name: 'punkgrid-migrate' });
}

function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`unsafe role name: ${name}`);
  return `"${name}"`;
}
