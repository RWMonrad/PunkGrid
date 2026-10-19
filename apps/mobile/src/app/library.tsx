// UI07's list surface (US06: a returning player finds their worlds and their last
// scene, rehydrated from the server rather than from a local cache), drawn as the
// mockups' Multiverse Nexus: the live lives above, the concluded ones below.

import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button, Row } from '../components/Button';
import { LegacyCard, WorldCard } from '../components/cards';
import { CornerTicks, Readout } from '../components/hud';
import { NavBar } from '../components/nav';
import { ErrorPanel, PanelHead, ProgressSkeleton, Screen } from '../components/kit';
import { session, useReduceMotion, useSession } from '../hooks/useApp';
import type { WorldSummary } from '../lib/api';
import { describe } from '../lib/session';
import { color, face, font, maxFontScale, radius, space } from '../lib/theme';

export default function Library() {
  const router = useRouter();
  const snap = useSession();
  const reduced = useReduceMotion();
  const [worlds, setWorlds] = useState<WorldSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    if (snap.status === 'loading') return;
    if (snap.status !== 'signedIn') {
      router.replace('/');
      return;
    }
    return Promise.resolve()
      .then(() => session.client().listWorlds())
      .then((res) => setWorlds(res.items))
      .catch((e) => setError(describe(e)))
      .finally(() => setRefreshing(false));
  }, [router, snap.status]);

  useEffect(() => {
    void load();
  }, [load]);

  // The mockup's counts line, on the numbers the reply actually carries: a live
  // matrix is any world the engine still moves, a legacy is one it does not.
  const live = worlds?.filter((w) => w.status !== 'archived') ?? null;
  const legacies = worlds?.filter((w) => w.status === 'archived') ?? [];

  return (
    <Screen
      title="Multiverse"
      subtitle={
        worlds
          ? `${live?.length ?? 0} live · ${legacies.length} legacies`
          : snap.userId
            ? `Signed in as ${snap.userId}`
            : undefined
      }
      nav={<NavBar active="multiverse" />}
    >
      {error ? <ErrorPanel title="Could not read your worlds" message={error} onRetry={() => { setError(null); void load(); }} /> : null}

      {worlds === null && !error ? <ProgressSkeleton label="Reading the multiverse" reducedMotion={reduced} /> : null}

      {worlds !== null && worlds.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyKicker} maxFontSizeMultiplier={maxFontScale.chrome}>
            NO CONSCIOUSNESS THREADS YET
          </Text>
          <Text style={styles.emptyText} maxFontSizeMultiplier={maxFontScale.body}>
            No worlds yet. The first one is free.
          </Text>
        </View>
      ) : null}

      {worlds !== null && worlds.length > 0 ? (
        <View style={styles.panel}>
          {/* The instrument panel the mockup's nexus keeps, on this screen's two
              real numbers. Nothing here is estimated: both come from the same reply
              that drew the rows below, and the world ids stay off the panel — the
              contract's reads carry them, the player's screen does not. */}
          <Readout label="Lives in play" value={`${worlds.length}`} />
          <Readout label="Deepest divergence" value={`V${Math.max(...worlds.map((w) => w.stateVersion))}`} />
          <CornerTicks />
        </View>
      ) : null}

      {live !== null && live.length > 0 ? (
        <View style={styles.section}>
          {/* While you walk in one life, the others breathe — these are the matrices
              the engine is still moving, so their cards are doors back into play. */}
          <PanelHead kicker="Live consciousness matrices" right={`${live.length} active`} />
          {live.map((w) => (
            <WorldCard key={w.worldId} world={w} onOpen={() => router.push({ pathname: '/world/[worldId]', params: { worldId: w.worldId } })} />
          ))}
        </View>
      ) : null}

      {legacies.length > 0 ? (
        <View style={styles.section}>
          {/* The hall of legacies: concluded lives stay readable, and their doors open
              on the chronicle rather than a scene that can no longer move. */}
          <PanelHead kicker="Hall of legacies" right={`${legacies.length} archived`} />
          {legacies.map((w) => (
            <LegacyCard key={w.worldId} world={w} onOpen={() => router.push(`/history/${w.worldId}`)} />
          ))}
        </View>
      ) : null}

      {/* The screen's one affirmative action wears the same filled cyan as UI01's
          “Create a Life”, which is the mockup's rule rather than a decoration: one
          bright door per screen, everything else a plate or an outline. */}
      <Button
        label="Initiate new consciousness thread"
        variant="accent"
        onPress={() => router.push('/genesis')}
        accessibilityHint="Begins a new life in a new world"
      />
      <Row>
        <Button label="Account and privacy" variant="ghost" style={styles.grow} onPress={() => router.push('/account')} />
        <Button label="Reload worlds" variant="ghost" style={styles.grow} busy={refreshing} onPress={() => { setError(null); setRefreshing(true); void load(); }} />
      </Row>
    </Screen>
  );
}

const styles = StyleSheet.create({
  panel: { gap: space.sm, padding: space.md, backgroundColor: color.surface, borderRadius: radius.md, borderTopWidth: 2, borderTopColor: color.cyan },
  section: { gap: space.md },
  empty: { padding: space.lg, backgroundColor: color.surface, borderRadius: radius.md, gap: space.sm },
  emptyKicker: { color: color.cyan, fontSize: font.caption, fontWeight: '700', fontFamily: face.monoBold, letterSpacing: 0.8 },
  emptyText: { color: color.muted, fontSize: font.body },
  grow: { flexBasis: '48%', flexGrow: 1 },
});
