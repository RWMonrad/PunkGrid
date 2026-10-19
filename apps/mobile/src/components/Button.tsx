import { useState } from 'react';
import { Pressable, Text, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { color, face, focusRing, font, maxFontScale, onAccent, radius, space, touchTarget } from '../lib/theme';

export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';

interface Props {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  /** A button whose label is truncated or icon-adjacent still needs to say what
   *  it does to a screen reader (NFR-07). */
  accessibilityHint?: string;
  /** A control that opens or closes a region says so in the state a screen reader
   *   reads, not only in the glyph painted next to its label (NFR-07). */
  expanded?: boolean;
  busy?: boolean;
  /** The instrument-strip size: the same box and the same label colour at caption
   *  size, for the row of small controls a screen fits on one line (the play
   *  screen's console). */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({ label, onPress, variant = 'primary', disabled = false, accessibilityHint, expanded, busy = false, compact = false, style }: Props) {
  const accessibilityLabel = busy ? `${label}, working` : label;
  // SC 2.4.7, and the reason it is state and not style: `PressableStateCallbackType`
  // carries `pressed` only (react-native/Libraries/Components/Pressable/Pressable.d.ts:25),
  // so a callback that reads `focused` would typecheck nowhere and paint nothing.
  // `onFocus`/`onBlur` are the two events the framework does forward.
  const [isFocused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled, busy, ...(expanded === undefined ? {} : { expanded }) }}
      disabled={disabled || busy}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [styles.base, compact && styles.compact, styles[variant], isFocused && focusRing, pressed && styles.pressed, disabled && styles.disabled, style]}
    >
      <Text style={[styles.label, compact && styles.labelCompact, variant === 'primary' || variant === 'accent' ? styles.labelOnAccent : styles.labelInk]} maxFontSizeMultiplier={maxFontScale.chrome}>
        {busy ? `${label}…` : label}
      </Text>
    </Pressable>
  );
}

export function Row({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  base: {
    minHeight: touchTarget,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compact: { paddingHorizontal: space.sm },
  primary: { backgroundColor: color.violet },
  // The mockup's one filled, glowing door: the accent is the screen's single
  // affirmative action, so it is the brightest thing on the page and everything else
  // is a plate or an outline.
  accent: { backgroundColor: color.cyan },
  secondary: { backgroundColor: color.raised },
  ghost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: color.line },
  danger: { backgroundColor: 'transparent', borderWidth: 1, borderColor: color.danger },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.45 },
  // Sans, deliberately: a button is a word a player reads under pressure, and the
  // mockups put their own button labels in mono at sizes this app's players must be
  // able to double (SC 1.4.4) — the reading face is the one that survives that.
  label: { fontSize: font.body, fontWeight: '700', fontFamily: face.sansBold, textAlign: 'center' },
  // Only the size changes; the colour pair is whichever of the two label keys the
  // variant paints, so the strip's pairs are measured at the size it paints them.
  labelCompact: { fontSize: font.caption },
  labelOnAccent: { color: onAccent },
  labelInk: { color: color.text },
  // Wrapping is what lets two buttons in one row survive 200 % text (SC 1.4.4):
  // at that size their labels no longer share a line, and a row that cannot wrap
  // would push the second button off the screen.
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
});
