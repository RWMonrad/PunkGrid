// Router root. The Stack is deliberately plain: navigation is the least
// interesting part of this app, and every screen owns its own data fetch so a
// deep link into `/world/<id>` works without a coordinator in front of it.
//
// The one thing that must happen before any screen paints is the typefaces: the
// whole UI is measured in the mockups' pairing (Plus Jakarta Sans + JetBrains
// Mono), and a screen that renders before the fonts land would flash the system
// faces and then re-flow. `useFonts` is asked here — and the gate opens on
// `loaded || error`, never on `loaded` alone, because a font that cannot be
// resolved must not become a black screen: the app renders with the platform
// fallback instead.

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { fontMap } from '../lib/fonts';
import { color, font, maxFontScale } from '../lib/theme';

export default function RootLayout() {
  const [loaded, error] = useFonts(fontMap);
  if (!loaded && !error) {
    return (
      <View style={styles.boot}>
        <Text style={styles.bootMark} maxFontSizeMultiplier={maxFontScale.chrome}>
          PUNKGRID
        </Text>
      </View>
    );
  }
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: color.ink },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="genesis" />
        <Stack.Screen name="setup" />
        <Stack.Screen name="library" />
        <Stack.Screen name="world/[worldId]" />
        <Stack.Screen name="history/[worldId]" />
        <Stack.Screen name="account" />
        <Stack.Screen name="paywall" options={{ presentation: 'modal' }} />
      </Stack>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  boot: { flex: 1, backgroundColor: color.deep, alignItems: 'center', justifyContent: 'center' },
  // The boot mark is mono and tracked because that is the voice every telemetry
  // label in the app speaks; it is the only text the player can see before the
  // faces land, so it is the one that must not depend on them.
  bootMark: { color: color.cyan, fontSize: font.label, fontFamily: 'monospace', fontWeight: '700', letterSpacing: 4 },
});
