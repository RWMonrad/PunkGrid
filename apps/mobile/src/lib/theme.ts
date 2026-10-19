// Designsystem v1 — Master §5.5. Tokens are the only source of colour, size and
// spacing in the app; a status is never carried by colour alone, so every token
// that reads as a state also has a text label at the call site.
//
// v1 moves the accents to the signal palette of the Stitch mockups
// (`vibe_images/stitch-1..4/DESIGN.md`, "Cyber-Tactical HUD"): the electric cyan
// and the magenta/amber family are what make a mockup screen read as a live
// instrument rather than a document. Every value below was measured against every
// plate it can sit on before it replaced its v0 twin, with `contrast.test.ts` as
// the gate — the mockups' own teal-on-void pairs fail SC 1.4.3 and 1.4.11 at the
// sizes they draw them, so what is taken from them is the signal, not the ratio.

export const color = {
  ink: '#0D1223',
  /** The floor of the backdrop ramp. It exists as a token rather than a literal in
   *  `plates.ts` because the ramp's ceiling is `ink`, and the pair (floor, ceiling)
   *  is the property `contrast.test.ts` measures: every band the page paints is at
   *  most as bright as the colour the text pairs are anchored to. */
  deep: '#070A14',
  surface: '#18213A',
  raised: '#24314E',
  violet: '#A58BFA',
  /** The mockups' Electric Cyan (#00F5D4). As text it measures 13.3:1 on Ink,
   *  11.2:1 on Surface and 9.3:1 on Raised — brighter than the v0 sky-cyan on every
   *  plate, so the one accent the app already measured got stronger, not riskier.
   *  The label it paints always says the same thing in words (§5.5). */
  cyan: '#00F5D4',
  /** The mockups' Neon Magenta (#F72585), the hostile tone. It is a fill and a
   *  boundary only: against Ink it reaches 4.9:1 and against Surface 4.1:1, which
   *  clears the 3:1 a boundary is asked for but not the 4.5 body text is — so it
   *  never paints a word at reading size, and the family's readable tone is
   *  `pink`. Ink text on a magenta fill measures 4.9:1, so a filled hostile badge
   *  keeps its ink label. */
  magenta: '#F72585',
  /** The magenta family's readable tone (the mockups' #FFB1C6): 11.7:1 on Ink and
   *  9.2:1 on Surface, so a hostile or dramatic word can sit where `magenta` cannot. */
  pink: '#FFB1C6',
  /** The mockups' Hazard Amber (#FFB703): 10.7:1 on Ink, 8.9:1 on Surface — text-safe
   *  on every plate, and the colour of a state that is neither hostile nor settled
   *  (a pending episode, a paused engine). The word beside it still carries the state. */
  amber: '#FFB703',
  danger: '#FF8F99',
  success: '#8BE0B0',
  text: '#F5F7FF',
  muted: '#BDC8E1',
  /** The line token exists because `raised` cannot be one: as a 1px boundary it
   *  measures 1.44:1 on Ink and 1.23:1 on Surface, and SC 1.4.11 asks for 3:1
   *  wherever the boundary is what tells the user where a control is (NFR-07).
   *  `line` measures 4.20 on Ink and 3.59 on Surface, so it holds against both
   *  neighbours a border can sit on. `raised` stays a fill — button, toast, press.
   */
  line: '#66789C',
} as const;

/** On Cyan and Violet the dark ink is the only combination that reaches 4.5:1 at
 *  body size, so those two pairs are fixed here rather than left to each screen. */
export const onAccent = color.ink;

export const font = {
  caption: 12,
  label: 14,
  body: 16,
  lead: 20,
  title: 24,
  display: 32,
} as const;

/** The faces the app loads at start (`lib/fonts.ts` — the mockups' own pairing:
 *  Plus Jakarta Sans for everything a player reads, JetBrains Mono for every
 *  number and label that pretends to be telemetry). Named here as strings and not
 *  imported, because `contrast.test.ts` reads this file in a Node worker where a
 *  font file cannot be required; on a device an unresolved family falls back to
 *  the platform default, so a failed load degrades the look and never the layout.
 *  Weight-matched families carry the bold steps, because a synthesized bold is a
 *  lie a fixed-width face especially refuses to tell. */
export const face = {
  sans: 'PlusJakartaSans_400Regular',
  sansBold: 'PlusJakartaSans_700Bold',
  sansHeavy: 'PlusJakartaSans_800ExtraBold',
  mono: 'JetBrainsMono_400Regular',
  monoBold: 'JetBrainsMono_700Bold',
} as const;

/** SC 1.4.4 asks for text that survives 200 % scaling without losing content or
 *  function, so the cap is the standard's own number and not a layout compromise:
 *  reading text follows the platform setting, chrome stops at exactly 2×, and what
 *  keeps chrome on the screen is the layout — `Row` wraps, the choice badge is
 *  sized by padding, and no text sits in a fixed box. Measured on the device at
 *  `font_scale 2.0` (`npm run walk:device`), which is why the cap could be raised. */
export const maxFontScale = { body: Infinity, chrome: 2 } as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 8, md: 12, lg: 20 } as const;

export const touchTarget = 44;

/** SC 2.4.7 asks for a visible focus indicator, and React Native draws none: on a
 *  device with a keyboard or a switch attached, a focused control looks exactly
 *  like an unfocused one unless the app paints the difference. `Pressable` reports
 *  `pressed` in its style callback and nothing else, so a control learns it has
 *  focus from `onFocus`/`onBlur` held as state, and every control in the app takes
 *  its ring from this token and nothing else. Cyan is the one token that clears the
 *  3:1 a focus indicator is asked for against every surface a control can sit on —
 *  measured by `contrast.test.ts` against ink, surface and the raised fill a pressed
 *  control wears — and 2 dp is thick enough to read against the 1 dp `line` border
 *  many of those controls already have.
 */
export const focusRing = { borderWidth: 2, borderColor: color.cyan } as const;

/** The HUD glow the mockups paint with `text-shadow` and box-shadows: the number
 *  that matters gets a soft corona of its own colour, drawn under the glyph where
 *  it cannot touch a boundary. Android honours `textShadowColor`; the offsets are
 *  zero so the glyphs stay exactly where the layout put them. Decoration only —
 *  the number's meaning is in its label, never in the glow. */
export const glow = (tone: string) => ({ textShadowColor: tone, textShadowRadius: 12 });
