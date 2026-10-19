// UI09 — History (US10: what happened since last visit, bounded to committed
// episodes). The list is the engine's own episode rows in ledger order; nothing is
// reconstructed locally, so a row here is a row in the database.

import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ArtBand } from '../../components/art';
import { EpisodeText } from '../../components/cards';
import { NavBar } from '../../components/nav';
import { ErrorPanel, PanelHead, ProgressSkeleton, Screen, StoryStatus } from '../../components/kit';
import { session, useReduceMotion, useSession } from '../../hooks/useApp';
import { heroFor } from '../../lib/art';
import type { Episode, WorldView } from '../../lib/api';
import { catalogFor } from '../../lib/setting';
import { describe } from '../../lib/session';
import { color, face, focusRing, font, maxFontScale, radius, space, touchTarget } from '../../lib/theme';

export default function History() {
  const { worldId } = useLocalSearchParams<{ worldId: string }>();
  const snap = useSession();
  const reduced = useReduceMotion();
  const [items, setItems] = useState<Episode[] | null>(null);
  const [world, setWorld] = useState<WorldView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  // SC 2.4.7: the ring is drawn from `onFocus`/`onBlur`, because RN 0.86's style
  // callback carries `pressed` only. One key holds the focused row of the whole list,
  // and the blur clears only that key, so a row cannot erase a focus that already
  // moved to the next one.
  const [headFocus, setHeadFocus] = useState<string | null>(null);

  useEffect(() => {
    if (!worldId || snap.status !== 'signedIn') return;
    let alive = true;
    // The hero is decoration, so it rides on its own read rather than in the same
    // chain as the ledger: a world view that fails leaves the text-only layout
    // (`ArtBand` returns null for no source), while the list below keeps its own
    // error path. One combined promise would turn a missing picture into a broken
    // page — and the page is the thing the player came for.
    void session
      .client()
      .getWorld(worldId)
      .then((res) => {
        if (alive) setWorld(res);
      })
      .catch(() => {
        if (alive) setWorld(null);
      });
    void session
      .client()
      .listEpisodes(worldId)
      .then((res) => {
        if (alive) setItems(res.items);
      })
      .catch((e) => {
        if (alive) setError(describe(e));
      });
    return () => {
      alive = false;
    };
  }, [worldId, snap.status]);

  if (!worldId) {
    return <Screen title="History"><Text style={styles.body} maxFontSizeMultiplier={maxFontScale.body}>No world selected.</Text></Screen>;
  }

  const name = world ? catalogFor(world.world.rulepackId)?.title ?? 'A life in progress' : null;

  return (
    <Screen
      title={name ?? 'Episodes'}
      subtitle={`${items?.length ?? 0} committed scenes · every decision encoded in the event ledger`}
      nav={<NavBar active="chronicle" worldId={worldId} />}
    >
      {world ? <ArtBand source={heroFor(world.world.rulepackId)} height={112} frame /> : null}
      {error ? <ErrorPanel title="Could not read the history" message={error} /> : null}
      {items === null && !error ? <ProgressSkeleton label="Loading episodes" reducedMotion={reduced} /> : null}

      {items !== null && items.length > 0 ? (
        <View style={styles.tree}>
          {/* The mockups' causal tree, on the ledger the engine actually wrote: one
              node per committed episode, and the count is the list's own length. */}
          <PanelHead kicker="Causal tree" right={`${items.length} nodes`} />
          {items.map((episode, i) => (
            <View key={episode.id} style={styles.row}>
              {/* The ledger drawn as one: every committed episode is a node on the same
                  line, which is what the list actually is — `fromEventSequence` to
                  `throughEventSequence` along one unbroken run of events. Paint only: the
                  dots carry no state, so nothing here is said by colour alone (SC 1.4.1),
                  and the tree the walk reads is the card's. */}
              <View style={styles.rail} accessibilityElementsHidden>
                <View style={styles.dot} />
                {i < items.length - 1 ? <View style={styles.line} /> : null}
              </View>
              <View style={styles.card}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open === episode.id }}
                  onPress={() => setOpen(open === episode.id ? null : episode.id)}
                  onFocus={() => setHeadFocus(episode.id)}
                  onBlur={() => setHeadFocus((k) => (k === episode.id ? null : k))}
                  style={[styles.head, headFocus === episode.id && focusRing]}
                >
                  <Text style={styles.title} maxFontSizeMultiplier={maxFontScale.chrome}>
                    {`Episode ${i + 1} · events ${episode.fromEventSequence}–${episode.throughEventSequence}`}
                  </Text>
                  <StoryStatus state={episode.status} note={`version ${episode.worldStateVersion}`} />
                </Pressable>
                {open === episode.id ? <EpisodeText episode={episode} episodeNumber={i + 1} /> : null}
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { color: color.text, fontSize: font.body },
  tree: { gap: space.sm },
  row: { flexDirection: 'row', gap: space.sm },
  // A fixed gutter, and the dot pushed down to the height the head sits at (card
  // padding plus the centring inside a `touchTarget` head). The line is the row's
  // own height minus the dot, so it ends exactly where the next dot begins.
  rail: { width: 16, alignItems: 'center', paddingTop: space.xl },
  dot: { width: 10, height: 10, borderRadius: radius.sm, backgroundColor: color.violet },
  line: { width: 2, flex: 1, marginTop: space.xs, backgroundColor: color.line },
  card: {
    flex: 1,
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.line,
  },
  head: { gap: space.xs, minHeight: touchTarget, justifyContent: 'center' },
  title: { color: color.text, fontSize: font.label, fontWeight: '700', fontFamily: face.monoBold, letterSpacing: 0.4 },
});
