import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackButton } from '@/components/BackButton';
import { ErrorBanner } from '@/components/ErrorBanner';
import { GradientButton } from '@/components/GradientButton';
import { normalizeJoinCode } from '@/features/connections/pending-invite';
import { joinGroupByCode } from '@/features/groups/api';
import { COLORS, FONTS, RADII, SPACING } from '@/lib/theme';
import type { JoinGroupByCodeResult } from '@/types/api';

/** Join a group by its persistent code (D050/D051): instant entry while the group is in setup, a host-approved request once it has started. Reached from the bottom nav, or by an open share link with ?code= (D052). */
export default function JoinGroupScreen(): ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { code: codeParam } = useLocalSearchParams<{ code?: string }>();

  const [codeInput, setCodeInput] = useState(codeParam ?? '');
  const [outcome, setOutcome] = useState<JoinGroupByCodeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const autoSubmitted = useRef(false);

  const handleJoin = useCallback(
    async (raw: string) => {
      const code = normalizeJoinCode(raw);
      if (!code) {
        setError('Group codes are 8 letters and numbers — double-check it and try again.');
        return;
      }
      setIsJoining(true);
      setError(null);
      const result = await joinGroupByCode({ code });
      setIsJoining(false);
      if (result.error) {
        setError(result.error.message);
        return;
      }
      setOutcome(result.data);
    },
    [],
  );

  // An open share link lands here with the code already in the URL (D052/D053): submit it once without requiring a retype.
  useEffect(() => {
    if (codeParam && !autoSubmitted.current) {
      autoSubmitted.current = true;
      void handleJoin(codeParam);
    }
  }, [codeParam, handleJoin]);

  if (outcome !== null && outcome.status === 'joined') {
    return (
      <View style={[styles.flex, styles.resultWrap, { paddingTop: insets.top }]}>
        <Text style={styles.resultEmoji}>🎉</Text>
        <Text style={styles.resultTitle}>You’re in {outcome.group_name}!</Text>
        <Text style={styles.resultSub}>The game hasn’t started yet — you’re on the roster.</Text>
        <View style={styles.resultButtonWrap}>
          <GradientButton
            label="Go to Group →"
            onPress={() => router.dismissTo(`/group/${outcome.group_id}`)}
            variant="invite"
          />
        </View>
      </View>
    );
  }

  if (outcome !== null) {
    return (
      <View style={[styles.flex, styles.resultWrap, { paddingTop: insets.top }]}>
        <Text style={styles.resultEmoji}>🙋</Text>
        <Text style={styles.resultTitle}>Request sent</Text>
        <Text style={styles.resultSub}>
          {outcome.group_name} is already playing, so the host needs to let you in. You’ll see the
          group on your home screen once they approve.
        </Text>
        <Pressable
          onPress={() => router.dismissTo('/')}
          style={({ pressed }) => [styles.plainButton, pressed && styles.pressed]}
        >
          <Text style={styles.plainButtonLabel}>Back to Home</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <BackButton />
        <Text style={styles.title}>Join a Group</Text>
      </View>

      {error !== null && (
        <View style={styles.section}>
          <ErrorBanner message={error} />
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.hint}>
          Every group has an 8-character code. Get it from the host (or anyone in the group) and
          enter it here — if the game hasn’t started you’re in right away; otherwise the host
          approves your request.
        </Text>
        <TextInput
          value={codeInput}
          onChangeText={setCodeInput}
          placeholder="GROUP CODE"
          placeholderTextColor={COLORS.textMuted}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={8}
          style={styles.codeInput}
        />
        <GradientButton
          label={isJoining ? 'Joining…' : 'Join Group'}
          onPress={() => handleJoin(codeInput)}
          disabled={isJoining || codeInput.trim().length < 8}
          variant="invite"
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  codeInput: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: 14,
    borderWidth: 1.5,
    color: COLORS.textPrimary,
    fontFamily: FONTS.display,
    fontSize: 20,
    letterSpacing: 6,
    marginBottom: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    textAlign: 'center',
  },
  flex: {
    backgroundColor: COLORS.background,
    flex: 1,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingBottom: 24,
    paddingHorizontal: SPACING.contentX,
  },
  hint: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.body,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 16,
  },
  plainButton: {
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: RADII.button,
    borderWidth: 1,
    maxWidth: 280,
    paddingVertical: 14,
    width: '100%',
  },
  plainButtonLabel: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.display,
    fontSize: 15,
  },
  pressed: {
    opacity: 0.8,
  },
  resultButtonWrap: {
    maxWidth: 280,
    width: '100%',
  },
  resultEmoji: {
    fontSize: 40,
    marginBottom: 8,
  },
  resultSub: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.body,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 32,
    textAlign: 'center',
  },
  resultTitle: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.displayBlack,
    fontSize: 26,
    letterSpacing: -1,
    marginBottom: 8,
    textAlign: 'center',
  },
  resultWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  section: {
    paddingBottom: 24,
    paddingHorizontal: SPACING.contentX,
  },
  title: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.displayExtraBold,
    fontSize: 22,
    letterSpacing: -0.6,
  },
});
