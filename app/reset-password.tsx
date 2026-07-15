import { useCallback, useState, type ReactElement } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorBanner } from '@/components/ErrorBanner';
import { FormField } from '@/components/FormField';
import { GradientButton } from '@/components/GradientButton';
import { updatePassword } from '@/features/auth/api';
import { isPasswordValid } from '@/features/auth/password-policy';
import { PasswordRequirements } from '@/features/auth/PasswordRequirements';
import { useSession } from '@/features/auth/SessionProvider';
import { COLORS, FONTS, SPACING } from '@/lib/theme';

/** Held here by the root layout's recovery guard after a password-reset link established a session (D068). Setting the password — or skipping — clears the guard and lands in the app. */
export default function ResetPasswordScreen(): ReactElement {
  const insets = useSafeAreaInsets();
  const { session, setPasswordRecovery } = useSession();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = isPasswordValid(password) && !submitting;

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    const result = await updatePassword(password);
    if (result.error) {
      setError(result.error.message);
      setSubmitting(false);
      return;
    }
    // Recovery is complete; dropping the flag swaps the guard to the (app) group — already signed in, no extra sign-in step.
    setPasswordRecovery(false);
  }, [password, setPasswordRecovery]);

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingTop: insets.top + 72, paddingBottom: insets.bottom + 32 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.brand}>New password</Text>
        <Text style={styles.tagline}>
          {session?.user.email
            ? `Set a new password for ${session.user.email}.`
            : 'Set a new password for your account.'}
        </Text>

        <FormField
          label="New Password"
          value={password}
          onChangeText={setPassword}
          placeholder="Your new password"
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          style={styles.field}
        />
        <PasswordRequirements password={password} />

        {error !== null && <ErrorBanner message={error} />}

        <GradientButton
          label={submitting ? 'Saving…' : 'Set New Password'}
          onPress={handleSubmit}
          disabled={!canSubmit}
        />

        {/* The recovery link signed them in, so declining to reset is a valid exit — the session is real either way. */}
        <Pressable onPress={() => setPasswordRecovery(false)} style={styles.skipWrap}>
          <Text style={styles.skipLink}>Skip for now</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  brand: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.displayBlack,
    fontSize: 34,
    letterSpacing: -1.2,
  },
  container: {
    flexGrow: 1,
    gap: 18,
    paddingHorizontal: SPACING.contentX,
  },
  field: {
    marginTop: 0,
  },
  flex: {
    backgroundColor: COLORS.background,
    flex: 1,
  },
  skipLink: {
    color: COLORS.invite,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 14,
    textAlign: 'center',
  },
  skipWrap: {
    marginTop: 4,
  },
  tagline: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.body,
    fontSize: 14,
    marginTop: 6,
  },
});
