// The reading-order rule, tested against the trees the device actually wrote.
//
// The newest walk is the fixture: `device-walk.mjs` drops one XML per screen under
// `docs/qa/evidence/device-walk/<tidsstempel>/`, so this file re-measures real trees
// instead of a hand-drawn sketch of one — of the build that is on the device today. It
// also carries the inversions the rule has to catch: the global scanline that this file
// replaced could not tell a tile from a column, a full-bleed decorative plate must not
// get to order the page, and a check that cannot fail is not a check.
//
// Run by the root suite: `npm test` at the repo root.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { parseTree, readingOrder, treeOrder } from './lib/reading-order.mjs';

const PKG = 'com.monrad.punkgrid';
const EVIDENCE = join(fileURLToPath(new URL('../../../', import.meta.url)), 'docs/qa/evidence/device-walk');

const driver = readFileSync(new URL('./device-walk.mjs', import.meta.url), 'utf8');

describe('device evidence integrity', () => {
  it('does not attach cached XML after an unsuccessful dump', () => {
    const files = new Map();
    let successful = true;
    const context = {
      PKG, OUT: 'evidence', join,
      shell: () => successful ? 'dumped to:' : '',
      adb: () => '<fresh/>',
      parseTree: () => [{}],
      adbRaw: () => Buffer.from('png'),
      writeFileSync: (path, data) => files.set(path, data),
    };
    const dumping = driver.slice(driver.indexOf('let latestXml = null;'), driver.indexOf('/** `uiautomator dump`'));
    const shooting = driver.slice(driver.indexOf('function shoot('), driver.indexOf('/** The one thing the tree'));
    runInNewContext(dumping + shooting + 'dumpOnce(); shoot("good", "stamp");', context);
    expect(files.get(join('evidence', 'stamp', 'good.xml'))).toBe('<fresh/>');
    successful = false;
    runInNewContext('dumpOnce(); shoot("failed", "stamp");', context);
    expect(files.has(join('evidence', 'stamp', 'failed.xml'))).toBe(false);
    expect(files.has(join('evidence', 'stamp', 'failed.png'))).toBe(true);
  });

  it('fails a strict walk when the app dies instead of silently restarting', async () => {
    let launches = 0;
    let alive = false;
    const context = {
      appAlive: () => alive,
      crashNotes: () => [],
      launch: () => { launches += 1; },
      process: { env: { PUNKGRID_STRICT_WALK: '1' } },
      console, setTimeout,
    };
    const revive = driver.slice(driver.indexOf('async function revive('), driver.indexOf('async function until('));
    await expect(runInNewContext(revive + 'revive(0, "pending");', context)).rejects.toThrow('app process died');
    expect(launches).toBe(0);
    alive = true;
    await expect(runInNewContext('revive(0, "pending");', context)).resolves.toBe(0);
  });

  it('reveals panel actions separately and refreshes History after scrolling', async () => {
    const visited = [];
    let visible = [];
    const context = {
      vp: {}, dp: 3, stamp: 'stamp', nodes: [],
      findToTap: async (name) => {
        visited.push(name);
        visible = [{ desc: name }];
        return visible[0];
      },
      tap: (node) => expect(node.desc).toBe('World actions'),
      dump: () => visible,
      auditTree: async (_, nodes) => expect(nodes).toEqual([{ desc: 'Archive' }]),
      shoot: () => {},
      scrollToTop: async () => { visible = []; visited.push('top'); },
      tapTo: async (node, destination) => {
        expect(node).toBe(visible[0]);
        expect(node.desc).toBe('History');
        expect(destination).toBe('committed scenes');
        return { nodes: [] };
      },
    };
    const actions = driver.slice(driver.indexOf("  const toggle = await findToTap('World actions'"), driver.indexOf("  screen = 'UI09 history';"));
    expect(actions.length).toBeGreaterThan(0);
    await runInNewContext('(async () => {' + actions + '})()', context);
    expect(visited).toEqual(['World actions', 'Archive', 'top', 'History']);
  });

  it.each([false, true])('measures complete history rows without double counting (missing status: %s)', (missing) => {
    const results = [];
    const nodes = [1, 2, 3].flatMap((version) => {
      const bounds = { x1: 10, x2: 200, y1: version * 100, y2: version * 100 + 80 };
      const text = `Episode ${version} · events ${version}–${version}`;
      const status = `Published · version ${version}`;
      return [
        { clickable: true, desc: `${text}, ${status}`, text: '', bounds },
        { clickable: false, desc: '', text, bounds: { ...bounds, y2: bounds.y1 + 30 } },
        { clickable: false, desc: '', text: missing && version === 2 ? '' : status, bounds: { ...bounds, y1: bounds.y1 + 40 } },
      ];
    });
    const context = {
      nodes, vp: {}, screen: 'history',
      scrollRegion: () => ({ y1: 0, y2: 290 }),
      check: (_, __, ok) => results.push(ok),
    };
    const geometry = driver.slice(driver.indexOf('const whole ='), driver.indexOf('/** Every pixel of a *whole* box'));
    const start = driver.indexOf('  const historyRegion =');
    const checking = driver.slice(start, driver.indexOf('  await checkArt(screen, stamp);', start));
    expect(geometry.length).toBeGreaterThan(0);
    expect(checking.length).toBeGreaterThan(0);
    runInNewContext(geometry + checking, context);
    expect(results).toEqual([true, !missing]);
  });

  it('rejects inverted rows and status boxes using the driver geometry', () => {
    const geometry = driver.slice(driver.indexOf('const whole ='), driver.indexOf('/** Every pixel of a *whole* box'));
    const start = driver.indexOf('  const historyRegion =');
    const checking = driver.slice(start, driver.indexOf('  await checkArt(screen, stamp);', start));
    expect(geometry.length).toBeGreaterThan(0);
    expect(checking.length).toBeGreaterThan(0);
    for (const target of ['row', 'status']) {
      for (const axis of ['x', 'y']) {
        const results = [];
        const nodes = [1, 2].flatMap((version) => {
          const bounds = { x1: 10, x2: 200, y1: version * 100, y2: version * 100 + 80 };
          const status = `Published · version ${version}`;
          return [
            { clickable: true, desc: `Episode ${version} · events ${version}–${version}, ${status}`, bounds },
            { clickable: false, text: status, bounds: { ...bounds, y1: bounds.y1 + 40 } },
          ];
        });
        const invalid = nodes[target === 'row' ? 2 : 3].bounds;
        invalid[`${axis}1`] = invalid[`${axis}2`] - 10;
        invalid[`${axis}2`] = invalid[`${axis}1`] - 10;
        runInNewContext(geometry + checking, {
          nodes, vp: {}, screen: 'history',
          scrollRegion: () => ({ y1: 0, y2: 290 }),
          check: (_, __, ok) => results.push(ok),
        });
        expect(results, `${target} inverted on ${axis}`).toEqual(target === 'row' ? [false, true] : [true, false]);
      }
    }
  });
});

/** The newest walk, which is the walk of the build on the device.
 *  An older stamp is a photograph of an APK nobody has installed any more: keeping
 *  every one of them made this file red for a reading order that has since been
 *  fixed, and green would then have meant nothing either. The older trees stay on
 *  disk as evidence — they are just not a verdict on today's code.
 *
 *  A stamp counts only when `device-walk.mjs` finished writing its verdict into it.
 *  Without that test the fixture is whatever the walk happened to have captured when
 *  the suite was started, and on 2026-10-13 a walk still in flight supplied 5 of the
 *  12 trees and the file stayed green while the count fell from 20 to 13. */
const latestStamp = () => {
  if (!existsSync(EVIDENCE)) return null;
  return readdirSync(EVIDENCE, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .filter((d) => existsSync(join(EVIDENCE, d.name, 'walk.json')))
    .map((d) => d.name)
    .sort()
    .at(-1) ?? null;
};

const trees = () => {
  const stamp = latestStamp();
  if (!stamp) return [];
  const dir = join(EVIDENCE, stamp);
  return readdirSync(dir)
    .filter((p) => p.endsWith('.xml'))
    .map((p) => ({ file: `${stamp}/${p}`, nodes: parseTree(readFileSync(join(dir, p), 'utf8'), PKG) }))
    .filter((t) => t.nodes.length > 0);
};

describe('reading order off a captured tree', () => {
  it('has trees to measure', () => {
    // Not skipped quietly: a run with no evidence means the walk has never been run
    // on this checkout, and every claim below would be vacuous.
    expect(trees().length, `no finished walk under ${EVIDENCE} — run the device walk`).toBeGreaterThan(0);
  });

  for (const t of trees()) {
    it(`${t.file}: the tree hands the leaves over in the order they are placed`, () => {
      expect(readingOrder(t.nodes).map((n) => `${n.text}|${n.desc}|${n.bounds.y1},${n.bounds.x1}`)).toEqual(
        treeOrder(t.nodes).map((n) => `${n.text}|${n.desc}|${n.bounds.y1},${n.bounds.x1}`),
      );
    });
  }
});

// A tile from UI04 as the device wrote it: a box holding a label above a number, and
// a second tile to its right.
const tile = (x1, name, value) => [
  { class: 'ViewGroup', text: '', desc: '', bounds: { x1, y1: 550, x2: x1 + 288, y2: 764 } },
  { class: 'TextView', text: name, desc: '', bounds: { x1: x1 + 36, y1: 586, x2: x1 + 137, y2: 635 } },
  { class: 'TextView', text: value, desc: '', bounds: { x1: x1 + 36, y1: 647, x2: x1 + 252, y2: 728 } },
];

const row = [...tile(48, 'CASH', '100'), ...tile(372, 'INFLUENCE', '60')];

const move = (nodes, text, bounds) =>
  nodes.map((n) => (n.text === text ? { ...n, bounds } : n));

describe('the rule has teeth', () => {
  it('a row of tiles reads down each tile, not across all the labels first', () => {
    expect(readingOrder(row).map((n) => n.text)).toEqual(['CASH', '100', 'INFLUENCE', '60']);
    // The scanline this replaced demanded CASH, INFLUENCE, 100, 60 — the tree order
    // was right and the old rule called it a failure.
    expect(treeOrder(row).map((n) => n.text)).toEqual(['CASH', '100', 'INFLUENCE', '60']);
  });

  it('a number placed above its own label is a failure', () => {
    const swapped = move(row, '100', { x1: 84, y1: 400, x2: 300, y2: 481 });
    expect(readingOrder(swapped).map((n) => n.text)).toEqual(['100', 'CASH', 'INFLUENCE', '60']);
    expect(treeOrder(swapped).map((n) => n.text)).toEqual(['CASH', '100', 'INFLUENCE', '60']);
  });

  it('a tile whose box is on the wrong side of the row is a failure', () => {
    // The tree offers the CASH tile first, but its box sits to the right of the
    // INFLUENCE tile: a reader moving left to right meets them the other way round.
    const crossed = [...tile(372, 'CASH', '100'), ...tile(48, 'INFLUENCE', '60')];
    expect(readingOrder(crossed).map((n) => n.text)).toEqual(['INFLUENCE', '60', 'CASH', '100']);
    expect(treeOrder(crossed).map((n) => n.text)).toEqual(['CASH', '100', 'INFLUENCE', '60']);
  });

  it('a node clipped by the viewport is not ordered at all', () => {
    const clipped = move(row, '60', { x1: 408, y1: 3000, x2: 624, y2: 2992 });
    expect(readingOrder(clipped).map((n) => n.text)).toEqual(['CASH', '100', 'INFLUENCE']);
  });
});

// A dump the way the device writes it: nested `<node>` elements, so the tree itself
// says which box is inside which. `parseTree` has to keep that, because the alternative
// — calling the smallest box that covers a node its container — files real content under
// the Backdrop's full-bleed plates and then demands it be read at the plate's height.
const leaf = (text, bounds) =>
  `<node index="0" text="${text}" class="android.widget.TextView" package="${PKG}" content-desc="" bounds="${bounds}" />`;
const box = (bounds, inner) =>
  `<node index="0" text="" class="android.view.ViewGroup" package="${PKG}" content-desc="" bounds="${bounds}">${inner}</node>`;

/** A page: two lines of prose, a two-by-two grid of buttons below them, and one
 *  decorative plate behind the whole grid. The grid is handed over row by row, which is
 *  how the screen reads it. */
const page = (cells) =>
  `<?xml version='1.0'?><hierarchy rotation="0">${box('[0,0][1080,1920]', [
    box('[0,1560][1080,1920]', ''),
    leaf('Head', '[48,100][1032,180]'),
    leaf('Body', '[48,220][1032,300]'),
    ...cells,
  ].join(''))}</hierarchy>`;

const cell = (name, x1, y1) =>
  box(`[${x1},${y1}][${x1 + 480},${y1 + 120}]`, leaf(name, `[${x1 + 72},${y1 + 30}][${x1 + 352},${y1 + 90}]`));

const grid = [cell('A', 48, 1620), cell('B', 552, 1620), cell('C', 48, 1760), cell('D', 552, 1760)];

describe('a tree that came from a dump', () => {
  it('a full-bleed plate does not decide the order of the page', () => {
    const nodes = parseTree(page(grid), PKG);
    expect(treeOrder(nodes).map((n) => n.text)).toEqual(['Head', 'Body', 'A', 'B', 'C', 'D']);
    expect(readingOrder(nodes).map((n) => n.text)).toEqual(['Head', 'Body', 'A', 'B', 'C', 'D']);
  });

  it('a grid handed over column by column is still a failure', () => {
    // The rule kept its teeth: move the plate out of the way and the geometry still
    // disagrees with a tree that reads down each column.
    const nodes = parseTree(page([grid[0], grid[2], grid[1], grid[3]]), PKG);
    expect(treeOrder(nodes).map((n) => n.text)).toEqual(['Head', 'Body', 'A', 'C', 'B', 'D']);
    expect(readingOrder(nodes).map((n) => n.text)).toEqual(['Head', 'Body', 'A', 'B', 'C', 'D']);
  });
});
