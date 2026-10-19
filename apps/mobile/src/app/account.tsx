// UI10 — Account and privacy. Everything on this screen either works or says that
// it does not: export and deletion are listed because US15 promises them, and the
// honest state in this build is that the server has no such route yet (F15 waits on
// the ADR-014 legal gate). A row that would 404 is disabled with the reason, not
// hidden.

import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '../components/Button';
import { CornerTicks, Readout } from '../components/hud';
import { ConsentDisclosure, PrivacyRow, Screen, Section, StoryStatus, Toast } from '../components/kit';
import { session, useReduceMotion, useSession } from '../hooks/useApp';
import { ApiError } from '../lib/api';
import { isHttpUrl } from '../lib/config';
import { describe } from '../lib/session';
import { telemetry } from '../lib/telemetry';
import { color, face, focusRing, font, maxFontScale, radius, space, touchTarget } from '../lib/theme';

export default function Account() {
  const router = useRouter();
  const snap = useSession();
  const reduced = useReduceMotion();
  const [address, setAddress] = useState(snap.baseUrlOverride ?? snap.baseUrl);
  // SC 2.4.7: the field's own 1 dp `line` border says nothing about which field has
  // the keyboard, and React Native gives no style callback for a TextInput, so the
  // focus is held in state and painted from here.
  const [addressFocused, setAddressFocused] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [health, setHealth] = useState<'unknown' | 'checking' | 'up' | 'down'>('unknown');

  async function check() {
    setHealth('checking');
    try {
      await session.client().health();
      setHealth('up');
    } catch (e) {
      setHealth('down');
      setNote(e instanceof ApiError ? e.message : describe(e));
    }
  }

  async function saveAddress() {
    if (!isHttpUrl(address)) {
      setNote('Use a full http:// or https:// address.');
      return;
    }
    await session.setBaseUrlOverride(address.trim());
    setNote('Server address saved on this device.');
    setHealth('unknown');
  }

  return (
    <Screen
      title="Account and privacy"
      subtitle={snap.userId ? `Dev account ${snap.userId}` : 'Not signed in'}
      footer={
        <View style={styles.footer}>
          {snap.flags.premium ? (
            <Button label="Premium" variant="ghost" onPress={() => router.push('/paywall')} />
          ) : null}
          {/* The screen is reachable by deep link on a device with no session, and a
              “Sign out” there is a control that ends nothing. It says what the device
              actually has, and gives the one way back the walk does not have to guess. */}
          {snap.status === 'signedIn' ? (
            <Button label="Sign out" variant="danger" onPress={() => void session.signOut().then(() => router.replace('/'))} />
          ) : snap.status === 'signedOut' ? (
            <Button
              label="Go to the welcome screen"
              onPress={() => router.replace('/')}
              accessibilityHint="This device has no session yet, so there is nothing to sign out of"
            />
          ) : null}
        </View>
      }
    >
      {note ? <Toast message={note} /> : null}

      <Section title="Reality Engine">
        <Text style={styles.label} maxFontSizeMultiplier={maxFontScale.chrome}>
          Server address
        </Text>
        <TextInput
          value={address}
          onChangeText={setAddress}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={[styles.input, addressFocused && focusRing]}
          onFocus={() => setAddressFocused(true)}
          onBlur={() => setAddressFocused(false)}
          accessibilityLabel="Server address"
          placeholder="http://10.0.2.2:3000"
          placeholderTextColor={color.muted}
        />
        <View style={styles.row}>
          <Button label="Save" variant="secondary" onPress={() => void saveAddress()} style={{ flex: 1 }} />
          <Button label="Check" variant="ghost" onPress={() => void check()} busy={health === 'checking'} style={{ flex: 1 }} />
        </View>
        {health !== 'unknown' ? (
          <StoryStatus state={health === 'up' ? 'published' : health === 'down' ? 'failed' : 'pending'} note={health === 'checking' ? 'asking /healthz' : health === 'up' ? 'reachable' : 'not reachable'} />
        ) : null}
        <Text style={styles.hint} maxFontSizeMultiplier={maxFontScale.body}>
          An Android emulator reaches the machine it runs on through 10.0.2.2. A physical device needs the machine&apos;s own address on the same network.
        </Text>
        {/* The value the client will actually call, kept on the screen after the field
            has been edited or the keyboard has covered it. */}
        <Readout label="Address in use" value={snap.baseUrlOverride ?? snap.baseUrl} />
      </Section>

      <Section title="Reading">
        <PrivacyRow
          label="Reduced motion"
          value={reduced ? (snap.flags.reducedMotion ? 'On — set by this switch' : 'On — set by the device') : 'Off — the app may animate'}
          onPress={() => void session.setFlags({ reducedMotion: !snap.flags.reducedMotion })}
          hint="The device setting is read directly, and this switch is the same door for a device that exposes none. Either one replaces the animation with a static element."
        />
      </Section>

      <Section title="Premium">
        <PrivacyRow
          label="Billing"
          value={snap.flags.premium ? 'Feature flag on (development)' : 'Feature flag off — nothing is purchasable'}
          onPress={() => void session.setFlags({ premium: !snap.flags.premium })}
          hint="The paywall exists as UI11 only while the flag is on, and no store is connected."
        />
      </Section>

      <Section title="Your data">
        <PrivacyRow label="Export my worlds and episodes" value="Not available in this build" hint="§11 has no export route yet (F15)." />
        <PrivacyRow label="Delete account and data" value="Not available in this build" hint="Deletion is gated by ADR-014's legal review of event retention." />
        <PrivacyRow
          label="Report a scene"
          value="Available from any episode"
          hint="A report files a case with a reason code and a short excerpt, never the full scene."
        />
      </Section>

      <ConsentDisclosure />

      <View style={styles.debug}>
        <Text style={styles.label} maxFontSizeMultiplier={maxFontScale.chrome}>
          Analytics buffered on this device
        </Text>
        <Readout label="Events" value={`${telemetry.recent().length}`} />
        <Text style={styles.hint} maxFontSizeMultiplier={maxFontScale.body}>
          No story text, and nothing is sent anywhere: there is no analytics endpoint in this build.
        </Text>
        <Button label="Request account deletion (records the event only)" variant="ghost" onPress={() => { telemetry.track({ name: 'account_deletion_requested', origin: 'account_screen', completionState: 'not_available' }); setNote('Recorded locally. Deletion needs the route F15 has not shipped.'); }} />
        <CornerTicks tone={color.line} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  footer: { gap: space.md },
  label: { color: color.text, fontSize: font.label, fontWeight: '700' },
  input: { minHeight: touchTarget, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: color.ink, borderWidth: 1, borderColor: color.line, color: color.text, fontSize: font.body, fontFamily: face.mono },
  row: { flexDirection: 'row', gap: space.md },
  hint: { color: color.muted, fontSize: font.caption },
  debug: { gap: space.sm, padding: space.md, backgroundColor: color.surface, borderRadius: radius.md },
});
