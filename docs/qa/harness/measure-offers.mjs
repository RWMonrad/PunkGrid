import { Engine } from '../../dist/core/src/engine.js';
import { GLASS_HARBOR } from '../../dist/core/src/glassHarbor.js';
import { CompliantProvider } from '../../dist/core/src/providers.js';

const T0 = Date.parse('2026-10-11T12:00:00.000Z');
let counter = 0;
const cid = () => `cmd_${(++counter).toString(36).padStart(4, '0')}`;

const engine = new Engine(structuredClone(GLASS_HARBOR), new CompliantProvider(), { now: () => T0, seed: 20261011, autoFlush: false });
engine.registerUser('user_a');
const created = await engine.createWorld({ actorUserId: 'user_a', mode: 'create', templateId: 'glass-harbor-2034', commandId: cid() });
const worldId = created.worldId;
const identityId = created.identityId;
let version = created.commandResult.newVersion;

const pool = () => engine.currentChoices(worldId).map((c) => c.choiceId);
const res = () => {
  const s = engine.store.latestSnapshot(worldId).state.characters.char_player.resources;
  return `cash=${s.cash} influence=${s.influence} credibility=${s.credibility}`;
};
const pick = async (choiceId) => {
  try {
    var r = await engine.submitChoice({ actorUserId: 'user_a', worldId, actorIdentityId: identityId, expectedWorldVersion: version, choiceId, commandId: cid() });
  } catch (e) {
    console.log(`  ${choiceId} -> threw ${e.code} ${JSON.stringify(e.details)} at version ${version} pool=[${pool()}] ${res()}`);
    return false;
  }
  if (r.outcome !== 'committed') { console.log(`  ${choiceId} -> ${r.outcome} ${r.noOpReason ?? ''}`); return false; }
  version = r.newVersion;
  return true;
};

console.log('genesis', pool().length, pool().join(','));
await pick('open_negotiation');
console.log('after open_negotiation', pool().length, pool().join(','), res());
await pick('reject_sale');
console.log('after reject_sale', pool().length, pool().join(','), res());
for (let i = 0; i < 6; i += 1) await pick('open_negotiation');
console.log('after 6 more open_negotiation', pool().length, pool().join(','), res());
for (let i = 0; i < 10; i += 1) await pick('investigate_buyer');
console.log('after 10 investigate_buyer', pool().length, pool().join(','), res());
for (let i = 0; i < 10; i += 1) await pick('brief_staff');
console.log('after 10 brief_staff', pool().length, pool().join(','), res());
for (let i = 0; i < 20; i += 1) await pick('confront_mara');
console.log('after 20 confront_mara', pool().length, pool().join(','), res());
console.log('version', version, 'replay', engine.verifyReplay(worldId).equal);
