// Reading order, measured off the tree the device writes.
//
// `uiautomator dump` hands back a flat list of `<node>` tags. Two things are hidden
// by that flatness and both matter for SC 2.4.3: which node sits inside which, and
// therefore the order a TalkBack user actually moves through. `parseTree` keeps the
// document order (that is the tree order); the geometry (that is the reading order)
// has to be rebuilt from `bounds`.
//
// Why not a plain top-to-bottom scan of the whole screen: the HUD is a row of tiles,
// each one label above its number. A scanline demands every label of the row and then
// every number, which is not how anyone reads a row of widgets — a screen reader takes
// each tile as one unit and reads down inside it. So the rule is applied per parent:
// the children of every box come top to bottom and left to right, and inside each
// child the same rule again. That is strictly more checking than one global scan
// (every nesting level is compared) with the tile row no longer a false positive.
//
// Which box is inside which comes from the document itself, not from the areas: the
// Backdrop is drawn as twelve full-bleed plates behind the page, and a plate that
// covers a paragraph also has less area than the scroll view holding it, so an
// area-minimising parent hunt filed real content under a decorative plate and then
// demanded it be read at the plate's height. Measured on UI10 at 100 % text on
// 2026-10-12: the export note was adopted by the plate spanning y 2493-2743 and read
// after the footer button, which is the wrong claim about the wrong node.

export const overlapsY = (a, b) => Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1) > 0;
export const encloses = (a, b) => a.x1 <= b.x1 && a.y1 <= b.y1 && a.x2 >= b.x2 && a.y2 >= b.y2;
const area = (b) => (b.x2 - b.x1) * (b.y2 - b.y1);

/** The nodes of our own package, in tree order, as `uiautomator` wrote them.
 *  A dump taken while the window is still settling returns the tree of the app that
 *  was last in front, so a foreign package reads as "not our screen".
 *
 *  Each node carries `up`: the nearest ancestor of our own package, taken from the
 *  document's nesting. `</node>` is what makes that readable — the tags arrive in
 *  order, a container opens with `>` and closes later, and a leaf closes at once with
 *  `/>`, so a stack over the same scan the attributes need gives the hierarchy for
 *  free. Nodes of another package stay on the stack as a hole (`null`) so our content
 *  behind the system bar still finds its own parent. */
export function parseTree(xml, pkg) {
  if (!xml.startsWith('<?xml')) return [];
  const nodes = [];
  const open = [];
  // Every element is a `<node …>` — containers end in `>` and leaves in `/>`, so
  // the tag itself (not the subtree) is the unit to match.
  for (const raw of xml.match(/<\/node>|<node\b[^>]*>/g) ?? []) {
    if (raw === '</node>') {
      open.pop();
      continue;
    }
    const attrs = {};
    for (const [, k, v] of raw.matchAll(/([\w-]+)="([^"]*)"/g)) attrs[k] = v;
    const mine = !attrs.package || attrs.package === pkg;
    // uiautomator writes bounds as `[x1,y1][x2,y2]`.
    const b = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(attrs.bounds ?? '');
    const node = {
      class: attrs.class ?? '',
      text: attrs.text ?? '',
      desc: attrs['content-desc'] ?? '',
      clickable: attrs.clickable === 'true',
      // Which box actually scrolls. Reading order does not need it, but a gesture
      // aimed at a node the viewport cut has to land inside this band and not on the
      // pinned footer below it (`device-walk.mjs`, `scrollRegion`).
      scrollable: attrs.scrollable === 'true',
      focusable: attrs.focusable === 'true',
      focused: attrs.focused === 'true',
      bounds: b ? { x1: +b[1], y1: +b[2], x2: +b[3], y2: +b[4] } : null,
      up: null,
    };
    if (mine) {
      for (let i = open.length - 1; i >= 0; i--) {
        if (open[i]) {
          node.up = open[i];
          break;
        }
      }
      nodes.push(node);
    }
    open.push(mine ? node : null);
    if (raw.endsWith('/>')) open.pop();
  }
  return nodes;
}

/** Nodes with real area, one per box. A row whose top edge has scrolled out comes
 *  back with a clipped (zero or negative) height: the viewport's doing, not the
 *  node's, and an unread box cannot be ordered. Two nodes that share a box exactly —
 *  the wrapper React Native emits around a full-bleed image, or the frame chain at
 *  launch — are the same place on screen, so only the first is kept. */
function laidOut(nodes) {
  const kept = [];
  const boxes = new Set();
  for (const n of nodes) {
    if (!n.bounds) continue;
    const { x1, y1, x2, y2 } = n.bounds;
    if (x2 <= x1 || y2 <= y1) continue;
    const key = `${x1},${y1},${x2},${y2}`;
    if (boxes.has(key)) continue;
    boxes.add(key);
    kept.push(n);
  }
  return kept;
}

/** Top to bottom, and left to right among nodes that share a row. Ties keep the
 *  document order: two nodes in the same place give the checker no basis to complain. */
function scanOrder(list) {
  const rows = [];
  for (const n of list) {
    const row = rows.find((r) => r.some((m) => overlapsY(m.bounds, n.bounds)));
    if (row) row.push(n);
    else rows.push([n]);
  }
  const rowTop = new Map();
  for (const r of rows) {
    const top = Math.min(...r.map((n) => n.bounds.y1));
    for (const n of r) rowTop.set(n, top);
  }
  const key = (n) => `${String(rowTop.get(n)).padStart(8, '0')}:${String(n.bounds.x1).padStart(8, '0')}`;
  return [...list].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

/** The hierarchy the dump hides: which box is inside which, and the labelled
 *  leaves under it. A node is a leaf when nothing sits inside it — both orders are
 *  read out of this one set, so the two lists can never disagree about what is on
 *  the screen and only about the order.
 *
 *  A tree that came from `parseTree` already knows its parent, and that is the answer.
 *  Only a hand-built tree — the fixtures in `reading-order.test.mjs`, written as a flat
 *  list — has to be grouped by geometry, and there the smallest box that covers a node
 *  is the best guess available. */
function build(nodes) {
  const boxes = laidOut(nodes);
  const parent = new Map();
  if (boxes.length && boxes.every((n) => 'up' in n)) {
    const kept = new Set(boxes);
    for (const n of boxes) {
      // Climb to the nearest ancestor that survived `laidOut`; a wrapper clipped away
      // by the viewport or dropped as a duplicate box is not a container any more.
      for (let a = n.up; a; a = a.up) {
        if (kept.has(a)) {
          parent.set(n, a);
          break;
        }
      }
    }
  } else {
    for (const n of boxes) {
      let best = null;
      for (const c of boxes) {
        if (c === n || area(c.bounds) <= area(n.bounds) || !encloses(c.bounds, n.bounds)) continue;
        if (!best || area(c.bounds) < area(best.bounds)) best = c;
      }
      if (best) parent.set(n, best);
    }
  }
  let children = new Map();
  const link = (map) => {
    map.clear();
    for (const n of boxes) {
      const p = parent.get(n);
      if (!p) continue;
      if (!map.has(p)) map.set(p, []);
      map.get(p).push(n);
    }
    return map;
  };
  link(children);

  // Paint is not a layer of the page. A Backdrop plate, the corner ticks of a bracket
  // and the wrapper around a full-bleed image carry no word and hide none, and left in
  // they sit in the same row as everything they cover — the plates cover the screen, so
  // the whole page collapses into one row and is ordered by its left edge instead of by
  // its height. Measured on UI04 on 2026-10-12: with the twelve plates in, the footer's
  // six buttons came out column by column and the check blamed the app for the order of
  // boxes a screen reader is never told about.
  const says = new Map();
  const saysAnything = (n) => {
    const known = says.get(n);
    if (known !== undefined) return known;
    const own = !!(n.text || n.desc);
    const answer = own || (children.get(n) ?? []).some(saysAnything);
    says.set(n, answer);
    return answer;
  };
  const words = boxes.filter(saysAnything);
  const readable = new Set(words);
  for (const n of boxes) if (!readable.has(n)) parent.delete(n);
  for (const n of words) {
    // Climb out of the paint: the container a word lives in is the nearest ancestor
    // that says something itself.
    let a = parent.get(n);
    while (a && !readable.has(a)) a = parent.get(a);
    if (a) parent.set(n, a);
    else parent.delete(n);
  }
  boxes.length = 0;
  boxes.push(...words);
  children = link(children);

  return {
    roots: boxes.filter((n) => !parent.has(n)),
    children,
    leaves: boxes.filter((n) => !children.has(n) && (n.text || n.desc)),
  };
}

/** The labelled leaves in the order the tree hands them over — what a screen reader
 *  meets, node by node. */
export function treeOrder(nodes) {
  return build(nodes).leaves;
}

/** The same leaves in the order the geometry says they should be met: children of
 *  every box top to bottom and left to right, and the same rule inside each box. */
export function readingOrder(nodes) {
  const { roots, children, leaves } = build(nodes);
  const isLeaf = new Set(leaves);
  const emit = (list) =>
    scanOrder(list).flatMap((n) => {
      const kids = children.get(n);
      if (kids) return emit(kids);
      return isLeaf.has(n) ? [n] : [];
    });
  return emit(roots);
}
