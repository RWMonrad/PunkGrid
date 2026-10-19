// The shared chrome from the §5.5 component list, in one module because every
// screen uses several of them and none of them has behaviour worth isolating.
// Two rules run through the file: a state is never signalled by colour alone, and
// nothing may animate when the platform says reduce motion.
//
// v1: the chrome speaks the mockups' two voices — Plus Jakarta Sans for words a
// player reads, JetBrains Mono for anything that pretends to be telemetry — and
// `Screen` can pin the four-tab NavBar instead of a footer, which is what turns
// the stack of screens into the console the mockups draw.

import { useEffect, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useReduceMotion } from '../hooks/useApp';
import type { EpisodeStatus } from '../lib/api';
import { color, face, focusRing, font, maxFontScale, radius, space, touchTarget } from '../lib/theme';
import { Backdrop, CornerTicks, LiveDot } from './hud';

export function Screen({
  title,
  subtitle,
  children,
  footer,
  titleNode,
  nav,
  compact = false,
}: {
  compact?: boolean;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  titleNode?: React.ReactNode;
  /** The pinned bottom navigation. A screen with `nav` is a hub of the console and
   *  owns no footer: its actions sit in the flow, and the four tabs are the one
   *  thing pinned — the restructure that ended the measured footer-eats-the-fold
   *  class of bugs (six secondary buttons once measured 61 % of the viewport). */
  nav?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screen, { paddingTop: insets.top + space.md }]}>
      <Backdrop />
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          compact ? { gap: space.sm } : null,
        ]}
        accessibilityRole="none"
      >
        {/* The panel edge the mockup's screens are built on: the heading sits behind
            a rail rather than floating on the page, so the first thing on every
            screen reads as an instrument and not as a document. Decoration only —
            the header a screen reader announces is the title text below, unchanged,
            and the rail carries no meaning by colour. */}
        <View style={styles.header}>
          {/* `title` stays the accessible name either way. A screen that sets itself
              apart typographically passes the node it wants painted and keeps the
              string for the tree. */}
          {titleNode ?? (
            <Text style={styles.title} maxFontSizeMultiplier={maxFontScale.chrome} accessibilityRole="header">
              {title}
            </Text>
          )}
          {subtitle ? (
            <Text
              style={[styles.subtitle, titleNode ? null : styles.subtitleTight]}
              maxFontSizeMultiplier={maxFontScale.body}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
        {children}
      </ScrollView>
      {footer ? <View style={[styles.footer, { paddingBottom: insets.bottom + space.md }]}>{footer}</View> : null}
      {nav ? (
        <View style={[styles.navDock, { paddingBottom: insets.bottom }]}>{nav}</View>
      ) : null}
    </View>
  );
}

/** A fact about the account or the world, stated in words and framed like a key on
 *  a synth panel. Deliberately not a `Pressable`: nothing here is for pressing, and
 *  a control that is not one would enter the device walk's touch-target and focus
 *  audits as a lie. The dot carries the accent and no meaning — the rule that a
 *  state is never signalled by colour alone holds, because the label says the state
 *  — so the only text pairs a chip paints are the ones `contrast.test.ts` already
 *  measures (muted on surface). */
export function Chip({ label, dot = 'cyan' }: { label: string; dot?: keyof typeof color }) {
  return (
    <View style={styles.chip}>
      <View style={[styles.chipDot, { backgroundColor: color[dot] }]} accessibilityElementsHidden />
      <Text style={styles.chipText} maxFontSizeMultiplier={maxFontScale.chrome}>{label}</Text>
    </View>
  );
}

export type StoryState = 'active' | 'paused' | 'archived' | EpisodeStatus;
const STATE_LABEL: Record<StoryState, string> = {
  active: 'Active',
  paused: 'Paused',
  archived: 'Archived',
  none: 'No episode yet',
  pending: 'Writing',
  generating: 'Writing',
  validated: 'Awaiting publication',
  retrying: 'Retrying',
  published: 'Published',
  fallback: 'Stored without narration',
  failed: 'Generation failed',
};

const QUIET: EpisodeStatus[] = ['none', 'pending', 'generating', 'validated', 'retrying'];

/** A state chip. The word is the signal; the colour only reinforces it (§5.5).
 *  `right` is the mockup's other half: a strip that states the state on the left and
 *  the numbers the state is about on the right, so the top of a screen reads as a
 *  panel header instead of a caption.
 *
 *  A world that is running wears a breathing dot. The app had no motion anywhere on
 *  2026-10-12, which is the difference between a screen that reports a live world
 *  and one that looks alive — but the animation is the decoration it names itself as,
 *  and `useReduceMotion` is asked at the component rather than at the call site, so a
 *  screen cannot forget to honour it. */
export function StoryStatus({ state, note, right }: { state: StoryState; note?: string; right?: React.ReactNode }) {
  const reduced = useReduceMotion();
  const quiet = (QUIET as string[]).includes(state);
  const tone = state === 'failed' ? color.danger : state === 'fallback' ? color.cyan : quiet ? color.muted : color.success;
  return (
    <View style={styles.statusStrip}>
      <View style={styles.statusRow}>
        {state === 'active' ? (
          <LiveDot tone={tone} reduced={reduced} />
        ) : (
          <View style={[styles.dot, { backgroundColor: tone }]} accessibilityElementsHidden />
        )}
        <Text style={styles.statusText} maxFontSizeMultiplier={maxFontScale.chrome}>
          {STATE_LABEL[state]}
          {note ? ` · ${note}` : ''}
        </Text>
      </View>
      {right ? <View style={styles.statusReadouts}>{right}</View> : null}
    </View>
  );
}

/** The reading placeholder for a pending episode. Reduced motion replaces the
 *  shimmer with a static line, so the layout does not jump when it appears.
 *  `stages`/`active` add the mockup's pipeline row. It names stages the caller
 *  actually knows — the client's own request state — and never a percentage,
 *  because the engine reports no progress it could be scaled from, and a bar would
 *  claim a maximum the rules never promised (the same reason `StatTile` draws no
 *  meter). The stage carries its state in a glyph and brackets as well as a colour,
 *  and the row is hidden from the tree: the label above it already says the state in
 *  words, so nothing a player can hear depends on reading this. */
export function ProgressSkeleton({
  label = 'The Reality Engine is writing this scene',
  reducedMotion = false,
  stages,
  active = 0,
}: {
  label?: string;
  reducedMotion?: boolean;
  stages?: readonly string[];
  active?: number;
}) {
  return (
    <View style={styles.skeleton} accessibilityLiveRegion="polite">
      <View style={styles.skeletonTop}>
        {reducedMotion ? <View style={styles.staticBar} /> : <Shimmer />}
        <Text style={styles.skeletonText} maxFontSizeMultiplier={maxFontScale.body}>
          {label}
        </Text>
      </View>
      {stages ? (
        <View style={styles.stageRow} accessibilityElementsHidden>
          {stages.map((stage, i) => (
            <Text
              key={stage}
              style={i < active ? styles.stageDone : i === active ? styles.stageActive : styles.stageTodo}
              maxFontSizeMultiplier={maxFontScale.chrome}
            >
              {`${i < active ? '✓' : i === active ? '▸' : '·'} ${stage.toUpperCase()}`}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** The mockups' scanning progress line: a bar of light that runs across a track,
 *  scaled on the X axis so the whole loop rides the native driver. Decoration — the
 *  sentence beside it is what says the engine is working, and reduced motion keeps
 *  the bar still at a third of its travel so the placeholder is visible either way. */
function Shimmer() {
  const [phase] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(phase, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(phase, { toValue: 0, duration: 450, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [phase]);
  return (
    <View style={styles.shimmerTrack} accessibilityElementsHidden>
      <Animated.View
        style={[
          styles.shimmerBar,
          {
            transform: [
              {
                scaleX: phase.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }),
              },
              { translateX: 0 },
            ],
          },
        ]}
      />
    </View>
  );
}

export function ErrorPanel({ title, message, onRetry, retryLabel = 'Try again' }: { title: string; message: string; onRetry?: () => void; retryLabel?: string }) {
  // SC 2.4.7: the ring is drawn from focus state, because `Pressable`'s style callback
  // reports `pressed` only.
  const [isFocused, setFocused] = useState(false);
  return (
    <View style={styles.errorPanel} accessibilityRole="alert" accessibilityLiveRegion="assertive">
      <Text style={styles.errorTitle} maxFontSizeMultiplier={maxFontScale.chrome}>
        {title}
      </Text>
      <Text style={styles.errorMessage} maxFontSizeMultiplier={maxFontScale.body}>
        {message}
      </Text>
      {onRetry ? (
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[styles.retry, isFocused && focusRing]}
        >
          <Text style={styles.retryText} maxFontSizeMultiplier={maxFontScale.chrome}>{retryLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Toast({ message }: { message: string }) {
  return (
    <View style={styles.toast} accessibilityLiveRegion="polite">
      <Text style={styles.toastText} maxFontSizeMultiplier={maxFontScale.chrome}>
        {message}
      </Text>
    </View>
  );
}

/** US12: the fiction label the master doc wants in onboarding and in the relevant
 *  views, not only in a settings screen. */
export function ConsentDisclosure({ compact = false }: { compact?: boolean }) {
  return (
    <View style={styles.disclosure}>
      <Text style={styles.disclosureText} maxFontSizeMultiplier={maxFontScale.body}>
        {compact
          ? 'Fiction, generated by AI. Not a prediction about real people, companies or events.'
          : 'Everything in PunkGrid is fictional and generated by AI. Worlds follow ordinary institutional limits, and nothing here predicts real futures. 18+ only.'}
      </Text>
    </View>
  );
}

export function PrivacyRow({ label, value, onPress, hint }: { label: string; value: string; onPress?: () => void; hint?: string }) {
  const [isFocused, setFocused] = useState(false);
  const content = (
    <View style={styles.privacyRow}>
      <Text style={styles.privacyLabel} maxFontSizeMultiplier={maxFontScale.chrome}>
        {label}
      </Text>
      <Text style={styles.privacyValue} maxFontSizeMultiplier={maxFontScale.body}>
        {value}
      </Text>
      {hint ? (
        <Text style={styles.privacyHint} maxFontSizeMultiplier={maxFontScale.body}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={isFocused ? focusRing : null}
    >
      {content}
    </Pressable>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle} maxFontSizeMultiplier={maxFontScale.chrome}>
        {title}
      </Text>
      {/* The panel is what makes a section read as one object: the mockup's framed
          instrument, with the name above it and the settings inside. The fill is
          `surface`, so every text a section carries is measured on that colour in
          `contrast.test.ts` — the pair list is the app's own claim about what it paints.
          The brackets are the same four ticks the tiles, the doors and the scene window
          wear, set in `line` rather than cyan: on a screen of four panels the bright
          tone would stop meaning "this one is the instrument" and say nothing. */}
      <View style={styles.sectionPanel}>
        {children}
        <CornerTicks tone={color.line} />
      </View>
    </View>
  );
}

/** The mockups' section header — the register the Stitch screens speak in: a
 *  telemetry kicker that names what the section is, and on the right the number the
 *  section is actually about ("TACTICAL BRANCH MATRIX · 3 VECTORS"). The count is
 *  never invented: every caller passes a number its own reply carried, because a
 *  header that said "DETECTED" over choices the engine merely offered would be the
 *  mockup's theatre without its honesty. The pairs are the page's own — cyan for the
 *  kicker (`sectionTitle`'s pair), muted for the count (`subtitle`'s). */
export function PanelHead({ kicker, right }: { kicker: string; right?: string }) {
  return (
    <View style={styles.panelHead}>
      <Text style={styles.panelKicker} maxFontSizeMultiplier={maxFontScale.chrome}>
        {kicker.toUpperCase()}
      </Text>
      {right ? (
        <Text style={styles.panelRight} maxFontSizeMultiplier={maxFontScale.chrome}>
          {right.toUpperCase()}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // The floor of the backdrop ramp, so a strip the `Backdrop` does not reach (the
  // status-bar inset, which absolute children sit below) is the darkest plate rather
  // than a visible seam.
  screen: { flex: 1, backgroundColor: color.deep },
  scroll: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  header: { gap: 0, borderLeftWidth: 3, borderLeftColor: color.cyan, paddingLeft: space.md },
  footer: {
    flexShrink: 0, paddingHorizontal: space.lg, paddingTop: space.md, gap: space.md,
    backgroundColor: color.surface, borderTopWidth: 1, borderTopColor: color.line,
  },
  // The NavBar paints its own top border and safe-area padding; the dock only
  // lifts it off the gesture bar.
  navDock: { flexShrink: 0 },
  // The mockups' headlines are the sans face at full weight — the reading voice —
  // while everything around them is telemetry. The title was mono in v0, and the
  // change is what makes a screen read as a panel with a headline rather than a
  // terminal with a prompt.
  title: { color: color.text, fontSize: font.title, fontWeight: '800', fontFamily: face.sansHeavy, letterSpacing: -0.3 },
  subtitle: { color: color.muted, fontSize: font.body, fontFamily: face.sans },
  // The plain title is a text line, so its own leading is the gap; pulling the tagline
  // up by `space.sm` is what makes the pair read as one block. A screen that paints its
  // own `titleNode` has no such leading — UI01's brand row is as tall as its emblem, and
  // the same pull put the tagline under the mark. Measured on the device 2026-10-12.
  subtitleTight: { marginTop: -space.sm },
  statusStrip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: space.md },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  statusReadouts: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  dot: { width: 10, height: 10, borderRadius: radius.sm },
  statusText: { color: color.muted, fontSize: font.label, fontWeight: '600', fontFamily: face.sansBold },
  skeleton: { padding: space.md, backgroundColor: color.surface, borderRadius: radius.md, gap: space.sm },
  skeletonTop: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  staticBar: { width: 24, height: 4, borderRadius: radius.sm, backgroundColor: color.cyan },
  shimmerTrack: { width: 24, height: 4, borderRadius: radius.sm, backgroundColor: color.raised, overflow: 'hidden', alignItems: 'center' },
  // The bar grows from the centre of its track; the glow the mockups put on their
  // progress lines is a text-shadow trick that does not exist for a View, and a
  // solid signal fill carries the same meaning without pretending to emit light.
  shimmerBar: { width: '100%', height: '100%', borderRadius: radius.sm, backgroundColor: color.cyan },
  skeletonText: { color: color.muted, fontSize: font.label, fontFamily: face.sans, flex: 1 },
  stageRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, paddingLeft: space.xs },
  stageTodo: { color: color.muted, fontSize: font.caption, fontFamily: face.mono, fontWeight: '600', letterSpacing: 0.6 },
  stageActive: { color: color.text, fontSize: font.caption, fontFamily: face.monoBold, fontWeight: '700', letterSpacing: 0.6 },
  stageDone: { color: color.cyan, fontSize: font.caption, fontFamily: face.mono, fontWeight: '600', letterSpacing: 0.6 },
  errorPanel: { padding: space.lg, backgroundColor: color.surface, borderRadius: radius.md, gap: space.sm, borderLeftWidth: 3, borderLeftColor: color.danger },
  errorTitle: { color: color.danger, fontSize: font.lead, fontWeight: '700', fontFamily: face.sansBold },
  errorMessage: { color: color.text, fontSize: font.body, fontFamily: face.sans },
  retry: { minHeight: touchTarget, justifyContent: 'center', alignItems: 'flex-start' },
  retryText: { color: color.cyan, fontSize: font.label, fontWeight: '700', fontFamily: face.sansBold },
  toast: { padding: space.md, backgroundColor: color.raised, borderRadius: radius.md, borderLeftWidth: 3, borderLeftColor: color.cyan },
  toastText: { color: color.text, fontSize: font.label, fontFamily: face.sans },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, alignSelf: 'flex-start',
    paddingHorizontal: space.md, paddingVertical: space.xs,
    borderRadius: radius.lg, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface,
  },
  chipDot: { width: 8, height: 8, borderRadius: radius.sm },
  chipText: { color: color.muted, fontSize: font.label, fontWeight: '600', letterSpacing: 0.3, fontFamily: face.mono },
  disclosure: { padding: space.md, backgroundColor: color.surface, borderRadius: radius.md, borderLeftWidth: 3, borderLeftColor: color.violet },
  disclosureText: { color: color.muted, fontSize: font.caption, fontFamily: face.sans },
  privacyRow: { paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: color.line, gap: space.xs },
  privacyLabel: { color: color.text, fontSize: font.label, fontWeight: '700', fontFamily: face.sansBold },
  privacyValue: { color: color.muted, fontSize: font.body, fontFamily: face.sans },
  privacyHint: { color: color.muted, fontSize: font.caption, fontFamily: face.sans },
  section: { gap: space.sm, paddingVertical: space.sm },
  sectionPanel: { gap: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: color.surface, borderWidth: 1, borderColor: color.line },
  sectionTitle: { color: color.cyan, fontSize: font.label, fontWeight: '700', letterSpacing: 0.4, fontFamily: face.monoBold },
  // The panel head sits on the page rather than on a plate, so its pairs are the
  // page's: the kicker beside a rail of chrome, the count far enough from the kicker
  // to read as the section's number rather than its subtitle.
  panelHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: space.sm },
  panelKicker: { color: color.cyan, fontSize: font.label, fontWeight: '700', letterSpacing: 0.6, fontFamily: face.monoBold },
  panelRight: { color: color.muted, fontSize: font.caption, fontFamily: face.mono, letterSpacing: 0.5 },
});
