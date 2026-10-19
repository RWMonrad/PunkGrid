// The HUD layer borrowed from the Stitch mockups (vibe_images/stitch-1..4,
// "Cyber-Tactical HUD"), rebuilt on this app's own measured tokens. What is taken
// is the structure — the beacon beside a label, the fixed-width value, the bracket
// that makes a panel read as an instrument — and the mockups' own typography rule:
// numbers and labels that pretend to be telemetry are set in JetBrains Mono
// (`face.mono`), uppercase with positive tracking, while every sentence a player
// reads stays in the sans face. Their 9 px micro-labels fail SC 1.4.3 here, so the
// smallest telemetry this app paints is `font.caption` (12) on the measured plates.

import { useEffect, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';

import { ArtBand } from './art';
import { plates, seam } from '../lib/plates';
import { color, face, focusRing, font, glow, maxFontScale, radius, space, touchTarget } from '../lib/theme';

/** The darkest moment of the breath, and its period. Both are exported because
 *  `contrast.test.ts` measures the trough rather than the peak: an element that
 *  fades to a colour nobody measured is a gate that only looks measured. */
export const breathTrough = 0.55;
export const breathMs = 2600;

/** The state beacon of a live world, breathing. It is decoration — the word beside it
 *  says `Active`, so no state is signalled by colour or motion alone (§5.5) — and it
 *  is hidden from the tree, which is why the device walk counts the same nodes with
 *  it on the screen as without it.
 *
 *  `reduced` stops the animation instead of shortening it, and the dot then sits at
 *  full opacity: the platform's own answer to reduce motion, read by the caller
 *  rather than guessed here. */
export function LiveDot({ tone, reduced = false }: { tone: string; reduced?: boolean }) {
  const [phase] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(phase, { toValue: 1, duration: breathMs / 2, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(phase, { toValue: 0, duration: breathMs / 2, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [phase, reduced]);
  return (
    <Animated.View
      style={[styles.liveDot, { backgroundColor: tone, opacity: reduced ? 1 : phase.interpolate({ inputRange: [0, 1], outputRange: [breathTrough, 1] }) }]}
      accessibilityElementsHidden
    />
  );
}

/** The four ticks that make a box read as an instrument rather than a snapshot.
 *  Decoration inside a node the tree already ignores or, on a tile, beside text the
 *  walk reads — so the ticks carry no meaning and are hidden wherever they can be. */
export function CornerTicks({ tone = color.cyan }: { tone?: string }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden>
      <View style={[styles.tick, styles.tickTL, { borderColor: tone }]} />
      <View style={[styles.tick, styles.tickTR, { borderColor: tone }]} />
      <View style={[styles.tick, styles.tickBL, { borderColor: tone }]} />
      <View style={[styles.tick, styles.tickBR, { borderColor: tone }]} />
    </View>
  );
}

/** An entry a player chooses between, drawn as the mockup's bracketed panel instead
 *  of a plate with a word in it: a kicker that names what kind of door it is, the
 *  door's own name at reading size, and the one sentence that tells what it costs.
 *
 *  It is a `Pressable` with the same three properties `ChoiceCard` had to earn on the
 *  device — a composed label so the panel is one announcement, the ring the app paints
 *  itself (SC 2.4.7), and a box that is the touch target rather than a 44 dp strip
 *  inside a taller card. The accent is a rail and a bracket, never a colour alone: the
 *  kicker says which door it is in words, so §5.5's rule holds at 200 % text and in
 *  greyscale alike.
 *
 *  `art` is the door's own picture, laid between the kicker and the name. It is not a
 *  caption of anything: what the door is and what it costs are both already in the two
 *  lines of text on either side of it, so the band stays out of the tree (rule 1) and
 *  the walk reads the same three nodes it read before the pictures arrived. An accent
 *  door also wears the mockup's scanner stroke — a short signal line across the top
 *  edge — which is decoration the kicker already names. */
export function DoorCard({ kicker, title, blurb, art, onPress, accessibilityHint, accent = false, disabled = false }: {
  kicker: string;
  title: string;
  blurb: string;
  art?: ImageSourcePropType;
  onPress: () => void;
  accessibilityHint?: string;
  accent?: boolean;
  disabled?: boolean;
}) {
  const [isFocused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${kicker}. ${title}. ${blurb}`}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [styles.door, accent && styles.doorAccent, isFocused && focusRing, pressed && styles.doorPressed, disabled && styles.doorDisabled]}
    >
      <Text style={styles.doorKicker} maxFontSizeMultiplier={maxFontScale.chrome}>
        {kicker.toUpperCase()}
      </Text>
      <ArtBand source={art} height={96} corner={radius.sm} />
      <Text style={styles.doorTitle} maxFontSizeMultiplier={maxFontScale.chrome}>
        {title}
      </Text>
      <Text style={styles.doorBlurb} maxFontSizeMultiplier={maxFontScale.body}>
        {blurb}
      </Text>
      {accent ? (
        <View style={styles.doorScan} accessibilityElementsHidden />
      ) : null}
      {accent ? <CornerTicks tone={color.cyan} /> : null}
    </Pressable>
  );
}

/** The page under the content: a luminance ramp with a horizon and an inset frame,
 *  built from token composites so the brightest plate it paints is the `ink` every
 *  text pair is measured against (`lib/plates.ts`). No image, because the gate in
 *  `contrast.test.ts` cannot read a photograph, and no text ever sits on it without
 *  the plate beneath it being the measured worst case. */
export function Backdrop() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden>
      <View style={styles.ramp}>
        {plates().map((plate, i) => (
          <View key={`plate-${i}`} style={[styles.band, { backgroundColor: plate }]} />
        ))}
      </View>
      <View style={styles.frame} />
      <View style={[styles.hairline, { top: '16%' }]} />
      <View style={[styles.hairline, { top: '84%' }]} />
    </View>
  );
}


/** The sign is part of the text, so the colour only reinforces a direction the
 *  player can also read out (§5.5). */
function DeltaChip({ delta }: { delta: number }) {
  return (
    <View style={[styles.chip, { borderColor: delta > 0 ? color.success : color.danger }]}>
      <Text
        style={[styles.chipText, { color: delta > 0 ? color.success : color.danger }]}
        maxFontSizeMultiplier={maxFontScale.chrome}
      >
        {delta > 0 ? `+${delta}` : `${delta}`}
      </Text>
    </View>
  );
}

/** One resource from the world summary: what it is called, what it holds now, and
 *  — once the client has seen an earlier version of the same world — how far the
 *  last decision moved it. Nothing is drawn as a meter: the engine keeps these
 *  values unbounded (`core/src/reducer.ts:84`), so a bar would claim a maximum the
 *  rules never promised.
 *
 *  The tile is one announcement. A bare `View` says nothing of its own, so React
 *  Native leaves it out of the accessibility tree and hoists its two texts into the
 *  row beside them; measured on UI04 on 2026-10-12 the walk read
 *  `CASH 100 INFLUENCE CREDIBILITY 60 20`, which is the value of one resource after
 *  the name of another (SC 2.4.3, correctly failed). `accessible` with a composed
 *  label keeps the fact in the order the eye takes it, and it is the better sentence
 *  to hear: "CASH 100, down 5" rather than "100" with nothing to belong to.
 *
 *  The rail on the left and the beacon beside the name are the resource's own colour
 *  — cash is success, influence is cyan, credibility is violet — so three tiles in a
 *  row read as three kinds of number without the player having to read the name, and
 *  the value wears a corona of the same tone (the mockup's emissive telemetry). The
 *  colour reinforces a direction the words already carry (§5.5), the beacon is hidden
 *  from the tree, and the rail is 3 dp wide, which clears SC 1.4.11 against the
 *  surface it sits on. */
export function StatTile({ name, value, delta }: { name: string; value: number; delta?: number }) {
  const spoken = `${name.toUpperCase()} ${value}` + (delta ? `, ${delta > 0 ? 'up' : 'down'} ${Math.abs(delta)}` : '');
  const rail = resourceRail(name);
  return (
    <View style={[styles.tile, { borderLeftColor: rail }]} accessible accessibilityLabel={spoken}>
      <View style={styles.tileBody}>
        <View style={styles.tileHead}>
          <View style={[styles.beacon, { backgroundColor: rail }]} accessibilityElementsHidden />
          <Text style={styles.name} maxFontSizeMultiplier={maxFontScale.chrome}>
            {name.toUpperCase()}
          </Text>
          {delta ? <DeltaChip delta={delta} /> : null}
        </View>
        <Text style={[styles.value, glow(rail)]} maxFontSizeMultiplier={maxFontScale.chrome}>
          {`${value}`}
        </Text>
      </View>
      <CornerTicks />
    </View>
  );
}

/** The colour a resource's rail wears. Cash is the resource the player spends, so it
 *  takes the success green — the colour of things that stay. Influence is the colour
 *  of the doors on UI02, so it takes cyan — the colour of the path forward.
 *  Credibility is the resource the mockups' violet accent already pointed at, so it
 *  takes violet. Anything the rulepack names that is not one of these three falls
 *  back to `line`, which is the colour of a boundary that carries no meaning. */
function resourceRail(name: string): string {
  const key = name.toLowerCase();
  if (key === 'cash') return color.success;
  if (key === 'influence') return color.cyan;
  if (key === 'credibility') return color.violet;
  return color.line;
}

/** One fact in the strip's own voice: a fixed-width name and the value beside it.
 *  Uppercase and mono because the mockup's chrome reads as a panel of labels, and
 *  because these strings are short — a sentence belongs in `Text`, not here. */
export function Tag({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.tag}>
      <Text style={styles.tagLabel} maxFontSizeMultiplier={maxFontScale.chrome}>
        {label.toUpperCase()}
      </Text>
      <Text style={styles.tagValue} maxFontSizeMultiplier={maxFontScale.chrome}>
        {value}
      </Text>
    </View>
  );
}


/** One line of the instrument panel: what the device is called, and what it is set
 *  to. The value is fixed-width and selectable because these strings are read out
 *  character by character — `10.0.2.2` and `10.0.2.22` are the same width in a
 *  proportional face, and a player who has to type one of them should be able to
 *  copy it instead. */
export function Readout({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.readout}>
      <Text style={styles.readoutLabel} maxFontSizeMultiplier={maxFontScale.chrome}>
        {label.toUpperCase()}
      </Text>
      <Text style={styles.readoutValue} maxFontSizeMultiplier={maxFontScale.chrome} selectable>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  ramp: { ...StyleSheet.absoluteFill, flexDirection: 'column' },
  band: { flex: 1 },
  frame: { position: 'absolute', top: space.sm, right: space.sm, bottom: space.sm, left: space.sm, borderWidth: 1, borderColor: seam },
  hairline: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: seam },
  tick: { position: 'absolute', width: 12, height: 12 },
  tickTL: { top: 4, left: 4, borderTopWidth: 2, borderLeftWidth: 2 },
  tickTR: { top: 4, right: 4, borderTopWidth: 2, borderRightWidth: 2 },
  tickBL: { bottom: 4, left: 4, borderBottomWidth: 2, borderLeftWidth: 2 },
  tickBR: { bottom: 4, right: 4, borderBottomWidth: 2, borderRightWidth: 2 },
  // The same box as `kit.tsx`'s status dot, so a world that is live and a world that
  // is paused differ only in whether the dot breathes.
  liveDot: { width: 10, height: 10, borderRadius: radius.sm },
  // The mockups' telemetry beacons: a 6 dp square, sharp enough to read as a mark
  // rather than a dot. Decoration — the name beside it is what the tree reads.
  beacon: { width: 6, height: 6, borderRadius: 1 },
  // Wraps rather than collides: at 200 % text the label and the value are both 24 dp
  // tall, and a row that keeps them on one line reads as one word. Measured on UI04 at
  // font_scale 2.0 on 2026-10-12, where the pair came out as “EPISODEpublished”.
  tag: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, flexWrap: 'wrap' },
  tagLabel: { color: color.muted, fontSize: font.caption, fontFamily: face.monoBold, fontWeight: '700', letterSpacing: 0.8 },
  tagValue: { color: color.text, fontSize: font.caption, fontFamily: face.mono, letterSpacing: 0.4 },
  tile: { minWidth: 96, padding: space.md, backgroundColor: color.surface, borderWidth: 1, borderColor: color.line, borderLeftWidth: 3, borderRadius: radius.md },
  tileBody: { gap: space.xs },
  tileHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  name: { color: color.muted, fontSize: font.caption, fontFamily: face.monoBold, fontWeight: '700', letterSpacing: 0.6, flexShrink: 1 },
  value: { color: color.text, fontSize: font.lead, fontFamily: face.monoBold, fontWeight: '700' },
  chip: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: space.sm, paddingVertical: 2 },
  chipText: { fontSize: font.caption, fontWeight: '700', fontFamily: face.monoBold },
  readout: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.md, paddingTop: space.xs, borderBottomWidth: 1, borderBottomColor: color.line },
  readoutLabel: { color: color.muted, fontSize: font.caption, fontWeight: '700', letterSpacing: 0.6, fontFamily: face.monoBold },
  readoutValue: { color: color.text, fontSize: font.label, fontFamily: face.mono, flex: 1, textAlign: 'right' },
  // The panel is the target: `minHeight` is declared so the SC 2.5.8 scan finds a
  // number here rather than inferring one from padding, and the content is far
  // taller than it at every text scale.
  door: { minHeight: touchTarget, padding: space.lg, backgroundColor: color.surface, borderRadius: radius.md, gap: space.xs },
  // A rail, not a fill: the accent door stays on the measured `surface` plate every
  // text pair is anchored to, and says which it is in the kicker as well as in cyan.
  doorAccent: { borderLeftWidth: 3, borderLeftColor: color.cyan },
  doorPressed: { backgroundColor: color.raised },
  doorDisabled: { opacity: 0.45 },
  // The mockups' top-edge scanner stroke: a short signal line on the accent door's
  // upper edge. It sits on the border itself so it never moves the content.
  doorScan: { position: 'absolute', top: 0, left: 0, width: '32%', height: 2, backgroundColor: color.cyan },
  // Cyan, not the section violet. The panel's plate changes to `raised` while it is
  // held, and violet on that plate measures 3.88:1 — the press state alone would fail
  // SC 1.4.3 on a control the player is touching. The kicker is also the word that says
  // which door it is, so the colour carries no meaning the label does not carry too.
  doorKicker: { color: color.cyan, fontSize: font.caption, fontWeight: '700', fontFamily: face.monoBold, letterSpacing: 0.8 },
  // The door's own name is a word the player reads, so it takes the sans face — the
  // mockups' division between editorial text and telemetry, applied at this size.
  doorTitle: { color: color.text, fontSize: font.lead, fontWeight: '700', fontFamily: face.sansBold },
  doorBlurb: { color: color.muted, fontSize: font.label, fontFamily: face.sans },
});
