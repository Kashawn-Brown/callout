import { Link } from 'expo-router';
import { useCallback, useState, type ReactElement } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorBanner } from '@/components/ErrorBanner';
import { FormField } from '@/components/FormField';
import { GradientButton } from '@/components/GradientButton';
import { signInWithEmail } from '@/features/auth/api';
import { COLORS, FONTS, SPACING } from '@/lib/theme';

export default function SignInScreen(): ReactElement {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !submitting;

  const handleSignIn = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    const result = await signInWithEmail(email, password);
    if (result.error) {
      setError(result.error.message);
      setSubmitting(false);
    }
    // On success the root layout's session guard swaps to the (app) group; no manual navigation, and no setState on this soon-unmounted screen.
  }, [email, password]);

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
        <Text style={styles.brand}>Callout</Text>
        <Text style={styles.tagline}>You&apos;re on the clock 🔥</Text>

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
          <FormField
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="Your password"
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
          />

          {error !== null && <ErrorBanner message={error} />}

          <GradientButton
            label={submitting ? 'Signing in…' : 'Sign In'}
            onPress={handleSignIn}
            disabled={!canSubmit}
          />
        </View>

        <View style={styles.switchRow}>
          <Text style={styles.switchText}>New here? </Text>
          <Link href="/sign-up" style={styles.switchLink}>
            Create an account
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
    fontSize: 40,
    letterSpacing: -1.5,
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
