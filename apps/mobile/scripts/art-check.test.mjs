// The art the accessibility tree is not allowed to know about, measured against the
// screenshots the device already wrote.
//
// Rule 1 of `docs/design/ART.md` keeps every picture out of the tree, so no node can say
// whether an image *arrived* — and the known failure of the delivery loop is exactly
// that: `scripts/copy-assets.mjs` is what puts the files into `res/`, and a bundle built
// without it shows "svart firkant der kunsten skal være". The walk catches that on the
// device; this file catches it afterwards, on a machine with no emulator attached, from
// the same evidence a reader would audit by hand. It is the reason the slot table lives
// in `lib/art-check.mjs` rather than in the walk: two callers, one list of claims, so a
// slot cannot be counted in one place and forgotten in the other.
//
// Run by the root suite: `npm test` at the repo root.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { ART_MIN, ART_SLOTS, artColors, artVerdicts, bandRow, frameOf, readArt, slotsFor } from './lib/art-check.mjs';
import { decodePng, distinctColors } from './lib/png.mjs';
import { parseTree } from './lib/reading-order.mjs';

const PKG = 'com.monrad.punkgrid';
const EVIDENCE = join(fileURLToPath(new URL('../../../', import.meta.url)), 'docs/qa/evidence/device-walk');

/** The newest finished walk — the same fixture `reading-order.test.mjs` measures, for
 *  the same two reasons: an older stamp is a photograph of an APK nobody installs any
 *  more, and a stamp without `walk.json` is a run that was still writing when the suite
 *  started. */
const latestStamp = () => {
  if (!existsSync(EVIDENCE)) return null;
  return readdirSync(EVIDENCE, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .filter((d) => existsSync(join(EVIDENCE, d.name, 'walk.json')))
    .map((d) => d.name)
    .sort()
    .at(-1) ?? null;
};

/** The frames the slot table asks for, with the slots each one has to show. A band below
 *  the fold is photographed on its own scrolled frame, so the file names here are not
 *  the screen names — and a frame the walk stopped writing shows up as a missing file
 *  rather than as nothing at all. */
const frames = () => {
  const byFrame = new Map();
  for (const slot of ART_SLOTS) {
    const frame = frameOf(slot);
    if (!byFrame.has(frame)) byFrame.set(frame, []);
    byFrame.get(frame).push(slot);
  }
  return byFrame;
};

describe('the art on the device that is installed', () => {
  const stamp = latestStamp();

  it('has a walk to measure', () => {
    expect(stamp, `no finished walk under ${EVIDENCE} — run the device walk`).not.toBeNull();
  });

  for (const [frame, slots] of frames()) {
    it(`${frame}: the art it shows is painted`, () => {
      const png = join(EVIDENCE, stamp, `${frame}.png`);
      const xml = join(EVIDENCE, stamp, `${frame}.xml`);
      expect(existsSync(png), `${png} is not in the newest walk`).toBe(true);
      expect(existsSync(xml), `${xml} is not in the newest walk`).toBe(true);
      const nodes = parseTree(readFileSync(xml, 'utf8'), PKG);
      expect(nodes.length, `${xml} holds no nodes of this app`).toBeGreaterThan(0);
      // The failures carry the number they measured and the nodes they bracketed, so the
      // row that explains the red is in the message rather than in a re-run.
      const bad = artVerdicts(slots, nodes, readArt(png)).filter((v) => !v.pass);
      expect(bad.map((v) => `${v.claim} — ${v.detail}`)).toEqual([]);
    });
  }
});

// The gate has to be able to say no. Both fixtures below are hand-written PNGs, so this
// is the rule measured against a picture of a flat plate and a picture of a photograph,
// independent of whatever the device happened to be showing.
const chunk = (type, body) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
};

/** A PNG the way `adb exec-out screencap -p` writes one: 8-bit RGBA, non-interlaced,
 *  every row filtered with 0. */
const pngOf = (width, height, pixel) => {
  const stride = width * 4;
  const lines = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixel(x, y);
      const i = y * (stride + 1) + 1 + x * 4;
      lines[i] = r;
      lines[i + 1] = g;
      lines[i + 2] = b;
      lines[i + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return decodePng(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(lines)),
    chunk('IEND', Buffer.alloc(0)),
  ]));
};

const flat = pngOf(64, 4, () => [18, 18, 22]);
const photograph = pngOf(300, 4, (x) => [(x * 7) % 256, (x * 13) % 256, (x * 29) % 256]);
// Wider than the flat plate, and a box that leaves the image is clamped — so the same
// row measures one colour of the first picture and 292 of the second.
const row = { x1: 4, y1: 1, x2: 296, y2: 3 };

describe('the gate has teeth', () => {
  it('a flat plate is one colour, which is what a missing asset looks like', () => {
    expect(distinctColors(flat, row)).toBe(1);
    expect(artColors(flat, row).colors).toBeLessThan(ART_MIN);
  });

  it('a photograph clears the gate by three orders of magnitude', () => {
    expect(artColors(photograph, row).colors).toBeGreaterThan(ART_MIN);
  });

  it('a slot whose anchors left the screen is a failure, not a skip', () => {
    // The whole point of the null box: a screen that moved the art out from under the
    // text that brackets it must come back red rather than quietly unmeasured.
    const [verdict] = artVerdicts(slotsFor('UI04 world'), [], photograph);
    expect(verdict.claim).toBe('the hero above the scene is painted, not a flat plate');
    expect(verdict.pass).toBe(false);
    expect(verdict.detail).toBe('the nodes that bracket it are not on the screen');
  });

  it('locates the scene image independently of the console position', () => {
    const region = slotsFor('UI04 world')[0].region;
    const image = { class: 'android.widget.ImageView', text: '', bounds: { x1: 10, y1: 100, x2: 290, y2: 180 } };
    const heading = { text: 'Episode 1', bounds: { x1: 10, y1: 200, x2: 290, y2: 240 } };
    for (const y1 of [40, 400]) {
      const console = { text: 'World actions', bounds: { x1: 10, y1, x2: 290, y2: y1 + 40 } };
      expect(region([console, image, heading])).toMatchObject(image.bounds);
    }
    expect(region([heading])).toBeNull();
    expect(region([{ ...image, bounds: { ...image.bounds, y2: 90 } }, heading])).toBeNull();
  });

  it('a frame that was never photographed is a failure too', () => {
    const [verdict] = artVerdicts(slotsFor('UI01 welcome'), [], null);
    expect(verdict.pass).toBe(false);
    expect(verdict.detail).toBe('the frame the slot is measured on is not among the evidence');
  });

  it('a bracketed row lands between the two nodes, wherever they are', () => {
    const region = bandRow((n) => n.text === 'above', (n) => n.text === 'below')([
      { text: 'above', bounds: { x1: 0, y1: 0, x2: 300, y2: 1 } },
      { text: 'below', bounds: { x1: 0, y1: 3, x2: 300, y2: 4 } },
    ]);
    expect(region).toMatchObject({ y1: 2, y2: 3 });
    expect(artColors(photograph, region).colors).toBeGreaterThan(ART_MIN);
  });

  it('no slot asks for a frame the newest walk did not write', () => {
    // A renamed screen or frame would leave its art unmeasured for ever, because the walk
    // only asks for the slots of the screen it is standing on.
    const stamp = latestStamp();
    const written = new Set(readdirSync(join(EVIDENCE, stamp)).filter((p) => p.endsWith('.xml')).map((p) => p.replace(/\.xml$/, '')));
    for (const slot of ART_SLOTS) expect(written.has(frameOf(slot)), `${frameOf(slot)} is not in ${stamp}`).toBe(true);
  });
});
