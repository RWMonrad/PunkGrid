// The four doors at the bottom of every hub screen — the one structural thing the
// Stitch mockups have that the app did not: a console whose tabs are always under
// the thumb, so a life is one tap away from anywhere (the engagement loop the
// product is for). LIFE STREAM and CHRONICLE need a world; without one they route
// to the multiverse, where the worlds that exist are listed — an honest "no
// active consciousness" rather than a disabled tab.
//
// Routing is `replace`, not `push`: the four hubs are peers, not a drill-down, and
// a stack that grew on every tab change would bury the player in copies of the
// same screens. Pressing the tab that is already lit does nothing.

import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { color, face, focusRing, font, maxFontScale, space } from '../lib/theme';

export type NavTab = 'stream' | 'genesis' | 'chronicle' | 'multiverse';

const TABS: { key: NavTab; label: string; icon: ComponentProps<typeof MaterialCommunityIcons>['name'] }[] = [
  { key: 'stream', label: 'Life Stream', icon: 'console' },
  { key: 'genesis', label: 'Genesis', icon: 'creation-outline' },
  { key: 'chronicle', label: 'Chronicle', icon: 'brain' },
  { key: 'multiverse', label: 'Multiverse', icon: 'view-grid-outline' },
];

export function NavBar({ active, worldId }: { active: NavTab; worldId?: string | null }) {
  const router = useRouter();
  const { selectedWorldId } = useLocalSearchParams<{ selectedWorldId?: string }>();
  const selected = worldId ?? selectedWorldId;
  const { width, fontScale } = useWindowDimensions();
  const twoColumns = width / Math.min(fontScale, maxFontScale.chrome) < 380;

  const go = (key: NavTab) => {
    if (key === active) return;
    if (key === 'stream') {
      router.replace(selected ? { pathname: '/world/[worldId]', params: { worldId: selected } } : '/library');
    } else if (key === 'chronicle') {
      router.replace(selected ? { pathname: '/history/[worldId]', params: { worldId: selected } } : '/library');
    } else if (key === 'multiverse') {
      router.replace({ pathname: '/library', params: { selectedWorldId: selected } });
    } else {
      router.replace({ pathname: '/genesis', params: { selectedWorldId: selected } });
    }
  };

  return (
    <View style={styles.bar} accessibilityRole="tablist" accessible={false} importantForAccessibility="no">
      {TABS.map((tab) => (
        <Tab key={tab.key} tab={tab} selected={tab.key === active} twoColumns={twoColumns} onPress={() => go(tab.key)} />
      ))}
    </View>
  );
}

function Tab({ tab, selected, twoColumns, onPress }: {
  tab: (typeof TABS)[number];
  selected: boolean;
  twoColumns: boolean;
  onPress: () => void;
}) {
  // SC 2.4.7: the ring is drawn from focus state, because `Pressable`'s style
  // callback reports `pressed` only.
  const [isFocused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={tab.label}
      accessibilityState={{ selected }}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[styles.tab, twoColumns && styles.tabTwoColumns, isFocused && focusRing, selected && styles.tabOn]}
    >
      {/* The icon is decoration: the label beneath it is the name the reader
          speaks, and the tree carries `selected` as a state, not as a colour. */}
      <MaterialCommunityIcons
        name={tab.icon}
        size={22}
        color={selected ? color.cyan : color.muted}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <Text style={[styles.tabLabel, selected && styles.tabLabelOn]} maxFontSizeMultiplier={maxFontScale.chrome} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {tab.label.toUpperCase()}
      </Text>
      {/* A beacon on the lit tab — paint, not meaning: the state is already in the
          label's colour and in `selected`, and the square is hidden from the tree. */}
      {selected ? <View style={styles.beacon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: color.deep,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  // The tab is the target and the four of them share the row, so the SC 2.5.8
  // number comes from the bar's height rather than each tab's own minHeight.
  tab: {
    flex: 1,
    minHeight: 60,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    paddingHorizontal: space.xs,
  },
  tabTwoColumns: { flexBasis: '50%', flexGrow: 0 },
  tabOn: { borderTopWidth: 2, borderTopColor: color.cyan },
  tabLabel: { color: color.muted, fontSize: font.caption, fontFamily: face.monoBold, fontWeight: '700', letterSpacing: 0.6, textAlign: 'center' },
  tabLabelOn: { color: color.cyan },
  beacon: { position: 'absolute', top: 6, right: 10, width: 6, height: 6, borderRadius: 2, backgroundColor: color.cyan },
});
