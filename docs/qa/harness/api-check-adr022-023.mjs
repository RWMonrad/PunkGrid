// Måler ADR-022 og ADR-023 over den faktige HTTP-transporten mot en kørende tjener.
// Skriver ingen filer og printer ingen token. Kjør:
//   PUNKGRID_BASE_URL=http://127.0.0.1:3120 node docs/qa/harness/api-check-adr022-023.mjs
import process from 'node:process';

const base = process.env.PUNKGRID_BASE_URL ?? 'http://127.0.0.1:3120';
const userId = process.env.PUNKGRID_DEV_USERS ?? 'user_demo';
const line = (s) => process.stdout.write(`${s}\n`);

async function call(method, path, body, token, key) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (key) headers['Idempotency-Key'] = key;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(key ? { commandId: key, ...body } : body) } : {}),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const token = (await call('POST', '/dev/token', { userId })).json.token;
if (!token) throw new Error('no dev token from the isolated server');

// ADR-023: the era and role the player chose open the world.
const cmd = `era_${Date.now().toString(36)}`;
const created = await call('POST', '/v1/worlds', {
  mode: 'create', templateId: 'glass-harbor-2034',
  setting: { era: '1888', location: 'copenhagen', role: 'investigator', flags: [] },
}, token, cmd);
line(`POST /v1/worlds -> ${created.status} ${created.json.error?.code ?? ''}`);
const worldId = created.json.worldId;
const view = await call('GET', `/v1/worlds/${worldId}`, null, token);
const world = view.json;
line(`GET  /v1/worlds/{id} -> ${view.status} worldTime=${world.world?.worldTime} version=${world.stateVersion}`);
line(`  offers: ${(world.choices ?? []).length} [${(world.choices ?? []).map((c) => c.choiceId).join(', ')}]`);
if (world.world?.worldTime !== '1888-09-15T09:00:00.000Z') {
  throw new Error(`ADR-023 HTTP FAIL: worldTime ${world.world?.worldTime}`);
}
const identityId = world.identityId;
let issuedIds = (world.choices ?? []).map((c) => c.choiceId);
if (issuedIds.length > 4) throw new Error(`ADR-022 HTTP FAIL: ${issuedIds.length} offers in one scene`);

// The episode the scene was built from carries the same issue list.
const ep = await call('GET', `/v1/worlds/${worldId}/episodes/${created.json.episodeId}`, null, token);
const episode = ep.json.episode ?? {};
line(`GET  episode -> ${ep.status} status=${ep.json.status} prose=${(episode.content ?? '').length} chars allowed=${JSON.stringify(episode.allowedChoiceIds ?? [])}`);

// ADR-022: a choice the server trimmed away does not exist for the player.
const unissued = ['investigate_buyer', 'confront_mara', 'open_negotiation', 'brief_staff', 'reject_sale']
  .find((id) => !issuedIds.includes(id));
if (unissued) {
  const bad = await call('POST', `/v1/worlds/${worldId}/choices`, {
    expectedWorldVersion: world.stateVersion, actorIdentityId: identityId, choiceId: unissued,
  }, token, `bad_${Date.now().toString(36)}`);
  line(`POST unissued ${unissued} -> ${bad.status} ${bad.json.error?.code ?? ''}/${bad.json.error?.details?.ruleCode ?? ''}`);
  if (bad.status !== 422 || !['CHOICE_NOT_OFFERED', 'RULE_PRECONDITION_FAILED'].includes(bad.json.error?.details?.ruleCode ?? '')) {
    throw new Error(`ADR-022 HTTP FAIL: unissued ${unissued} returned ${bad.status}`);
  }
}

// Play the scene the way the app does and watch the interval hold.
let v = world.stateVersion;
const perTurn = [issuedIds.length];
for (let i = 0; i < 6; i += 1) {
  const w = await call('GET', `/v1/worlds/${worldId}`, null, token);
  const offers = (w.json.choices ?? []).map((c) => c.choiceId);
  perTurn.push(offers.length);
  if (!offers.length) break;
  const r = await call('POST', `/v1/worlds/${worldId}/choices`, {
    expectedWorldVersion: w.json.stateVersion, actorIdentityId: identityId, choiceId: offers[0],
  }, token, `play_${i}_${Date.now().toString(36)}`);
  line(`  turn ${i + 1}: ${offers[0]} -> ${r.status} ${r.json.error?.code ?? ''}/${r.json.error?.details?.ruleCode ?? ''}, scene had ${offers.length} offers`);
  if (r.status >= 500) throw new Error(`server error on turn ${i + 1}: ${r.status}`);
  v = w.json.stateVersion;
}
line(`offers per turn: ${perTurn.join(', ')}`);
if (perTurn.some((n) => n > 4)) throw new Error('ADR-022 HTTP FAIL: a scene exceeded max');
line(`last version read: ${v}`);
line('OK: ADR-022 and ADR-023 hold over HTTP.');
