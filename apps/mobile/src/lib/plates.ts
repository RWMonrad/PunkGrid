// The page plates the backdrop paints.
//
// React Native has no gradient without an asset or a dependency, and what the
// mockups (`docs/design/inspiration/stitch-2026-10-12`) actually get from their
// washes is a luminance ramp with a horizon, not a colour. So the ramp is built from
// bands, and every band is a composite of two tokens rather than a literal.
//
// The rule that keeps this honest is the ceiling: the ramp runs from `deep` up to
// `ink` and no higher. `contrast.test.ts` anchors each text pair to the page colour
// it sits on, and a plate darker than that anchor can only raise the ratio — so
// `ink` stays the worst case a glyph can meet anywhere on the screen. A plate
// brighter than `ink` would silently un-measure every pair in the app, which is what
// the assertion in `contrast.test.ts` is for.

import { composite, type Hex } from './contrast';
import { color } from './theme';

/** Bands per half-ramp. Six is enough that the step is not readable as stripes on a
 *  2 992 px panel and few enough that the whole layer is twelve views. */
export const rampSteps = 6;

/** `deep` at the edges, `ink` across the reading band in the middle: the horizon the
 *  mockups have, with the page token as its brightest point. */
export function plates(steps: number = rampSteps): Hex[] {
  const up = Array.from({ length: steps }, (_, i) => composite(color.ink, color.deep, (i + 1) / steps));
  return [color.deep, ...up, ...up.slice(0, steps - 1).reverse()];
}

/** The seams: panel edges engraved *into* the page, so they are darker than every
 *  plate they cross and never a lighter pixel under a glyph. */
export const seam = 'rgba(0, 0, 0, 0.45)' as const;
