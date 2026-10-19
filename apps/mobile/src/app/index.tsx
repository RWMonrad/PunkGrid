// UI01 — Welcome (US01: one screen that says what the product is, with the fiction
// mark and the two entrances; US12: the mark is on the screen, not behind a menu).

import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ArtBand, ArtMark, ArtPlate } from '../components/art';
import { Button, Row } from '../components/Button';
import { Chip, ConsentDisclosure, Screen } from '../components/kit';
import { useReduceMotion, useSession } from '../hooks/useApp';
import { plateFor, welcomeEmblem, welcomePortal } from '../lib/art';
import { GLASS_HARBOR } from '../lib/setting';
import { telemetry } from '../lib/telemetry';
import { color, face, font, maxFontScale, radius, space } from '../lib/theme';

export default function Welcome() {
  const router = useRouter();
  const snap = useSession();
  const reducedMotion = useReduceMotion();

  useEffect(() => {
    telemetry.track({
      name: 'app_opened',
      userKey: snap.userId ?? 'guest',
      platform: snap.baseUrl.includes('10.0.2.2') ? 'android-emulator' : 'mobile',
      version: '0.1.0',
      source: 'direct',
    });
  }, [snap.userId, snap.baseUrl]);

  const enter = (entry: 'create' | 'surprise') => {
    telemetry.track({ name: 'genesis_started', entryMode: entry, templateId: entry === 'create' ? 'glass-harbor-2034' : null });
    router.push({ pathname: '/genesis', params: { entry } });
  };

  return (
    <Screen
      title="PunkGrid"
      titleNode={
        <View style={styles.brand}>
          {/* The mark is decoration: the header node and its accessible name are the
              wordmark below, unchanged, so the tree the walk reads on this screen is
              the one it read before the emblem existed. */}
          <ArtMark source={welcomeEmblem} size={48} />
          <Text
            style={styles.wordmark}
            maxFontSizeMultiplier={maxFontScale.chrome}
            accessibilityRole="header"
            accessibilityLabel="PunkGrid"
          >
            <Text style={styles.wordmarkFirst} maxFontSizeMultiplier={maxFontScale.chrome}>PUNK</Text>
            <Text style={styles.wordmarkLast} maxFontSizeMultiplier={maxFontScale.chrome}>GRID</Text>
          </Text>
        </View>
      }
      subtitle="Live a thousand lives. Every choice matters."
      footer={
        <View style={styles.doors}>
          {/* F02: the door that costs nothing. Master §2 defers sign-in until *after*
              a player has seen what a decision reads like, so it sits in the thumb
              zone above the two doors that build a world — and not in the scroll
              body, where it pushed the account row below the fold at 100 % text. */}
          <Button
            label="Try a scene first"
            variant="secondary"
            onPress={() => router.push('/preview')}
            accessibilityHint="Plays one scene on this device — no account, and nothing is sent"
          />
          <Row>
            <Button label="Create a Life" variant="accent" onPress={() => enter('create')} accessibilityHint="Opens the guided world setup" style={{ flex: 1 }} />
            <Button label="Surprise Me" variant="secondary" onPress={() => enter('surprise')} accessibilityHint="Builds a world for you" style={{ flex: 1 }} />
          </Row>
        </View>
      }
    >
      <View style={styles.portal}>
        <ArtBand source={welcomePortal} height={200} corner={radius.md} frame />
        <View style={styles.portalCopy}>
          <View style={[styles.gate, reducedMotion && styles.gateStill]} />
          <Text style={styles.portalText} maxFontSizeMultiplier={maxFontScale.chrome}>
            Your reality is only one of many.
          </Text>
        </View>
      </View>

      <ConsentDisclosure />

      {/* Three facts, each one true and each one in words: the account, the age
          limit, and the machine this build talks to. They were one line of prose
          before, which is why a long host name clipped at 200 % text — as chips the
          row wraps instead of cutting a token in half. */}
      <Row style={styles.chips}>
        <Chip
          label={snap.status === 'signedIn' ? `Signed in as ${snap.userId ?? ''}` : 'Not signed in'}
          dot={snap.status === 'signedIn' ? 'success' : 'muted'}
        />
        <Chip label="18+ only" dot="violet" />
        <Chip label={snap.baseUrl} dot="cyan" />
      </Row>

      {snap.status !== 'signedIn' ? (
        <Button label="Sign in" variant="ghost" onPress={() => router.push('/sign-in')} accessibilityHint="Development accounts only until a real sign-in provider is connected" />
      ) : (
        <Row>
          <Button label="Multiverse" variant="ghost" onPress={() => router.push('/library')} style={{ flex: 1 }} />
          <Button label="Account" variant="ghost" onPress={() => router.push('/account')} style={{ flex: 1 }} />
        </Row>
      )}

      {/* The band under the doors measured 830 px of bare page on a 2 992 px screen
          (`docs/qa/evidence/device-walk/2026-10-13T00-01-14-099Z/UI01 welcome.png`), on
          the one screen whose job is to make a player want in. What fills it is the art
          that already ships, keyed the same honest way as everywhere else in the app:
          these are the four places the catalogue in `lib/setting.ts` actually offers,
          named by that catalogue, not a promise about worlds this build cannot make. */}
      <View style={styles.places}>
        <Text style={styles.placesKicker} maxFontSizeMultiplier={maxFontScale.chrome}>
          {`${GLASS_HARBOR.title.toUpperCase()} · WHERE A LIFE CAN START`}
        </Text>
        <Row style={styles.plateRow}>
          {GLASS_HARBOR.locations.map((l) => (
            <ArtPlate key={l.value} source={plateFor(l.value)} label={l.label} size={72} />
          ))}
        </Row>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  portal: {
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: color.surface,
    gap: space.lg,
  },
  portalCopy: { gap: space.sm },
  gate: {
    height: 6,
    borderRadius: radius.sm,
    backgroundColor: color.violet,
    alignSelf: 'stretch',
  },
  gateStill: { backgroundColor: color.cyan },
  portalText: { color: color.text, fontSize: font.title, fontWeight: '700' },
  // The brand as one line in two colours with wide tracking. It is still a single
  // `Text`, so the tree carries one header node and the accessible name is the
  // brand rather than the two halves read apart.
  // The mark shares the row's height instead of adding one: UI01 was measured at
  // both 100 % and 200 % text, and the chrome cap keeps the wordmark bounded, so a
  // 48 dp plate sits inside the line it already needed.
  brand: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  wordmark: { color: color.cyan, fontSize: font.display, fontWeight: '800', letterSpacing: 6 },
  wordmarkFirst: { color: color.text },
  wordmarkLast: { color: color.cyan },
  chips: { gap: space.sm },
  // The strip is the last thing on the page, so it keeps its own air above it and
  // wraps rather than clipping: at 200 % text the four names are too wide for one
  // line, and a row that cannot wrap would push Mars off the screen.
  places: { gap: space.md, paddingTop: space.xl },
  placesKicker: { color: color.cyan, fontSize: font.caption, fontWeight: '700', fontFamily: face.monoBold, letterSpacing: 0.8 },
  plateRow: { gap: space.lg },
  // The footer holds three doors and must not weld them into one pressable block.
  doors: { gap: space.md },
});
