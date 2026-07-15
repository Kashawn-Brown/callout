import * as Linking from 'expo-linking';
import { Link } from 'expo-router';
import { useCallback, useState, type ReactElement } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorBanner } from '@/components/ErrorBanner';
import { FormField } from '@/components/FormField';
import { GradientButton } from '@/components/GradientButton';
import { SegmentedToggle } from '@/components/SegmentedToggle';
import { resendSignUpConfirmation, signInWithEmail, signInWithPhone } from '@/features/auth/api';
import { PhoneOtpForm } from '@/features/auth/PhoneOtpForm';
import { COLORS, FONTS, SPACING } from '@/lib/theme';

type AuthMethod = 'email' | 'phone';

export default function SignInScreen(): ReactElement {
  const insets = useSafeAreaInsets();
  const [method, setMethod] = useState<AuthMethod>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent'>('idle');

  const canSubmit = email.trim().length > 0 && password.length > 0 && !submitting;

  const handleSignIn = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    setResendState('idle');
    const result = await signInWithEmail(email, password);
    if (result.error) {
      // Unconfirmed accounts get a plain-language explanation and a resend action instead of GoTrue's raw message (D070).
      setError(
        result.error.code === 'email_not_confirmed'
          ? {
              code: result.error.code,
              message: 'Your email isn’t confirmed yet — open the link we sent you first.',
            }
          : result.error,
      );
      setSubmitting(false);
    }
    // On success the root layout's session guard swaps to the (app) group; no manual navigation, and no setState on this soon-unmounted screen.
  }, [email, password]);

  const handleResendConfirmation = useCallback(async () => {
    setResendState('sending');
    const result = await resendSignUpConfirmation(email, Linking.createURL(''));
    if (result.error) {
      setError(result.error);
      setResendState('idle');
      return;
    }
    setResendState('sent');
  }, [email]);

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
          <SegmentedToggle
            options={[
              { id: 'email', label: 'Email' },
              { id: 'phone', label: 'Phone' },
            ]}
            activeId={method}
            onChange={(id) => {
              setMethod(id as AuthMethod);
              setError(null);
            }}
          />

          {method === 'email' ? (
            <>
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
              <View>
                <FormField
                  label="Password"
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Your password"
                  secureTextEntry
                  autoComplete="current-password"
                  textContentType="password"
                />
                <Link href="/forgot-password" style={styles.forgotLink}>
                  Forgot password?
                </Link>
              </View>

              {error !== null && <ErrorBanner message={error.message} />}
              {error?.code === 'email_not_confirmed' && (
                <Pressable
                  onPress={handleResendConfirmation}
                  disabled={resendState !== 'idle' || email.trim().length === 0}
                >
                  <Text style={styles.resendLink}>
                    {resendState === 'sent'
                      ? 'Sent — check your inbox'
                      : resendState === 'sending'
                        ? 'Sending…'
                        : 'Resend confirmation email'}
                  </Text>
                </Pressable>
              )}

              <GradientButton
                label={submitting ? 'Signing in…' : 'Sign In'}
                onPress={handleSignIn}
                disabled={!canSubmit}
              />
            </>
          ) : (
            <>
              {error !== null && <ErrorBanner message={error.message} />}
              {/* Sign-in never creates an account (shouldCreateUser: false) — a typo'd number errors instead of minting a ghost user (D037). */}
              <PhoneOtpForm
                onSend={signInWithPhone}
                onError={(message) =>
                  setError(message === null ? null : { code: 'auth_error', message })
                }
              />
            </>
          )}
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
  forgotLink: {
    alignSelf: 'flex-end',
    color: COLORS.invite,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 13,
    marginTop: 8,
  },
  form: {
    gap: 18,
    marginTop: 40,
  },
  resendLink: {
    color: COLORS.invite,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 13,
    textAlign: 'center',
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
