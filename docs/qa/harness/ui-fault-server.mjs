import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { Engine } from '../../dist/core/src/engine.js';
import { GLASS_HARBOR } from '../../dist/core/src/glassHarbor.js';
import { CompliantProvider } from '../../dist/core/src/providers.js';
import { Api, InMemoryRunner } from '../../dist/core/src/api.js';
import { HmacDevAuth } from '../../dist/core/src/server/auth.js';
import { TokenBucket } from '../../dist/core/src/server/rateLimit.js';
import { startAppServer } from '../../dist/core/src/server/http.js';

const engine = new Engine(GLASS_HARBOR, new CompliantProvider(), { seed: Date.now(), autoFlush: false });
engine.registerUser('user_demo');
const secret = randomBytes(32).toString('hex');
const bucket = new TokenBucket({ capacity: 1000, refillPerMinute: 1000 });
const backend = await startAppServer({
  api: new Api(new InMemoryRunner(engine)), auth: new HmacDevAuth(secret),
  limiters: { addresses: bucket, accounts: bucket }, devAuth: { secret, userIds: ['user_demo'] },
});
let held = false;
let dropNext = false;
const requests = [];
const readBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
};
const status = () => ({
  held, dropNext, requests,
  worlds: [...engine.store.worlds.values()].map((w) => ({ id: w.id, status: w.status, version: w.stateVersion, replay: engine.verifyReplay(w.id).equal })),
  episodes: [...engine.store.episodes.values()].map((r) => ({ id: r.episode.id, version: r.episode.worldStateVersion, status: r.status })),
});
const proxy = createServer(async (req, res) => {
  const request = req.method === 'POST' ? { path: req.url, status: null } : null;
  if (request) requests.push(request);
  try {
    const body = await readBody(req);
    if (request) {
      const payload = body.length ? JSON.parse(body.toString()) : null;
      request.commandId = payload?.commandId;
      request.body = req.url === '/dev/token' ? undefined : payload;
    }
    const headers = { ...req.headers };
    delete headers.host;
    delete headers.connection;
    delete headers['content-length'];
    const response = await fetch(`${backend.url}${req.url}`, { method: req.method, headers, ...(body.length ? { body } : {}) });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (request) {
      request.status = response.status;
      if (response.ok && !held) await engine.flush();
      if (response.ok && dropNext && req.url?.endsWith('/choices')) {
        res.destroy();
        return;
      }
    }
    res.writeHead(response.status, { 'content-type': response.headers.get('content-type') ?? 'application/json' });
    res.end(bytes);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.writeHead(500);
    res.end('fixture failure');
  }
});
const control = createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/hold') held = true;
  else if (req.method === 'POST' && req.url === '/release') { held = false; await engine.flush(); }
  else if (req.method === 'POST' && req.url === '/drop-next') dropNext = true;
  else if (req.method === 'POST' && req.url === '/allow') dropNext = false;
  else if (req.method !== 'GET' || req.url !== '/status') { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(status()));
});
const apiPort = Number(process.env.PUNKGRID_FAULT_API_PORT ?? 3111);
const controlPort = Number(process.env.PUNKGRID_FAULT_CONTROL_PORT ?? 3112);
await new Promise((resolve, reject) => proxy.once('error', reject).listen(apiPort, '127.0.0.1', resolve));
await new Promise((resolve, reject) => control.once('error', reject).listen(controlPort, '127.0.0.1', resolve));
console.log(`Isolated UI fixture: API 127.0.0.1:${apiPort}, control 127.0.0.1:${controlPort}; in-memory state, deterministic provider, no database.`);
const close = async () => { proxy.close(); control.close(); await backend.close(); };
process.once('SIGTERM', close);
process.once('SIGINT', close);
