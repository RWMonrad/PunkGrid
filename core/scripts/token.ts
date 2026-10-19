// Mints a development bearer token locally, for a client that cannot reach the
// sign-in route (or a run where it is switched off). Prints the token only, so
// the output can be pasted straight into an app config.
//
//   PUNKGRID_DEV_SECRET  required, the same secret the server runs with
//   node dist/core/scripts/token.js <userId> [ttlHours]

import { issueDevToken } from '../src/server/auth.js';

const userId = process.argv[2];
if (!userId) {
  console.error('usage: token <userId> [ttlHours]');
  process.exit(2);
}
const secret = process.env.PUNKGRID_DEV_SECRET;
if (!secret) {
  console.error('PUNKGRID_DEV_SECRET is not set.');
  process.exit(2);
}
const ttlHours = Number(process.argv[3] ?? NaN);

console.log(issueDevToken(secret, userId, Number.isFinite(ttlHours) ? { ttlMs: ttlHours * 3600_000 } : {}));
