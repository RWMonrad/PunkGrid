// The smallest PNG reader that can answer one question about a screenshot: how many
// different colours are in this rectangle. The walk needs it because the art in this
// app is deliberately invisible to the accessibility tree (`ArtBand` sets
// `accessibilityElementsHidden`, rule 1 of docs/design/ART.md), so no node can say
// whether a picture arrived — and the known failure of the delivery loop is exactly
// that: `scripts/copy-assets.mjs` is what puts the files in `res/`, and without it a
// bundled app shows "svart firkant der kunsten skal være" (ART.md). A tree check is
// blind to that screen. Pixels are not.
//
// It is written by hand rather than pulled from npm because a dev-only dependency is
// still a dependency, and because the format `adb exec-out screencap -p` produces is
// the boring subset below: 8-bit, non-interlaced, no palette. Anything else is
// refused out loud instead of decoded into a wrong answer.

import { inflateSync } from 'node:zlib';

const SIGN = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Bytes per pixel for the colour types a screencap can carry. */
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

/** Decode a PNG into `{ width, height, channels, data }`, where `data` is
 *  `width * height * channels` bytes of raw, unfiltered pixels. */
export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(SIGN)) throw new Error('not a PNG');
  let pos = 8;
  let ihdr = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      ihdr = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        depth: body[8],
        color: body[9],
        compression: body[10],
        filter: body[11],
        interlace: body[12],
      };
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  if (!ihdr) throw new Error('PNG without IHDR');
  if (ihdr.depth !== 8) throw new Error(`only 8-bit PNGs are read here, this one is ${ihdr.depth}-bit`);
  if (ihdr.interlace !== 0) throw new Error('interlaced PNGs are not read here');
  if (ihdr.compression !== 0 || ihdr.filter !== 0) throw new Error('only the deflate/adaptive filter pair is read here');
  const channels = CHANNELS[ihdr.color];
  if (!channels) throw new Error(`colour type ${ihdr.color} is not read here`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = ihdr.width * channels;
  const out = Buffer.alloc(ihdr.height * stride);
  let p = 0;
  for (let y = 0; y < ihdr.height; y += 1) {
    const filter = raw[p];
    p += 1;
    const line = raw.subarray(p, p + stride);
    const here = out.subarray(y * stride, (y + 1) * stride);
    const above = y === 0 ? null : out.subarray((y - 1) * stride, y * stride);
    p += stride;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? here[x - channels] : 0;
      const b = above ? above[x] : 0;
      const c = above && x >= channels ? above[x - channels] : 0;
      const v = line[x];
      let value;
      if (filter === 0) value = v;
      else if (filter === 1) value = v + a;
      else if (filter === 2) value = v + b;
      else if (filter === 3) value = v + ((a + b) >> 1);
      else if (filter === 4) {
        const q = a + b - c;
        const pa = Math.abs(q - a);
        const pb = Math.abs(q - b);
        const pc = Math.abs(q - c);
        value = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else throw new Error(`unknown PNG filter ${filter} on row ${y}`);
      here[x] = value & 0xff;
    }
  }
  return { width: ihdr.width, height: ihdr.height, channels, data: out };
}

/** How many distinct 24-bit colours the rectangle holds. Coordinates are device
 *  pixels, `x2`/`y2` exclusive, and a box that leaves the image is clamped — a
 *  screenshot that is smaller than expected is a measurement to report, not a crash. */
export function distinctColors(img, rect) {
  const x1 = Math.max(0, Math.floor(rect.x1));
  const y1 = Math.max(0, Math.floor(rect.y1));
  const x2 = Math.min(img.width, Math.ceil(rect.x2));
  const y2 = Math.min(img.height, Math.ceil(rect.y2));
  const seen = new Set();
  for (let y = y1; y < y2; y += 1) {
    const row = y * img.width * img.channels;
    for (let x = x1; x < x2; x += 1) {
      const i = row + x * img.channels;
      seen.add((img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2]);
    }
  }
  return seen.size;
}
