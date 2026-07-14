import type { ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { COLORS, FONTS } from '@/lib/theme';

type SegmentedToggleProps = {
  options: { id: string; label: string }[];
  activeId: string;
  onChange: (id: string) => void;
};

/** Small segmented control in the prototype's pill language; used for the email/phone auth method switch (D037). */
export function SegmentedToggle({ options, activeId, onChange }: SegmentedToggleProps): ReactElement {
  return (
    <View style={styles.track}>
      {options.map((option) => {
        const isActive = option.id === activeId;
        return (
          <Pressable
            key={option.id}
            onPress={() => onChange(option.id)}
            accessibilityRole="button"
            accessibilityLabel={option.label}
            style={[styles.segment, isActive && styles.segmentActive]}
          >
            <Text style={[styles.label, isActive && styles.labelActive]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.display,
    fontSize: 13,
  },
  labelActive: {
    color: COLORS.textPrimary,
  },
  segment: {
    alignItems: 'center',
    borderRadius: 12,
    flex: 1,
    paddingVertical: 9,
  },
  segmentActive: {
    backgroundColor: COLORS.elevated,
  },
  track: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    padding: 3,
  },
});
