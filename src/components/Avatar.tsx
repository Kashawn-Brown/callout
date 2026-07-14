import type { ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { COLORS, FONTS } from '@/lib/theme';

type AvatarProps = {
  initials: string;
  color: string;
  size?: number;
  ring?: boolean;
  ringColor?: string;
  /** Renders a small pencil badge on the bottom-right corner — the editability affordance for the profile identity card's color picker. The surrounding Pressable owns the actual tap. */
  editBadge?: boolean;
};

/** Initials-in-a-circle avatar matching the prototype's Avatar: tinted fill from the member color, optional highlight ring for the active-turn member. */
export function Avatar({
  initials,
  color,
  size = 40,
  ring,
  ringColor,
  editBadge,
}: AvatarProps): ReactElement {
  const accent = ringColor ?? color;

  const circle = (
    <View
      style={[
        styles.circle,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: `${color}22`,
          borderWidth: ring ? 2.5 : 2,
          borderColor: ring ? accent : `${color}44`,
        },
      ]}
    >
      <Text style={[styles.initials, { fontSize: size * 0.35, color: accent }]}>{initials}</Text>
    </View>
  );

  if (!editBadge) {
    return circle;
  }

  const badgeSize = Math.max(20, size * 0.34);
  return (
    <View>
      {circle}
      <View
        style={[
          styles.badge,
          { width: badgeSize, height: badgeSize, borderRadius: badgeSize / 2 },
        ]}
      >
        <Svg width={badgeSize * 0.5} height={badgeSize * 0.5} viewBox="0 0 14 14" fill="none">
          <Path
            d="M9.5 1.5l3 3L5 12l-3.5.5L2 9l7.5-7.5z"
            stroke={COLORS.textPrimary}
            strokeWidth={1.5}
            strokeLinejoin="round"
          />
        </Svg>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    backgroundColor: COLORS.elevated,
    borderColor: COLORS.border,
    borderWidth: 1,
    bottom: -2,
    justifyContent: 'center',
    position: 'absolute',
    right: -2,
  },
  circle: {
    alignItems: 'center',
    flexShrink: 0,
    justifyContent: 'center',
  },
  initials: {
    fontFamily: FONTS.display,
    letterSpacing: -0.3,
  },
});
