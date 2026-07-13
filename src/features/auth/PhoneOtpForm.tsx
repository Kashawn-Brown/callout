import { useCallback, useState, type ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FormField } from '@/components/FormField';
import { GradientButton } from '@/components/GradientButton';
import { normalizePhone, verifyPhoneOtp, type AuthResult } from '@/features/auth/api';
import { COLORS, FONTS } from '@/lib/theme';

const OTP_LENGTH = 6;

type PhoneOtpFormProps = {
  /** Sends the SMS code for the entered number — sign-up and sign-in differ only here (metadata vs. shouldCreateUser). */
  onSend: (phone: string) => Promise<AuthResult>;
  onError: (message: string | null) => void;
  /** Blocks the send button while the surrounding form is incomplete (e.g. sign-up's display name). */
  sendDisabled?: boolean;
};

/** Shared two-stage phone OTP flow (D037): enter a number, get an SMS code, verify. On successful verification a session exists and the root layout's guard swaps route groups — no navigation here. */
export function PhoneOtpForm({ onSend, onError, sendDisabled }: PhoneOtpFormProps): ReactElement {
  const [phoneInput, setPhoneInput] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSend = useCallback(async () => {
    const normalized = normalizePhone(phoneInput);
    if (!normalized) {
      onError('Enter a phone number with country code, like +1 555 012 3456.');
      return;
    }
    setBusy(true);
    onError(null);
    const result = await onSend(normalized);
    setBusy(false);
    if (result.error) {
      onError(result.error.message);
      return;
    }
    setSentTo(normalized);
    setCode('');
  }, [phoneInput, onSend, onError]);

  const handleVerify = useCallback(async () => {
    if (!sentTo) {
      return;
    }
    setBusy(true);
    onError(null);
    const result = await verifyPhoneOtp(sentTo, code);
    setBusy(false);
    if (result.error) {
      onError(result.error.message);
    }
    // On success the session guard swaps to the (app) group; this component unmounts.
  }, [sentTo, code, onError]);

  if (sentTo === null) {
    return (
      <View style={styles.stack}>
        <FormField
          label="Phone Number"
          value={phoneInput}
          onChangeText={setPhoneInput}
          placeholder="+1 555 012 3456"
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
        />
        <GradientButton
          label={busy ? 'Sending code…' : 'Send Code'}
          onPress={handleSend}
          disabled={busy || sendDisabled === true || phoneInput.trim().length === 0}
        />
      </View>
    );
  }

  return (
    <View style={styles.stack}>
      <FormField
        label={`Code sent to ${sentTo}`}
        value={code}
        onChangeText={setCode}
        placeholder="6-digit code"
        keyboardType="number-pad"
        maxLength={OTP_LENGTH}
        autoComplete="sms-otp"
        textContentType="oneTimeCode"
      />
      <GradientButton
        label={busy ? 'Verifying…' : 'Verify & Continue'}
        onPress={handleVerify}
        disabled={busy || code.trim().length < OTP_LENGTH}
      />
      <Pressable onPress={() => setSentTo(null)} disabled={busy}>
        <Text style={styles.changeNumber}>Use a different number</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  changeNumber: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 13,
    textAlign: 'center',
  },
  stack: {
    gap: 18,
  },
});
