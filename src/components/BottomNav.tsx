import { useRouter } from 'expo-router';
import type { ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import { COLORS, FONTS } from '@/lib/theme';

type TabId = 'home' | 'create' | 'activity';

/** The prototype's bottom bar (Groups / New / Activity). Activity points at the placeholder group's detail screen until Phase 3 gives it a real cross-group feed. */
export function BottomNav({ active }: { active: TabId }): ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const tabs: {
    id: TabId;
    label: string;
    icon: (activeTab: boolean) => ReactElement;
    onPress: () => void;
  }[] = [
    { id: 'home', label: 'Groups', icon: homeIcon, onPress: () => router.push('/') },
    { id: 'create', label: 'New', icon: plusIcon, onPress: () => router.push('/create-group') },
    {
      id: 'activity',
      label: 'Activity',
      icon: activityIcon,
      onPress: () => router.push('/group/g1'),
    },
  ];

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <Pressable
            key={tab.id}
            onPress={tab.onPress}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            style={styles.tab}
          >
            {tab.icon(isActive)}
            <Text style={[styles.label, isActive && styles.labelActive]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function stroke(active: boolean): string {
  return active ? COLORS.ember : COLORS.textSecondary;
}

function fill(active: boolean): string {
  return active ? 'rgba(255,78,58,0.15)' : 'none';
}

function homeIcon(active: boolean): ReactElement {
  return (
    <Svg width={22} height={22} viewBox="0 0 22 22" fill="none">
      <Path
        d="M3 9.5L11 3l8 6.5V19a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"
        stroke={stroke(active)}
        strokeWidth={1.8}
        strokeLinejoin="round"
        fill={fill(active)}
      />
    </Svg>
  );
}

function plusIcon(active: boolean): ReactElement {
  return (
    <Svg width={22} height={22} viewBox="0 0 22 22" fill="none">
      <Circle cx={11} cy={11} r={8} stroke={stroke(active)} strokeWidth={1.8} fill={fill(active)} />
      <Path
        d="M11 7.5v7M7.5 11h7"
        stroke={stroke(active)}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}

function activityIcon(active: boolean): ReactElement {
  return (
    <Svg width={22} height={22} viewBox="0 0 22 22" fill="none">
      <Path
        d="M3 11h3l3-7 4 14 3-7h3"
        stroke={stroke(active)}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: 'rgba(14,14,20,0.97)',
    borderTopColor: COLORS.border,
    borderTopWidth: 1,
    bottom: 0,
    flexDirection: 'row',
    left: 0,
    paddingTop: 10,
    position: 'absolute',
    right: 0,
  },
  label: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 10,
    letterSpacing: 0.4,
  },
  labelActive: {
    color: COLORS.ember,
  },
  tab: {
    alignItems: 'center',
    flex: 1,
    gap: 4,
    paddingVertical: 6,
  },
});
