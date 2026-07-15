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
import { resendSignUpConfirmation, signUpWithEmail, signUpWithPhone } from '@/features/auth/api';
import { PASSWORD_MIN_LENGTH, isPasswordValid } from '@/features/auth/password-policy';
import { PasswordRequirements } from '@/features/auth/PasswordRequirements';
import { PhoneOtpForm } from '@/features/auth/PhoneOtpForm';
import { normalizeJoinCode, stashPendingJoinCode } from '@/features/connections/pending-invite';
import { COLORS, FONTS, SPACING } from '@/lib/theme';

// Mirrors the profile.display_name check constraint (1–50 chars) so validation fails in the form, not in the database trigger.
const DISPLAY_NAME_MAX_LENGTH = 50;

type AuthMethod = 'email' | 'phone';

export default function SignUpScreen(): ReactElement {
  const insets = useSafeAreaInsets();
  const [method, setMethod] = useState<AuthMethod>('email');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [showInviteField, setShowInviteField] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent'>('idle');

  const canSubmit =
    displayName.trim().length > 0 &&
    displayName.trim().length <= DISPLAY_NAME_MAX_LENGTH &&
    email.trim().length > 0 &&
    isPasswordValid(password) &&
    !submitting;

  const displayNameMissing =
    displayName.trim().length === 0 || displayName.trim().length > DISPLAY_NAME_MAX_LENGTH;

  // Stashes a typed group code (D063 — the one invite shape) so the home screen resumes it right after the session exists, opening Join Group pre-filled (D064); returns false when input is present but malformed.
  const stashInviteIfPresent = useCallback(async (): Promise<boolean> => {
    const raw = inviteCode.trim();
    if (raw.length === 0) {
      return true;
    }
    const code = normalizeJoinCode(raw);
    if (!code) {
      setError('That code doesn’t look right — group codes are 8 letters and numbers.');
      return false;
    }
    await stashPendingJoinCode(code);
    return true;
  }, [inviteCode]);

  const handleSignUp = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    if (!(await stashInviteIfPresent())) {
      setSubmitting(false);
      return;
    }
    // The confirmation link (D070) bounces back to the app root for this exact environment (Expo Go dev URL or callout://); the root layout sets the session from the redirect and signs them straight in.
    const result = await signUpWithEmail(email, password, displayName, Linking.createURL(''));
    if (result.error) {
      setError(result.error.message);
      setSubmitting(false);
      return;
    }
    if (result.needsEmailConfirmation) {
      // Confirmations are on in every environment (D070); a session only exists straight away if a project has them disabled.
      setConfirmationSent(true);
      setSubmitting(false);
    }
    // Otherwise a session now exists and the root layout's guard swaps to the (app) group.
  }, [displayName, email, password, stashInviteIfPresent]);

  const handleResend = useCallback(async () => {
    setResendState('sending');
    const result = await resendSignUpConfirmation(email, Linking.createURL(''));
    if (result.error) {
      setError(result.error.message);
      setResendState('idle');
      return;
    }
    setResendState('sent');
  }, [email]);

  const handlePhoneSend = useCallback(
    async (phone: string) => {
      if (!(await stashInviteIfPresent())) {
        return { error: { code: 'invalid_input', message: 'Fix the invite code first.' } };
      }
      return signUpWithPhone(phone, displayName);
    },
    [displayName, stashInviteIfPresent],
  );

  if (confirmationSent) {
    return (
      <View style={[styles.flex, styles.confirmWrap, { paddingTop: insets.top }]}>
        <Text style={styles.confirmEmoji}>📬</Text>
        <Text style={styles.confirmTitle}>Check your email</Text>
        <Text style={styles.confirmBody}>
          We sent a confirmation link to {email.trim()}. Open it on this device and you’ll be
          signed in automatically.
        </Text>
        {error !== null && <ErrorBanner message={error} />}
        <Pressable onPress={handleResend} disabled={resendState !== 'idle'}>
          <Text style={[styles.switchLink, resendState !== 'idle' && styles.resendDone]}>
            {resendState === 'sent'
              ? 'Sent — check your inbox'
              : resendState === 'sending'
                ? 'Sending…'
                : 'Resend email'}
          </Text>
        </Pressable>
        <Link href="/sign-in" style={[styles.switchLink, styles.backLink]}>
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
        <Text style={styles.brand}>Join Callout</Text>
        <Text style={styles.tagline}>Set up your account — your crew is waiting</Text>

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

          <FormField
            label="Display Name"
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="How your group sees you"
            maxLength={DISPLAY_NAME_MAX_LENGTH}
            autoComplete="name"
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
                  placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`}
                  secureTextEntry
                  autoComplete="new-password"
                  textContentType="newPassword"
                />
                {/* D069: mirror the server's password policy inline so weak passwords fail while typing, not on the round-trip. */}
                {password.length > 0 && <PasswordRequirements password={password} />}
              </View>
            </>
          ) : null}

          {showInviteField ? (
            <FormField
              label="Group Code"
              value={inviteCode}
              onChangeText={setInviteCode}
              placeholder="8-character code from a group"
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={8}
            />
          ) : (
            <Pressable onPress={() => setShowInviteField(true)}>
              <Text style={styles.inviteLink}>Have a group code?</Text>
            </Pressable>
          )}

          {error !== null && <ErrorBanner message={error} />}

          {method === 'email' ? (
            <GradientButton
              label={submitting ? 'Creating account…' : 'Create Account'}
              onPress={handleSignUp}
              disabled={!canSubmit}
            />
          ) : (
            // No password on the phone path (D037): the SMS code is the whole credential.
            <PhoneOtpForm
              onSend={handlePhoneSend}
              onError={setError}
              sendDisabled={displayNameMissing}
            />
          )}
        </View>

        <View style={styles.switchRow}>
          <Text style={styles.switchText}>Already have an account? </Text>
          <Link href="/sign-in" style={styles.switchLink}>
            Sign in
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  backLink: {
    marginTop: 16,
  },
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
  inviteLink: {
    color: COLORS.invite,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 13,
  },
  resendDone: {
    opacity: 0.6,
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
