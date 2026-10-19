// Development sign-in (ADR-016). This screen exists because §11 accepts a bearer
// token from an auth provider the project has not connected yet: the server signs
// HMAC dev tokens for an allowlist of names, and nothing here pretends that is an
// account system. Supabase Auth replaces this screen, not the routes behind it.

import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '../components/Button';
import { ErrorPanel, Screen } from '../components/kit';
import { session, useSession } from '../hooks/useApp';
import { color, focusRing, font, maxFontScale, radius, space, touchTarget } from '../lib/theme';

export default function SignIn() {
  const router = useRouter();
  const snap = useSession();
  const [userId, setUserId] = useState('user_demo');
  // SC 2.4.7: painted by the app, because a TextInput gives no style callback and the
  // field's own border is the same whether or not the keyboard is in it.
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    const res = await session.signInDev(userId.trim());
    setBusy(false);
    if (res.ok) router.replace('/library');
    else setMessage(res.message ?? 'Sign-in failed.');
  }

  return (
    <Screen title="Sign in" subtitle="Development accounts only — the server must be started with an allowlist." footer={<Button label="Enter the world" onPress={() => void submit()} busy={busy} disabled={userId.trim().length === 0} />}>
      <View style={styles.field}>
        <Text style={styles.label} maxFontSizeMultiplier={maxFontScale.chrome}>
          Dev account name
        </Text>
        <TextInput
          value={userId}
          onChangeText={setUserId}
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, focused && focusRing]}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          accessibilityLabel="Dev account name"
          placeholder="user_demo"
          placeholderTextColor={color.muted}
        />
        <Text style={styles.hint} maxFontSizeMultiplier={maxFontScale.body}>
          The name has to be listed in the server&apos;s `PUNKGRID_DEV_USERS`. An unlisted name is refused with 403, and a server without the dev port answers 404.
        </Text>
      </View>

      <Text style={styles.hint} maxFontSizeMultiplier={maxFontScale.body}>
        {'Server: '}{snap.baseUrl}
      </Text>

      {message ? <ErrorPanel title="Could not sign in" message={message} onRetry={() => void submit()} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  field: { gap: space.sm },
  label: { color: color.text, fontSize: font.label, fontWeight: '700' },
  input: {
    minHeight: touchTarget,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.line,
    color: color.text,
    fontSize: font.body,
  },
  hint: { color: color.muted, fontSize: font.caption },
});
