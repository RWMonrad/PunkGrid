// The typefaces the app runs on — the one file that requires the font binaries,
// so no test and no other lib ever touches a .ttf import. Loaded once in the
// router root; an unresolved family falls back to the platform default at the
// same point size, so a failed load costs the look and never a layout.

import { JetBrainsMono_400Regular, JetBrainsMono_700Bold } from '@expo-google-fonts/jetbrains-mono';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';

import { face } from './theme';

/** Keyed by the family name `theme.face` declares, so the map and the names cannot
 *  drift apart: a typo in either place makes `useFonts` wait for a font that will
 *  never arrive, and this way the wait and the name are the same object. The keys
 *  are spelled out rather than computed, because a record built from computed keys
 *  is not exact enough for TS to check; the `Record` type still fails if `face`
 *  ever names a family this map does not load. The values are the packages' asset
 *  module ids — `useFonts` registers each one under its key, and the key is the
 *  family name the styles name. */
export const fontMap: Record<(typeof face)[keyof typeof face], number> = {
  PlusJakartaSans_400Regular: PlusJakartaSans_400Regular,
  PlusJakartaSans_700Bold: PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold: PlusJakartaSans_800ExtraBold,
  JetBrainsMono_400Regular: JetBrainsMono_400Regular,
  JetBrainsMono_700Bold: JetBrainsMono_700Bold,
};
