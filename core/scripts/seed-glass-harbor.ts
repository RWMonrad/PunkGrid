// Seeds The Glass Harbor (contract section 12) and plays its canonical opening
// through the HTTP boundary, then reports the ledger, the state hash and the
// replay result. Deterministic: the same seed always produces the same hashes.
//
//   npm run seed

import { Engine } from '../src/engine.js';
import { Api } from '../src/api.js';
import { GLASS_HARBOR } from '../src/glassHarbor.js';
import { CompliantProvider } from '../src/providers.js';
import { membershipKey } from '../src/store.js';
import type { ID } from '../src/domain.js';

const SEED = 20261011;
const WALL_START = Date.parse('2026-10-11T12:00:00.000Z');

async function main() {
  const engine = new Engine(GLASS_HARBOR, new CompliantProvider(), { seed: SEED, now: () => WALL_START });
  const api = new Api(engine);
  const userId = engine.registerUser('user_demo');

  const line = (s = '') => process.stdout.write(s + '\n');
  const section = (title: string) => line(`\n${'='.repeat(72)}\n${title}\n${'='.repeat(72)}`);

  const call = async (method: 'GET' | 'POST', path: string, body: Record<string, unknown> = {}) => {
    const commandId = body.commandId as ID | undefined;
    const res = await api.handle({
      method, path, body,
      headers: commandId ? { 'idempotency-key': commandId } : {},
      actor: { userId },
    });
    if (res.status >= 400) {
      line(`!! ${method} ${path} -> ${res.status} ${JSON.stringify(res.body.error)}`);
      process.exitCode = 1;
    }
    return res.body;
  };

  section('1 — POST /v1/worlds (Create a Life, template glass-harbor-2034)');
  const created = await call('POST', '/v1/worlds', {
    schemaVersion: '1.0',
    commandId: engine.ids('cmd'),
    mode: 'create',
    templateId: 'glass-harbor-2034',
    setting: { era: '2034', location: 'singapore', role: 'founder-ceo', genre: 'speculative-corporate-mystery' },
  });
  const worldId = created.worldId as ID;
  let version = created.version as number;
  const identityId = engine.store.memberships.get(membershipKey(worldId, userId))!.identityId;
  line(`worldId=${worldId} version=${version} episodeStatus=${created.episodeStatus}`);

  const act = async (choiceId: string) => {
    const body = await call('POST', `/v1/worlds/${worldId}/choices`, {
      schemaVersion: '1.0', commandId: engine.ids('cmd'),
      actorIdentityId: identityId, expectedWorldVersion: version, choiceId,
    });
    version = (body.commandResult as { newVersion: number }).newVersion;
    line(`choice ${choiceId.padEnd(20)} -> version ${version}`);
  };

  section('2 — the opening decisions (contract section 12 premise)');
  await act('investigate_buyer');
  await act('confront_mara');
  await act('open_negotiation');
  await act('brief_staff');

  section('3 — surprise.request and one bounded catch-up resume');
  const surprise = await call('POST', `/v1/worlds/${worldId}/surprises`, {
    schemaVersion: '1.0', commandId: engine.ids('cmd'),
    actorIdentityId: identityId, expectedWorldVersion: version,
  });
  const surpriseResult = surprise.commandResult as { outcome: string; noOpReason?: string; newVersion: number };
  line(`surprise -> ${surpriseResult.outcome}${surpriseResult.noOpReason ? ` (${surpriseResult.noOpReason})` : ''}`);
  version = surpriseResult.newVersion;

  engine.advanceWall(540); // nine world-hours of wall time between visits
  const resumed = await call('POST', `/v1/worlds/${worldId}/resume`, {
    schemaVersion: '1.0', commandId: engine.ids('cmd'),
    actorIdentityId: identityId, expectedWorldVersion: version,
  });
  const resumeResult = resumed.commandResult as { outcome: string; newVersion: number; lastEventSequence: number | null };
  line(`resume -> ${resumeResult.outcome}, version ${resumeResult.newVersion}`);
  version = resumeResult.newVersion;

  section('4 — world view and the newest published episode');
  const view = await call('GET', `/v1/worlds/${worldId}`);
  const worldView = view as { stateVersion: number; summary: { worldTime: string; resources: Record<string, number> }; choices: { choiceId: string }[] };
  line(`worldTime=${worldView.summary.worldTime}`);
  line(`resources=${JSON.stringify(worldView.summary.resources)}`);
  line(`offered choices=${worldView.choices.map((c) => c.choiceId).join(', ')}`);

  const episodes = await call('GET', `/v1/worlds/${worldId}/episodes`, { limit: 50 });
  const items = episodes.items as { id: ID; status: string; worldStateVersion: number; fromEventSequence: number; throughEventSequence: number }[];
  const newest = items.at(-1);
  if (newest) {
    const one = await call('GET', `/v1/worlds/${worldId}/episodes/${newest.id}`);
    const episode = (one as { episode?: { content: string; referencedEventIds: ID[] } }).episode;
    const tiles = items.map((e) => `${e.worldStateVersion}:${e.fromEventSequence}..${e.throughEventSequence}`).join(' ');
    line(`${items.length} episodes, version:events ${tiles}`);
    line(`\nepisode ${newest.id} (version ${newest.worldStateVersion}, ${newest.status}, events ${newest.fromEventSequence}..${newest.throughEventSequence}):`);
    line(episode?.content ?? '(no content)');
    line(`referenced event ids: ${episode?.referencedEventIds.length ?? 0}`);
  }

  section('5 — determinism report');
  const events = engine.store.worldEvents(worldId);
  const byType = new Map<string, number>();
  for (const e of events) byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
  line(`events=${events.length}  versions=${version}  sequences=${events[0]?.sequence}..${events.at(-1)?.sequence}`);
  for (const [type, count] of [...byType].sort((a, b) => b[1] - a[1])) line(`  ${type.padEnd(26)} ${count}`);

  const replay = engine.verifyReplay(worldId);
  line(`\nstored  hash: ${replay.storedHash}`);
  line(`replayed hash: ${replay.replayedHash}`);
  line(`replay equal : ${replay.equal}`);
  if (!replay.equal) process.exitCode = 1;

  // Golden anchor for SEED/WALL_START above: drift here means the deterministic
  // core changed, so this run is a replay artefact and not only a demo.
  const GOLDEN_HASH = 'sha256:ba95bdda8cae86f80349812bc071df78a2e17a359bcf3291364f2c6a6d356247';
  const goldenOk = replay.replayedHash === GOLDEN_HASH && events.length === 28 && version === 7;
  line(`golden hash  : ${goldenOk ? 'match' : `DRIFT (expected ${GOLDEN_HASH})`}`);
  if (!goldenOk) process.exitCode = 1;

  const runs = [...engine.store.generationRuns.values()];
  const spend = runs.reduce((s, r) => s + Number(r.costUsd), 0);
  const calls = engine.provider instanceof CompliantProvider ? engine.provider.calls : -1;
  line(`\ngeneration runs=${runs.length} provider calls=${calls} spend=usd ${spend.toFixed(4)} (per-day cap enforced before each call)`);
  line(`audit entries=${engine.store.audit.length}`);
  line(process.exitCode ? '\nSEED FAILED' : '\nSeed completed: The Glass Harbor is replay-verified.');
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  process.exitCode = 1;
});
