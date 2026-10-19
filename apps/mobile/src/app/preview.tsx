// F02 — the guest preview screen. The point of this route is that it exists before
// an account does, so it reads its scene out of the bundle (`lib/preview.ts`) and
// keeps its state in the component: leaving the screen costs the player nothing,
// and signing in is the first thing that costs anything.

import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ArtBand } from '../components/art';
import { Button, Row } from '../components/Button';
import { ChoiceCard } from '../components/cards';
import { Chip, ConsentDisclosure, Screen } from '../components/kit';
import { welcomePortal } from '../lib/art';
import { OPENING, PREVIEW_TITLE, UPGRADE_LINE, chosen, type PreviewScene } from '../lib/preview';
import { color, face, font, maxFontScale, radius, space } from '../lib/theme';

export default function Preview() {
  const router = useRouter();
  const [scene, setScene] = useState<PreviewScene>(OPENING);
  const decided = scene.choices.length === 0;

  return (
    <Screen
      key={scene.id}
      title={decided ? 'What it cost' : PREVIEW_TITLE}
      subtitle="Local preview · nothing here is saved or sent"
      footer={
        decided ? (
          <View style={styles.footer}>
            <Button label="Sign in to begin a saved life" onPress={() => router.push('/sign-in')} accessibilityHint="Opens sign-in. You can then create a new world; this preview is not transferred" />
            <Button label="Make a different choice" variant="ghost" onPress={() => setScene(OPENING)} accessibilityHint="Returns to the four doors; nothing was saved from the one you took" />
          </View>
        ) : (
          <View style={styles.footer}>
            <Button label="Skip the preview, take me in" variant="ghost" onPress={() => router.push('/')} accessibilityHint="Returns to the welcome screen" />
          </View>
        )
      }
    >
      <ArtBand source={welcomePortal} height={120} corner={radius.md} frame />

      <View style={styles.card}>
        <Text style={styles.kicker} maxFontSizeMultiplier={maxFontScale.chrome}>{scene.kicker}</Text>
        {scene.paragraphs.map((p, i) => (
          <Text key={i} style={styles.paragraph} maxFontSizeMultiplier={maxFontScale.body}>
            {p}
          </Text>
        ))}
        {scene.receipt ? (
          <View style={styles.receipt} accessibilityRole="summary" accessibilityLiveRegion="polite">
            <Text style={styles.receiptLabel} maxFontSizeMultiplier={maxFontScale.chrome}>WHAT MOVED</Text>
            <Text style={styles.receiptText} maxFontSizeMultiplier={maxFontScale.body}>{scene.receipt}</Text>
          </View>
        ) : null}
      </View>

      {decided ? (
        <View style={styles.upgrade}>
          <Text style={styles.upgradeText} maxFontSizeMultiplier={maxFontScale.body}>{UPGRADE_LINE}</Text>
        </View>
      ) : (
        OPENING.choices.map((c, i) => (
          <ChoiceCard
            key={c.choiceId}
            choice={c}
            index={i}
            total={OPENING.choices.length}
            onChoose={() => setScene(chosen(OPENING, c.choiceId))}
          />
        ))
      )}

      <Row style={styles.chips}>
        <Chip label="No account" dot="muted" />
        <Chip label="No server" dot="cyan" />
        <Chip label="18+ only" dot="violet" />
      </Row>

      <ConsentDisclosure compact />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { padding: space.lg, backgroundColor: color.surface, borderRadius: radius.md, gap: space.md },
  kicker: { color: color.violet, fontSize: font.label, fontWeight: '700', fontFamily: face.monoBold },
  paragraph: { color: color.text, fontSize: font.lead, lineHeight: 30 },
  receipt: { gap: space.xs, paddingTop: space.md, borderTopWidth: 1, borderTopColor: color.line },
  receiptLabel: { color: color.muted, fontSize: font.caption, fontWeight: '700', letterSpacing: 0.6 },
  receiptText: { color: color.text, fontSize: font.label },
  upgrade: { padding: space.lg, backgroundColor: color.surface, borderRadius: radius.md, borderLeftWidth: 3, borderLeftColor: color.cyan },
  upgradeText: { color: color.muted, fontSize: font.body },
  chips: { gap: space.sm },
  footer: { gap: space.md },
});
