// UI02 — Genesis choice (US02). Surprise Me is the one-button entrance: it sends
// `mode: 'surprise'` and lets the engine pick the template and the opening, and it
// still has to land on a server-validated blueprint before a world exists (US03's
// guarantee that no half-created world is left behind).

import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ConsentDisclosure, ErrorPanel, ProgressSkeleton, Screen } from '../components/kit';
import { DoorCard } from '../components/hud';
import { NavBar } from '../components/nav';
import { session, useReduceMotion, useSession } from '../hooks/useApp';
import { genesisGuided, genesisSurprise } from '../lib/art';
import { ApiError } from '../lib/api';
import { describe } from '../lib/session';
import { telemetry, worldRef } from '../lib/telemetry';
import { color, font, maxFontScale, radius, space } from '../lib/theme';

export default function Genesis() {
  const router = useRouter();
  const snap = useSession();
  const reduced = useReduceMotion();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function surpriseMe() {
    setBusy(true);
    setError(null);
    const api = session.client();
    const commandId = api.newCommandId();
    const started = Date.now();
    try {
      const res = await api.createWorld({ mode: 'surprise', commandId });
      telemetry.track({
        name: 'world_created',
        worldRef: worldRef(res.worldId),
        templateId: null,
        durationMs: Date.now() - started,
      });
      router.replace({ pathname: '/world/[worldId]', params: { worldId: res.worldId, episodeId: res.episodeId } });
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === 'WORLD_LIMIT_REACHED'
          ? 'The free quota is already used by another world. Open a world from the multiverse, or see what Premium would change.'
          : describe(e),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title="Begin a life"
      subtitle="Two ways to begin a life. Both end in the same kind of world: bounded rules, stored choices, fictional people."
      nav={<NavBar active="genesis" />}
    >
      {busy ? <ProgressSkeleton label="A world is being assembled" reducedMotion={reduced} /> : null}
      {error ? <ErrorPanel title="No world was created" message={error} onRetry={() => void surpriseMe()} /> : null}

      {/* The seam used to sit here: one establishing picture above the two doors. It
          moved *into* them on 2026-10-13, because a door the player has to choose
          between is worth a picture of its own, and three bands on one screen pushed
          the second door's own words under the fold. Still no world's art: Surprise Me
          has not chosen a template yet, so these two are the two ways in — a skyline
          that has not decided, and a table the life is planned on. */}

      {/* The two doors are the screen. They were a footer of two plates under a
          paragraph of prose; as panels they carry their own one-line contract, so a
          player reads what each door costs before choosing — and the affirmative one
          is the brightest thing on the page, which is what an accent is for. */}
      <View style={styles.doors}>
        <DoorCard
          kicker="One button"
          title="Surprise Me"
          blurb="The engine chooses era, place and role, and writes the first scene."
          art={genesisSurprise}
          accessibilityHint="Costs one world from your quota. Nothing is charged"
          accent
          onPress={() => void surpriseMe()}
          disabled={busy}
        />
        <DoorCard
          kicker="Guided"
          title="Create a Life"
          blurb="You choose era, place and role from the lists the rules accept."
          art={genesisGuided}
          accessibilityHint="Opens the guided world setup"
          onPress={() => router.push('/setup')}
          disabled={busy}
        />
      </View>

      <View style={styles.note}>
        <Text style={styles.noteText} maxFontSizeMultiplier={maxFontScale.body}>
          {snap.status === 'signedIn'
            ? 'Surprise Me costs one world from your quota. Nothing is charged, and the first scene is written after the rules are committed.'
            : 'You are not signed in, so this will fail with 401 until you sign in on the Welcome screen.'}
        </Text>
      </View>

      <ConsentDisclosure />
    </Screen>
  );
}

const styles = StyleSheet.create({
  doors: { gap: space.md },
  note: { padding: space.lg, backgroundColor: color.surface, borderRadius: radius.md },
  noteText: { color: color.muted, fontSize: font.label },
});
