import type { ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { COLORS, FONTS, RADII } from '@/lib/theme';

/** The consistent user-facing error surface required by CLAUDE.md §5.7 — every screen renders failures through this rather than ad-hoc text. */
export function ErrorBanner({ message }: { message: string }): ReactElement {
  return (
    <View style={styles.banner}>
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: 'rgba(255,78,58,0.12)',
    borderColor: 'rgba(255,78,58,0.35)',
    borderRadius: RADII.input,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  text: {
    color: COLORS.ember,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 13,
    lineHeight: 18,
  },
});
