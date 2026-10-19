// NFR-07 gate for the design system. Every colour pair the app paints is measured
// here with the WCAG 2.2 formula (contrast.ts), at the size the call site uses, and
// the run fails when a token change drops a pair below AA. Three scopes: the page the
// anchors are measured on, SC 1.4.3 for text and SC 1.4.11 for the boundary that says
// where a control is.
//
// The pairs are not a table someone can edit into agreement: each one names the file
// and the StyleSheet key that paints it, and its colour, size and weight are read out
// of that declaration. Two further cases read the sources directly — a border token
// and an unlabelled control are found in the code as it stands.
//
// What this does NOT cover, and no one should read it as covered: screen-reader
// output and keyboard/focus order (both measured on the device instead — see
// apps/mobile/scripts/device-walk.mjs). SC 1.4.4 is covered by the cap below and by
// a device walk run at `font_scale 2.0`; a static scan cannot show whether a
// wrapped footer still fits the viewport.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { check, composite, contrastRatio, isLargeText, relativeLuminance, type Hex, requiredRatio } from './contrast';
import { plates } from './plates';
import { color, focusRing, font, maxFontScale, onAccent, touchTarget } from './theme';

interface Pair {
  fg: Hex;
  bg: Hex;
  size: number;
  bold: boolean;
  where: string;
}

/** Every .tsx under app/ and components/, keyed by the path this table uses. Read
 *  once: the pairs and the scans below are all views of the same text. */
let index: Map<string, string> | null = null;
function sourceIndex(): Map<string, string> {
  if (index) return index;
  const srcRoot = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
  index = new Map();
  for (const { path, text } of sourceFiles()) {
    index.set(path.replace(/\\/g, '/').slice(srcRoot.length + 1), text);
  }
  return index;
}

/** A pair is anchored by the style declaration that paints it: the file and its
 *  StyleSheet key. Not by a line number — a line number in the old version of this
 *  table had drifted for a third of its entries, and a citation nobody can check is
 *  a gate that only looks measured. Colour, size and weight are read out of that
 *  declaration, so a token change in the app changes what is measured here instead
 *  of leaving a table that agrees with itself. */
interface Site {
  file: string;
  key: string;
  /** The surface the text sits on — the one thing the source does not say, because
   *  the same card is Ink on the page and Surface inside a panel. Named as a token
   *  so no literal hex enters the table either. */
  bg: string;
  note: string;
  /** A colour the call site composes (`{ color: active ? a : b }`, a placeholder
   *  attribute). Still has to appear in that file, or the entry fails. */
  fgToken?: string;
  /** A size the call site composes (`{ fontSize: font.lead * fontScale }`), or one
   *  that lives in the sibling key the label is taken from (Button's `label`). */
  sizeToken?: string;
}

const SITES: Site[] = [
  // kit.tsx — the shared chrome
  { file: 'components/kit.tsx', key: 'title', bg: 'ink', note: 'screen title' },
  { file: 'components/kit.tsx', key: 'subtitle', bg: 'ink', note: 'screen subtitle' },
  { file: 'components/kit.tsx', key: 'statusText', bg: 'ink', note: 'status text on the page' },
  { file: 'components/kit.tsx', key: 'statusText', bg: 'surface', note: 'status text inside a section panel' },
  { file: 'components/kit.tsx', key: 'sectionTitle', bg: 'ink', note: 'section title' },
  { file: 'components/kit.tsx', key: 'disclosureText', bg: 'surface', note: 'consent disclosure' },
  { file: 'components/kit.tsx', key: 'errorMessage', bg: 'surface', note: 'error panel message' },
  { file: 'components/kit.tsx', key: 'errorTitle', bg: 'surface', note: 'error panel title' },
  { file: 'components/kit.tsx', key: 'retryText', bg: 'surface', note: 'retry link' },
  { file: 'components/kit.tsx', key: 'toastText', bg: 'raised', note: 'toast text' },
  { file: 'components/kit.tsx', key: 'skeletonText', bg: 'surface', note: 'skeleton label' },
  // The pipeline row paints each stage from its own key, so each key is measured —
  // including the quiet one, which is the only stage a player sees for long.
  { file: 'components/kit.tsx', key: 'stageTodo', bg: 'surface', note: 'stage not reached' },
  { file: 'components/kit.tsx', key: 'stageActive', bg: 'surface', note: 'stage in progress' },
  { file: 'components/kit.tsx', key: 'stageDone', bg: 'surface', note: 'stage completed' },
  { file: 'components/kit.tsx', key: 'chipText', bg: 'surface', note: 'chip label' },
  { file: 'components/kit.tsx', key: 'privacyLabel', bg: 'surface', note: 'privacy label' },
  { file: 'components/kit.tsx', key: 'privacyValue', bg: 'surface', note: 'privacy value' },
  { file: 'components/kit.tsx', key: 'privacyHint', bg: 'surface', note: 'privacy hint' },
  // The panel heads and the tab bar the stitch rebuild added: a kicker a player
  // reads as an instrument's name is text, so it is measured like text.
  { file: 'components/kit.tsx', key: 'panelKicker', bg: 'ink', note: 'panel kicker' },
  { file: 'components/kit.tsx', key: 'panelRight', bg: 'ink', note: 'panel right value' },
  { file: 'components/nav.tsx', key: 'tabLabel', bg: 'deep', note: 'nav tab label' },
  { file: 'components/nav.tsx', key: 'tabLabelOn', bg: 'deep', sizeToken: 'caption', note: 'lit nav tab label' },

  // Button.tsx — the label colour and the label size are two keys, so the size is named
  { file: 'components/Button.tsx', key: 'labelOnAccent', bg: 'violet', sizeToken: 'body', note: 'primary label' },
  { file: 'components/Button.tsx', key: 'labelOnAccent', bg: 'cyan', sizeToken: 'body', note: 'accent label' },
  { file: 'components/Button.tsx', key: 'labelInk', bg: 'raised', sizeToken: 'body', note: 'secondary label' },
  // ghost and danger both paint transparent fills with the ink label, so what matters
  // is the page behind them — and a footer is Surface while a screen body is Ink.
  { file: 'components/Button.tsx', key: 'labelInk', bg: 'surface', sizeToken: 'body', note: 'ghost and danger label on a surface footer' },
  { file: 'components/Button.tsx', key: 'labelInk', bg: 'ink', sizeToken: 'body', note: 'ghost and danger label on the page' },
  // The console strip paints the same two label colours at caption size, so each
  // pair is measured at the size the strip actually paints it.
  { file: 'components/Button.tsx', key: 'labelCompact', bg: 'raised', fgToken: 'text', sizeToken: 'caption', note: 'compact secondary label' },
  { file: 'components/Button.tsx', key: 'labelCompact', bg: 'ink', fgToken: 'text', sizeToken: 'caption', note: 'compact ghost label on the page' },

  // cards.tsx — choice, prose, world row
  { file: 'components/cards.tsx', key: 'label', bg: 'surface', note: 'choice label' },
  { file: 'components/cards.tsx', key: 'copy', bg: 'surface', note: 'choice copy' },
  { file: 'components/cards.tsx', key: 'label', bg: 'raised', note: 'choice label while pressed' },
  { file: 'components/cards.tsx', key: 'copy', bg: 'raised', note: 'choice copy while pressed' },
  { file: 'components/cards.tsx', key: 'paragraph', bg: 'ink', sizeToken: 'lead', note: 'episode paragraph on the page' },
  { file: 'components/cards.tsx', key: 'paragraph', bg: 'surface', sizeToken: 'lead', note: 'episode paragraph in a history row' },
  { file: 'components/cards.tsx', key: 'episodeKicker', bg: 'ink', note: 'episode kicker on the page' },
  { file: 'components/cards.tsx', key: 'episodeKicker', bg: 'surface', note: 'episode kicker in a history row' },
  { file: 'components/cards.tsx', key: 'worldTitle', bg: 'surface', note: 'world title' },
  { file: 'components/cards.tsx', key: 'worldState', bg: 'surface', fgToken: 'success', note: 'active state word' },
  { file: 'components/cards.tsx', key: 'worldState', bg: 'surface', fgToken: 'muted', note: 'paused state word' },
  { file: 'components/cards.tsx', key: 'worldMeta', bg: 'surface', note: 'world meta' },
  { file: 'components/cards.tsx', key: 'resumeText', bg: 'surface', note: 'resume row' },
  { file: 'components/cards.tsx', key: 'resumeArrow', bg: 'surface', note: 'resume arrow' },
  // The legacy plate paints ink, so its words are measured on ink — a hall that
  // sits below every live card still has to be readable.
  { file: 'components/cards.tsx', key: 'legacyTitle', bg: 'ink', note: 'legacy title' },
  { file: 'components/cards.tsx', key: 'legacyState', bg: 'ink', note: 'legacy state word' },
  { file: 'components/cards.tsx', key: 'legacyMeta', bg: 'ink', note: 'legacy meta' },
  { file: 'components/cards.tsx', key: 'legacyArrow', bg: 'ink', note: 'legacy arrow' },
  // The choice letter sits on its own chip, and the chip's plate is the door's own
  // signal colour — onAccent against the fill it is printed on. Past D the chip goes
  // quiet (`muted` on the card), and the pressed card wears `raised`.
  { file: 'components/cards.tsx', key: 'letterText', bg: 'cyan', note: 'choice letter on the cyan chip' },
  { file: 'components/cards.tsx', key: 'letterText', bg: 'violet', note: 'choice letter on the violet chip' },
  { file: 'components/cards.tsx', key: 'letterText', bg: 'success', note: 'choice letter on the success chip' },
  { file: 'components/cards.tsx', key: 'letterText', bg: 'amber', note: 'choice letter on the amber chip' },
  { file: 'components/cards.tsx', key: 'letterText', bg: 'surface', fgToken: 'muted', note: 'choice letter on the quiet chip' },
  { file: 'components/cards.tsx', key: 'letterText', bg: 'raised', fgToken: 'muted', note: 'choice letter on the quiet chip, pressed' },

  // Screens
  { file: 'app/index.tsx', key: 'portalText', bg: 'surface', note: 'portal heading' },
  { file: 'app/index.tsx', key: 'wordmarkFirst', bg: 'ink', sizeToken: 'display', note: 'wordmark, first half' },
  { file: 'app/index.tsx', key: 'wordmarkLast', bg: 'ink', sizeToken: 'display', note: 'wordmark, second half' },
  { file: 'app/index.tsx', key: 'placesKicker', bg: 'ink', note: 'welcome place strip kicker' },
  { file: 'components/art.tsx', key: 'plateLabel', bg: 'ink', note: 'place name under its picture' },
  // The same two keys again on the panel surface: UI03's cast row sits inside a
  // `Section`, which paints `surface` where the welcome strip paints the page.
  { file: 'components/art.tsx', key: 'plateLabel', bg: 'surface', note: 'cast name under a portrait' },
  { file: 'components/art.tsx', key: 'plateNote', bg: 'surface', note: 'cast role under the name' },
  // No "resource line" pair: `resources` is a row container that paints no text, and
  // the tiles inside it are hud.tsx's, measured there.
  { file: 'app/world/[worldId].tsx', key: 'body', bg: 'ink', note: 'play body' },
  { file: 'app/world/[worldId].tsx', key: 'receiptText', bg: 'surface', note: 'decision receipt' },
  { file: 'app/world/[worldId].tsx', key: 'deadEnd', bg: 'ink', note: 'dead-end note' },
  { file: 'app/world/[worldId].tsx', key: 'actionLabel', bg: 'surface', note: 'world action label' },
  { file: 'app/world/[worldId].tsx', key: 'actionNote', bg: 'surface', note: 'world action note' },
  { file: 'app/genesis.tsx', key: 'noteText', bg: 'surface', note: 'quota note' },
  { file: 'app/library.tsx', key: 'emptyText', bg: 'surface', note: 'empty list' },
  { file: 'app/library.tsx', key: 'emptyKicker', bg: 'surface', note: 'empty nexus kicker' },
  { file: 'app/preview.tsx', key: 'kicker', bg: 'surface', sizeToken: 'label', note: 'preview scene line' },
  { file: 'app/preview.tsx', key: 'paragraph', bg: 'surface', sizeToken: 'lead', note: 'preview prose' },
  { file: 'app/preview.tsx', key: 'receiptLabel', bg: 'surface', note: 'what moved label' },
  { file: 'app/preview.tsx', key: 'receiptText', bg: 'surface', note: 'what moved' },
  { file: 'app/preview.tsx', key: 'upgradeText', bg: 'surface', note: 'why an account exists' },
  { file: 'app/history/[worldId].tsx', key: 'title', bg: 'surface', note: 'episode heading' },
  { file: 'app/setup.tsx', key: 'premiseKicker', bg: 'surface', note: 'premise kicker' },
  { file: 'app/setup.tsx', key: 'premiseTitle', bg: 'surface', note: 'premise heading' },
  { file: 'app/setup.tsx', key: 'premiseText', bg: 'surface', note: 'premise text' },
  { file: 'app/setup.tsx', key: 'chipText', bg: 'surface', note: 'unselected chip' },
  { file: 'app/setup.tsx', key: 'chipTextOn', bg: 'violet', sizeToken: 'label', note: 'selected chip' },
  { file: 'app/setup.tsx', key: 'problemText', bg: 'surface', note: 'validation problem' },
  { file: 'app/sign-in.tsx', key: 'label', bg: 'ink', note: 'field label' },
  { file: 'app/sign-in.tsx', key: 'input', bg: 'surface', note: 'typed value' },
  { file: 'app/sign-in.tsx', key: 'input', bg: 'surface', fgToken: 'muted', note: 'placeholder' },
  { file: 'app/sign-in.tsx', key: 'hint', bg: 'ink', note: 'hint' },
  // The field keeps its own ink fill inside the panel, so the text in it is measured
  // on ink — the well, not the wall around it. `label` and `hint` sit on the panel.
  { file: 'app/account.tsx', key: 'label', bg: 'surface', note: 'field label on a section panel' },
  { file: 'app/account.tsx', key: 'input', bg: 'ink', note: 'typed value on an ink field' },
  { file: 'app/account.tsx', key: 'input', bg: 'ink', fgToken: 'muted', note: 'placeholder on an ink field' },
  { file: 'app/account.tsx', key: 'hint', bg: 'surface', note: 'field hint on a section panel' },
  { file: 'components/ReportSheet.tsx', key: 'title', bg: 'surface', note: 'sheet title' },
  { file: 'components/ReportSheet.tsx', key: 'scene', bg: 'surface', note: 'episode label' },
  { file: 'components/ReportSheet.tsx', key: 'legend', bg: 'surface', note: 'legend' },
  { file: 'components/ReportSheet.tsx', key: 'reasonLabel', bg: 'surface', note: 'reason text' },
  { file: 'components/ReportSheet.tsx', key: 'note', bg: 'ink', note: 'note text on an ink field' },
  { file: 'components/ReportSheet.tsx', key: 'note', bg: 'ink', fgToken: 'muted', note: 'placeholder on an ink field' },
  { file: 'components/ReportSheet.tsx', key: 'cancelText', bg: 'surface', note: 'cancel text' },
  { file: 'components/ReportSheet.tsx', key: 'submitText', bg: 'violet', note: 'submit text' },
  { file: 'components/ReportSheet.tsx', key: 'doneText', bg: 'violet', note: 'receipt confirmation text' },
  { file: 'components/ReportSheet.tsx', key: 'error', bg: 'surface', note: 'sheet error' },
  { file: 'components/ReportSheet.tsx', key: 'receipt', bg: 'surface', note: 'receipt reference' },
  { file: 'components/ReportSheet.tsx', key: 'receiptLabel', bg: 'surface', note: 'receipt label' },
  { file: 'components/ReportSheet.tsx', key: 'line', bg: 'surface', note: 'note line' },
  { file: 'app/paywall.tsx', key: 'planName', bg: 'surface', note: 'plan name' },
  { file: 'app/paywall.tsx', key: 'price', bg: 'surface', note: 'price' },
  { file: 'app/paywall.tsx', key: 'body', bg: 'surface', note: 'plan body' },
  { file: 'components/hud.tsx', key: 'name', bg: 'surface', note: 'stat name' },
  { file: 'components/hud.tsx', key: 'value', bg: 'surface', note: 'stat value' },
  { file: 'components/hud.tsx', key: 'chipText', bg: 'surface', fgToken: 'success', note: 'rising delta chip' },
  { file: 'components/hud.tsx', key: 'chipText', bg: 'surface', fgToken: 'danger', note: 'falling delta chip' },
  { file: 'components/hud.tsx', key: 'readoutLabel', bg: 'surface', note: 'instrument panel label' },
  { file: 'components/hud.tsx', key: 'readoutValue', bg: 'surface', note: 'instrument panel value' },
  { file: 'components/hud.tsx', key: 'tagLabel', bg: 'ink', note: 'strip readout name' },
  { file: 'components/hud.tsx', key: 'tagValue', bg: 'ink', note: 'strip readout value' },
  // The doors on UI02. The kicker is the same violet on the same plate as the episode
  // kicker in a history row, but it is measured as its own pair: a panel the player
  // taps is a control, and a control whose label nobody checked is a gate that only
  // looks measured.
  { file: 'components/hud.tsx', key: 'doorKicker', bg: 'surface', note: 'door kicker' },
  { file: 'components/hud.tsx', key: 'doorTitle', bg: 'surface', note: 'door title' },
  { file: 'components/hud.tsx', key: 'doorBlurb', bg: 'surface', note: 'door blurb' },
];

/** A source file's style block, read from the key that names it. Brace matching with
 *  quote awareness, because `backgroundColor: 'transparent'` contains a brace-free
 *  string and a multiline block is the norm in this codebase. */
function styleBlock(text: string, file: string, key: string): string {
  const found = new RegExp(`^[ \\t]*${key}:[ \\t]*\\{`, 'm').exec(text);
  if (!found) throw new Error(`${file} has no style key “${key}” — this table is stale`);
  const open = text.indexOf('{', found.index);
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i]!;
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  throw new Error(`${file}: style key “${key}” never closes`);
}

/** The token a property names, if it names one. `(^|[\s,{])` keeps `backgroundColor`
 *  and `borderColor` out of a search for `color`. */
function tokenOf(block: string, prop: string, set: 'color' | 'font'): string | null {
  const m = new RegExp(`(^|[\\s,{])${prop}:\\s*(?:${set}\\.(\\w+)|(onAccent))`).exec(block);
  return m ? (m[2] ?? m[3] ?? null) : null;
}

function hexOf(token: string): Hex {
  if (token === 'onAccent') return onAccent;
  const hex = color[token as keyof typeof color];
  if (!hex) throw new Error(`color.${token} is not a theme token`);
  return hex as Hex;
}

/** A numeric constant the app itself declares, read out of its source. An animation
 *  measured at a number this test invented is not a measurement: the value has to
 *  come from the code that runs, or a change there would leave the gate describing a
 *  motion the app no longer performs. */
function constOf(file: string, name: string): number {
  const source = sourceIndex().get(file);
  if (!source) throw new Error(`${file} is not in the source tree`);
  const m = new RegExp(`^export const ${name}\\s*=\\s*([\\d.]+);`, 'm').exec(source);
  if (!m) throw new Error(`${file} declares no numeric \`export const ${name}\` — this gate is stale`);
  return Number(m[1]);
}

function pairOf(site: Site): Pair {
  const source = sourceIndex().get(site.file);
  if (source === undefined) throw new Error(`${site.file} is not in the source tree`);
  const block = styleBlock(source, site.file, site.key);

  const fgToken = site.fgToken ?? tokenOf(block, 'color', 'color');
  if (!fgToken) throw new Error(`${site.file} · ${site.key} paints no text colour`);
  // A composed colour is a claim about the call site, so it is checked against the
  // file rather than trusted: the entry fails when the app stops painting that token.
  if (site.fgToken && !source.includes(site.fgToken === 'onAccent' ? 'onAccent' : `color.${site.fgToken}`)) {
    throw new Error(`${site.file} never mentions color.${site.fgToken}`);
  }

  const sizeToken = site.sizeToken ?? tokenOf(block, 'fontSize', 'font');
  if (!sizeToken) throw new Error(`${site.file} · ${site.key} sets no fontSize`);
  if (site.sizeToken && !source.includes(`font.${site.sizeToken}`)) {
    throw new Error(`${site.file} never mentions font.${site.sizeToken}`);
  }

  const weight = Number(/fontWeight:\s*'(\d+)'/.exec(block)?.[1] ?? 400);
  return {
    fg: hexOf(fgToken),
    bg: hexOf(site.bg),
    size: font[sizeToken as keyof typeof font],
    // WCAG counts 700 and up as bold for the large-text threshold; 600 in this design
    // system does not buy a looser ratio.
    bold: weight >= 700,
    where: `${site.file} · ${site.key} (${site.note})`,
  };
}

const TEXT_PAIRS: Pair[] = SITES.map(pairOf);

/** The same anchor read for SC 1.4.11: a boundary token comes out of the key that
 *  paints it, measured against the surface the note says it lands on. */
function boundary(file: string, key: string, prop: string, on: string, note: string): { where: string; ratio: number } {
  const source = sourceIndex().get(file);
  if (!source) throw new Error(`${file} is not in the source tree`);
  const token = tokenOf(styleBlock(source, file, key), prop, 'color');
  if (!token) throw new Error(`${file} · ${key} sets no ${prop}`);
  return { where: `${file} · ${key} (${note})`, ratio: contrastRatio(hexOf(token), hexOf(on)) };
}


/** The app only ever paints a boundary against one of these two, so a border token
 *  is checked against both instead of guessing which screen it lands on. */
const BACKGROUNDS = [color.ink, color.surface] as const;

function sourceFiles(): { path: string; text: string }[] {
  const roots = ['../app', '../components'].map((p) => fileURLToPath(new URL(p, import.meta.url)));
  const out: { path: string; text: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.tsx')) out.push({ path: full, text: readFileSync(full, 'utf8') });
    }
  };
  for (const root of roots) walk(root);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** A JSX opening tag ends at the first `>` that is not the tail of an arrow
 *  function and is not inside a string — `style={({ pressed }) => [...]}` spans
 *  lines in this codebase and would otherwise truncate the scan. */
function openingTag(text: string, from: number): string {
  let quote: string | null = null;
  let depth = 0;
  for (let i = from; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    else if (c === '>' && depth === 0 && text[i - 1] !== '=') return text.slice(from, i + 1);
  }
  return text.slice(from);
}

function tagIndexes(text: string, tag: string): number[] {
  const found: number[] = [];
  let at = text.indexOf(tag);
  while (at !== -1) {
    found.push(at);
    at = text.indexOf(tag, at + tag.length);
  }
  return found;
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

/** Windows paths arrive with backslashes, so a label is the last two segments. */
function label(path: string, line?: number): string {
  const short = path.split(/[\\/]/).slice(-2).join('/');
  return line === undefined ? short : `${short}:${line}`;
}

describe('contrast arithmetic', () => {
  it('reproduces the ratios the specification is written against', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 4);
    expect(contrastRatio('#000000', '#000000')).toBeCloseTo(1, 4);
    expect(isLargeText(24, false)).toBe(true);
    expect(isLargeText(18.66, true)).toBe(true);
    expect(isLargeText(20, false)).toBe(false);
    expect(requiredRatio('text')).toBe(4.5);
    expect(requiredRatio('text-large')).toBe(3);
    expect(requiredRatio('ui')).toBe(3);
  });
});

describe('the page the pairs are anchored to', () => {
  it('the backdrop never paints a plate brighter than the page colour text is measured on', () => {
    // `contrast.test.ts` anchors body text to `color.ink`, and the backdrop
    // (`components/hud.tsx` → `lib/plates.ts`) is a ramp of composites under it. A
    // ramp that stayed at or below `ink` in luminance can only raise every ratio
    // measured on that anchor; one band brighter would leave the whole table
    // describing a page the app no longer paints.
    const ceiling = relativeLuminance(color.ink as Hex);
    const offenders = plates()
      .map((plate) => ({ plate, ratio: contrastRatio(color.text as Hex, plate), over: relativeLuminance(plate) > ceiling }))
      .filter((p) => p.over)
      .map((p) => `${p.plate} er lysere enn ${color.ink} (${p.ratio.toFixed(2)} mot tekst)`);
    console.log(`  ${plates().length} plates sjekket — svakste tekstforhold ${Math.min(...plates().map((p) => contrastRatio(color.text as Hex, p))).toFixed(2)}:1`);
    expect(offenders).toEqual([]);
  });
});

describe('SC 1.4.3 — text contrast', () => {
  it('every text pair the app paints reaches its AA ratio', () => {
    const failures = TEXT_PAIRS.map((p) => {
      const kind = isLargeText(p.size, p.bold) ? 'text-large' : 'text';
      return { ...p, ...check(p.fg, p.bg, kind), kind };
    }).filter((p) => !p.pass);

    const measured = TEXT_PAIRS.map((p) => {
      const kind = isLargeText(p.size, p.bold) ? 'text-large' : 'text';
      return { ratio: contrastRatio(p.fg, p.bg), kind, where: p.where };
    }).sort((a, b) => a.ratio - b.ratio);

    console.log(
      `  ${TEXT_PAIRS.length} textpar målt — svakste: ${measured
        .slice(0, 5)
        .map((m) => `${m.ratio.toFixed(2)} (${m.where})`)
        .join(', ')}`,
    );

    expect(failures.map((f) => `${f.where}: ${f.ratio.toFixed(2)} < ${f.need}`)).toEqual([]);
  });

  it('the press state still clears AA while it is held', () => {
    // opacity composites the whole control toward the page behind it, so the label
    // and the fill are flattened separately before the ratio is taken.
    const cases = [
      { label: 'primary pressed', fg: composite(onAccent, color.ink, 0.85), bg: composite(color.violet, color.ink, 0.85) },
      { label: 'accent pressed', fg: composite(onAccent, color.ink, 0.85), bg: composite(color.cyan, color.ink, 0.85) },
      { label: 'secondary pressed', fg: composite(color.text, color.ink, 0.85), bg: composite(color.raised, color.ink, 0.85) },
      { label: 'choice pressed', fg: composite(color.text, color.ink, 0.85), bg: composite(color.raised, color.ink, 0.85) },
      // The door panel's quiet line is the dimmest text that changes plate when the
      // panel is held down, so it is the pair a press could break.
      { label: 'door blurb pressed', fg: composite(color.muted, color.ink, 0.85), bg: composite(color.raised, color.ink, 0.85) },
      // The kicker of a door is the pair that found this test: violet measured 3.88 on
      // the plate the panel wears while it is held, on the same screen where it clears
      // 5.82 at rest. A mid-tone on a plate that brightens is the case the static list
      // cannot see, so every text colour a press moves is taken on the pressed plate.
      { label: 'door kicker pressed', fg: composite(color.cyan, color.ink, 0.85), bg: composite(color.raised, color.ink, 0.85) },
      // The world row's state word is the one green the list paints on a plate that
      // moves under the finger.
      { label: 'world state pressed', fg: composite(color.success, color.ink, 0.85), bg: composite(color.raised, color.ink, 0.85) },
      { label: 'submit pressed', fg: composite(onAccent, color.surface, 0.85), bg: composite(color.violet, color.surface, 0.85) },
    ];
    for (const c of cases) {
      const ratio = contrastRatio(c.fg, c.bg);
      console.log(`  ${c.label}: ${ratio.toFixed(2)} mot 4.5`);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('measures the disabled state without asserting on it', () => {
    // Understanding 1.4.3 and 1.4.11 both except inactive components, so 45 % is
    // allowed. The number is printed because a reader needs a reason for the wash.
    for (const bg of [color.ink, color.surface, color.violet]) {
      const ratio = contrastRatio(composite(color.text, bg, 0.45), bg);
      console.log(`  disabled tekst over ${bg}: ${ratio.toFixed(2)} (unntatt — inaktiv kontroll)`);
    }
    expect(touchTarget).toBeGreaterThanOrEqual(44);
  });
});

describe('SC 1.4.11 — the boundary that identifies a control', () => {
  it('every border in the app clears 3:1 against both page backgrounds', () => {
    const failures: string[] = [];
    const measured: { site: string; token: string; worst: number }[] = [];

    for (const { path, text } of sourceFiles()) {
      // The assignment is read up to the next comma or line end, and every token in
      // it is measured: a border chosen by a condition (`state ? a : b`) paints both
      // colours in the app's lifetime, so both have to clear the bar.
      const border = /border(?:Top|Bottom|Left|Right)?Color:\s*([^,\n]+)/g;
      for (const match of text.matchAll(border)) {
        for (const tokenMatch of match[1]!.matchAll(/color\.(\w+)/g)) {
          const token = tokenMatch[1]!;
          const hex = color[token as keyof typeof color] as Hex;
          const worst = Math.min(...BACKGROUNDS.map((bg) => contrastRatio(hex, bg)));
          const where = label(path, lineOf(text, match.index!));
          measured.push({ site: where, token, worst });
          if (worst < 3) failures.push(`${where}: color.${token} mot Ink/Surface gir ${worst.toFixed(2)} < 3`);
        }
      }
    }

    console.log(`  ${measured.length} kanter målt — svakste: ${measured.slice().sort((a, b) => a.worst - b.worst).slice(0, 6).map((m) => `${m.token} ${m.worst.toFixed(2)} (${m.site})`).join(', ')}`);
    expect(failures).toEqual([]);
  });

  it('selection indicators clear 3:1 as non-text content', () => {
    // Same anchor as the text pairs: the file and the key that paints the boundary,
    // so a renamed or removed indicator fails the gate instead of being re-typed.
    const indicators = [
      boundary('components/ReportSheet.tsx', 'radio', 'borderColor', 'surface', 'unselected radio'),
      boundary('components/ReportSheet.tsx', 'radioOn', 'borderColor', 'surface', 'selected radio'),
      boundary('app/setup.tsx', 'chipOn', 'borderColor', 'surface', 'selected chip outline'),
      boundary('app/index.tsx', 'gate', 'backgroundColor', 'surface', 'gate bar'),
      boundary('app/index.tsx', 'gateStill', 'backgroundColor', 'surface', 'still gate bar'),
      boundary('components/kit.tsx', 'staticBar', 'backgroundColor', 'surface', 'static progress bar'),
      boundary('components/kit.tsx', 'disclosure', 'borderLeftColor', 'surface', 'fiction mark on the disclosure'),
      boundary('app/preview.tsx', 'upgrade', 'borderLeftColor', 'surface', 'fiction mark on the preview receipt'),
      boundary('components/nav.tsx', 'tabOn', 'borderTopColor', 'deep', 'lit tab top edge'),
    ];
    for (const i of indicators) {
      console.log(`  ${i.where}: ${i.ratio.toFixed(2)} mot 3`);
      expect(i.ratio).toBeGreaterThanOrEqual(3);
    }
  });

  it('the breathing dot is still there at the bottom of its breath', () => {
    // The 1.4.11 gate does not ask for this one: `StoryStatus` hides the dot from the
    // tree and the word `Active` beside it carries the state, so the dot is
    // decoration. It is measured anyway because it is the only moving thing in the
    // app and a player watches it — a token change or a deeper trough that made it
    // vanish at the low point would read as a broken screen, and no static pair and
    // no device-walk check looks at colour. Flattened over both backgrounds the strip
    // is painted on, at the trough the component itself declares.
    const trough = constOf('components/hud.tsx', 'breathTrough');
    expect(trough).toBeGreaterThan(0);
    expect(trough).toBeLessThan(1);
    for (const bg of BACKGROUNDS) {
      const ratio = contrastRatio(composite(color.success, bg, trough), bg);
      console.log(`  pustende dot på ${bg} ved ${trough}: ${ratio.toFixed(2)} mot 3`);
      expect(ratio).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('SC 2.5.8 — touch targets', () => {
  it('the token is at least 44 and no control writes the number by hand', () => {
    expect(touchTarget).toBeGreaterThanOrEqual(44);

    const offenders: string[] = [];
    for (const { path, text } of sourceFiles()) {
      for (const match of text.matchAll(/minHeight:\s*(\d+)/g)) {
        const px = Number(match[1]);
        if (px < touchTarget) offenders.push(`${label(path, lineOf(text, match.index!))}: minHeight ${px} < ${touchTarget}`);
        if (px === touchTarget) offenders.push(`${label(path, lineOf(text, match.index!))}: skriver ${touchTarget} rett, bruk touchTarget`);
      }
    }
    // Heights that come from padding and content (privacy rows) are not visible in
    // a static scan; only a declared minHeight is checked here.
    expect(offenders).toEqual([]);
  });
});

describe('NFR-07 — control semantics in the sources', () => {
  it('every Pressable says what kind of control it is', () => {
    const missing: string[] = [];
    let checked = 0;
    for (const { path, text } of sourceFiles()) {
      for (const at of tagIndexes(text, '<Pressable')) {
        checked += 1;
        if (!openingTag(text, at).includes('accessibilityRole')) missing.push(label(path, lineOf(text, at)));
      }
    }
    console.log(`  ${checked} Pressableelement sjekket`);
    expect(missing).toEqual([]);
  });

  it('every control draws its own focus indicator (SC 2.4.7)', () => {
    // React Native paints nothing when a control takes focus, so a ring the app does
    // not draw is a screen that fails the guideline on a device with a keyboard or a
    // switch attached. Counted per element, because a file that wires the first
    // control and forgets the fourth is the failure this rule exists for.
    const missing: string[] = [];
    let checked = 0;
    for (const { path, text } of sourceFiles()) {
      for (const element of ['<Pressable', '<TextInput']) {
        for (const at of tagIndexes(text, element)) {
          checked += 1;
          if (!openingTag(text, at).includes('focusRing')) missing.push(`${label(path, lineOf(text, at))} ${element}`);
        }
      }
    }
    console.log(`  ${checked} kontroller målt for fokusring`);
    expect(missing).toEqual([]);
  });

  it('the focus ring clears 3:1 on every surface a control can sit on', () => {
    // Anchored to the token and not to a hex, so a colour change in `theme.ts` changes
    // what this measures instead of quietly agreeing with itself. `raised` is in the
    // list because a pressed secondary button wears it while the ring is drawn.
    for (const bg of [...BACKGROUNDS, color.raised]) {
      const ratio = contrastRatio(focusRing.borderColor, bg);
      if (ratio < 3) throw new Error(`fokusring mot ${bg}: ${ratio.toFixed(2)} < 3`);
      console.log(`  fokusring mot ${bg}: ${ratio.toFixed(2)}`);
    }
    expect(focusRing.borderWidth).toBeGreaterThanOrEqual(2);
  });

  it('every TextInput carries a label a reader can speak', () => {
    const missing: string[] = [];
    for (const { path, text } of sourceFiles()) {
      for (const at of tagIndexes(text, '<TextInput')) {
        if (!openingTag(text, at).includes('accessibilityLabel')) missing.push(label(path, lineOf(text, at)));
      }
    }
    expect(missing).toEqual([]);
  });

  it('raster art stays out of the accessibility tree: only the band draws an Image', () => {
    const offenders: string[] = [];
    for (const { path, text } of sourceFiles()) {
      if (path.replace(/\\/g, '/').endsWith('components/art.tsx')) continue;
      for (const at of tagIndexes(text, '<Image')) offenders.push(label(path, lineOf(text, at)));
    }
    expect(offenders).toEqual([]);
  });

  it('a radio is never alone: a group declares itself', () => {
    const offenders: string[] = [];
    for (const { path, text } of sourceFiles()) {
      if (text.includes('accessibilityRole="radio"') && !text.includes('accessibilityRole="radiogroup"')) {
        offenders.push(`${label(path)}: radioer uten radiogroup`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the reduced-motion switch reaches the things that move', () => {
    // UI10's row promises that motion becomes a static element, and neither a pair of
    // contrast numbers nor the accessibility tree can show whether it keeps that
    // promise — only a device setting and an eye can. So the wiring is scanned: the
    // hook every animated element asks has to read the app's own flag, and the screen
    // that writes the flag has to read the state it produces. Measured 2026-10-12,
    // when the row wrote `flags.reducedMotion` and nothing in the app read it back
    // while the spinner kept turning.
    const hook = readFileSync(fileURLToPath(new URL('../hooks/useApp.ts', import.meta.url)), 'utf8');
    const problems: string[] = [];
    if (!hook.includes('flags.reducedMotion')) {
      problems.push('hooks/useApp.ts: useReduceMotion() asks only the platform, so the app’s own switch changes nothing');
    }
    for (const { path, text } of sourceFiles()) {
      if (text.includes('setFlags({ reducedMotion') && !text.includes('useReduceMotion')) {
        problems.push(`${label(path)}: skriver redusert-bevegelse-flaggen uten å lese tilstanden den styrer`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('SC 1.4.4 — text at 200 %', () => {
  it('the chrome cap is the standard’s number, not a layout compromise', () => {
    // Chrome may stop scaling somewhere, but not below the 2× the criterion asks
    // for; what keeps it on the screen is the layout (Row wraps, badges grow),
    // and that is measured on the device at font_scale 2.0.
    expect(maxFontScale.chrome).toBeGreaterThanOrEqual(2);
    expect(maxFontScale.body).toBe(Infinity);
  });

  it('every Text in the app says how it scales', () => {
    // An absent multiplier is not "uncapped" in practice — it inherits whatever the
    // platform does — so it is a hole in the measurement rather than a choice. 66
    // Text elements today; a new one has to state its own answer.
    const missing: string[] = [];
    let checked = 0;
    for (const { path, text } of sourceFiles()) {
      // `(?![\w-])` keeps `<TextInput` out of a scan for `<Text`.
      for (const match of text.matchAll(/<Text(?![\w-])/g)) {
        checked += 1;
        const at = match.index!;
        if (!openingTag(text, at).includes('maxFontSizeMultiplier')) missing.push(label(path, lineOf(text, at)));
      }
    }
    console.log(`  ${checked} Textelementer sjekket for maksmultiplikator`);
    expect(missing).toEqual([]);
  });
});
