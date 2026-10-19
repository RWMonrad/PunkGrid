// Kjører målingen mot en tjener som er startet i denne prosessen og derfor har
// et tomt kanon: målingen oppretter verdens sin egen, og et gjenbruk av en
// allerede opprettet verden ville gjort biblioteksdøra borte.
//
// Kjør fra repo-rot: node docs/qa/harness/run-native.mjs
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const port = 3120;
const srv = spawn(process.execPath, ['dist/core/scripts/serve.js'], {
  env: {
    ...process.env,
    PUNKGRID_DEV_SECRET: randomBytes(32).toString('hex'),
    PUNKGRID_PORT: String(port),
    PUNKGRID_HOST: '0.0.0.0',
    PUNKGRID_DEV_USERS: 'user_demo',
    PUNKGRID_SEED: '20261015',
  },
  stdio: ['ignore', 'inherit', 'inherit'],
});

const up = async () => {
  for (let i = 0; i < 30; i += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) return true;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return false;
};

if (!(await up())) {
  console.error('the isolated server never answered /healthz');
  srv.kill();
  process.exit(1);
}

const script = process.env.PUNKGRID_TARGET ?? 'docs/qa/harness/native-check-adr022-023.mjs';
let code = 0;
try {
  execFileSync(process.execPath, [script], {
    stdio: 'inherit',
    env: {
      ...process.env,
      // 10.0.2.2 er vertens eget grensesnitt sett fra emulatoren; måling som
      // kjøres på verten snakker til 127.0.0.1.
      PUNKGRID_BASE_URL: process.env.PUNKGRID_BASE_URL ?? (script.includes('api-check') ? `http://127.0.0.1:${port}` : 'http://10.0.2.2:3120'),
    },
  });
} catch (e) {
  code = e.status ?? 1;
}
srv.kill();
process.exit(code);
