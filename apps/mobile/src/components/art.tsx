// Art in this app is decoration, and that is an accessibility decision rather
// than a shortcut: whatever a picture suggests is also stated in the text next to
// it, so no image enters the accessibility tree (`accessibilityElementsHidden`),
// and no text is ever laid on top of a picture — a scrim over a photograph cannot
// be measured by `src/lib/contrast.test.ts`, so the bands keep their text below
// them and the device walk keeps measuring the same tree it measured before.

import { Image, StyleSheet, Text, View, type ImageSourcePropType, type StyleProp, type ViewStyle } from 'react-native';

import { color, face, font, maxFontScale, radius, space } from '../lib/theme';

export function ArtBand({
  source,
  height = 140,
  corner = radius.md,
  style,
  frame = false,
}: {
  source: ImageSourcePropType | undefined;
  height?: number;
  corner?: number;
  style?: StyleProp<ViewStyle>;
  /** Four corner ticks, so the band reads as an instrument rather than a snapshot.
   *  Decoration inside a node that is already hidden from the tree. */
  frame?: boolean;
}) {
  if (!source) return null;
  return (
    <View style={[styles.band, { borderRadius: corner }, style]} accessibilityElementsHidden>
      <Image source={source} style={[styles.image, { height }]} resizeMode="cover" />
      <View style={styles.wash} />
      {frame ? (
        <View style={styles.corners} pointerEvents="none">
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />
        </View>
      ) : null}
    </View>
  );
}

/** The brand as a mark rather than a word: a square plate the art is cropped into,
 *  framed by the same line the bands use. Square because the marks in the mockups sit
 *  beside a heading without changing its height, and because `welcome-emblem.png` is a
 *  square crop centred on the mark, so `cover` loses nothing at any size. */
export function ArtMark({ source, size = 44 }: { source: ImageSourcePropType | undefined; size?: number }) {
  if (!source) return null;
  return (
    <View style={[styles.mark, { width: size, height: size }]} accessibilityElementsHidden>
      {/* Explicit numbers, not an absolute fill: measured on the device at 480 dpi, an
          `Image` with only insets lays itself out at its intrinsic size (a 512 px file
          is 170 dp), so the plate showed the top-left corner of the art instead of the
          centred crop `cover` was supposed to make. */}
      <Image source={source} style={{ width: size, height: size }} resizeMode="cover" />
    </View>
  );
}

/** A place or a person named by its picture and its own word: the plate is the art,
 *  the label sits under it on the page, and an optional second line says what the
 *  first one is. That placement is the rule in this file's header — a caption laid
 *  over a photograph cannot be measured by `lib/contrast.test.ts`, so it does not
 *  happen here. The square is the shape the row needs: the delivered plates are 4:3
 *  and the portraits 1:1, and `cover` takes the middle of them, which is where the
 *  subject of all of them already sits.
 *
 *  The plate is one accessibility element carrying both lines, not two nodes. Android
 *  traverses a row of plates by geometry, so the unmerged version announced every name
 *  and then every role — «Alex Vale · you, Mara Venn, Ilya Chen, Noor Rahman, Founder /
 *  CEO, Co-founder, Investor, …» — which reads as two lists and says nothing about who
 *  is who. Merging keeps the pairing without adding a word. The art stays out of it:
 *  `ArtMark` hides itself from the tree, and the label is the app's own text, never a
 *  description of a picture (§1, rule 1). */
export function ArtPlate({ source, label, note, size = 72 }: { source: ImageSourcePropType | undefined; label: string; note?: string; size?: number }) {
  if (!source) return null;
  return (
    <View style={styles.plate} accessible accessibilityLabel={note ? `${label}. ${note}` : label}>
      <ArtMark source={source} size={size} />
      <Text style={styles.plateLabel} maxFontSizeMultiplier={maxFontScale.chrome}>
        {label}
      </Text>
      {note ? (
        <Text style={styles.plateNote} maxFontSizeMultiplier={maxFontScale.chrome}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  band: { overflow: 'hidden', backgroundColor: color.surface, borderWidth: 1, borderColor: color.line },
  image: { width: '100%', resizeMode: 'cover' },
  mark: { overflow: 'hidden', backgroundColor: color.deep, borderWidth: 1, borderColor: color.line, borderRadius: radius.sm },
  // The name belongs to the plate, so the pair is one column with a hair of air
  // between them; `flexShrink: 0` keeps a wrapped row from squeezing the art instead
  // of the word.
  plate: { alignItems: 'center', gap: space.xs, flexShrink: 0 },
  // A name is a word a player reads, so it takes the sans face at bold; the note
  // under it is what the person is, which is metadata, so it takes the mono face —
  // the mockups' own division between the editorial and the instrument.
  plateLabel: { color: color.muted, fontSize: font.caption, fontWeight: '700', fontFamily: face.sansBold, letterSpacing: 0.6 },
  // Quieter by weight rather than by colour: `muted` is the faintest text colour that
  // passes AA on both plates, so a second line that tried to look fainter would simply
  // fail the contrast gate.
  plateNote: { color: color.muted, fontSize: font.caption, fontFamily: face.mono, letterSpacing: 0.2, textAlign: 'center' },
  wash: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(13, 18, 35, 0.10)' },
  corners: { ...StyleSheet.absoluteFill, padding: space.sm },
  corner: { position: 'absolute', width: 20, height: 20, borderColor: color.cyan },
  cornerTL: { top: space.sm, left: space.sm, borderTopWidth: 2, borderLeftWidth: 2 },
  cornerTR: { top: space.sm, right: space.sm, borderTopWidth: 2, borderRightWidth: 2 },
  cornerBL: { bottom: space.sm, left: space.sm, borderBottomWidth: 2, borderLeftWidth: 2 },
  cornerBR: { bottom: space.sm, right: space.sm, borderBottomWidth: 2, borderRightWidth: 2 },
});
