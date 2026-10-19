// Device walk: drives the installed debug APK on a real Android emulator through
// the golden path and asserts what the accessibility tree says, not what the
// source says. It is the counterpart to `core/tests/e2e.test.ts`, which proves the
// eleven routes on the server but never renders a screen.
//
// It is opt-in because it needs hardware: an emulator with the APK installed, a
// dev server reachable from that emulator, and adb on PATH.
//
//   node apps/mobile/scripts/device-walk.mjs
//   PUNKGRID_SERIAL=emulator-5556 PUNKGRID_ADB=/c/Android/Sdk/platform-tools/adb.exe node apps/mobile/scripts/device-walk.mjs
//   PUNKGRID_BASE_URL=http://10.0.2.2:3100 node apps/mobile/scripts/device-walk.mjs
//
// Exit 0 means every check passed; each failure prints the screen, the expectation
// and the tree it saw.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseTree, readingOrder, treeOrder } from './lib/reading-order.mjs';
import { artVerdicts, frameOf, readArt, slotsFor } from './lib/art-check.mjs';

/** The repository root, wherever the command was typed from. `reading-order.test.mjs`
 *  reads this same directory, and on 2026-10-12 a walk run from `apps/mobile` dropped
 *  its trees where that test could not see them. */
const REPO = fileURLToPath(new URL('../../../', import.meta.url));

/** The people the shipped rulepack has, read off the engine's own source with the same
 *  expression `apps/mobile/src/lib/setting.test.ts` uses. The walk goes to the file
 *  instead of naming six people here because a written-out list drifts from the cast
 *  exactly the way the client catalogue is not allowed to — and the test that guards the
 *  catalogue would notice that drift on disk while the device kept showing the old cast. */
const CAST = [...readFileSync(join(REPO, 'core/src/glassHarbor.ts'), 'utf8')
  .matchAll(/\{ id: '(char_\w+)', name: '([^']+)', isPlayer: (true|false)/g)]
  .map(([, , name]) => name);

const ADB = process.env.PUNKGRID_ADB ?? 'adb';
const SERIAL = process.env.PUNKGRID_SERIAL ?? '';
const PKG = process.env.PUNKGRID_PKG ?? 'com.monrad.punkgrid';
const OUT = process.env.PUNKGRID_OUT ?? join(REPO, 'docs/qa/evidence/device-walk');
/** The server this build of the app must be pointed at. Port 3000 is not a
 *  safe assumption on a shared workstation — one sibling session took it on
 *  2026-10-12 and answered `/healthz` with a different product's payload — and a
 *  release bundle has no Metro host to borrow. So the walk sets the address
 *  itself, through the app's own UI10 field, which is the supported channel. */
const BASE_URL = process.env.PUNKGRID_BASE_URL ?? 'http://10.0.2.2:3000';
const HOST = BASE_URL.replace(/^[a-z]+:\/\//, '');
/** The text scale the *measured* pass runs at, as a `settings put system font_scale`
 *  value — `2.0` is the SC 1.4.4 run. It is applied after the server address is in the
 *  field and restored when the run ends, because the address has to be typed and the
 *  typing is not part of what this measures. Empty means "leave the device's own scale
 *  alone".
 *
 *  A failed typing loop on this device is not evidence about the scale. Two runs on
 *  2026-10-12 were read that way before the crash buffer was looked at: the app had
 *  died of a `Fatal signal 11` in `UIManager::completeSurface` seconds into the start,
 *  and the keys went to a process that was no longer there — at scale 1.0 as well.
 *  `crashNotes()` prints that buffer whenever a run stops or fails. */
const FONT_SCALE = process.env.PUNKGRID_FONT_SCALE ?? '';
const POLL_MS = 1000;
const SETTLE_MS = 1200;
const WAIT_MS = Number(process.env.PUNKGRID_WAIT_MS ?? 40_000);

const args = SERIAL ? ['-s', SERIAL] : [];
// `monkey` and `uiautomator` narrate on stderr; the walk's own report is the only
// output worth forwarding.
const adb = (...rest) => execFileSync(ADB, [...args, ...rest], { encoding: 'utf8', timeout: 30_000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
// Screenshots are binary: decoding them as UTF-8 would replace every invalid byte
// with U+FFFD and write an unreadable PNG.
const adbRaw = (...rest) => execFileSync(ADB, [...args, ...rest], { timeout: 30_000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
const shell = (cmd) => adb('shell', cmd);

const launch = () => shell(`monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`);
const stop = () => shell(`am force-stop ${PKG}`);
/** `punkgrid://` is the scheme the APK declares (AndroidManifest.xml:24-29), and
 *  `/account` renders UI10 — including while signed out, which is the whole point:
 *  the server address is the one thing the walk has to change before it can sign
 *  in. No extra screen or debug hook is needed for it. */
const deepLink = (route) => shell(`am start -a android.intent.action.VIEW -d 'punkgrid://${route}' ${PKG}`);

const density = () => {
  const m = /Physical density: (\d+)/.exec(shell('wm density'));
  return m ? Number(m[1]) / 160 : 1;
};

let latestXml = null;

function dumpOnce() {
  latestXml = null;
  // A failed dump can leave the previous screen's XML on disk.
  try {
    const result = shell('uiautomator dump /sdcard/punkgrid-ui.xml');
    if (!result.includes('dumped to:')) return [];
  } catch (error) {
    if (error.code === 'ETIMEDOUT') throw new Error('UI hierarchy dump exceeded 30 seconds');
    return [];
  }
  let xml = '';
  try {
    xml = adb('shell', 'cat', '/sdcard/punkgrid-ui.xml');
  } catch {
    return [];
  }
  // A dump taken while the window is still settling returns the tree of the app that
  // was last in front; `parseTree` keeps only our own package, so those reads come
  // back empty and read as "not ready".
  const nodes = parseTree(xml, PKG);
  if (nodes.length) latestXml = xml;
  return nodes;
}

/** `uiautomator dump` is not a reliable read of a screen that is animating — it
 *  answers with no root node, or with the tree of the app that was last in front, and
 *  both come back as an empty list. Measured on the 200 % run of 2026-10-12: the
 *  scroll pass over the guest preview kept its first read and then answered empty for
 *  every swipe, so the merged screen it promised to have read was one viewport wide
 *  and the four doors below it were reported as missing. One retry is what a reader
 *  with a hand on the device would do. */
function dump() {
  const first = dumpOnce();
  if (first.length) return first;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
  return dumpOnce();
}

const label = (n) => n.desc || n.text || n.class;

/** A failure printed from a truncated tree is not evidence. The whole named tree,
 *  short prose dropped, so the row that explains the failure is in the message. */
const spoken = (ns) => ns.map(label).filter((s) => s.length > 4).join(' | ');

function find(nodes, want) {
  const needle = want.toLowerCase();
  return nodes.find((n) => n.bounds && (n.desc.toLowerCase() === needle || n.text.toLowerCase() === needle)) ?? null;
}

function contains(nodes, want) {
  const needle = want.toLowerCase();
  return nodes.find((n) => n.desc.toLowerCase().includes(needle) || n.text.toLowerCase().includes(needle)) ?? null;
}

const appAlive = () => {
  try {
    return shell(`pidof ${PKG}`).trim().length > 0;
  } catch {
    // `pidof` exits 1 when the process is not there, which is the answer, not an error.
    return false;
  }
};

/** A wait cannot read a tree out of a process that is not running. This happened on
 *  2026-10-12: the app died three times in half an hour of walking with a SIGSEGV in
 *  `MountingCoordinator::pullTransaction` (the open cause is task #47), and each time
 *  the wait kept polling whatever window the launcher had left on screen — Gmail's
 *  first-boot tour after one of them — until its timeout expired, then reported the
 *  screen as missing. Whether the process is alive is one command, so the wait restarts
 *  it and says so in the output, and keeps measuring the screen it was sent to read.
 *  Two restarts per wait: a third dead process means the screen really is not there, and
 *  the run should fail with the tree it saw rather than hide an endless relaunch loop. */
async function revive(restarts, where) {
  if (appAlive()) return restarts;
  const [note] = crashNotes();
  if (process.env.PUNKGRID_STRICT_WALK === '1') throw new Error(`${where}: app process died. ${note ?? 'No crash line in the buffer'}`);
  if (restarts >= 2) return restarts;
  console.log(`      (${where}: the app process is gone — restarting. ${note ? note.trim() : 'no crash line in the buffer'})`);
  launch();
  await new Promise((r) => setTimeout(r, 8_000));
  return restarts + 1;
}

async function until(want, ms = WAIT_MS) {
  const deadline = Date.now() + ms;
  let nodes = [];
  let restarts = 0;
  for (;;) {
    nodes = dump();
    // A node with no bounds is off-screen or not laid out yet — the caller needs
    // one it can tap.
    const hit = nodes.find((n) => n.bounds && (n.desc.toLowerCase().includes(want.toLowerCase()) || n.text.toLowerCase().includes(want.toLowerCase()))) ?? null;
    if (hit) {
      // The first tree that mentions a target is often mid-render: the text is
      // there while the clickable flags are not. Re-read before handing it over.
      await new Promise((r) => setTimeout(r, SETTLE_MS));
      const settled = dump();
      return settled.some((n) => n.bounds && (n.desc.toLowerCase().includes(want.toLowerCase()) || n.text.toLowerCase().includes(want.toLowerCase())))
        ? { nodes: settled, hit: settled.find((n) => n.bounds && (n.desc.toLowerCase().includes(want.toLowerCase()) || n.text.toLowerCase().includes(want.toLowerCase()))) }
        : { nodes, hit };
    }
    if (Date.now() > deadline) return { nodes, hit: null };
    await new Promise((r) => setTimeout(r, POLL_MS));
    restarts = await revive(restarts, `waiting for “${want}”`);
  }
}

/** `until` waits for a label; this waits for a statement about the whole tree, which
 *  is what a focus state or an exact field value needs. Same settle re-read: the
 *  first tree that satisfies the condition is often mid-render. */
async function untilNodes(want, ms = WAIT_MS) {
  const deadline = Date.now() + ms;
  let nodes = [];
  let restarts = 0;
  for (;;) {
    nodes = dump();
    if (want(nodes)) {
      await new Promise((r) => setTimeout(r, SETTLE_MS));
      const settled = dump();
      return want(settled) ? settled : nodes;
    }
    if (Date.now() > deadline) return nodes;
    await new Promise((r) => setTimeout(r, POLL_MS));
    restarts = await revive(restarts, 'waiting for a tree condition');
  }
}

function tap(node) {
  // Named, because the walk has stopped here with no clue about which control it
  // lost: the caller looked a button up in a tree, the app had already moved, and
  // “cannot tap a node without bounds” is not a sentence about the device.
  if (!node?.bounds) {
    throw new Error(node ? `cannot tap “${label(node)}” — the tree reports no box for it` : 'the control is not in the tree the walk read');
  }
  const { x1, y1, x2, y2 } = node.bounds;
  shell(`input tap ${Math.round((x1 + x2) / 2)} ${Math.round((y1 + y2) / 2)}`);
}

/** A box with real area. uiautomator hands back the *cut* when the scroll viewport
 *  clips a node, and the cut reads as an inverted box — `bounds="[48,2868][1296,2716]"`
 *  for UI01's Sign in, bottom edge above the top. */
const whole = (n) => !!n.bounds && n.bounds.y2 > n.bounds.y1 && n.bounds.x2 > n.bounds.x1;

/** A box the fold has not cut — which `whole()` does not cover. A row running off the
 *  bottom of the scroll viewport comes back with a *positive* height whose bottom edge
 *  sits exactly on the viewport's own bottom (measured: `[48,2429][1296,2545]` for a
 *  329 px door in a view that ends at 2545), so the cut reads as a small control. The
 *  edge on the boundary is the tell. */
const uncut = (n, region) => whole(n) && n.bounds.y1 > region.y1 && n.bounds.y2 < region.y2;

/** Every pixel of a *whole* box belongs to the node, even one the fold clips from
 *  below, so its midpoint is always a valid tap. An inverted box has no pixels at
 *  all, and its midpoint is y=2792 — a point that belongs to whatever survived the
 *  fold (measured: the walk tapped there, the door never fired, and the hop to UI02
 *  timed out with four re-taps that each aimed at the same non-existent pixel).
 *  So: scroll until the same node answers with a whole box, then hand it over as the
 *  tree sees it now. Null when four swipes do not uncover it — a door the fold will
 *  not give up is not a tap this walk should fake. */
async function reveal(node) {
  if (!node) return null;
  node = dump().find((m) => m.class === node.class && m.desc === node.desc && m.text === node.text);
  if (!node?.bounds) return null;
  if (whole(node)) return node;
  const vp = viewportSize();
  // Which way the content has to travel is read from where the cut box *claims* to
  // start, and the gesture stays inside the band that scrolls (`scrollSwipe`) — a
  // fixed fraction of the screen can land on the footer, and a clipped box's own
  // midpoint can land further down than the screen the node is on.
  const swipe = scrollSwipe(node, vp, await scrollRegionNow(vp));
  for (let i = 0; i < 4; i += 1) {
    shell(swipe);
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    // Matched by identity, not by name: the label a button paints is also a `<Text>`
    // node with the same words, and the field on UI10 shares its description with the
    // prose above it. A class + desc + text triple is the node, and only the node.
    const shown = dump().find((m) => m.class === node.class && m.desc === node.desc && m.text === node.text && whole(m));
    if (shown) return shown;
  }
  console.log(`      (“${label(node)}” stays behind the fold — no tap sent)`);
  return null;
}

/** Tap and wait for the screen the tap should produce, tapping once more if the
 *  first landed while the window was still taking focus. Only for navigation: a
 *  hop that commits a command must not be repeated. */
async function tapTo(node, want, ms = WAIT_MS) {
  const deadline = Date.now() + ms;
  let target = node;
  for (let attempt = 1; ; attempt += 1) {
    // Re-revealed on every attempt: the fold the previous tap was aimed at is the
    // reason there is an attempt at all.
    target = await reveal(target);
    if (!target || !whole(target)) throw new Error(`No visible control for navigation to “${want}”`);
    tap(target);
    const found = await until(want, Math.min(8_000, ms));
    if (found.hit) return found;
    if (Date.now() > deadline) return found;
    console.log(`      (no “${want}” after tap ${attempt} — tapping again)`);
  }
}

const failures = [];
let checks = 0;

function check(screen, what, ok, saw) {
  checks += 1;
  if (!ok) failures.push({ screen, what, saw: saw ?? '' });
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${screen} — ${what}${ok ? '' : ` (saw: ${saw ?? 'nothing'})`}`);
}

/** Native crashes the device recorded for this package, newest last. A walk that
 *  stops reads a tree, and a tree cannot say “the process died while you were
 *  typing”: measured 2026-10-12, where a `Fatal signal 11` in
 *  `UIManager::completeSurface` three seconds into a run left the address field
 *  looking untypeable, and the run was blamed on the text scale that was not the
 *  cause. Any red or stopped run therefore prints what the crash buffer says, so
 *  the next reader sees the death before inventing a reason for it. */
function crashNotes() {
  let lines = [];
  try {
    lines = adb('logcat', '-d', '-b', 'crash').split('\n').filter((l) => /Fatal signal/.test(l) && /monrad\.punkgrid/.test(l));
  } catch {
    return [];
  }
  return lines.slice(-3);
}

/** The same statement, twice. The walk runs one prepared pass first, and there a
 *  step that does not work is not a finding about the app — it is a walk that
 *  cannot run, so it stops with a message. In the measured pass it is a check. */
function expect(phase, screen, what, ok, saw) {
  if (phase === 'measure') return check(screen, what, ok, saw);
  if (!ok) throw new Error(`${screen}: ${what} — saw ${saw ?? 'nothing'}`);
}

/** The field, not the label that names it: UI10 writes “Server address” twice, once
 *  as a `<Text>` and once as the field's own content description, and only the field
 *  takes a tap. Measured on the device — the label is node 3, the field node 4. */
const accountField = (nodes) => nodes.find((n) => n.desc === 'Server address' && n.bounds) ?? null;
const addressInUse = (nodes) => {
  const index = nodes.findIndex((n) => n.text === 'ADDRESS IN USE');
  return index < 0 ? undefined : nodes[index + 1]?.text;
};

/** Point the installed app at `BASE_URL` through its own Account screen, and —
 *  in the measured pass — audit that screen on the way. `pm clear` wipes the
 *  stored override with the session, so this runs once per pass. */
async function setServerAddress(phase, dp, stamp) {
  // Sent on a cold start the link *is* the launch intent and the app opens on
  // UI10. Sent while the app is already starting — which is what a `pm clear`
  // followed by anything looks like from the outside — it reaches a router that
  // has not mounted yet and is dropped, and the app finishes on UI01. Measured:
  // the first version of this function got the welcome tree here. So the link is
  // sent, and sent again once the app is demonstrably up.
  deepLink('account');
  let opened = await until('Server address', 60_000);
  let hit = accountField(opened.nodes);
  if (!hit) {
    // The link reached a starting app. Cold start is the one state this walk has
    // measured it can rely on, so the retry restarts rather than linking into a
    // screen it has not identified: the previous version waited for “Sign in”,
    // which is a button on UI01 *and* the heading of the sign-in screen, and a run
    // on 2026-10-12 linked a second time into a sign-in screen left over from the
    // run before it,
    // linked a second time into a sign-in screen left over from the run before it,
    // waited 120 s for a field that was never there, and stopped with a tree the
    // message could not explain. Evidence goes to disk this time, for the same
    // reason.
    console.log('      (the link reached a starting app — cold starting, then linking again)');
    recordTree('UI10 account first link', opened.nodes, stamp);
    stop();
    launch();
    await until('Sign in', 120_000);
    deepLink('account');
    opened = await until('Server address', 120_000);
    hit = accountField(opened.nodes);
    if (!hit) recordTree('UI10 account second link', opened.nodes, stamp);
  }
  const { nodes } = opened;
  expect(phase, 'UI10 account', 'opens the Account screen from the deep link while signed out', !!hit,
    nodes.map(label).join(' | '));
  if (phase === 'measure') {
    const screen = 'UI10 account';
    await auditTree(screen, nodes, dp);
    shoot(screen, stamp);
    check(screen, 'says the player is not signed in', !!contains(nodes, 'Not signed in'), nodes.map(label).join(' | '));
    // The field arrives holding the address in use, which on a device that has never
    // saved an override is the build's own default, not the address this walk wants.
    check(screen, 'prefills the field with an address', !!nodes.some((n) => /^https?:\/\//.test(n.text)),
      nodes.filter((n) => n.text.includes('//')).map((n) => n.text).join(' | ') || 'no url in the tree');
    check(screen, 'offers Save and Check', !!find(nodes, 'Save') && !!find(nodes, 'Check'),
      nodes.map(label).join(' | '));
    check(screen, 'explains 10.0.2.2 rather than assuming it', !!contains(nodes, '10.0.2.2'),
      nodes.map((n) => n.text).join(' | ').slice(0, 120));
  }

  const readAddress = (ns) => accountField(ns)?.text ?? '';
  let typed = { nodes: [] };
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const field = accountField(dump()) ?? hit;
    tap((await reveal(field)) ?? field);
    const focused = await untilNodes((ns) => accountField(ns)?.focused === true, 15_000);
    expect(phase, 'UI10 account', 'focuses the Server address field', accountField(focused)?.focused === true);
    // Android exposes an empty field's hint as text; select-all avoids guessing its length or caret position.
    shell('input keycombination 113 29');
    shell(`input text ${JSON.stringify(BASE_URL)}`);
    await untilNodes((ns) => readAddress(ns) === BASE_URL, 8_000);
    shell('input keyevent 111');
    typed = { nodes: await untilNodes((ns) => readAddress(ns) === BASE_URL, 8_000) };
    if (readAddress(typed.nodes) === BASE_URL) break;
    console.log(`      (the field holds “${readAddress(typed.nodes)}” after attempt ${attempt} — starting over)`);
  }
  // Exact, not "contains": a field that was never cleared holds the old address and
  // the new one joined, which still contains what this walk wants and would sail
  // through as a pass. The field's own text is what the app will store.
  const value = readAddress(typed.nodes);
  expect(phase, 'UI10 account', `the Server address field holds exactly “${BASE_URL}”`, value === BASE_URL,
    `the field holds “${value}”`);
  // Not saved, and the section ends. A field this walk knows to be wrong would store a
  // wrong server override, and every screen measured after it would fail for a reason the
  // evidence cannot tell apart from an app bug (measured: a “:31000000” save was followed
  // by a prose FAIL and a thrown tap on the next screen). The address the app arrived with
  // is the build's own default, so the remaining screens are still measured — against the
  // server they would use with no override at all.
  if (value !== BASE_URL) {
    console.log(`      (the field does not hold the wanted address, so nothing is saved; the link section ends here)`);
    return;
  }

  const save = find(typed.nodes, 'Save');
  expect(phase, 'UI10 account', 'has a Save button', !!save, typed.nodes.map(label).filter((s) => s.length > 4).join(' | '));
  tap((await reveal(save)) ?? save);
  const saved = await until('Server address saved on this device');
  expect(phase, 'UI10 account', 'confirms the saved address on the device', !!saved.hit,
    spoken(saved.nodes));
  const persisted = await untilNodes((ns) => addressInUse(ns) === BASE_URL);
  expect(phase, 'UI10 account', `keeps “${HOST}” as the address in use`, addressInUse(persisted) === BASE_URL,
    addressInUse(persisted) ?? 'no saved address in the tree');
}

/** UI01 seen from the node tree. The subtitle is the marker: it is UI01's own line,
 *  while “Sign in” also appears in prose on the screens around it. */
const welcomeShown = (ns) => !!contains(ns, 'Live a thousand lives');

/** Back to the welcome screen after UI10, by the route that was measured rather
 *  than assumed. Hardware BACK does not navigate: UI10 opened from a deep link is
 *  the only entry in the task, so BACK leaves the app on the launcher home screen
 *  (measured — the next tree was “Mon, Oct 12 / Play Store / Gmail”). A cold start
 *  is deterministic about the *process* and not about the route: expo-router replays
 *  the last stack, so a relaunch can open on UI10 with no welcome screen in it
 *  (measured). The link to the root is what names the destination; the cold start is
 *  what makes the saved server override survive. Safe to do here because both passes
 *  run this before anything is signed in. */
async function toWelcome() {
  stop();
  launch();
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    deepLink('');
    const nodes = await untilNodes(welcomeShown, attempt === 1 ? 120_000 : 30_000);
    if (welcomeShown(nodes)) return;
    console.log(`      (no welcome screen after link ${attempt}: ${spoken(nodes)})`);
    stop();
    launch();
  }
  throw new Error('the app never reached UI01 after the Account screen');
}

/** UI07 seen from the node tree: the empty-library door or a world row's version
 *  line. Neither is a screen title, because the title is prose the world carries and
 *  changes with the fixture. */
const libraryShown = (ns) => !!contains(ns, 'Initiate new consciousness thread') || ns.some((n) => /Version \d+/.test(n.text));

/** UI04 seen from the node tree. `· version N` is the play screen's own subtitle;
 *  UI07's row says `Version N ·` with a capital V, so it cannot answer a wait for
 *  this while the hop is still in flight. It is used instead of a footer button
 *  because the secondary actions now sit behind a disclosure, and a hop that waits
 *  on a control the player has to open first is a hop that times out. */
const playShown = (ns) => ns.some((n) => /· version \d+/.test(`${n.text} ${n.desc}`));

/** UI02 — the genesis choice — and UI03 — the guided setup. Both waits name the
 *  screen's own title, which is prose the route owns and does not depend on which
 *  world the account happens to hold. */
const genesisShown = (ns) => !!contains(ns, 'Begin a life');
const setupShown = (ns) => !!contains(ns, 'Persona synthesizer');

/** Open a route by name and hand back the tree that says it is there. The link is
 *  sent twice before the door is called shut, because a link that arrives while the
 *  app is settling is dropped by the router (measured on the F02 hop). */
async function toRoute(route, shown, ms = 60_000) {
  deepLink(route);
  let nodes = await untilNodes(shown, ms);
  if (!shown(nodes)) {
    console.log(`      (no ${route} after the first link: ${spoken(nodes).slice(0, 120)})`);
    deepLink(route);
    nodes = await untilNodes(shown, ms);
  }
  return nodes;
}

/** Reach UI07 by name rather than by whatever stack the app has restored. The router
 *  replays the last route on a cold start, so the hop out of UI02 can land on UI10,
 *  where “Multiverse” is not in the tree at all. Measured on the device. */
async function toLibrary() {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    deepLink('library');
    const nodes = await untilNodes(libraryShown, 20_000);
    if (libraryShown(nodes)) return nodes;
    console.log(`      (no library after deep link ${attempt}: ${spoken(nodes)})`);
  }
  throw new Error(`the prepared pass never reached the library (saw: ${spoken(dump())})`);
}

/** The walk measures a world, and a fresh database has none — the Postgres suite
 *  TRUNCATEs the schema, and `pm clear` erases the device's own session. So the
 *  prepared pass creates one through the app's first-run door (UI07 → UI03 →
 *  Surprise Me) and leaves it on the account. It is a no-op on every later run. */
async function ensureWorld(stamp) {
  shell(`pm clear ${PKG}`);
  // No launcher start here on purpose: the deep link is what should start the app,
  // so it arrives as the launch intent rather than as an interruption.
  await setServerAddress('prepare', undefined, stamp);
  await toWelcome();

  let { hit } = await until('Sign in', 120_000);
  if (!hit) throw new Error('the prepared pass never reached UI01');
  let found = await tapTo(hit, 'Enter the world');
  if (!found.hit) throw new Error('the prepared pass never reached UI02');
  // The hop that signs in. Where it lands is not predictable — the router replays
  // the restored stack — so the library is reached by deep link below.
  await tapTo(found.hit, 'Multiverse');
  const nodes = await toLibrary();
  if (contains(nodes, 'The Glass Harbor')) {
    console.log('      (the account already has a world — nothing to prepare)');
    return;
  }

  const begin = contains(nodes, 'Initiate new consciousness thread');
  if (!begin) throw new Error(`the empty library offers no door (saw: ${spoken(nodes)})`);
  found = await tapTo(begin, 'Surprise Me');
  // The accessible card name includes its kicker; quota prose is not a control.
  const surprise = found.nodes.find((n) => n.clickable && n.desc.startsWith('One button. Surprise Me.'));
  if (!surprise) throw new Error(`the prepared pass never found the Surprise Me control (saw: ${spoken(found.nodes)})`);
  // One tap only: this is the hop that commits `world.create`. `reveal` scrolls a
  // cut box into view before that single tap — a swipe commits nothing, a mis-aimed
  // tap would leave the account without the world the rest of the walk needs.
  tap((await reveal(surprise)) ?? surprise);
  // The play screen's own subtitle, not a footer button: the secondary actions now
  // sit behind the footer's disclosure, so a wait on “Report this scene” would time
  // out on a world that had opened perfectly.
  const opened = await untilNodes(playShown, 120_000);
  if (!playShown(opened)) throw new Error(`the new world never opened (saw: ${opened.map(label).join(' | ')})`);
  console.log('      (prepared pass created the account world through UI03)');
}

/** What the prepared pass was looking at when it gave up. A prepare failure throws,
 *  so without this the only trace is one line of console output — and a tree that
 *  cannot be re-read is a failure nobody can diagnose afterwards. */
function recordTree(name, nodes, stamp) {
  if (!stamp) return;
  try {
    mkdirSync(join(OUT, stamp), { recursive: true });
    writeFileSync(join(OUT, stamp, `${name}.xml`), adb('shell', 'cat', '/sdcard/punkgrid-ui.xml'));
  } catch {
    /* the run is already stopping; evidence must not add a second error */
  }
  console.log(`      (tree written to ${join(OUT, stamp, `${name}.xml`)})`);
}

/** The device's own viewport in pixels. `wm size` is the authority here; the walk
 *  needs it to tell a control that is small from a control the viewport cuts off. */
function viewportSize() {
  const m = /Physical size:\s*(\d+)x(\d+)/.exec(shell('wm size'));
  if (!m) throw new Error('wm size answered no viewport');
  return { w: Number(m[1]), h: Number(m[2]) };
}

const shortSide = (n) => Math.min(n.bounds.y2 - n.bounds.y1, n.bounds.x2 - n.bounds.x1);

// Gestures stay inside the measured scroll view, away from fixed controls.
function scrollRegion(nodes, vp) {
  const box = nodes
    .filter((n) => n.scrollable && whole(n))
    .map((n) => n.bounds)
    .sort((a, b) => (b.y2 - b.y1) * (b.x2 - b.x1) - (a.y2 - a.y1) * (a.x2 - a.x1))[0];
  if (!box) return null;
  return { y1: Math.max(0, box.y1), y2: Math.min(vp.h - 1, box.y2) };
}

// No measured scroll region means no safe gesture.
async function scrollRegionNow(vp) {
  const region = scrollRegion(dump(), vp);
  if (!region) throw new Error('No measured scroll region; refusing a gesture over fixed controls');
  return region;
}

/** A swipe that scrolls the content a node lives in. It starts inside the region that
 *  scrolls and on the node's own box where it can, and both of those are measured: on
 *  UI04 the `0.72 · height` recipe landed at y=2154, which in the build before the
 *  footer was pinned sat inside the button bar (2170–2302), so the gesture was
 *  swallowed by a bar that does not scroll and the proof reported "at best 116 px after
 *  scrolling" for a card that is 329 px tall. A node's clipped box is still scrollable
 *  content by definition — the viewport cut it, the footer did not — but the box the
 *  viewport reports for content below the fold is inverted, and its midpoint is a point
 *  the footer owns. Hence the clamp. */
function scrollSwipe(n, vp, region) {
  const cx = Math.round(vp.w / 2);
  const reach = Math.round((region.y2 - region.y1) * 0.38);
  const limit = Math.round(reach / 3);
  const claimed = Math.round((n.bounds.y1 + Math.min(n.bounds.y2, region.y2)) / 2);
  const mid = Math.max(region.y1 + limit, Math.min(region.y2 - limit, claimed));
  return mid > (region.y1 + region.y2) / 2
    ? `input swipe ${cx} ${mid} ${cx} ${Math.max(region.y1 + limit, mid - reach)} 300`
    : `input swipe ${cx} ${mid} ${cx} ${Math.min(region.y2 - limit, mid + reach)} 300`;
}

/** A swipe toward the end of the scroll, anchored in the region rather than the screen. */
function swipeDown(region, vp) {
  const span = region.y2 - region.y1;
  return `input swipe ${Math.round(vp.w / 2)} ${Math.round(region.y1 + span * 0.8)} ` +
    `${Math.round(vp.w / 2)} ${Math.round(region.y1 + span * 0.3)} 300`;
}

/** … and toward the top of it. */
function swipeUp(region, vp) {
  const span = region.y2 - region.y1;
  return `input swipe ${Math.round(vp.w / 2)} ${Math.round(region.y1 + span * 0.3)} ` +
    `${Math.round(vp.w / 2)} ${Math.round(region.y1 + span * 0.8)} 300`;
}

/** Scroll until a node reports a whole box, and answer with the largest short side
 *  it reaches. A control the viewport cuts off reports the cut, not its own height:
 *  at 200 % text UI01's Sign in button measured 1248x28 px with its label clipped to
 *  18, while the footer's buttons beside it measured a full 132. The walk cannot tell
 *  that from a genuinely small target by geometry alone — the clipped box does not
 *  even sit at the bottom of the *screen*, it sits at the bottom of the scroll
 *  viewport inside it — so the excuse has to be earned by scrolling. A button that
 *  stays short after four swipes is a failure, not a fold. */
async function scrollIntoView(n, vp, min) {
  const swipe = scrollSwipe(n, vp, await scrollRegionNow(vp));
  let best = shortSide(n);
  for (let i = 0; i < 4 && best < min; i += 1) {
    shell(swipe);
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    const seen = dump().filter((m) => label(m) === label(n) && m.bounds);
    for (const m of seen) best = Math.max(best, shortSide(m));
  }
  return best;
}

/** Back to the top of the scroll, so the screen the walk photographs and then taps
 *  on is the screen it says it audited. Stops when the tree stops moving. */
async function scrollToTop(vp) {
  const region = await scrollRegionNow(vp);
  const gesture = swipeUp(region, vp);
  let previous = '';
  for (let i = 0; i < 5; i += 1) {
    const before = dump().map((n) => `${label(n)}:${JSON.stringify(n.bounds)}`).join('|');
    if (before === previous) return;
    previous = before;
    shell(gesture);
    await new Promise((r) => setTimeout(r, SETTLE_MS));
  }
}

/** The whole of a scrolling screen, as one list of nodes. uiautomator does not put a
 *  row that is entirely below the fold into the tree at all — measured on the guest
 *  preview, where the four choices above the fold were in the dump while the chip row
 *  and the fiction mark below them were simply absent (52 nodes, none of them the
 *  disclosure the screen renders). So a promise about what a screen *says* has to be
 *  read the way a player reads it: start at the top, scroll to the end, keep every
 *  node seen on the way. Identity is class + description + text, because the bounds of
 *  the same node move with the scroll.
 *
 *  The merged list is for reading only. A tap still has to come from a dump taken with
 *  the node on screen — `reveal` does that — since a box recorded three swipes ago is
 *  no longer where the pixel is. */
async function readWholeScreen(vp) {
  await scrollToTop(vp);
  let region = await scrollRegionNow(vp);
  const seen = new Map();
  let previous = '';
  // The merged list is only a picture of one screen if the screen stayed put. On the
  // 200 % run of 2026-10-12 the read came back holding UI01 and UI02 and none of the
  // doors it had started on: the app had moved under the loop, and the merge printed
  // a tree that never existed on the device — which is the one thing this harness must
  // not hand a reader. So every read is measured against what the pass has already
  // seen. Two views of one scroll share most of their labels, because the swipe moves
  // the page by less than a screenful; a view of a different screen shares almost
  // nothing. That gap is the test.
  const overlap = (a, b) => {
    if (!a.size || !b.size) return 1;
    let shared = 0;
    for (const k of b) if (a.has(k)) shared += 1;
    return shared / Math.min(a.size, b.size);
  };
  for (let i = 0; i < 8; i += 1) {
    const nodes = dump();
    if (!nodes.length) throw new Error('Empty screen read; refusing a gesture with stale coordinates');
    region = scrollRegion(nodes, vp);
    if (!region) throw new Error('Scroll region disappeared during the read');
    const keys = new Set(nodes.map((n) => `${n.class}|${n.desc}|${n.text}`));
    if (seen.size && overlap(new Set(seen.keys()), keys) < 0.2) {
      throw new Error(`The screen changed under the read at swipe ${i}: ${spoken(nodes).slice(0, 200)}`);
    }
    for (const n of nodes) {
      const key = `${n.class}|${n.desc}|${n.text}`;
      if (!seen.has(key)) seen.set(key, n);
    }
    const now = nodes.map((n) => `${label(n)}:${JSON.stringify(n.bounds)}`).join('|');
    if (now === previous) break;
    previous = now;
    shell(swipeDown(region, vp));
    await new Promise((r) => setTimeout(r, SETTLE_MS));
  }
  await scrollToTop(vp);
  return [...seen.values()];
}

// A previously sighted box is not a valid tap after another swipe.
async function findToTap(want, vp, max = 6) {
  for (let i = 0; i <= max; i += 1) {
    const nodes = dump();
    const region = scrollRegion(nodes, vp);
    if (!region) throw new Error('No measured scroll region while finding a control');
    const found = contains(nodes, want);
    if (found && uncut(found, region)) return found;
    if (i === max) break;
    shell(swipeDown(region, vp));
    await new Promise((r) => setTimeout(r, SETTLE_MS));
  }
  return null;
}

async function auditTree(screen, nodes, dp) {
  const min = Math.round(44 * dp);
  const vp = viewportSize();
  const controls = nodes.filter((n) => n.clickable && n.bounds);
  check(screen, 'the tree is laid out (at least one clickable node)', controls.length > 0, `${controls.length}`);
  const named = controls.filter((n) => n.desc || n.text);
  // A row scrolled off the top or bottom edge comes back with clipped bounds — a
  // negative height is the viewport's doing, not the control's, and only a node
  // with real area can be measured against the touch target or tapped.
  const laidOut = controls.filter((n) => n.bounds.y2 > n.bounds.y1 && n.bounds.x2 > n.bounds.x1);
  const small = laidOut.filter((n) => shortSide(n) < min);
  // At 200 % text (SC 1.4.4) a screen's content is taller than the viewport, and the
  // control below the fold reports the cut rather than its own box. Every short node
  // therefore gets the scroll proof before it can be called a failure — and the proof
  // is what makes the fold an excuse that has to be earned.
  const reached = [];
  for (const n of small) reached.push({ n, after: await scrollIntoView(n, vp, min) });
  if (reached.length) await scrollToTop(vp);
  const tooSmall = reached.filter((r) => r.after < min).map((r) => r.n);
  check(screen, `${controls.length} clickable nodes all carry a label`, named.length === controls.length,
    `${named.length}/${controls.length} named`);
  check(screen, `every clickable node is at least 44 dp (${min} px) on its short side`, tooSmall.length === 0,
    `${laidOut.length} measured, ${controls.length - laidOut.length} outside the viewport, ` +
    `${reached.length} put through the scroll proof` +
      (tooSmall.length ? `: ${reached.filter((r) => r.after < min).map((r) => `${label(r.n)} ${r.n.bounds.x2 - r.n.bounds.x1}x${r.n.bounds.y2 - r.n.bounds.y1}, at best ${r.after} after scrolling`).join(', ')}` : ''));

  // SC 2.1.1 asks that every function be reachable from the keyboard. On Android
  // that begins with the node being focusable at all — a `Pressable` that is not
  // focusable can only ever be reached by a finger.
  const reachable = laidOut.filter((n) => n.focusable);
  check(screen, `every clickable node is focusable (SC 2.1.1)`, reachable.length === laidOut.length,
    `${reachable.length}/${laidOut.length} focusable` +
      (reachable.length === laidOut.length ? '' : `: ${laidOut.filter((n) => !n.focusable).map(label).join(', ')}`));
  auditReadingOrder(screen, nodes);
  return controls;
}

/** SC 2.4.3, read off the tree a screen reader reads: the nodes a TalkBack user
 *  meets in tree order should come top to bottom and left to right — inside every
 *  box on the screen, not only across the whole of it. Source cannot show this; it
 *  is the laid-out geometry that decides. `lib/reading-order.mjs` holds the rule and
 *  `scripts/reading-order.test.mjs` measures it against the trees already captured. */
function auditReadingOrder(screen, nodes) {
  const items = treeOrder(nodes);
  const sorted = readingOrder(nodes);
  const bad = items.findIndex((n, i) => n !== sorted[i]);
  check(screen, `${items.length} labelled nodes come in the order they are laid out (SC 2.4.3)`, bad === -1,
    bad === -1 ? '' : `“${label(items[bad])}” at x=${items[bad].bounds.x1},y=${items[bad].bounds.y1} is read before “${label(sorted[bad])}” at x=${sorted[bad].bounds.x1},y=${sorted[bad].bounds.y1}`);
}

function shoot(screen, stamp) {
  const png = adbRaw('exec-out', 'screencap', '-p');
  writeFileSync(join(OUT, stamp, `${screen}.png`), png);
  // Never pair a new screenshot with the device's cached XML after a failed dump.
  if (latestXml) writeFileSync(join(OUT, stamp, `${screen}.xml`), latestXml);
}

/** The one thing the tree is not allowed to know, and therefore the one thing the
 *  tree cannot prove: whether an image *arrived*.
 *
 *  `lib/art-check.mjs` holds the rule, the slot table and the wording of the claim, so
 *  a walk on a device and `scripts/art-check.test.mjs` over the evidence already on
 *  disk ask for the same thing. This function only pairs them up.
 *
 *  The geometry comes from the XML that `shoot()` wrote rather than from the node list
 *  the caller happens to hold, for two reasons that are the same reason: a band found
 *  from a tree that is not the tree the pixels were taken under measures the wrong row,
 *  and a verdict the test can never re-measure is not a verdict. What is on disk is what
 *  the device said at the instant the frame was photographed. */
async function checkArt(screen, stamp) {
  const vp = viewportSize();
  // Slots are grouped by the frame they are visible on: a screen can hand its bands to
  // two frames when the text scale pushes one of them below the fold.
  const byFrame = new Map();
  for (const slot of slotsFor(screen)) {
    const frame = frameOf(slot);
    if (!byFrame.has(frame)) byFrame.set(frame, []);
    byFrame.get(frame).push(slot);
  }
  for (const [frame, slots] of byFrame) {
    if (frame !== screen) await shootBand(frame, slots, stamp, vp);
    let img = null;
    let nodes = [];
    let read = '';
    try {
      img = readArt(join(OUT, stamp, `${frame}.png`));
      nodes = parseTree(readFileSync(join(OUT, stamp, `${frame}.xml`), 'utf8'), PKG);
    } catch (e) {
      read = e.message;
    }
    for (const verdict of artVerdicts(slots, nodes, img)) {
      check(frame, verdict.claim, verdict.pass, read || verdict.detail);
    }
  }
  // The screen is left where a player who has not scrolled would find it, because every
  // check after this one reads the frame it is standing on.
  await scrollToTop(vp);
}

/** Photograph the frame that shows a band.
 *
 *  Measured on the 2026-10-13 walks: at 100 % text every band sits inside the first
 *  viewport, but at 200 % UI01's row of place plates is not in the dump at all (the tree
 *  ends at the `THE GLASS HARBOR · WHERE A LIFE CAN START` label, y=2916 of a viewport
 *  that ends at 2545), and the guest consequence screen comes back from a decision
 *  scrolled past its own header, with no `ImageView` node in the frame. The claim is
 *  about the asset arriving, so the walk scrolls to it and shoots that frame under the
 *  slot's own name rather than calling a row the viewport never showed a flat plate.
 *
 *  The tree is the only way to know the band is in the picture — a bracketing row the
 *  dump no longer names is a row the viewport has cut — so the loop stops as soon as
 *  every pair on this frame is present, and shoots what it has after six swipes. A band
 *  that never comes back fails its own verdict instead of the harness. */
async function shootBand(frame, slots, stamp, vp) {
  await scrollToTop(vp);
  let nodes = dump();
  for (let i = 0; i < 6 && slots.some((s) => !s.region(nodes)); i += 1) {
    shell(swipeDown(await scrollRegionNow(vp), vp));
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    nodes = dump();
  }
  shoot(frame, stamp);
}

/** SC 2.1.1 read as behaviour rather than as an attribute: focusable nodes are
 *  useless if nothing moves the focus to them. Keyevents 19/20 are DPAD_UP/DOWN
 *  (measured, not assumed) and 61 is TAB. The walk never sends DPAD_CENTER (23),
 *  because on UI04 the focused control is a choice and activating it would commit a
 *  command to a real world. */
async function auditDpadFocus(screen, stamp) {
  const before = dump();
  const focusable = before.filter((n) => n.focusable && n.bounds);
  check(screen, `${focusable.length} nodes in the tree are focusable`, focusable.length > 0, `${focusable.length}`);
  const wasFocused = before.filter((n) => n.focused).map(label).join(', ') || 'none';
  shell('input keyevent 20');
  await new Promise((r) => setTimeout(r, SETTLE_MS));
  const after = dump();
  const isFocused = after.filter((n) => n.focused).map(label).join(', ');
  check(screen, 'the D-pad moves focus to a node of this app (SC 2.1.1)', !!isFocused,
    `focused before: ${wasFocused}; after keyevent 20: ${isFocused || 'still none'}`);
  // The tree cannot say what a focused control *looks* like, and SC 2.4.7 is about
  // exactly that, so the run keeps the frame the focus produced. It is the only
  // evidence of the drawn ring a reader can check without a keyboard attached.
  if (isFocused) shoot(`${screen} — ring`, stamp);
  shell('input keyevent 19');
}

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  mkdirSync(join(OUT, stamp), { recursive: true });
  const dp = density();
  const apkPath = adb('shell', 'pm', 'path', PKG).trim().split('\n').find((p) => p.endsWith('/base.apk'))?.replace(/^package:/, '');
  if (!apkPath) throw new Error('Installed base APK not found');
  const apkSha256 = adb('shell', 'sha256sum', apkPath).trim().split(/\s+/)[0];

  // First the world the measured pass reads. It is prepared in its own pass with
  // its own `pm clear`, because signing in, creating a world and then wiping the
  // session is exactly the state a returning customer arrives in.
  console.log('preparing the account world…');
  await ensureWorld(stamp);

  shell(`pm clear ${PKG}`);
  // The address comes before anything that talks to a server: `pm clear` just
  // erased both the session and any override a previous run left behind.
  await setServerAddress('measure', dp, stamp);
  // After the address, before any other screen is read: the scale is what SC 1.4.4 is
  // measured at, and a cold start is what makes RN pick it up. UI10 was audited inside
  // `setServerAddress` at the scale the device came in with, because that is where the
  // address has to be typed; so the screen is opened again and measured once more here,
  // and its evidence file is overwritten by the run that is at the right scale.
  if (FONT_SCALE) {
    shell(`settings put system font_scale ${FONT_SCALE}`);
    stop();
    launch();
    // The link goes to a running app, not to one that is starting: a deep link sent
    // during cold start is dropped by the router (measured, in `setServerAddress`).
    await until('Sign in', 120_000);
    deepLink('account');
    const scaled = await until('Server address', 60_000);
    await auditTree('UI10 account', scaled.nodes, dp);
    shoot('UI10 account', stamp);
    console.log(`      (screens after the server address are measured at font_scale ${FONT_SCALE})`);
  }
  await toWelcome();

  // UI01 — welcome, signed out. A cold start after `pm clear` also rebuilds the
  // key store, so this is the slowest hop in the walk.
  let { nodes, hit } = await until('Sign in', 120_000);
  let screen = 'UI01 welcome';
  await auditTree(screen, nodes, dp);
  shoot(screen, stamp);
  check(screen, 'shows the product name', !!contains(nodes, 'PunkGrid'));
  check(screen, 'says the player is not signed in', !!contains(nodes, 'Not signed in'));
  check(screen, 'carries the 18+ line', !!contains(nodes, '18+'));
  check(screen, 'offers both genesis buttons', !!contains(nodes, 'Create a Life') && !!contains(nodes, 'Surprise Me'),
    nodes.map(label).join(' | '));
  await checkArt(screen, stamp);
  if (!hit) throw new Error('the app never reached UI01');

  // F02 — the guest preview: the one door a signed-out player can walk through
  // without an account or a request. Reached by the deep link the manifest already
  // carries, because the route is the contract and the button is one way onto it.
  // The wait names the subtitle and the footer, never a chip: the screen is taller
  // than one viewport, and a row that sits entirely below the fold is not in the tree
  // at all (measured — the first version waited on “No server”, timed out twice, and
  // reported a door that was open as “the guest preview never opened”).
  deepLink('preview');
  let opened = await until('nothing here is saved or sent', 60_000);
  // Measured: a link that arrives while the app is settling is dropped by the
  // router, so the walk sends it a second time before it calls the door shut.
  if (!opened.hit) {
    console.log('      (the preview link reached a settling app — sending it again)');
    deepLink('preview');
    opened = await until('nothing here is saved or sent', 60_000);
  }
  ({ nodes, hit } = opened);
  screen = 'F02 guest preview';
  await auditTree(screen, nodes, dp);
  shoot(screen, stamp);
  check(screen, 'says out loud that nothing is saved or sent', !!contains(nodes, 'nothing here is saved or sent'),
    nodes.map(label).join(' | '));
  await checkArt(screen, stamp);
  // What the screen *says* is read top to bottom, because the doors, the three facts
  // and the fiction mark together do not fit in one dump at any text scale.
  const preview = await readWholeScreen(viewportSize());
  check(screen, 'offers four named choices',
    ['Brief staff', 'Confront Mara', 'Trace the buyer', 'Set terms'].every((l) => !!contains(preview, l)),
    spoken(preview));
  check(screen, 'states the three facts that make it a guest door',
    ['No account', 'No server', '18+ only'].every((l) => !!contains(preview, l)), spoken(preview));
  check(screen, 'carries the fiction mark on the screen that shows fiction',
    !!contains(preview, 'Fiction, generated by AI'), spoken(preview));
  if (!hit) throw new Error('the guest preview never opened');

  const trace = await findToTap('Trace the buyer', viewportSize());
  if (!trace) throw new Error(`the preview offers no door to take (saw: ${spoken(dump())})`);
  ({ nodes } = await tapTo(trace, 'Sign in to begin a saved life'));
  screen = 'F02 guest consequence';
  await auditTree(screen, nodes, dp);
  shoot(screen, stamp);
  await checkArt(screen, stamp);
  const outcome = await readWholeScreen(viewportSize());
  check(screen, 'answers the decision in prose', !!contains(outcome, 'Asterion bought the dockside lease'),
    spoken(outcome));
  check(screen, 'says what moved', !!contains(outcome, 'You now know one fact'), spoken(outcome));
  check(screen, 'offers sign-in for a new saved life', !!contains(outcome, 'Sign in to begin a saved life'),
    spoken(outcome));
  check(screen, 'states what an account would add', !!contains(outcome, 'ledger'), spoken(outcome));
  check(screen, 'does not promise to transfer the preview choice', !!contains(outcome, 'not transferred'), spoken(outcome));

  // The state machine is part of the promise: choosing again costs nothing, and the
  // four doors come back on the same screen.
  ({ nodes } = await tapTo(contains(dump(), 'Make a different choice'), 'Skip the preview, take me in'));
  screen = 'F02 guest preview';
  const again = await readWholeScreen(viewportSize());
  check(screen, 'gives the four doors back after a choice',
    ['Brief staff', 'Confront Mara', 'Trace the buyer', 'Set terms'].every((l) => !!contains(again, l)),
    spoken(again));

  // Back to UI01 by the screen's own exit, so the rest of the walk is standing where
  // a player who skipped the preview would stand. Read after the scroll pass, because
  // a box recorded three swipes ago is not where the pixel is.
  nodes = dump();
  ({ nodes, hit } = await tapTo(contains(nodes, 'Skip the preview, take me in'), 'Sign in'));
  screen = 'UI01 welcome';
  check(screen, 'lets the player out of the preview without an account', !!hit, nodes.map(label).join(' | '));
  if (!hit) throw new Error('the preview never let go of the app');

  // The dev sign-in door. It carries no UI number of its own: Master §5.3 gives UI02
  // to the genesis choice, which is measured at the end of this run. This route only
  // exists because `PUNKGRID_DEV_USERS` stands in for the account port until one is
  // wired up, so the walk names it for what it is.
  ({ nodes, hit } = await tapTo(hit, 'Enter the world'));
  screen = 'dev sign-in';
  await auditTree(screen, nodes, dp);
  shoot(screen, stamp);
  check(screen, 'names the dev allowlist out loud', !!contains(nodes, 'PUNKGRID_DEV_USERS'));
  check(screen, `states the server address (${HOST})`, !!contains(nodes, HOST), nodes.map(label).join(' | '));
  if (!hit) throw new Error('the sign-in screen never rendered');

  // UI07 — the library.
  ({ nodes, hit } = await tapTo(hit, 'Multiverse'));
  screen = 'UI07 library';
  await auditTree(screen, nodes, dp);
  shoot(screen, stamp);
  const row = contains(nodes, 'The Glass Harbor');
  check(screen, 'lists the account world by title, not by id', !!row);
  check(screen, 'shows the version and world time', !!contains(nodes, 'Version '));
  check(screen, 'marks the world Active', !!contains(nodes, 'Active'));
  check(screen, 'never prints an internal world id', !nodes.some((n) => /world_[A-Z0-9]{12}/.test(`${n.text}${n.desc}`)));
  await checkArt(screen, stamp);
  if (!row) throw new Error(`no world on UI07 after the prepared pass (saw: ${nodes.map(label).join(' | ')})`);

  // UI04 — the scene. The hop waits for the footer, and the loading skeleton renders
  // that same footer, so the tree is read again until the header states a version.
  // Measured on the 200 % run of 2026-10-12: the walk audited a screen still on
  // “Reading the world” and reported the scene it had not yet received.
  await tapTo(row, '· version ');
  // `· version N` is the play screen's own subtitle. UI07's row says `Version N ·`
  // with a capital V, so it cannot answer this wait while the hop is still in flight.
  nodes = await untilNodes(playShown, 90_000);
  screen = 'UI04 world';
  await auditTree(screen, nodes, dp);
  // Back to the top before the photograph is taken and before the fold is measured:
  // both of them claim to say what a player sees without touching the screen.
  const vp = viewportSize();
  await scrollToTop(vp);
  nodes = dump();
  shoot(screen, stamp);
  // The walk is repeatable, so it reads the version it is standing on instead of
  // assuming a virgin world: every run takes one choice and moves it by one.
  const head = nodes.map((n) => `${n.text} ${n.desc}`).join(' ');
  const version = Number(/version (\d+)/.exec(head)?.[1] ?? NaN);
  check(screen, `states the version it is showing (${version})`, Number.isFinite(version), head.slice(0, 80));
  check(screen, 'titles the scene with the world, not the rulepack id', !!contains(nodes, 'The Glass Harbor'));
  await checkArt(screen, stamp);
  check(screen, 'shows an episode heading', !!/Episode \d+/.test(head), head.slice(0, 80));
  check(screen, 'offers prose', !!nodes.some((n) => n.text.length > 80), 'no long text node');
  // Read from the unscrolled tree, because this is the one screen where the story is
  // the product. A heading the viewport cuts off comes back as an inverted box — the
  // scene prose on UI04 measured `[48,1214][1296,1161]` while a pinned footer took
  // 1 831 of the screen's 2 992 px, and “offers prose” passed on that clipped node.
  // Geometry is what tells the two apart, so geometry is what gets asserted.
  const kicker = nodes.find((n) => /Episode \d+/.test(n.text) && n.text.length < 60);
  const body = kicker ? nodes[nodes.indexOf(kicker) + 1] : null;
  check(screen, 'the scene heading is inside the first viewport',
    !!kicker && whole(kicker) && kicker.bounds.y2 <= vp.h,
    kicker ? `“${kicker.text}” at y=${kicker.bounds.y1}..${kicker.bounds.y2} of ${vp.h}` : 'no heading in the unscrolled tree');
  check(screen, 'the prose begins above the fold',
    !!body && whole(body) && body.bounds.y2 <= vp.h && body.text.length > 80,
    body ? `“${body.text.slice(0, 28)}…” at y=${body.bounds.y1}..${body.bounds.y2} of ${vp.h}` : 'nothing follows the heading');
  // A choice button announces itself as "Choice A of 4. <label>. <copy>" (the
  // ordinal is cards.tsx speaking the mockup's A/B/C badge), so the pack label is a
  // prefix of what remains after that sentence — not of the whole description.
  const unbadge = (n) => `${n.desc || n.text}`.replace(/^Choice [A-Z] of \d+\.\s*/, '');
  const packLabel = /^(Brief staff|Confront Mara|Investigate the buyer|Open negotiation|Reject the sale|Verify the leaked memo)\b/;
  if (Number(shell('settings get system font_scale').trim()) === 1) {
    const first = nodes.find((n) => n.clickable && /^Choice A of \d+\./.test(n.desc));
    const region = scrollRegion(nodes, vp);
    check(screen, 'the entire first choice card fits above the fold at 100% text',
      !!first && !!region && uncut(first, region),
      first ? `${JSON.stringify(first.bounds)} in ${JSON.stringify(region)}` : 'no first choice in the unscrolled tree');
  }
  // The doors are read from the whole scroll, not from the tree `auditTree` was handed.
  // A row entirely below the fold does not enter uiautomator's tree at all, and at
  // 200 % text the prose is what fills the first viewport: measured 2026-10-12, the
  // audit saw 6 clickable nodes (the six secondary buttons), the four doors appeared
  // only in the dumps taken after the first swipe, and the walk stopped on “no choice
  // to take” over a screen that was offering four.
  const choices = (await readWholeScreen(vp)).filter((n) => n.clickable && packLabel.test(unbadge(n)));
  check(screen, 'offers at least one of the pack’s choices as a named control', choices.length >= 1,
    choices.map((n) => unbadge(n).split('.')[0]).join(', ') || spoken(nodes));
  if (!choices.length) throw new Error(`no choice to take (saw: ${spoken(nodes)})`);
  // 44 dp and focusable are geometry, and at 200 % there was no door in the tree for
  // `auditTree` to measure. The fold is an excuse that has to be earned, not a licence
  // to leave the primary controls of the play screen unaudited, so the door the walk is
  // about to press is measured from the dump that shows it on screen.
  const tabs = ['Life Stream', 'Genesis', 'Chronicle', 'Multiverse'].map((name) => find(nodes, name));
  check(screen, 'all four navigation tabs are visible without scrolling',
    tabs.every((tab) => tab && whole(tab) && tab.bounds.y2 <= vp.h), tabs.map((tab) => tab?.desc ?? 'missing').join(', '));
  await tapTo(find(dump(), 'Multiverse'), 'Initiate new consciousness thread');
  await tapTo(find(dump(), 'Genesis'), 'Begin a life');
  await tapTo(find(dump(), 'Life Stream'), '· version ');
  const returned = await untilNodes(playShown);
  check(screen, 'Multiverse and Genesis preserve the selected life on return',
    !!contains(returned, `· version ${version}`) && !!contains(returned, `Episode ${version}`), spoken(returned));
  await tapTo(find(dump(), 'Chronicle'), 'committed scenes');
  await tapTo(find(dump(), 'Life Stream'), '· version ');
  check(screen, 'Chronicle returns to the selected life', !!contains(await untilNodes(playShown), `· version ${version}`));
  const min = Math.round(44 * dp);
  const door = await findToTap(choices[0].desc, vp);
  check(screen, `the door reached on the scroll is at least 44 dp (${min} px) on its short side`,
    !!door?.bounds && shortSide(door) >= min,
    door?.bounds ? `${door.bounds.x2 - door.bounds.x1}x${door.bounds.y2 - door.bounds.y1}` : 'no box');
  if (!door) throw new Error('No fully visible choice to press');

  // The command, and the queue that follows it.
  tap(door);
  // Back to the top before the header is read. The tap above came from a scrolled
  // position, and the version line lives at the top of the scroll: measured on the
  // 200 % run of 2026-10-12, the tree after the choice had `Episode 5` and no
  // `version 5` at all, because the screen was still standing on the doors and the
  // header was clipped to `[48,187][739,54]`.
  await scrollToTop(vp);
  ({ nodes } = await until(`version ${version + 1}`, 90_000));
  screen = 'UI04 after the choice';
  await auditTree(screen, nodes, dp);
  shoot(screen, stamp);
  check(screen, `the header moved from version ${version} to ${version + 1}`, !!contains(nodes, `version ${version + 1}`));
  const after = nodes.map((n) => `${n.text} ${n.desc}`).join(' ');
  // The engine publishes exactly one episode per committed version, so version
  // N+1 must read Episode N+1 (play.ts names it by the episode count).
  check(screen, `the next episode is on screen (Episode ${version + 1})`, new RegExp(`Episode ${version + 1}`).test(after), after.slice(0, 80));

  // UI09 — history, behind the footer's disclosure. The panel is opened, audited and
  // photographed before the hop, because the closed footer is what the fold above is
  // measured on and the open one is what the reading order and the 44 dp targets have
  // to survive as well.
  const toggle = await findToTap('World actions', vp);
  if (!toggle) throw new Error(`no World actions control on the play screen (saw: ${spoken(dump())})`);
  tap(toggle);
  if (!await findToTap('Archive', vp)) throw new Error(`no visible Archive action (saw: ${spoken(dump())})`);
  const panel = dump();
  await auditTree('UI04 world actions', panel, dp);
  shoot('UI04 world actions', stamp);

  await scrollToTop(vp);
  const history = await findToTap('History', vp);
  if (!history) throw new Error('the History button disappeared');
  ({ nodes } = await tapTo(history, 'committed scenes'));
  screen = 'UI09 history';
  await auditTree(screen, nodes, dp);
  shoot(screen, stamp);
  const historyRegion = scrollRegion(nodes, vp);
  const rows = nodes.filter((n) => n.clickable && historyRegion && uncut(n, historyRegion)
    && /^Episode \d+ · events \d+/.test(n.desc || n.text));
  const published = rows.filter((row) => {
    const status = (row.desc || row.text).match(/Published · version \d+/)?.[0];
    return status && nodes.some((n) => n.text === status && whole(n)
      && n.bounds.y1 >= row.bounds.y1 && n.bounds.y2 <= row.bounds.y2
      && n.bounds.x1 >= row.bounds.x1 && n.bounds.x2 <= row.bounds.x2);
  });
  check(screen, 'shows at least two complete episode rows', rows.length >= 2, `${rows.length} rows`);
  check(screen, 'every complete row visibly says it is published and names its version', published.length === rows.length,
    `${published.length} status lines for ${rows.length} complete rows`);
  await checkArt(screen, stamp);

  // Last, because it presses keys: on this screen nothing is tapped afterwards, and
  // a scrolled tree would not mislead a later hop.
  await auditDpadFocus('UI09 history — focus', stamp);

  // UI02 and UI03 — the two screens a new player walks through before a world exists.
  // Measured 2026-10-12: the prepared pass has always *passed through* UI03 to make
  // the world it measures, but no pass has ever read either screen's tree, so their
  // reading order, touch targets and fold have never been a verdict — while they are
  // the first two screens of the only path a new customer takes. Both are opened by
  // their own route, and neither is asked to create a world: the walk measures the
  // door, not the quota behind it.
  screen = 'UI02 genesis';
  const genesis = await toRoute('genesis', genesisShown);
  await auditTree(screen, genesis, dp);
  shoot(screen, stamp);
  check(screen, 'offers both doors', !!contains(genesis, 'Surprise Me') && !!contains(genesis, 'Create a Life'), spoken(genesis));
  check(screen, 'says what the one-button door costs', !!contains(genesis, 'one world from your quota'), spoken(genesis));
  check(screen, 'carries the fiction mark', !!contains(genesis, 'fictional'), spoken(genesis));
  await checkArt(screen, stamp);
  if (!genesisShown(genesis)) throw new Error(`the genesis screen never rendered (saw: ${spoken(genesis).slice(0, 200)})`);

  screen = 'UI03 setup';
  const setup = await toRoute('setup', setupShown);
  await auditTree(screen, setup, dp);
  const vp3 = viewportSize();
  await scrollToTop(vp3);
  const top3 = dump();
  shoot(screen, stamp);
  // The premise is this screen's pitch, so it is what the fold is about here — the
  // same claim UI04 makes about its prose, measured the same way: geometry, not
  // presence in a tree that a pinned footer can fill with buttons.
  const premise = top3.find((n) => /Helix Transit/.test(n.text));
  check(screen, 'shows the premise of the world it creates', !!contains(top3, 'The Glass Harbor') && !!premise, spoken(top3));
  check(screen, 'the premise is inside the first viewport',
    !!premise && whole(premise) && premise.bounds.y2 <= vp3.h,
    premise ? `“${premise.text.slice(0, 28)}…” at y=${premise.bounds.y1}..${premise.bounds.y2} of ${vp3.h}` : 'no premise in the unscrolled tree');
  await checkArt(screen, stamp);
  const whole3 = await readWholeScreen(vp3);
  check(screen, 'asks the three questions the setup answers',
    ['Where', 'When', 'Who'].every((q) => !!contains(whole3, q)), spoken(whole3));
  check(screen, 'names the places it offers',
    ['Singapore', 'Copenhagen', 'Lagos'].every((p) => !!contains(whole3, p)), spoken(whole3));
  // The cast strip is where the portraits live, and `ArtPlate` renders nothing for a
  // person the bundle has no file for — so the art slot can say a row of plates was
  // painted while the screen quietly shows five of six people. The names are the claim
  // the tree can make: every person the rulepack has, each announced together with the
  // role under it. Read from the whole scroll, because the row sits below the fold at
  // 200 % text and on the second wrapped line at 100 %.
  check(screen, 'names every person in the cast it shows',
    CAST.length > 0 && CAST.every((name) => !!contains(whole3, name)), spoken(whole3));
  check(screen, 'offers the create door on a combination the engine accepts',
    !!contains(whole3, 'Manifest consciousness'), spoken(whole3));
  check(screen, 'carries the fiction mark', !!contains(whole3, 'Fiction'), spoken(whole3));
  if (!setupShown(setup)) throw new Error(`the setup screen never rendered (saw: ${spoken(setup).slice(0, 200)})`);

  // The stamp directory is only evidence once the run has reached its end. A walk
  // that is still going, or that died at screen three, leaves trees in it — and
  // `reading-order.test.mjs` reads whatever stamp is newest, so without this marker a
  // half-finished pass silently shrank the suite (measured 2026-10-13: 20 tests became
  // 13 and stayed green). Written before the failures are printed, because a complete
  // run that failed is still a complete tree set worth measuring.
  writeFileSync(
    join(OUT, stamp, 'walk.json'),
    `${JSON.stringify({ stamp, fontScale: FONT_SCALE, baseUrl: BASE_URL, apkSha256, serial: SERIAL, strict: process.env.PUNKGRID_STRICT_WALK === '1', checks, passed: checks - failures.length, failures }, null, 2)}\n`,
  );

  console.log(`\n${checks - failures.length}/${checks} checks passed. Screenshots: ${join(OUT, stamp)}`);
  if (failures.length) {
    console.error('\nFailures:');
    for (const f of failures) console.error(`  ${f.screen}: ${f.what}${f.saw ? ` — saw ${f.saw}` : ''}`);
    for (const c of crashNotes()) console.error(`  crash buffer: ${c.trim()}`);
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(`device walk stopped: ${e.message}`);
    for (const c of crashNotes()) console.error(`  crash buffer: ${c.trim()}`);
    process.exitCode = 1;
  })
  .finally(() => {
    // The device is shared, and a font scale left at 2.0 is a workstation that looks
    // broken to the next person who picks it up.
    if (FONT_SCALE) shell('settings put system font_scale 1.0');
  });
