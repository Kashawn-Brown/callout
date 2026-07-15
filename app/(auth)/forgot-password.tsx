import * as Linking from 'expo-linking';
import { Link } from 'expo-router';
import { useCallback, useState, type ReactElement } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorBanner } from '@/components/ErrorBanner';
import { FormField } from '@/components/FormField';
import { GradientButton } from '@/components/GradientButton';
import { requestPasswordReset } from '@/features/auth/api';
import { COLORS, FONTS, SPACING } from '@/lib/theme';

/** Entry point of the password-reset flow (D068): sends the recovery email, whose link comes back into the app as a deep link and lands on the reset screen via the root layout's recovery guard. */
export default function ForgotPasswordScreen(): ReactElement {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const canSubmit = email.trim().length > 0 && !submitting;

  const handleSend = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    // The link must bounce back to this exact environment (Expo Go dev URL or the callout:// scheme), so the target is built at call time rather than hardcoded.
    const result = await requestPasswordReset(email, Linking.createURL('reset-password'));
    setSubmitting(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setSent(true);
  }, [email]);

  if (sent) {
    return (
      <View style={[styles.flex, styles.confirmWrap, { paddingTop: insets.top }]}>
        <Text style={styles.confirmEmoji}>📬</Text>
        <Text style={styles.confirmTitle}>Check your email</Text>
        <Text style={styles.confirmBody}>
          If an account exists for {email.trim()}, a reset link is on its way. Open it on this
          device and you’ll be brought right back here to set a new password.
        </Text>
        <Link href="/sign-in" style={styles.switchLink}>
          Back to sign in
        </Link>
      </View>
    );
  }

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
        <Text style={styles.brand}>Reset password</Text>
        <Text style={styles.tagline}>
          Enter your account’s email and we’ll send you a reset link.
        </Text>

        <View style={styles.form}>
          <FormField
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
          />

          {error !== null && <ErrorBanner message={error} />}

          <GradientButton
            label={submitting ? 'Sending…' : 'Send Reset Link'}
            onPress={handleSend}
            disabled={!canSubmit}
          />
        </View>

        <View style={styles.switchRow}>
          <Text style={styles.switchText}>Remembered it? </Text>
          <Link href="/sign-in" style={styles.switchLink}>
            Sign in
          </Link>
        </View>
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
  confirmBody: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.body,
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 28,
    marginTop: 8,
    textAlign: 'center',
  },
  confirmEmoji: {
    fontSize: 40,
    marginBottom: 12,
  },
  confirmTitle: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.displayBlack,
    fontSize: 26,
    letterSpacing: -1,
  },
  confirmWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: SPACING.contentX,
  },
  flex: {
    backgroundColor: COLORS.background,
    flex: 1,
  },
  form: {
    gap: 18,
    marginTop: 40,
  },
  switchLink: {
    color: COLORS.invite,
    fontFamily: FONTS.bodyBold,
    fontSize: 14,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 28,
  },
  switchText: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.body,
    fontSize: 14,
  },
  tagline: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.body,
    fontSize: 14,
    marginTop: 6,
  },
});
