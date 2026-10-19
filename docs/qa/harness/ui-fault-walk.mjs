// Kjører enhetsgangen med feilinjeksjon i tjeneren (se ui-fault-server.mjs på
// port 3112) og skriver et stempel «ui-fault-<tid>» under $PUNKGRID_OUT.
// Kjør fra repo-rot med PUNKGRID_OUT=docs/qa/evidence/ui-fault; stemplene i den
// mappa er flatta ned til bare tida.
import { readFileSync } from 'node:fs';

process.env.PUNKGRID_STRICT_WALK = '1';

const file = new URL('../../apps/mobile/scripts/device-walk.mjs', import.meta.url);
let source = readFileSync(file, 'utf8').split('\nmain()')[0];
source = source.replaceAll("'./lib/reading-order.mjs'", JSON.stringify(new URL('./lib/reading-order.mjs', file).href))
  .replaceAll("'./lib/art-check.mjs'", JSON.stringify(new URL('./lib/art-check.mjs', file).href))
  .replaceAll('import.meta.url', JSON.stringify(file.href))
  .replace('const BASE_URL =', 'let BASE_URL =')
  .replace('const HOST =', 'let HOST =');
source += `
const assert = (await import('node:assert/strict')).default;
const scope = process.env.PUNKGRID_FAULT_PHASE === 'lifecycle' ? 'lifecycle' : 'full';
const stamp = 'ui-fault-' + new Date().toISOString().replace(/[:.]/g, '-');
console.log('CHECKPOINT', stamp);
mkdirSync(join(OUT, stamp), { recursive: true });
const originalScale = shell('settings get system font_scale').trim();
const originalAnimationScale = shell('settings get global transition_animation_scale').trim();
const installedApk = adb('shell', 'pm', 'path', PKG).trim().replace(/^package:/, '');
const apkSha256 = adb('shell', 'sha256sum', installedApk).trim().split(' ')[0];
let originalAddress;
const observations = [];
const control = async (route = '/status') => {
  // Synchronous ADB calls delay socket-close processing past the server's keep-alive timeout.
  const response = await fetch((process.env.PUNKGRID_FAULT_CONTROL_URL ?? 'http://127.0.0.1:3112') + route, {
    method: route === '/status' ? 'GET' : 'POST', headers: { connection: 'close' },
  });
  assert.ok(response.ok, 'fixture control answered');
  return response.json();
};
const record = async (name) => {
  let nodes = [];
  try {
    nodes = dump();
  } catch (error) {
    console.error('UI read failed', name, error.message);
  }
  if (nodes.length) shoot(name, stamp);
  else writeFileSync(join(OUT, stamp, name + '.png'), adbRaw('exec-out', 'screencap', '-p'));
  const state = await control();
  observations.push({ name, uiRead: nodes.length > 0, state });
  writeFileSync(join(OUT, stamp, 'observations.json'), JSON.stringify(observations, null, 2));
  assert.ok(name === 'failure' || nodes.length > 0, 'Fresh UI read required for ' + name);
  console.log('MEASURED', name, JSON.stringify(state.worlds));
  return nodes;
};
const press = async (name, { exact = true, enabled = true } = {}) => {
  const vp = viewportSize();
  for (let i = 0; i < 9; i++) {
    const nodes = dump();
    const region = scrollRegion(nodes, vp);
    const node = nodes.find((n) => (exact ? n.desc === name : n.desc.includes(name)) && whole(n));
    if (node && (!region || uncut(node, region) || node.bounds.y1 >= region.y2)) {
      const xml = adb('shell', 'cat', '/sdcard/punkgrid-ui.xml');
      const raw = (xml.match(/<node\\b[^>]*>/g) ?? []).find((r) => r.includes('content-desc="' + node.desc + '"'));
      assert.ok(raw, 'control XML found for ' + name);
      assert.equal(raw.includes('enabled="true"'), enabled, 'enabled state for ' + name);
      tap(node);
      await new Promise((r) => setTimeout(r, SETTLE_MS));
      return;
    }
    assert.ok(region, 'scroll region for ' + name);
    shell(swipeDown(region, vp));
    await new Promise((r) => setTimeout(r, SETTLE_MS));
  }
  throw new Error('No fully visible control: ' + name + ' — ' + spoken(dump()));
};
const top = () => scrollToTop(viewportSize());
const actionsEnabled = () => (adb('shell', 'cat', '/sdcard/punkgrid-ui.xml').match(/<node\\b[^>]*>/g) ?? [])
  .some((raw) => raw.includes('content-desc="World actions"') && raw.includes('enabled="true"'));
const waitVersion = async (version, status = 'Active') => {
  await top();
  const nodes = await untilNodes((ns) => !!contains(ns, '· version ' + version)
    && ns.some((n) => whole(n) && (n.desc || n.text).startsWith(status + ' · arc:'))
    && !!find(ns, 'World actions') && actionsEnabled(), 60000);
  assert.ok(contains(nodes, '· version ' + version), 'UI version ' + version + ': ' + spoken(nodes));
  assert.ok(nodes.some((n) => whole(n) && (n.desc || n.text).startsWith(status + ' · arc:')), 'UI status ' + status + ': ' + spoken(nodes));
  assert.ok(actionsEnabled(), 'published scene ready for interaction');
  return nodes;
};
const signOut = async () => {
  deepLink('account');
  const opened = await until('Server address', 60000);
  assert.ok(accountField(opened.nodes));
  if (contains(await readWholeScreen(viewportSize()), 'Sign out')) {
    await press('Sign out');
    const welcome = await untilNodes(welcomeShown, 60000);
    assert.ok(welcomeShown(welcome), 'welcome shown after sign out');
    deepLink('account');
    assert.ok(accountField((await until('Server address', 60000)).nodes));
  }
  const signedOut = await readWholeScreen(viewportSize());
  assert.ok(contains(signedOut, 'Not signed in'), 'account confirms signed out');
  assert.ok(!contains(signedOut, 'Sign out'), 'account offers no Sign out');
};
try {
  shell('settings put system font_scale 1.0');
  // UIAutomator waits for idle; the animated live region never becomes idle.
  shell('settings put global transition_animation_scale 0');
  deepLink('account');
  const account = await until('Server address', 60000);
  originalAddress = addressInUse(account.nodes);
  assert.ok(originalAddress?.startsWith('http'), 'saved original address recorded, not the editable draft');
  await signOut();
  await setServerAddress('prepare', undefined, stamp);
  await toWelcome();
  await press('Sign in');
  assert.ok((await until('Enter the world')).hit);
  await press('Enter the world');
  await toLibrary();
  if (scope === 'lifecycle') {
    await press('The Glass Harbor', { exact: false });
    await waitVersion(3, 'Paused');
    const fixture = await control();
    assert.equal(fixture.worlds.length, 1);
    assert.equal(fixture.worlds[0].status, 'paused');
    assert.equal(fixture.worlds[0].version, 3);
    assert.equal(fixture.episodes.length, 3);
    assert.ok(fixture.episodes.every((episode) => episode.status === 'published'));
    await record('lifecycle-01-paused-fixture');
    await press('Resume');
    await waitVersion(3);
    const resumedFixture = await control();
    assert.equal(resumedFixture.worlds.length, 1);
    assert.equal(resumedFixture.worlds[0].status, 'active');
    assert.equal(resumedFixture.worlds[0].version, 3);
    assert.equal(resumedFixture.episodes.length, 3);
    assert.ok(resumedFixture.episodes.every((episode) => episode.status === 'published'));
    await record('lifecycle-02-resumed');
  } else {
    await press('Initiate new consciousness thread');
    assert.ok((await until('Surprise Me')).hit);
    await press('One button. Surprise Me.', { exact: false });
    await waitVersion(1);
    const created = await control();
    assert.equal(created.worlds.length, 1);
    assert.equal(created.worlds[0].version, 1);
    assert.equal(created.episodes[0].status, 'published');
    await record('01-created');

    await control('/hold');
    await press('Brief staff', { exact: false });
    const pending = await until('The Reality Engine is writing the scene', 45000);
    assert.ok(pending.hit, 'pending state visible: ' + spoken(pending.nodes));
    await record('02-pending');
    const held = await control();
    assert.equal(held.worlds[0].version, 2);
    assert.equal(held.episodes.at(-1).status, 'pending');
    const heldPosts = held.requests.length;
    await top();
    await press('Surprise me', { enabled: false });
    assert.equal((await control()).requests.length, heldPosts);
    await control('/release');
    await waitVersion(2);
    await record('03-published-after-release');

    await control('/drop-next');
    await press('Brief staff', { exact: false });
    await top();
    const error = await until('Try again', 45000);
    assert.ok(error.hit, 'retry offered after dropped acknowledgement');
    const allError = await readWholeScreen(viewportSize());
    assert.ok(contains(allError, 'The connection was lost before confirmation'), 'honest unknown-commit copy');
    const dropped = await control();
    assert.equal(dropped.worlds[0].version, 3);
    const droppedChoice = dropped.requests.filter((r) => r.path.endsWith('/choices')).at(-1);
    await record('04-dropped-acknowledgement');
    await top();
    const allowed = await control('/allow');
    const beforeRetry = allowed.requests.filter((r) => r.path.endsWith('/choices')).length;
    await press('Try again');
    await waitVersion(3);
    const retried = await control();
    const choices = retried.requests.filter((r) => r.path.endsWith('/choices'));
    assert.ok(choices.length > beforeRetry, 'manual retry sends the unconfirmed command again');
    assert.ok(choices.slice(1).every((r) => r.commandId === droppedChoice.commandId));
    assert.ok(choices.slice(beforeRetry).some((r) => r.status >= 200 && r.status < 300));
    assert.deepEqual(choices.at(-1).body, droppedChoice.body);
    assert.equal(retried.worlds[0].version, 3);
    assert.equal(retried.episodes.length, 3);
    await record('05-safe-retry');
  }

  await press('World actions');
  assert.ok((await untilNodes((ns) => !!find(ns, 'Pause'))).some((n) => n.desc === 'Pause'));
  await press('Pause');
  await waitVersion(3, 'Paused');
  const paused = await control();
  assert.equal(paused.worlds.length, 1);
  assert.equal(paused.worlds[0].status, 'paused');
  assert.equal(paused.worlds[0].version, 3);
  assert.equal(paused.episodes.length, 3);
  assert.ok(paused.episodes.every((episode) => episode.status === 'published'));
  await record('06-paused');
  await press('World actions');
  const beforeDisabled = (await control()).requests.length;
  await press('Brief staff', { exact: false, enabled: false });
  assert.equal((await control()).requests.length, beforeDisabled);
  await top();
  await press('Resume');
  await waitVersion(3);
  const resumed = await control();
  assert.equal(resumed.worlds.length, 1);
  assert.equal(resumed.worlds[0].status, 'active');
  assert.equal(resumed.worlds[0].version, 3);
  assert.equal(resumed.episodes.length, 3);
  assert.ok(resumed.episodes.every((episode) => episode.status === 'published'));
  for (const name of ['Surprise me', 'Choice A of ']) {
    await top();
    const vp = viewportSize();
    assert.ok(await findToTap(name, vp), 'resumed control revealed: ' + name);
    const nodes = dump();
    const region = scrollRegion(nodes, vp);
    const node = nodes.find((n) => n.clickable && region && uncut(n, region)
      && (name === 'Surprise me' ? n.desc === name : /^Choice A of \\d+\\./.test(n.desc)));
    assert.ok(node, 'fully visible resumed control: ' + name);
    const raw = (adb('shell', 'cat', '/sdcard/punkgrid-ui.xml').match(/<node\\b[^>]*>/g) ?? [])
      .find((r) => r.includes('content-desc="' + name + (name === 'Surprise me' ? '"' : '')));
    assert.ok(raw, 'fresh resumed control XML: ' + name);
    assert.ok(raw.includes('enabled="true"'), 'resumed control enabled: ' + name);
  }
  await top();
  await record('07-resumed');

  await press('World actions');
  assert.ok((await untilNodes((ns) => !!find(ns, 'Archive'))).some((n) => n.desc === 'Archive'));
  await press('Archive');
  await waitVersion(3, 'Archived');
  const archived = await control();
  assert.equal(archived.worlds.length, 1);
  assert.equal(archived.worlds[0].status, 'archived');
  assert.equal(archived.worlds[0].version, 3);
  assert.equal(archived.episodes.length, 3);
  assert.ok(archived.episodes.every((episode) => episode.status === 'published'));
  await record('08-archived');
  await press('World actions');
  const beforeArchived = (await control()).requests.length;
  await press('Brief staff', { exact: false, enabled: false });
  await top();
  await press('Resume', { enabled: false });
  await press('Surprise me', { enabled: false });
  assert.equal((await control()).requests.length, beforeArchived);
  await press('Chronicle');
  const history = await until('3 committed scenes');
  assert.ok(history.hit, 'archived history shows 3 committed scenes');
  const historyNodes = await readWholeScreen(viewportSize());
  for (const number of [1, 3]) {
    assert.ok(historyNodes.some((n) => (n.desc || n.text).startsWith('Episode ' + number + ' · events ')),
      'archived Episode ' + number + ' header visible');
  }
  assert.ok(!contains(historyNodes, 'Could not read the history'), 'archived history has no read error');
  await record('09-archived-history');
  const vp = viewportSize();
  assert.ok(await findToTap('Episode 1 · events ', vp), 'Episode 1 header revealed');
  const episodeNodes = dump();
  const episodeRegion = scrollRegion(episodeNodes, vp);
  const episodeButton = episodeNodes.find((n) => n.clickable && episodeRegion && uncut(n, episodeRegion)
    && (n.desc || n.text).startsWith('Episode 1 · events '));
  assert.ok(episodeButton, 'real Episode 1 button visible');
  tap(episodeButton);
  await new Promise((r) => setTimeout(r, SETTLE_MS));
  assert.ok(await findToTap('by the world clock.', vp), 'Episode 1 prose revealed');
  const replayNodes = dump();
  const replayRegion = scrollRegion(replayNodes, vp);
  assert.ok(replayNodes.some((n) => replayRegion && uncut(n, replayRegion)
    && n.text.includes('by the world clock.') && n.text.trim().length > 80), 'actual Episode 1 prose visible');
  assert.ok(!contains(replayNodes, 'Could not read the history'), 'opened episode has no read error');
  await record('10-archived-episode-1');
  const final = await control();
  assert.ok(final.worlds.every((w) => w.replay));
  console.log('MEASURED ' + scope + ' scenarios; restoring device settings');
} catch (error) {
  console.error(error.message, error.cause?.code ?? '');
  process.exitCode = 1;
  await record('failure');
} finally {
  try {
    try {
      await control('/allow');
      await control('/release');
    } finally {
      try {
        await signOut();
      } finally {
        if (originalAddress) {
          BASE_URL = originalAddress;
          HOST = new URL(originalAddress).host;
          await setServerAddress('prepare', undefined, stamp);
        }
      }
    }
  } finally {
    try {
      shell(originalAnimationScale === 'null'
        ? 'settings delete global transition_animation_scale'
        : 'settings put global transition_animation_scale ' + originalAnimationScale);
    } finally {
      shell(originalScale === 'null'
        ? 'settings delete system font_scale'
        : 'settings put system font_scale ' + originalScale);
    }
    assert.equal(shell('settings get system font_scale').trim(), originalScale, 'original font scale restored');
    assert.equal(shell('settings get global transition_animation_scale').trim(), originalAnimationScale, 'original animation scale restored');
  }
}
if (!process.exitCode) {
  deepLink('account');
  const restored = await untilNodes((ns) => addressInUse(ns) === originalAddress && !!contains(ns, 'Not signed in'), 60000);
  assert.ok(accountField(restored), 'restored account opened');
  assert.equal(addressInUse(restored), originalAddress, 'original address saved in account');
  const restoredAccount = await readWholeScreen(viewportSize());
  assert.ok(contains(restoredAccount, 'Not signed in'), 'restored account remains signed out');
  assert.ok(!contains(restoredAccount, 'Sign out'), 'restored account offers no Sign out');
  await record('11-restored-account');
  const final = await control();
  writeFileSync(join(OUT, stamp, 'result.json'), JSON.stringify({ passed: true, scope, stamp, apkSha256, reducedMotion: true, observations: observations.length, final }, null, 2));
  console.log('PASS ' + scope + ': ' + (scope === 'lifecycle'
    ? 'pause, resume, archive, replay'
    : 'pending, lost acknowledgement, same-command retry, pause, resume, archive, replay')
    + '; settings restored; evidence ' + join(OUT, stamp));
}
`;
try {
  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
} catch (error) {
  console.error(error.message, error.cause?.code ?? '');
  process.exitCode = 1;
}
