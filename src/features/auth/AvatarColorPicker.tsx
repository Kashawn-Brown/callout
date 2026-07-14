import { useCallback, useState, type ReactElement } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { GradientButton } from '@/components/GradientButton';
import { AVATAR_COLORS } from '@/lib/format';
import { COLORS, FONTS, RADII } from '@/lib/theme';

type AvatarColorPickerProps = {
  visible: boolean;
  initials: string;
  /** The color currently in effect (picked or hash default) — shown pre-selected. */
  currentColor: string;
  saving: boolean;
  onSave: (color: string) => void;
  onCancel: () => void;
};

/** The avatar color picker: a grid of the eight palette colors, each previewing the user's own initials, current selection ringed. Selection is local until Save; backdrop tap or Cancel discards. */
export function AvatarColorPicker({
  visible,
  initials,
  currentColor,
  saving,
  onSave,
  onCancel,
}: AvatarColorPickerProps): ReactElement {
  // Null means "no pick yet this session": the effective selection derives from currentColor, and cancelling clears the pick so nothing leaks into the next open (no state-sync effect needed).
  const [picked, setPicked] = useState<string | null>(null);
  const selected = picked ?? currentColor;

  const handleCancel = useCallback(() => {
    setPicked(null);
    onCancel();
  }, [onCancel]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
      <Pressable style={styles.backdrop} onPress={saving ? undefined : handleCancel}>
        {/* Stops backdrop-press from bubbling when tapping inside the card. */}
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.title}>Avatar Color</Text>

          <View style={styles.grid}>
            {AVATAR_COLORS.map((color) => {
              const isSelected = selected === color;
              return (
                <Pressable
                  key={color}
                  onPress={() => setPicked(color)}
                  accessibilityLabel={`Choose color ${color}`}
                  style={[styles.swatch, isSelected && styles.swatchSelected]}
                >
                  <Avatar initials={initials} color={color} size={44} ring={isSelected} />
                </Pressable>
              );
            })}
          </View>

          <GradientButton
            label={saving ? 'Saving…' : 'Save'}
            onPress={() => onSave(selected)}
            disabled={saving || selected === currentColor}
          />
          <Pressable onPress={handleCancel} disabled={saving} style={styles.cancel}>
            <Text style={styles.cancelLabel}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  cancel: {
    alignItems: 'center',
    marginTop: 12,
    paddingVertical: 6,
  },
  cancelLabel: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 13,
  },
  card: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: RADII.card,
    borderWidth: 1,
    padding: 20,
    width: '100%',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'center',
    marginBottom: 20,
    marginTop: 16,
  },
  swatch: {
    alignItems: 'center',
    backgroundColor: COLORS.elevated,
    borderColor: COLORS.border,
    borderRadius: RADII.input,
    borderWidth: 1.5,
    justifyContent: 'center',
    padding: 8,
  },
  swatchSelected: {
    borderColor: COLORS.textPrimary,
  },
  title: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.displayExtraBold,
    fontSize: 18,
    letterSpacing: -0.4,
    textAlign: 'center',
  },
});
