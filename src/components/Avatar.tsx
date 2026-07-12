import type { ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FONTS } from '@/lib/theme';

type AvatarProps = {
  initials: string;
  color: string;
  size?: number;
  ring?: boolean;
  ringColor?: string;
};

/** Initials-in-a-circle avatar matching the prototype's Avatar: tinted fill from the member color, optional highlight ring for the active-turn member. */
export function Avatar({ initials, color, size = 40, ring, ringColor }: AvatarProps): ReactElement {
  const accent = ringColor ?? color;

  return (
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
}

const styles = StyleSheet.create({
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
