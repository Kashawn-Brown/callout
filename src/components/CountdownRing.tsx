import type { ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { COLORS, FONTS } from '@/lib/theme';

type CountdownRingProps = {
  timeLabel: string;
  /** Fraction of the deadline window remaining, 0–1. Display-only: real values always derive from server-authoritative deadline_at minus serverNow(), never a client-owned clock (CLAUDE.md §2.1). */
  pct: number;
  size?: number;
  color?: string;
  urgent?: boolean;
};

/** Circular time-remaining indicator from the prototype's CountdownRing: grey track, colored progress arc, time label centered. */
export function CountdownRing({
  timeLabel,
  pct,
  size = 120,
  color = COLORS.ember,
  urgent = false,
}: CountdownRingProps): ReactElement {
  const strokeWidth = 8;
  const r = (size - 12) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - Math.min(Math.max(pct, 0), 1));
  const arcColor = urgent ? COLORS.warning : color;

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Svg width={size} height={size} style={styles.svg}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={COLORS.border}
          strokeWidth={strokeWidth}
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={arcColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${circumference}`}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={styles.center}>
        <Text
          style={[
            styles.time,
            { fontSize: size * 0.22, color: urgent ? COLORS.warning : COLORS.textPrimary },
          ]}
        >
          {timeLabel}
        </Text>
        <Text style={[styles.caption, { fontSize: size * 0.1 }]}>left</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  caption: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.bodySemiBold,
    letterSpacing: 0.5,
    marginTop: 2,
    textTransform: 'uppercase',
  },
  center: {
    alignItems: 'center',
  },
  svg: {
    position: 'absolute',
  },
  time: {
    fontFamily: FONTS.displayExtraBold,
    letterSpacing: -0.5,
    lineHeight: undefined,
  },
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
