// WCAG 2.2 contrast arithmetic, kept free of React Native so the repository root's
// `npm test` can run the audit (NFR-07). The formulas are the normative ones from
// Understanding 1.4.3: relative luminance from sRGB with the official rec.709
// weights and the linearisation step, then (L1 + 0.05) / (L2 + 0.05).

import { color } from './theme';

export type Hex = `#${string}`;

/** The linear channel step of sRGB's relative luminance (WCAG 4.x normative text). */
function channel(value8bit: number): number {
  const v = value8bit / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: Hex): number {
  const digits = hex.slice(1);
  if (!/^[0-9a-fA-F]{6}$/.test(digits)) throw new Error(`Not a #rrggbb colour: ${hex}`);
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(digits.slice(i, i + 2), 16)));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function contrastRatio(a: Hex, b: Hex): number {
  const [x, y] = [relativeLuminance(a), relativeLuminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** The large-text exemption, in WCAG's own sizes: ≥24 px, or ≥18.66 px (14 pt)
 *  when the weight is bold. Below that the text needs 4.5:1. */
export function isLargeText(sizePx: number, bold: boolean): boolean {
  return sizePx >= 24 || (bold && sizePx >= 18.66);
}

export type Need = 'text' | 'text-large' | 'ui';

/** 4.5 for body text (1.4.3 AA), 3 for large text and for the non-text contrast a
 *  control's shape depends on (1.4.11 AA). */
export function requiredRatio(kind: Need): number {
  return kind === 'text' ? 4.5 : 3;
}

export interface Verdict {
  ratio: number;
  need: number;
  pass: boolean;
}

export function check(fg: Hex, bg: Hex, kind: Need): Verdict {
  const ratio = contrastRatio(fg, bg);
  const need = requiredRatio(kind);
  return { ratio, need, pass: ratio >= need };
}

/** Text that is not a token — the semi-transparent press and disabled states —
 *  loses contrast by compositing. Flattening over the background gives the colour
 *  the eye actually sees, so the audit can measure the state instead of guessing. */
export function composite(fg: Hex, bg: Hex, alpha: number): Hex {
  const read = (hex: Hex, at: number) => parseInt(hex.slice(at, at + 2), 16);
  const mix = (at: number) => Math.round(read(fg, at) * alpha + read(bg, at) * (1 - alpha));
  const hex2 = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();
  return `#${hex2(mix(1))}${hex2(mix(3))}${hex2(mix(5))}` as Hex;
}

export const tokenColor = (name: keyof typeof color): Hex => color[name];
