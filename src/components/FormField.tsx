import { useState, type ComponentProps, type ReactElement } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { COLORS, FONTS, RADII, SECTION_LABEL } from '@/lib/theme';

type FormFieldProps = {
  label: string;
} & ComponentProps<typeof TextInput>;

/** Labelled text input matching the prototype's form fields: uppercase section label, dark card fill, border that tints purple while focused/filled. */
export function FormField({ label, style, ...inputProps }: FormFieldProps): ReactElement {
  const [focused, setFocused] = useState(false);

  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={COLORS.textMuted}
        {...inputProps}
        onFocus={(e) => {
          setFocused(true);
          inputProps.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          inputProps.onBlur?.(e);
        }}
        style={[styles.input, focused && styles.inputFocused, style]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: RADII.input,
    borderWidth: 1.5,
    color: COLORS.textPrimary,
    fontFamily: FONTS.body,
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  inputFocused: {
    borderColor: 'rgba(123,97,255,0.5)',
  },
  label: {
    ...SECTION_LABEL,
    marginBottom: 8,
  },
});
