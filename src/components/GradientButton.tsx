import { LinearGradient } from 'expo-linear-gradient';
import type { ReactElement } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { COLORS, FONTS, GRADIENTS, RADII } from '@/lib/theme';

type GradientButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** Which prototype gradient the CTA uses: ember for primary actions, invite for join-flow actions. */
  variant?: keyof typeof GRADIENTS;
};

/** Primary CTA matching the prototype's gradient buttons; renders flat and muted when disabled, exactly like the prototype's not-yet-valid states. */
export function GradientButton({
  label,
  onPress,
  disabled = false,
  variant = 'ember',
}: GradientButtonProps): ReactElement {
  if (disabled) {
    return (
      <Pressable style={[styles.base, styles.disabled]} accessibilityRole="button" disabled>
        <Text style={[styles.label, styles.labelDisabled]}>{label}</Text>
      </Pressable>
    );
  }

  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      {({ pressed }) => (
        <LinearGradient
          colors={GRADIENTS[variant]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.base, pressed && styles.pressed]}
        >
          <Text style={styles.label}>{label}</Text>
        </LinearGradient>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    borderRadius: RADII.button,
    justifyContent: 'center',
    paddingVertical: 16,
  },
  disabled: {
    backgroundColor: COLORS.elevated,
  },
  label: {
    color: COLORS.white,
    fontFamily: FONTS.displayExtraBold,
    fontSize: 16,
    letterSpacing: -0.2,
  },
  labelDisabled: {
    color: COLORS.textDisabled,
  },
  pressed: {
    opacity: 0.85,
  },
});
