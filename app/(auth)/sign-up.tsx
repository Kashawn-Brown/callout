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
import { signUpWithEmail, signUpWithPhone } from '@/features/auth/api';
import { PhoneOtpForm } from '@/features/auth/PhoneOtpForm';
import { classifyInviteInput, stashPendingInvite } from '@/features/connections/pending-invite';
import { COLORS, FONTS, SPACING } from '@/lib/theme';

// Mirrors the profile.display_name check constraint (1–50 chars) so validation fails in the form, not in the database trigger.
const DISPLAY_NAME_MAX_LENGTH = 50;
const PASSWORD_MIN_LENGTH = 6;

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

  const canSubmit =
    displayName.trim().length > 0 &&
    displayName.trim().length <= DISPLAY_NAME_MAX_LENGTH &&
    email.trim().length > 0 &&
    password.length >= PASSWORD_MIN_LENGTH &&
    !submitting;

  const displayNameMissing =
    displayName.trim().length === 0 || displayName.trim().length > DISPLAY_NAME_MAX_LENGTH;

  // Stashes a typed invite (a 16-character share token or an 8-character group code — D052's two shapes) so the home screen resumes it right after the session exists; returns false when input is present but malformed.
  const stashInviteIfPresent = useCallback(async (): Promise<boolean> => {
    const raw = inviteCode.trim();
    if (raw.length === 0) {
      return true;
    }
    const invite = classifyInviteInput(raw);
    if (!invite) {
      setError('That code doesn’t look right — invite links use 16 characters, group codes use 8.');
      return false;
    }
    await stashPendingInvite(invite);
    return true;
  }, [inviteCode]);

  const handleSignUp = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    if (!(await stashInviteIfPresent())) {
      setSubmitting(false);
      return;
    }
    const result = await signUpWithEmail(email, password, displayName);
    if (result.error) {
      setError(result.error.message);
      setSubmitting(false);
      return;
    }
    if (result.needsEmailConfirmation) {
      // Local dev has confirmations off, but a hosted project may require them — without this branch the screen would just sit there after a successful sign-up.
      setConfirmationSent(true);
      setSubmitting(false);
    }
    // Otherwise a session now exists and the root layout's guard swaps to the (app) group.
  }, [displayName, email, password, stashInviteIfPresent]);

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
          We sent a confirmation link to {email.trim()}. Confirm it, then come back and sign in.
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
              <FormField
                label="Password"
                value={password}
                onChangeText={setPassword}
                placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`}
                secureTextEntry
                autoComplete="new-password"
                textContentType="newPassword"
              />
            </>
          ) : null}

          {showInviteField ? (
            <FormField
              label="Invite or Group Code"
              value={inviteCode}
              onChangeText={setInviteCode}
              placeholder="Code from a friend or a group"
              autoCapitalize="characters"
              autoCorrect={false}
            />
          ) : (
            <Pressable onPress={() => setShowInviteField(true)}>
              <Text style={styles.inviteLink}>Have an invite code?</Text>
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
