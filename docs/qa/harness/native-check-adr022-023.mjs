// Måler ADR-022 og ADR-023 i den faktige native flyten: skyveknappene på UI03
// trykkes med ekte trykk, verden blir opprettet av appen, og påstanden leses ut av
// skjermtreet — ikke fra en HTTP-respons.
//
// Krev: en kjørende tjener på havnens vert (se docs/qa/harness/api-check-adr022-023.mjs)
// og en emulator med ferskt enhetsbygg.
//   PUNKGRID_ADB="$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe" \
//   PUNKGRID_SERIAL=emulator-5554 PUNKGRID_BASE_URL=http://10.0.2.2:3120 \
//   node docs/qa/harness/native-check-adr022-023.mjs

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseTree } from '../../apps/mobile/scripts/lib/reading-order.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const ADB = process.env.PUNKGRID_ADB ?? 'adb';
const SERIAL = process.env.PUNKGRID_SERIAL ?? 'emulator-5554';
const PKG = process.env.PUNKGRID_PKG ?? 'com.monrad.punkgrid';
const BASE_URL = process.env.PUNKGRID_BASE_URL ?? 'http://10.0.2.2:3120';
/** Verden flyten skal åpne på: 1888 er ikke malens første tid, og Investigator er
 *  ikke malens første rolle, så begge valgene må gi seg utslag for at målingen
 *  betyr noe. */
const ERA = process.env.PUNKGRID_ERA ?? '1888';
const ERA_DATE = process.env.PUNKGRID_ERA_DATE ?? '1888-09-15';
const ROLE = process.env.PUNKGRID_ROLE ?? 'Investigator';
const DEFAULT_ROLE = process.env.PUNKGRID_DEFAULT_ROLE ?? 'Founder / CEO';
const WAIT_MS = 120_000;
const SETTLE_MS = 1_200;
const OUT = join(repo, 'docs', 'qa', 'evidence', 'adr-022-023',
  new Date().toISOString().replace(/:/g, '-').replace(/\.\d+Z$/, 'Z'));

mkdirSync(OUT, { recursive: true });

const args = ['-s', SERIAL];
const adb = (...rest) => execFileSync(ADB, [...args, ...rest], { encoding: 'utf8', timeout: 30_000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
const shell = (cmd) => adb('shell', cmd);
const line = (s) => process.stdout.write(`${s}\n`);

const launch = () => shell(`monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`);
const stop = () => shell(`am force-stop ${PKG}`);
const deepLink = (route) => shell(`am start -a android.intent.action.VIEW -d 'punkgrid://${route}' ${PKG}`);

let latestXml = '';
function dumpOnce() {
  try {
    if (!shell('uiautomator dump /sdcard/adr.xml').includes('dumped to:')) return [];
  } catch {
    return [];
  }
  let xml = '';
  try {
    xml = adb('shell', 'cat', '/sdcard/adr.xml');
  } catch {
    return [];
  }
  const nodes = parseTree(xml, PKG);
  if (nodes.length) latestXml = xml;
  return nodes;
}

// En dump på en skjerm som animator enda kommer tom; én retry er det en leser med
// hånda på enheten ville gjort.
function dump() {
  const first = dumpOnce();
  if (first.length) return first;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
  return dumpOnce();
}

const label = (n) => n.desc || n.text || n.class;
const spoken = (ns) => ns.map(label).filter((s) => s.length > 4).join(' | ');
const whole = (n) => !!n?.bounds && n.bounds.y2 > n.bounds.y1 && n.bounds.x2 > n.bounds.x1;
const match = (n, want) => !!n.bounds && (`${n.desc} ${n.text}`.toLowerCase().includes(want.toLowerCase()));
const find = (nodes, want) => nodes.find((n) => match(n, want)) ?? null;
const exact = (nodes, want) => nodes.find((n) => n.bounds && (n.desc.toLowerCase() === want.toLowerCase() || n.text.toLowerCase() === want.toLowerCase())) ?? null;

async function until(want, ms = WAIT_MS) {
  const deadline = Date.now() + ms;
  for (;;) {
    const nodes = dump();
    if (find(nodes, want)) {
      await new Promise((r) => setTimeout(r, SETTLE_MS));
      const settled = dump();
      if (find(settled, want)) return settled;
    }
    if (!shell(`pidof ${PKG}`).trim()) throw new Error(`the app process died while waiting for “${want}”`);
    if (Date.now() > deadline) {
      // An empty tree is usually somebody else's window in front of the app, and a
      // message that says only "empty" sends the next reader to the same blind hunt.
      const foreign = [...new Set([...latestXml.matchAll(/package="([^"]+)"/g)].map((m) => m[1]))];
      throw new Error(nodes.length
        ? `never saw “${want}”. Tree: ${spoken(nodes).slice(0, 400)}`
        : `never saw “${want}”, and no node belongs to ${PKG}. Window: ${foreign.join(', ') || 'no dump at all'}`);
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
}

function tap(node) {
  if (!whole(node)) throw new Error(`cannot tap “${label(node)}” — no whole box in the tree`);
  const { x1, y1, x2, y2 } = node.bounds;
  shell(`input tap ${Math.round((x1 + x2) / 2)} ${Math.round((y1 + y2) / 2)}`);
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  line(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

const adbRaw = (...rest) => execFileSync(ADB, [...args, ...rest], { timeout: 30_000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });

function shoot(tag) {
  writeFileSync(join(OUT, `${tag}.xml`), latestXml);
  try {
    writeFileSync(join(OUT, `${tag}.png`), adbRaw('exec-out', 'screencap', '-p'));
  } catch {
    /* the tree is the measurement; the picture is a courtesy */
  }
}

/** Boksen en knapp ligger i: den valgte chippen i raden er alltid synlig, så
 *  midten av den gir den horisontale banden raden swipes i. */
async function chip(nodes, want, rowAnchor) {
  let hit = find(nodes, want);
  if (hit) return hit;
  const y = rowAnchor ? Math.round((rowAnchor.bounds.y1 + rowAnchor.bounds.y2) / 2) : null;
  if (y === null) return null;
  for (let i = 0; i < 3; i += 1) {
    shell(`input swipe ${vpW - 344} ${y} 320 ${y} 300`);
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    hit = find(dump(), want);
    if (hit) return hit;
  }
  return null;
}

const size = /(\d+)x(\d+)/.exec(shell('wm size'));
const vpW = Number(size?.[1] ?? 1344);
const vpH = Number(size?.[2] ?? 2992);
const midX = Math.round(vpW / 2);

const scrollDown = () => shell(`input swipe ${midX} ${Math.round(vpH * 0.72)} ${midX} ${Math.round(vpH * 0.34)} 400`);
const scrollUp = () => shell(`input swipe ${midX} ${Math.round(vpH * 0.34)} ${midX} ${Math.round(vpH * 0.72)} 400`);

/** what the player's own cast plate says as its note. `ArtPlate` er ett
 *  tilgjengelighetselement: desc er “<navn> · you. <rolle>”, så dette er plateens
 *  egen tekst og ikke en chips i raden over. */
async function youPlateNote() {
  for (let i = 0; i < 5; i += 1) {
    const plate = dump().find((n) => /^Alex Vale · you\./.test(n.desc) && whole(n));
    if (plate) return plate.desc.replace(/^Alex Vale · you\.\s*/, '');
    scrollDown();
    await new Promise((r) => setTimeout(r, SETTLE_MS));
  }
  return '';
}

// --- UI10: pek appen på den isolerte tjeneren, gjennom appens eget felt. ---------
const accountField = (nodes) => nodes.find((n) => n.desc === 'Server address' && n.bounds) ?? null;

shell(`pm clear ${PKG}`);
// The shade belongs to systemui, and every tree read while it is open comes back
// with no node from this package: measured on 2026-10-15, where the run spent its
// 60 s waiting for a field the app was painting underneath an open drawer.
shell('cmd statusbar collapse');
shell('input keyevent KEYCODE_WAKEUP');
deepLink('account');
let nodes = await until('Server address', 60_000);
let field = accountField(nodes);
if (!field) {
  stop();
  launch();
  await until('Live a thousand lives', 60_000);
  deepLink('account');
  nodes = await until('Server address', 60_000);
  field = accountField(nodes);
}
if (!field) throw new Error(`UI10 never showed the Server address field: ${spoken(nodes)}`);
shoot('01 account');

let stored = '';
for (let attempt = 1; attempt <= 3; attempt += 1) {
  tap(accountField(dump()) ?? field);
  await until('Server address', 15_000);
  shell('input keycombination 113 29');
  shell(`input text ${JSON.stringify(BASE_URL)}`);
  shell('input keyevent 111');
  await new Promise((r) => setTimeout(r, 800));
  stored = accountField(dump())?.text ?? '';
  if (stored === BASE_URL) break;
  line(`      (feltet holder “${stored}” etter forsøk ${attempt})`);
}
if (!check('UI10 holder den isolerte tjeneradressen', stored === BASE_URL, `feltet: “${stored}”`)) {
  line('Avbryter: en feil adresse lagrer en feil tjener, og resten av målingen ville vært bevisløs.');
  process.exit(1);
}
tap(exact(dump(), 'Save'));
await until('Server address saved on this device', 20_000);
shoot('02 address saved');

// --- UI01 → UI02: signér inn med utviklerkontoen tjeneren tillater. -------------
stop();
launch();
deepLink('');
await until('Live a thousand lives', 60_000);
shoot('03 welcome');
tap(find(dump(), 'Sign in'));
await until('Enter the world', 30_000);
tap(find(dump(), 'Enter the world'));

// --- UI07 → UI03: den veien en ny spiller faktisk går. --------------------------
let library = [];
for (let attempt = 1; attempt <= 3; attempt += 1) {
  deepLink('library');
  library = await until('Initiate new consciousness thread', 60_000);
  if (find(library, 'Initiate new consciousness thread')) break;
}
shoot('04 library empty');
tap(find(dump(), 'Initiate new consciousness thread'));

// Døra fra det tomme biblioteket går via UI02 (Begin a life) til UI03, og bare den
// første hoppen er forutsigbar: målingen sjekker derfor hvilken av de to skjermene
// som faktisk er i treet, og tar den veien enheten viser.
const setupGate = 20_000;
const onSetup = (ns) => !!find(ns, 'Persona synthesizer');
const onGenesis = (ns) => !!find(ns, 'Begin a life');
let at = dump();
for (let waited = 0; waited < setupGate; waited += 1_000) {
  if (onSetup(at) || onGenesis(at)) break;
  await new Promise((r) => setTimeout(r, 1_000));
  at = dump();
}
if (onGenesis(at) && !onSetup(at)) {
  shoot('04b genesis');
  tap(find(at, 'Create a Life'));
}
nodes = await until('Persona synthesizer', 30_000);
shoot('05 setup');

// Appens eget besetningskort skal si rollen spilleren valgte, ikke katalogens
// referanserolle — målt på plateens egen tekst, ikke på en chips label.
const plateBefore = await youPlateNote();
check(`UI03 sier referanserollen på «you»-plateen før valget (${DEFAULT_ROLE})`, plateBefore === DEFAULT_ROLE, `platen sier: “${plateBefore}”`);
for (let i = 0; i < 3; i += 1) {
  scrollUp();
  await new Promise((r) => setTimeout(r, 600));
}

const eraRow = find(dump(), '2034');
const eraChip = await chip(dump(), ERA, eraRow);
if (!check(`UI03 har en tidskipp for ${ERA}`, !!eraChip, eraChip ? label(eraChip) : 'ikke i treet')) process.exit(1);
tap(eraChip);
nodes = await until('Persona synthesizer', 15_000);

const roleRow = find(dump(), DEFAULT_ROLE);
const roleChip = await chip(nodes, ROLE, roleRow);
if (!check(`UI03 har en rollekipp for ${ROLE}`, !!roleChip, roleChip ? label(roleChip) : 'ikke i treet')) process.exit(1);
tap(roleChip);
nodes = await until('Persona synthesizer', 15_000);
shoot('06 era and role chosen');
const plateAfter = await youPlateNote();
shoot('06b you-plate');
check(`UI03 bytter «you»-plateen til ${ROLE}`, plateAfter === ROLE, `platen sier: “${plateAfter}”`);
for (let i = 0; i < 3; i += 1) {
  scrollUp();
  await new Promise((r) => setTimeout(r, 600));
}

// --- Opprett: dette er hoppet som skriver world.create. Én trykk. ----------------
const create = find(dump(), 'Manifest consciousness');
if (!create) throw new Error(`UI03 har ingen opprettelsesknapp: ${spoken(dump()).slice(0, 200)}`);
tap(create);

// --- UI04: episodens dører, lest fra hele skjermen. -----------------------------
nodes = await until('Episode', WAIT_MS);
shoot('07 play');
const doors = (n) => n.filter((m) => m.clickable && /^Choice [A-Z] of \d+\./.test(m.desc));
let all = dump();
// Den fjerde døra ligger under folden; readWholeScreen i enhetsgangen gjør samme
// swipe, og her telles dørene etter én swipe ned.
shell(`input swipe ${Math.round(vpW / 2)} ${Math.round(vpH * 0.75)} ${Math.round(vpW / 2)} ${Math.round(vpH * 0.3)} 400`);
await new Promise((r) => setTimeout(r, SETTLE_MS));
const after = dump();
const seen = new Set();
for (const m of [...doors(all), ...doors(after)]) seen.add(m.desc);
all = [...all, ...after];
const count = seen.size;
check(`ADR-022: scenen på enheten tilbyr ${count} valg (2–4)`, count >= 2 && count <= 4, [...seen].map((d) => d.split('.')[1]?.trim()).join(', '));
writeFileSync(join(OUT, 'play-screen.txt'), spoken(all));

// --- UI07: verdensteksten er motoren sin egen, og der står tida. -----------------
deepLink('library');
nodes = await until('Version', 60_000);
shoot('08 library card');
const meta = nodes.map((n) => `${n.text} ${n.desc}`).find((s) => s.includes('world time')) ?? '';
check(`ADR-023: kortet på enheten viser world time ${ERA_DATE}`, meta.includes(ERA_DATE), meta.trim().slice(0, 120) || 'ingen world time i treet');

writeFileSync(join(OUT, 'result.json'), JSON.stringify({ BASE_URL, ERA, ROLE, count, meta, results }, null, 2));
line(`bevis: ${OUT}`);
for (const r of results) if (!r.ok) process.exitCode = 1;
