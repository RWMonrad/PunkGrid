// UI11 — Paywall, reachable only while the Premium flag is on. There is no store,
// no product id and no price approved in this build, so the screen states the limit
// it would lift and does not offer a button that cannot complete a purchase
// (§5.3 puts Premium behind a feature flag for exactly this reason).

import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '../components/Button';
import { ConsentDisclosure, Screen, Section } from '../components/kit';
import { useSession } from '../hooks/useApp';
import { telemetry } from '../lib/telemetry';
import { color, font, maxFontScale, radius, space } from '../lib/theme';

export default function Paywall() {
  const router = useRouter();
  const snap = useSession();

  if (!snap.flags.premium) {
    return (
      <Screen title="Premium is off" subtitle="Nothing here is purchasable in this build." footer={<Button label="Back" onPress={() => router.back()} />}>
        <Text style={styles.body} maxFontSizeMultiplier={maxFontScale.body}>
          The feature flag is the reason. With it off the app has one free world and no store connection.
        </Text>
      </Screen>
    );
  }

  telemetry.track({ name: 'paywall_viewed', planId: 'premium_monthly', context: 'account' });

  return (
    <Screen
      title="Premium"
      subtitle="More worlds, longer arcs, the same rules underneath."
      footer={
        <View style={styles.footer}>
          <Button label="Subscribe" disabled onPress={() => undefined} accessibilityHint="Disabled: no store product is connected in this build" />
          <Button label="Restore purchases" variant="ghost" disabled onPress={() => undefined} />
          <Button label="Not now" variant="ghost" onPress={() => router.back()} />
        </View>
      }
    >
      <View style={styles.card}>
        <Text style={styles.planName} maxFontSizeMultiplier={maxFontScale.chrome}>
          Premium monthly
        </Text>
        <Text style={styles.price} maxFontSizeMultiplier={maxFontScale.chrome}>
          Price not set
        </Text>
        <Text style={styles.body} maxFontSizeMultiplier={maxFontScale.body}>
          {`Free: ${'1'} world at a time.\nPremium would add: more simultaneous worlds, longer generated scenes, and priority narration.\nRenewal, cancellation and refunds are shown here before any purchase — that is the transparency §5.3 asks for.`}
        </Text>
      </View>

      <Section title="What is not connected yet">
        <Text style={styles.body} maxFontSizeMultiplier={maxFontScale.body}>
          No store product id, no receipt validation route, no entitlement sync. The engine already reads an entitlement row (`free` or `premium`), so the server side is a grant change rather than a new subsystem.
        </Text>
      </Section>

      <ConsentDisclosure compact />
    </Screen>
  );
}

const styles = StyleSheet.create({
  footer: { gap: space.md },
  card: { padding: space.lg, backgroundColor: color.surface, borderRadius: radius.lg, gap: space.sm },
  planName: { color: color.text, fontSize: font.lead, fontWeight: '700' },
  price: { color: color.cyan, fontSize: font.title, fontWeight: '700' },
  body: { color: color.muted, fontSize: font.body },
});
