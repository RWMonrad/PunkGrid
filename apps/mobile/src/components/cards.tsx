import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ArtBand, ArtMark } from './art';
import { CornerTicks, LiveDot } from './hud';
import { useReduceMotion } from '../hooks/useApp';
import type { Episode, WorldSummary } from '../lib/api';
import { heroFor } from '../lib/art';
import { catalogFor } from '../lib/setting';
import { color, face, focusRing, font, maxFontScale, onAccent, radius, space, touchTarget } from '../lib/theme';

/** The signal a choice's own colour carries. A is the first door the player sees,
 *  so it takes cyan — the colour of the path forward. B takes violet — the colour
 *  of the screen's own confirmation. C takes success, the colour of things that
 *  stay. D takes amber, the colour of the hazardous road. Every one of them fills
 *  a chip with an ink letter (each pair measured in `contrast.test.ts`), so four
 *  cards in a column read as four distinct doors without the player having to read
 *  the letter — and past D the chip goes quiet: an outline and `muted`, the colour
 *  of a boundary that carries no meaning. The colour reinforces an ordinal the
 *  words already carry (§5.5): the card's own label says "choice B of 4". */
function choiceTone(index: number): { rail: string; fill: string | null } {
  if (index === 0) return { rail: color.cyan, fill: color.cyan };
  if (index === 1) return { rail: color.violet, fill: color.violet };
  if (index === 2) return { rail: color.success, fill: color.success };
  if (index === 3) return { rail: color.amber, fill: color.amber };
  return { rail: color.line, fill: null };
}

// Choice labels and copy stay bound to the server-issued world version.
export function ChoiceCard({ choice, index, total, onChoose, disabled }: { choice: { choiceId: string; label: string; copy: string }; index: number; total: number; onChoose: () => void; disabled?: boolean }) {
  const letter = String.fromCharCode(65 + index);
  const [isFocused, setFocused] = useState(false);
  const { rail, fill } = choiceTone(index);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Choice ${letter} of ${total}. ${choice.label}. ${choice.copy}`}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onChoose}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [styles.card, { borderLeftColor: rail }, isFocused && focusRing, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <View style={styles.choiceHead}>
        <View
          style={[styles.letter, fill ? { backgroundColor: fill } : { borderWidth: 1, borderColor: color.muted }]}
          accessibilityElementsHidden
        >
          <Text style={[styles.letterText, fill ? null : { color: color.muted }]} maxFontSizeMultiplier={maxFontScale.chrome}>{letter}</Text>
        </View>
        <Text style={styles.label} maxFontSizeMultiplier={maxFontScale.chrome}>
          {choice.label}
        </Text>
      </View>
      <Text style={styles.copy} maxFontSizeMultiplier={maxFontScale.body}>
        {choice.copy}
      </Text>
    </Pressable>
  );
}

/** The prose itself. Paragraph breaks come from the engine's template or the
 *  model; the reading style is the sans face at reading size, and the "reading
 *  mode" preference in UI10 changes size and measure, not colour.
 *
 *  `framed` is the play screen's scene window: the same bracket the tiles and the
 *  plate wear, drawn around the prose so the one thing the player came to read is
 *  also the one thing on the screen that reads as an instrument. It is a 1 dp `line`
 *  boundary on the page, not a plate — the text stays on the measured `ink` pair
 *  (`contrast.test.ts`), and the history rows keep their own `surface` card instead
 *  of a frame inside a frame. */
export function EpisodeText({ episode, episodeNumber, fontScale = 1, framed = false }: { episode: Episode; episodeNumber?: number; fontScale?: number; framed?: boolean }) {
  const paragraphs = episode.content.split(/\n{2,}/);
  return (
    <View accessibilityRole="summary" style={framed ? [styles.episode, styles.scene] : styles.episode}>
      {episodeNumber !== undefined ? (
        <Text style={styles.episodeKicker} maxFontSizeMultiplier={maxFontScale.chrome}>
          {`Episode ${episodeNumber}`}
          {episode.validationStatus === 'fallback' ? ' · told from stored state' : ''}
        </Text>
      ) : null}
      {paragraphs.map((p, i) => (
        <Text
          key={i}
          style={[styles.paragraph, { fontSize: Math.round(font.lead * fontScale), lineHeight: Math.round(30 * fontScale) }]}
          maxFontSizeMultiplier={maxFontScale.body}
        >
          {p}
        </Text>
      ))}
      {framed ? <CornerTicks /> : null}
    </View>
  );
}

/** The status a world's card wears: the word the tree reads, the colour that only
 *  reinforces it (§5.5), and — for the one life that is still running — the beacon
 *  that breathes. A paused life takes amber, the state that is neither hostile nor
 *  settled; an archived life takes muted and no motion at all, because a memory is
 *  not live. */
function worldTone(status: WorldSummary['status']): { word: string; tone: string } {
  if (status === 'active') return { word: 'Active', tone: color.cyan };
  if (status === 'paused') return { word: 'Paused', tone: color.amber };
  return { word: 'Archived', tone: color.muted };
}

function worldMetaOf(world: WorldSummary): string {
  return `Version ${world.stateVersion} · world time ${new Date(world.worldTime).toISOString().slice(0, 10)}`;
}

/** UI07: the consciousness card. The hero is the thing the player recognises the
 *  life by — at 168 dp the library measured one card and three quarters of empty
 *  page at 92 dp, which is what a list of one life looks like when it is laid out
 *  as a table — and the words under it are its caption. The crop is `cover` on a
 *  16:9 file, so the extra height takes more harbour and no letterboxing.
 *
 *  The state is a badge on the title row: the mockup's pill, drawn as a bordered
 *  chip with the beacon inside it. The card is the touch target and one
 *  announcement; the badge's colour is never the only thing that says the state,
 *  because the word is in the same chip. The resume row at the bottom is the
 *  mockup's full-width action, drawn as the card's own footer rather than a second
 *  button — a Pressable inside a Pressable is two targets for one action, and the
 *  hint already says what tapping does, so the row stays out of the tree. */
export function WorldCard({ world, onOpen }: { world: WorldSummary; onOpen: () => void }) {
  const active = world.status === 'active';
  const reduced = useReduceMotion();
  const [isFocused, setFocused] = useState(false);
  const title = catalogFor(world.rulepackId)?.title ?? 'A life in progress';
  const { word, tone } = worldTone(world.status);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={`Resume ${title} at version ${world.stateVersion}`}
      onPress={onOpen}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [styles.worldCard, isFocused && focusRing, pressed && styles.pressed]}
    >
      <ArtBand source={heroFor(world.rulepackId)} height={168} corner={radius.sm} frame />
      <View style={styles.worldHead}>
        <Text style={styles.worldTitle} maxFontSizeMultiplier={maxFontScale.chrome}>
          {title}
        </Text>
        <View style={[styles.badge, { borderColor: tone }]}>
          {active ? (
            <LiveDot tone={tone} reduced={reduced} />
          ) : (
            <View style={[styles.badgeDot, { backgroundColor: tone }]} accessibilityElementsHidden />
          )}
          <Text style={[styles.worldState, { color: tone }]} maxFontSizeMultiplier={maxFontScale.chrome}>
            {word}
          </Text>
        </View>
      </View>
      <Text style={styles.worldMeta} maxFontSizeMultiplier={maxFontScale.body}>
        {worldMetaOf(world)}
      </Text>
      <View style={styles.resumeRow} accessibilityElementsHidden>
        <Text style={styles.resumeText} maxFontSizeMultiplier={maxFontScale.chrome}>
          RESUME LIFE
        </Text>
        <Text style={styles.resumeArrow} maxFontSizeMultiplier={maxFontScale.chrome}>
          ▸
        </Text>
      </View>
      <CornerTicks />
    </Pressable>
  );
}

/** UI07's hall of legacies: a concluded life, drawn quieter than a live one. No
 *  hero band and no breathing — the mockup gives its archived cards the darkest
 *  plate and a static beacon, and the app's own ladder says the same thing with
 *  `ink` under a `line` border, a plate the ramp's ceiling never rises above. The
 *  picture is a 40 dp mark rather than a window, because the point of the row is
 *  what the life was called, not where it stood.
 *
 *  Tapping opens the world's chronicle: an archived world still serves its last
 *  state and its history, so the row is a door and not a memorial that goes
 *  nowhere. The hint says that in words, so the arrow is decoration. */
export function LegacyCard({ world, onOpen }: { world: WorldSummary; onOpen: () => void }) {
  const [isFocused, setFocused] = useState(false);
  const title = catalogFor(world.rulepackId)?.title ?? 'A life concluded';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={`Open the chronicle of ${title}`}
      onPress={onOpen}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [styles.legacyCard, isFocused && focusRing, pressed && styles.legacyPressed]}
    >
      <View style={styles.legacyHead}>
        <ArtMark source={heroFor(world.rulepackId)} size={40} />
        <View style={styles.legacyWho}>
          <Text style={styles.legacyTitle} maxFontSizeMultiplier={maxFontScale.chrome}>
            {title}
          </Text>
          <Text style={styles.legacyState} maxFontSizeMultiplier={maxFontScale.chrome}>
            ARCHIVED
          </Text>
        </View>
        <Text style={styles.legacyArrow} maxFontSizeMultiplier={maxFontScale.chrome}>
          ▸
        </Text>
      </View>
      <Text style={styles.legacyMeta} maxFontSizeMultiplier={maxFontScale.body}>
        {worldMetaOf(world)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { padding: space.lg, backgroundColor: color.surface, borderLeftWidth: 3, borderRadius: radius.md, gap: space.xs, minHeight: touchTarget },
  pressed: { backgroundColor: color.raised },
  disabled: { opacity: 0.5 },
  choiceHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  // Sized by padding, not by a fixed box: the badge is decorative
  // (`accessibilityElementsHidden`, and the ordinal is spoken in the card's own
  // label), so at 200 % text it grows around the letter instead of clipping it. No
  // minHeight either — the touch target is the card, and a small declared minimum
  // here would read as an undersized control in the SC 2.5.8 scan.
  letter: { minWidth: 26, paddingHorizontal: space.xs, paddingVertical: 4, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  letterText: { color: onAccent, fontSize: font.caption, fontWeight: '700', fontFamily: face.monoBold },
  label: { color: color.text, fontSize: font.body, fontWeight: '700', fontFamily: face.sansBold, flex: 1 },
  copy: { color: color.muted, fontSize: font.label, fontFamily: face.sans },
  episode: { gap: space.md },
  // The frame is the boundary only: `line` clears 4.20 on the page it sits on and
  // 3.59 on the plate a pressed control wears, and the prose inside stays on the
  // `ink` pair the contrast list already measures.
  scene: { padding: space.lg, borderWidth: 1, borderColor: color.line, borderRadius: radius.md },
  episodeKicker: { color: color.violet, fontSize: font.label, fontWeight: '700', fontFamily: face.monoBold },
  paragraph: { color: color.text, fontFamily: face.sans, lineHeight: 30 },
  worldCard: { padding: space.lg, backgroundColor: color.surface, borderWidth: 1, borderColor: color.line, borderRadius: radius.md, gap: space.xs },
  worldHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md },
  // The dot does not shrink and the word does not wrap away: at 200 % text it is the
  // title that takes a second line, because the title has room to and the state has to
  // stay one readable word.
  badge: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexShrink: 0, paddingHorizontal: space.sm, paddingVertical: 2, borderWidth: 1, borderRadius: radius.sm, backgroundColor: color.surface },
  badgeDot: { width: 10, height: 10, borderRadius: radius.sm },
  worldTitle: { color: color.text, fontSize: font.body, fontWeight: '700', fontFamily: face.sansBold, flex: 1 },
  worldState: { fontSize: font.caption, fontWeight: '700', fontFamily: face.monoBold, letterSpacing: 0.6 },
  worldMeta: { color: color.muted, fontSize: font.caption, fontFamily: face.mono },
  // The card's own footer: a hairline, the action's name in telemetry capitals, and
  // the arrow. The whole card is the button and the hint carries the meaning, so
  // this row is presentation only and stays out of the tree.
  resumeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: color.line, paddingTop: space.sm },
  resumeText: { color: color.cyan, fontSize: font.caption, fontWeight: '700', fontFamily: face.monoBold, letterSpacing: 0.8 },
  resumeArrow: { color: color.cyan, fontSize: font.caption, fontFamily: face.monoBold },
  // The archival plate: `ink` under a `line` border, sunken below every live card
  // on the page. `minHeight` is declared for the SC 2.5.8 scan; the row is taller
  // than it at every text scale.
  legacyCard: { minHeight: touchTarget, padding: space.md, backgroundColor: color.ink, borderWidth: 1, borderColor: color.line, borderRadius: radius.md, gap: space.sm },
  legacyPressed: { backgroundColor: color.raised },
  legacyHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  legacyWho: { flex: 1, gap: 2 },
  legacyTitle: { color: color.text, fontSize: font.body, fontWeight: '700', fontFamily: face.sansBold },
  legacyState: { color: color.muted, fontSize: font.caption, fontWeight: '700', fontFamily: face.monoBold, letterSpacing: 0.8 },
  legacyArrow: { color: color.muted, fontSize: font.caption, fontFamily: face.monoBold },
  legacyMeta: { color: color.muted, fontSize: font.caption, fontFamily: face.mono },
});
