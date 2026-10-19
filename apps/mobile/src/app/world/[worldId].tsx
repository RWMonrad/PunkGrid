// The play surface: UI04 (opening), UI05 (reading), UI06 (decision receipt),
// UI08 (surprise), UI12 (pending/error states) and the report entry, in one screen
// because they are the same object at different moments — a world view plus the
// newest episode. Splitting them into four routes would duplicate the controller.

import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { ArtBand } from '../../components/art';
import { Button, Row } from '../../components/Button';
import { ChoiceCard, EpisodeText } from '../../components/cards';
import { CornerTicks, StatTile, Tag } from '../../components/hud';
import { NavBar } from '../../components/nav';
import { ConsentDisclosure, ErrorPanel, PanelHead, ProgressSkeleton, Screen, StoryStatus, Toast } from '../../components/kit';
import { ReportSheet } from '../../components/ReportSheet';
import { usePlay } from '../../hooks/usePlay';
import { useReduceMotion, useSession } from '../../hooks/useApp';
import { heroFor } from '../../lib/art';
import { catalogFor } from '../../lib/setting';
import { color, face, focusRing, font, maxFontScale, radius, space, touchTarget } from '../../lib/theme';

/** The three stages this client can actually tell apart: the command is on its way,
 *  the engine is composing, the scene is on the screen. Nothing in between is
 *  displayed as progress, because §11 gives the client no percentage to draw. */
const STAGES = ['sent', 'written', 'shown'] as const;

export default function Play() {
  const { worldId } = useLocalSearchParams<{ worldId: string }>();
  const router = useRouter();
  const snap = useSession();
  const reduced = useReduceMotion();
  const { width, fontScale } = useWindowDimensions();
  const sceneFirst = width / Math.min(fontScale, maxFontScale.body) < 380;
  const { state, controller } = usePlay(worldId ?? '');
  const [reportOpen, setReportOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useFocusEffect(useCallback(() => {
    if (snap.status === 'signedOut' && state.phase !== 'loading') router.replace('/sign-in');
  }, [snap.status, state.phase, router]));

  if (!worldId) {
    return <Screen title="No world"><Text style={styles.body} maxFontSizeMultiplier={maxFontScale.body}>This screen needs a world id.</Text></Screen>;
  }

  const world = state.world;
  const writing = state.phase === 'writing' || state.phase === 'submitting';
  const choices = world?.choices ?? [];
  const scene = (
    <>
      {world ? <ArtBand source={heroFor(world.world.rulepackId)} height={64} frame /> : null}
      {state.episode ? (
        <EpisodeText episode={state.episode} episodeNumber={state.episodeNumber} fontScale={0.9} framed />
      ) : state.phase === 'loading' ? (
        <ProgressSkeleton label="Reading the world" reducedMotion={reduced} />
      ) : null}
    </>
  );

  return (
    <Screen
      title={world ? catalogFor(world.world.rulepackId)?.title ?? 'A life in progress' : 'World'}
      subtitle={world ? `Life stream · cycle ${state.episodeNumber ?? '—'} · version ${world.stateVersion}` : undefined}
      nav={<NavBar active="stream" worldId={worldId} />}
      compact
    >
      {toast ? <Toast message={toast} /> : null}

      {world ? (
        <View style={styles.headerRow}>
          <StoryStatus
            state={world.world.status === 'active' ? 'active' : world.world.status === 'paused' ? 'paused' : 'archived'}
            note={`arc: ${Object.values(world.summary.arcs)[0] ?? 'opening'}`}
            right={<Tag label="episode" value={writing ? 'writing' : state.episode?.status ?? 'none'} />}
          />
        </View>
      ) : null}

      {sceneFirst ? scene : null}

      {world ? (
        <View style={styles.telemetry}>
          {/* The mockups' "CONSCIOUSNESS TELEMETRY": the register is theirs, the
              numbers are the engine's own summary — the resource pools this world
              actually tracks, counted off the same reply that paints the tiles. */}
          <PanelHead kicker="Consciousness telemetry" right={`${Object.keys(world.summary.resources).length} pools`} />
          <View style={styles.resources}>
            {Object.entries(world.summary.resources).map(([key, value]) => {
              const before = state.previousResources?.[key];
              return <StatTile key={key} name={key} value={value} delta={before === undefined ? undefined : value - before} />;
            })}
          </View>
        </View>
      ) : null}

      <View style={styles.console}>
        {state.phase === 'error' ? (
          <Button
            label="Try again"
            variant="secondary"
            onPress={() => void controller.retry()}
            accessibilityHint="Retries an unconfirmed decision with its original id, or reads the scene again"
          />
        ) : null}
        <Row>
          <Button
            label="Surprise me"
            variant="secondary"
            compact
            style={styles.consoleBtn}
            onPress={() => void controller.surprise()}
            accessibilityHint="Lets the engine choose the next beat for you"
            disabled={state.phase !== 'reading' || world?.world.status !== 'active'}
          />
          <Button
            label="Resume"
            variant="ghost"
            compact
            style={styles.consoleBtn}
            onPress={() => void controller.resume()}
            accessibilityHint="Lets the world's clock move to its next scene"
            disabled={state.phase !== 'reading' || world?.world.status === 'archived'}
          />
          <Button
            label="World actions"
            variant="ghost"
            compact
            expanded={actionsOpen}
            style={styles.consoleBtn}
            onPress={() => setActionsOpen(!actionsOpen)}
            accessibilityHint="Opens this world's housekeeping actions"
            disabled={state.phase !== 'reading'}
          />
        </Row>
        {actionsOpen ? (
          <View style={styles.actionPanel}>
            <CornerTicks tone={color.line} />
            <ActionRow label="History" note="Every committed scene, newest first" onPress={() => router.push(`/history/${worldId}`)} />
            <ActionRow label="Report this scene" note="Flag prose for moderation" onPress={() => setReportOpen(true)} />
            <ActionRow label="Pause" note="The clock stops until you resume" onPress={() => void controller.pause()} disabled={state.phase !== 'reading' || world?.world.status !== 'active'} />
            <ActionRow label="Archive" note="Readable, never playable again" onPress={() => void controller.archive()} disabled={state.phase !== 'reading' || world?.world.status === 'archived'} />
          </View>
        ) : null}
      </View>

      {sceneFirst ? null : scene}

      {writing ? (
        <ProgressSkeleton
          label={state.phase === 'submitting' ? 'Committing your decision' : 'The Reality Engine is writing the scene'}
          reducedMotion={reduced}
          stages={STAGES}
          active={state.phase === 'submitting' ? 0 : 1}
        />
      ) : null}

      {state.message ? (
        <View style={styles.receipt} accessibilityLiveRegion="polite">
          <Text style={styles.receiptText} maxFontSizeMultiplier={maxFontScale.body}>
            {state.message}
          </Text>
        </View>
      ) : null}

      {state.phase === 'error' && !state.message ? <ErrorPanel title="The engine did not answer" message="Try again to recover the scene. Retrying a decision will not count it twice." onRetry={() => void controller.retry()} /> : null}

      {/* The doors sit in the reading flow, not in a footer. Four cards plus six
          secondary buttons in a pinned footer measured 1 831 of the screen's 2 992 px,
          which put the episode prose — the thing the player came to read — under the
          fold on the one screen that is the product. Measured 2026-10-12 in
          `docs/qa/evidence/device-walk/2026-10-12T17-46-33-877Z/UI04 world.xml`. */}
      {!writing && choices.length > 0 ? (
        <View style={styles.branchBlock}>
          {/* The mockups' branch matrix over the doors it counts: the vectors are the
              choices this screen can actually offer — the engine's own reply, not a
              "detected" the panel invented. */}
          <PanelHead kicker="Tactical branch matrix" right={`${choices.length} vectors`} />
          {choices.map((c, i) => (
            <ChoiceCard key={c.choiceId} choice={c} index={i} total={choices.length} onChoose={() => void controller.choose(c.choiceId)} disabled={state.phase !== 'reading' || world?.world.status !== 'active'} />
          ))}
        </View>
      ) : null}

      {!writing && choices.length === 0 && state.phase === 'reading' ? (
        <Text style={styles.deadEnd} maxFontSizeMultiplier={maxFontScale.body}>
          This scene offers no path forward yet. Resume to let the clock move, or open the history.
        </Text>
      ) : null}

      <ConsentDisclosure compact />

      <ReportSheet
        visible={reportOpen}
        episodeLabel={state.episode ? `Episode ${state.episodeNumber} · ${state.episode.id}` : 'This scene'}
        onClose={() => setReportOpen(false)}
        onSubmit={async (reason, note) => {
          const ack = await controller.report(reason, note);
          setToast(ack.status === 'duplicate' ? `Already reported — reference ${ack.receipt}` : `Report filed, reference ${ack.receipt}`);
          return ack;
        }}
      />
    </Screen>
  );
}

/** One housekeeping row in the world-actions panel: the same contract Button keeps
 *  (role, label, hint, 44 dp, focus ring from focus events), drawn as the panel's
 *  instrument row rather than a second chrome button on a screen full of them. */
function ActionRow({ label, note, onPress, disabled = false }: { label: string; note: string; onPress: () => void; disabled?: boolean }) {
  const [isFocused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={note}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [styles.actionRow, isFocused && focusRing, pressed && styles.actionRowPressed]}
    >
      <Text style={styles.actionLabel} maxFontSizeMultiplier={maxFontScale.chrome}>
        {label}
      </Text>
      <Text style={styles.actionNote} maxFontSizeMultiplier={maxFontScale.chrome}>
        {note}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { color: color.text, fontSize: font.body },
  telemetry: { gap: space.sm },
  branchBlock: { gap: space.md },
  console: { gap: space.md },
  // The strip's three controls share one line by growing into it: sized by their
  // labels first, so 100 % text keeps all three beside each other while 200 % wraps
  // the row instead of squeezing the labels inside fixed thirds.
  consoleBtn: { flexGrow: 1 },
  actionPanel: { gap: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: color.surface, borderWidth: 1, borderColor: color.line },
  actionRow: { minHeight: touchTarget, justifyContent: 'center', gap: space.xs },
  actionRowPressed: { opacity: 0.85 },
  actionLabel: { color: color.text, fontSize: font.body, fontWeight: '700', fontFamily: face.sansBold },
  actionNote: { color: color.muted, fontSize: font.caption, fontFamily: face.mono },
  headerRow: { marginBottom: -space.sm },
  receipt: { padding: space.md, backgroundColor: color.surface, borderRadius: radius.md },
  receiptText: { color: color.text, fontSize: font.label },
  resources: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  deadEnd: { color: color.muted, fontSize: font.label },
});
