// The art the accessibility tree cannot see.
//
// Rule 1 of `docs/design/ART.md` keeps every picture out of the tree, which is what
// makes the walk's node counts stable — and it means no tree check can say whether an
// image *arrived*. The failure is a known one: `scripts/copy-assets.mjs` is what puts
// the files into `res/`, and a bundle built without it shows a flat plate where the
// art should be ("svart firkant der kunsten skal være", ART.md). A tree is blind to
// that screen; pixels are not.
//
// So the walk reads back the PNG it just wrote and counts the distinct colours in the
// box the art is supposed to fill. The box is found from the nodes that bracket it,
// because the band itself is not one of them — which is also why the table below is
// the only place a slot is named: `scripts/art-check.test.mjs` measures these same
// regions against the trees already on disk, so a slot that stops being measurable,
// or starts being flat, is caught without an emulator.

import { readFileSync } from 'node:fs';

import { decodePng, distinctColors } from './png.mjs';

/** Measured on this device at both text scales: a ~1 100 px row across a photograph
 *  holds 750–1 009 distinct colours, and a row across any flat plate holds exactly 1.
 *  The gate sits at 64 because the two answers are three orders of magnitude apart and
 *  a half-read screen should still come back red. */
export const ART_MIN = 64;

const label = (n) => n.desc || n.text || n.class;

/** The single row halfway between the bottom of the node above a band and the top of
 *  the node below it. On every slot below the band is 92–336 px of that gap while the
 *  gaps around it are 24 dp, so the midpoint cannot land outside it without the layout
 *  having changed — which is what the check is for. */
export function bandRow(above, below) {
  return (nodes) => {
    const a = nodes.find((n) => n.bounds && above(n));
    const b = nodes.find((n) => n.bounds && below(n));
    if (!a || !b) return null;
    const y = Math.round((a.bounds.y2 + b.bounds.y1) / 2);
    return { y1: y, y2: y + 1, saw: `between “${label(a)}” (y2=${a.bounds.y2}) and “${label(b)}” (y1=${b.bounds.y1})` };
  };
}

/** The square a mark occupies when it sits in front of a heading: from the content
 *  edge to where the heading's own text starts. */
export function markBox(needle) {
  return (nodes) => {
    const t = nodes.find((n) => n.bounds && needle(n));
    if (!t) return null;
    return { x1: 48, x2: t.bounds.x1 - 12, y1: t.bounds.y1, y2: t.bounds.y2, saw: `beside “${label(t)}”` };
  };
}

/** The row of plates under a heading, taken from the pictures' own nodes.
 *
 *  Needed because a plate row has no node *under* the band to bracket against: `ArtPlate`
 *  is one merged accessibility element, so the node after the art starts at the top of the
 *  art (`UI01`: heading `y2=2118`, plate node `y1=2154`), and `bandRow`'s midpoint lands in
 *  the 36 px margin above the photograph and reports one colour. The picture does have a
 *  node — an unnamed `ImageView` — and that box is the honest anchor: it is the pixels the
 *  claim is about.
 *
 *  A node the ScrollView has cut reports inverted bounds (`[120,2855][405,2713]` on the
 *  cast row, measured), so insisting on an upright box does double duty: `shootBand` keeps
 *  scrolling until the row is genuinely on the screen instead of photographing the fold. */
export function plateRow(under) {
  return (nodes) => {
    const h = nodes.find((n) => n.bounds && under(n));
    if (!h) return null;
    const plates = nodes
      .filter((n) => n.class === 'android.widget.ImageView' && n.bounds && n.bounds.y1 >= h.bounds.y2 && n.bounds.y2 > n.bounds.y1)
      .map((n) => n.bounds);
    if (plates.length === 0) return null;
    const top = Math.min(...plates.map((b) => b.y1));
    const row = plates.filter((b) => b.y1 <= top + 8);
    return {
      x1: Math.min(...row.map((b) => b.x1)),
      x2: Math.max(...row.map((b) => b.x2)),
      y1: top,
      y2: Math.max(...row.map((b) => b.y2)),
      saw: `${row.length} plate node${row.length === 1 ? '' : 's'} under “${label(h)}”`,
    };
  };
}

const startsWith = (s) => (n) => n.text.startsWith(s);
const is = (s) => (n) => n.text === s;

/** Every bundled file the app can show, and the row that proves it reached the
 *  device. `welcome-emblem.png` is measured as a box beside the wordmark rather than
 *  a bracketed row because the mark has no node under it to bracket against; measured
 *  on the 2026-10-13 walks it holds 12 123 colours at 100 % and 12 478 at 200 %, so the
 *  same gate as the bands answers for it.
 *
 *  `frame` names the evidence file a band has to be photographed on when the screen's
 *  own frame does not show it: at 200 % text UI01's row of place plates sits below the
 *  viewport (`Singapore` is not in that dump at all), and after a decision the guest
 *  consequence screen comes back scrolled past its own header. The claim is about the
 *  asset arriving, not about the fold, so the walk scrolls to the band and shoots that
 *  frame under the slot's own name — and `scripts/art-check.test.mjs` reads the same
 *  name. A slot without `frame` is measured on the screen's frame and nowhere else.
 *
 *  De to skiverekkene måler seg mot plastenes egne noder med `plateRow`, ikke mot gapet
 *  rundt dem med `bandRow`: `ArtPlate` er én slått sammen tilgjengelighetsnode, så navnet
 *  under platene kommer tilbake som innholdsbeskrivelse med `y1` lik platens egen topplinja,
 *  og midpointet mellom overskrifta og den noden faller i marginalt over kunsten — målt til
 *  én farge. Node-et som krevjer oppreist boks, ruller i tillegg gangen helt fram til
 *  rekkja faktisk er på skjermen. */
export const ART_SLOTS = [
  { screen: 'UI01 welcome', name: 'welcome portal', region: bandRow(startsWith('Live a thousand'), startsWith('Your reality is only one')) },
  { screen: 'UI01 welcome', name: 'brand emblem', region: markBox((n) => n.desc === 'PunkGrid') },
  { screen: 'UI01 welcome', name: 'row of place plates', frame: 'UI01 welcome — plates', region: plateRow((n) => n.text.includes('WHERE A LIFE CAN START')) },
  // The seam moved into the doors on 2026-10-13: each door now carries its own picture
  // between the kicker and the name, so the slot is measured inside each door rather
  // than above them.
  { screen: 'UI02 genesis', name: 'art inside Surprise Me', region: bandRow(is('ONE BUTTON'), is('Surprise Me')) },
  { screen: 'UI02 genesis', name: 'art inside Create a Life', region: bandRow(is('GUIDED'), is('Create a Life')) },
  // The setup prose got a new lead-in sentence when the screen took the
  // mockups' voice on 2026-10-14, so the bracket follows the sentence's new
  // start: “Calibrate the world your consciousness enters. The engine
  // accepts …”.
  { screen: 'UI03 setup', name: 'premise band', region: bandRow(startsWith('Calibrate the world'), is('The Glass Harbor')) },
  // The cast section's heading changed from “Who else is in it” to “THE CAST”
  // in the same voice lift; the plate row under it is unchanged.
  { screen: 'UI03 setup', name: 'row of cast portraits', frame: 'UI03 setup — cast', region: plateRow(is('THE CAST')) },
  { screen: 'UI04 world', name: 'hero above the scene', region: (nodes) => {
    const heading = nodes.find((n) => /^Episode \d+$/.test(n.text) && n.bounds);
    if (!heading) return null;
    const image = nodes.filter((n) => n.class === 'android.widget.ImageView' && n.bounds
      && n.bounds.y2 > n.bounds.y1 && n.bounds.y2 <= heading.bounds.y1)
      .sort((a, b) => b.bounds.y2 - a.bounds.y2)[0];
    return image ? { ...image.bounds, saw: 'image above the scene heading' } : null;
  } },
  // The section's own header, not the readout above it: the readout was renamed when
  // the library took the mockups' voice, and the kicker is the last node before the
  // card either way.
  { screen: 'UI07 library', name: 'hero on the world card', region: bandRow(startsWith('LIVE CONSCIOUSNESS MATRICES'), is('The Glass Harbor')) },
  { screen: 'UI09 history', name: 'hero above the ledger', region: bandRow((n) => n.text.includes('committed scenes'), (n) => /^Episode 1 · events/.test(n.text)) },
  { screen: 'F02 guest preview', name: 'preview portal', region: bandRow((n) => n.text.includes('nothing here is saved or sent'), (n) => n.text.startsWith('The Glass Harbor · 2034')) },
  { screen: 'F02 guest consequence', name: 'consequence portal', frame: 'F02 guest consequence — portal', region: bandRow((n) => n.text.includes('nothing here is saved or sent'), (n) => n.text.startsWith('The Glass Harbor · 2034')) },
];

/** A screenshot the way the walk writes it: raw bytes, no colour conversion. The
 *  decode is the expensive part, so a caller that measures several slots on one frame
 *  decodes once and passes the image. */
export function readArt(pngPath) {
  return decodePng(readFileSync(pngPath));
}

/** The slots belonging to one screen, in the order the walk meets them. */
export const slotsFor = (screen) => ART_SLOTS.filter((s) => s.screen === screen);

/** The evidence file a slot is measured on: the screen's own frame unless the band has
 *  to be scrolled to. */
export const frameOf = (slot) => slot.frame ?? slot.screen;

/** The distinct colours inside `box` of a decoded screenshot, with the x edges taken
 *  from the image's own width when the box only names a row. */
export function artColors(img, box) {
  const x1 = box.x1 ?? Math.round(img.width * 0.1);
  const x2 = box.x2 ?? Math.round(img.width * 0.9);
  return { colors: distinctColors(img, { x1, y1: box.y1, x2, y2: box.y2 }), x1, x2 };
}

/** One verdict per slot, measured against the pixels and the tree of one frame. Both
 *  callers print these sentences verbatim — the walk as its checks,
 *  `scripts/art-check.test.mjs` as its assertions — so a slot cannot be counted in one
 *  place and forgotten in the other.
 *
 *  A missing anchor is a failure, not a skip: the art moved out from under the text that
 *  brackets it, or the screen was never read at all. */
export function artVerdicts(slots, nodes, img) {
  return slots.map((slot) => {
    const claim = `the ${slot.name} is painted, not a flat plate`;
    if (!img) return { claim, pass: false, detail: 'the frame the slot is measured on is not among the evidence' };
    const box = slot.region(nodes);
    if (!box) return { claim, pass: false, detail: 'the nodes that bracket it are not on the screen' };
    const { colors, x1, x2 } = artColors(img, box);
    return { claim, pass: colors >= (slot.min ?? ART_MIN), detail: `${colors} distinct colours in x=${x1}..${x2} y=${box.y1}..${box.y2} (${box.saw})` };
  });
}
