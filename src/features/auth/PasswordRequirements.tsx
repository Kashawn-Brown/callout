import { type ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { checkPassword } from '@/features/auth/password-policy';
import { COLORS, FONTS } from '@/lib/theme';

/** Inline checklist under a password field (D069): each policy rule flips from muted to green as the password satisfies it, so weak passwords fail in the form instead of on the auth round-trip. */
export function PasswordRequirements({ password }: { password: string }): ReactElement {
  return (
    <View style={styles.wrap}>
      {checkPassword(password).map((requirement) => (
        <View key={requirement.id} style={styles.row}>
          <Text style={[styles.mark, requirement.met && styles.markMet]}>
            {requirement.met ? '✓' : '○'}
          </Text>
          <Text style={[styles.label, requirement.met && styles.labelMet]}>
            {requirement.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    color: COLORS.textMuted,
    fontFamily: FONTS.body,
    fontSize: 12,
  },
  labelMet: {
    color: COLORS.success,
  },
  mark: {
    color: COLORS.textMuted,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 12,
    width: 16,
  },
  markMet: {
    color: COLORS.success,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  wrap: {
    gap: 4,
    marginTop: 8,
  },
});
