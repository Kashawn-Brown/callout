import type { ReactElement, ReactNode } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { COLORS, RADII } from '@/lib/theme';

type IconButtonProps = {
  onPress: () => void;
  children: ReactNode;
  accessibilityLabel: string;
  size?: number;
};

/** The prototype's 36×36 rounded-square utility button (back, close, overflow) — child is an SVG icon. */
export function IconButton({
  onPress,
  children,
  accessibilityLabel,
  size = 36,
}: IconButtonProps): ReactElement {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.button,
        { width: size, height: size },
        pressed && styles.pressed,
      ]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    backgroundColor: COLORS.elevated,
    borderColor: COLORS.border,
    borderRadius: RADII.iconButton,
    borderWidth: 1,
    flexShrink: 0,
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
});
