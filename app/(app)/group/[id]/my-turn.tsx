import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState, type ReactElement } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { BackButton } from '@/components/BackButton';
import { CountdownRing } from '@/components/CountdownRing';
import { ErrorBanner } from '@/components/ErrorBanner';
import { GradientButton } from '@/components/GradientButton';
import { useSession } from '@/features/auth/SessionProvider';
import { submitTurn } from '@/features/groups/api';
import { useCountdown } from '@/features/groups/useCountdown';
import { useGroupDetail } from '@/features/groups/useGroupDetail';
import { parseIntervalToMinutes, timeAgoLabel } from '@/lib/format';
import { serverNow } from '@/lib/server-time';
import { MAX_SUBMISSION_LENGTH } from '@/types/api';
import { COLORS, FONTS, RADII, SPACING } from '@/lib/theme';

const COUNTER_WARNING_THRESHOLD = 100;

export default function MyTurnScreen(): ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useSession();
  const { detail, isLoading, error, refetch } = useGroupDetail(id ?? null);

  const [update, setUpdate] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [roundCompleted, setRoundCompleted] = useState(false);

  const userId = session?.user.id ?? null;
  const myTurn =
    detail?.activeTurn !== null && detail?.activeTurn.called_out_user_id === userId
      ? detail.activeTurn
      : null;
  const windowMinutes = detail ? parseIntervalToMinutes(detail.group.per_turn_deadline) : null;
  const countdown = useCountdown(myTurn?.deadline_at ?? null, windowMinutes);

  const handleSubmit = useCallback(async () => {
    if (!myTurn || !detail) {
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);
    const result = await submitTurn({ target_turn_id: myTurn.id, submission_text: update.trim() });
    setIsSubmitting(false);
    if (result.error) {
      // deadline_passed and turn_not_pending mean the server already moved on (D029) — refetch so the screen reflects reality alongside the message.
      setSubmitError(result.error.message);
      refetch();
      return;
    }
    if (result.data.handoff_required) {
      router.replace(`/group/${detail.group.id}/pick-next?turnId=${myTurn.id}`);
    } else {
      setRoundCompleted(true);
    }
  }, [myTurn, detail, update, router, refetch]);

  if (isLoading || detail === null) {
    return (
      <View style={[styles.flex, styles.centerWrap, { paddingTop: insets.top }]}>
        {error !== null ? (
          <ErrorBanner message={error} />
        ) : (
          <ActivityIndicator color={COLORS.ember} />
        )}
      </View>
    );
  }

  if (roundCompleted) {
    return (
      <View style={[styles.flex, styles.centerWrap, { paddingTop: insets.top }]}>
        <Text style={styles.doneEmoji}>🏁</Text>
        <Text style={styles.doneTitle}>Round complete!</Text>
        <Text style={styles.doneSub}>
          Everyone’s had their turn — a new round is already starting.
        </Text>
        <Pressable
          onPress={() => router.dismissTo(`/group/${detail.group.id}`)}
          style={({ pressed }) => [styles.plainButton, pressed && styles.pressed]}
        >
          <Text style={styles.plainButtonLabel}>Back to Group</Text>
        </Pressable>
      </View>
    );
  }

  if (myTurn === null) {
    return (
      <View style={[styles.flex, styles.centerWrap, { paddingTop: insets.top }]}>
        <Text style={styles.doneEmoji}>😌</Text>
        <Text style={styles.doneTitle}>Not your turn</Text>
        <Text style={styles.doneSub}>
          Nothing to do here right now — you’ll see it on the home screen the moment you’re called
          out.
        </Text>
        <Pressable
          onPress={() => router.dismissTo(`/group/${detail.group.id}`)}
          style={({ pressed }) => [styles.plainButton, pressed && styles.pressed]}
        >
          <Text style={styles.plainButtonLabel}>Back to Group</Text>
        </Pressable>
      </View>
    );
  }

  const prevItem = detail.activity[0] ?? null;
  const prevAuthor = prevItem
    ? detail.members.find((m) => m.userId === prevItem.authorId)
    : undefined;
  const remaining = MAX_SUBMISSION_LENGTH - update.length;
  const caller = detail.members.find((m) => m.userId === myTurn.called_by_user_id);

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <BackButton />
          <Text style={styles.headerGroup}>{detail.group.name}</Text>
          <View style={styles.headerSpacer} />
        </View>

        {(error !== null || submitError !== null) && (
          <View style={styles.bannerWrap}>
            <ErrorBanner message={submitError ?? error ?? ''} />
          </View>
        )}

        {/* You're up hero */}
        <View style={styles.hero}>
          <Text style={styles.heroLabel}>
            {caller
              ? `🔥 ${caller.displayName.split(/\s+/)[0]} called you out`
              : '🔥 You’ve been called out'}
          </Text>
          <CountdownRing
            timeLabel={countdown.label}
            pct={countdown.pct}
            size={130}
            urgent={countdown.urgent}
          />
          <Text style={styles.heroTitle}>You’re Up!</Text>
          <Text style={styles.heroSub}>Share what’s on your mind right now</Text>
        </View>

        {/* Previous turn context */}
        {prevItem !== null && (
          <View style={styles.prevCard}>
            <View style={styles.prevHeader}>
              <Avatar
                initials={prevAuthor?.initials ?? '?'}
                color={prevAuthor?.color ?? COLORS.textSecondary}
                size={28}
              />
              <Text style={styles.prevMeta}>
                <Text
                  style={[styles.prevName, { color: prevAuthor?.color ?? COLORS.textSecondary }]}
                >
                  {prevAuthor?.displayName.split(/\s+/)[0] ?? 'Former member'}
                </Text>
                <Text style={styles.prevTime}>
                  {' '}
                  shared · {timeAgoLabel(prevItem.submittedAt, serverNow().getTime())}
                </Text>
              </Text>
            </View>
            <Text style={styles.prevText}>{prevItem.text}</Text>
          </View>
        )}

        {/* Composer */}
        <View style={[styles.composer, update.length > 0 && styles.composerActive]}>
          <TextInput
            value={update}
            onChangeText={(text) => setUpdate(text.slice(0, MAX_SUBMISSION_LENGTH))}
            placeholder="What's going on in your world? Share something — a thought, a moment, a question for the group…"
            placeholderTextColor={COLORS.textMuted}
            multiline
            style={styles.composerInput}
          />
          <View style={styles.composerFooter}>
            <Text style={styles.composerHint}>Keep it real ✨</Text>
            <Text
              style={[
                styles.composerCount,
                remaining < COUNTER_WARNING_THRESHOLD && styles.composerCountWarning,
              ]}
            >
              {remaining}
            </Text>
          </View>
        </View>

        <GradientButton
          label={
            isSubmitting
              ? 'Submitting…'
              : countdown.expired
                ? 'Time’s up'
                : update.trim()
                  ? 'Submit & Pick Next →'
                  : 'Write something first…'
          }
          onPress={handleSubmit}
          disabled={!update.trim() || isSubmitting || countdown.expired}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  bannerWrap: {
    marginBottom: 16,
  },
  centerWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  composer: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: RADII.card,
    borderWidth: 1.5,
    marginBottom: 16,
    padding: 16,
  },
  composerActive: {
    borderColor: 'rgba(123,97,255,0.5)',
  },
  composerCount: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.display,
    fontSize: 12,
  },
  composerCountWarning: {
    color: COLORS.warning,
  },
  composerFooter: {
    alignItems: 'center',
    borderTopColor: COLORS.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 10,
  },
  composerHint: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.body,
    fontSize: 12,
  },
  composerInput: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.body,
    fontSize: 15,
    lineHeight: 24,
    minHeight: 120,
    textAlignVertical: 'top',
  },
  container: {
    paddingHorizontal: SPACING.screenX,
  },
  doneEmoji: {
    fontSize: 40,
    marginBottom: 12,
  },
  doneSub: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.body,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 32,
    textAlign: 'center',
  },
  doneTitle: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.displayBlack,
    fontSize: 26,
    letterSpacing: -1,
    marginBottom: 8,
    textAlign: 'center',
  },
  flex: {
    backgroundColor: COLORS.background,
    flex: 1,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 16,
    paddingHorizontal: 4,
  },
  headerGroup: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 12,
  },
  headerSpacer: {
    width: 36,
  },
  hero: {
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderColor: 'rgba(255,78,58,0.3)',
    borderRadius: 28,
    borderWidth: 1,
    marginBottom: 20,
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  heroLabel: {
    color: COLORS.ember,
    fontFamily: FONTS.display,
    fontSize: 11,
    letterSpacing: 1.8,
    marginBottom: 16,
    textTransform: 'uppercase',
  },
  heroSub: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.body,
    fontSize: 13,
    marginTop: 6,
  },
  heroTitle: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.displayBlack,
    fontSize: 30,
    letterSpacing: -1.2,
    marginTop: 16,
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
  prevCard: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: RADII.card,
    borderWidth: 1,
    marginBottom: 16,
    padding: 14,
  },
  prevHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  prevMeta: {
    fontSize: 12,
  },
  prevName: {
    fontFamily: FONTS.bodyBold,
    fontSize: 12,
  },
  prevText: {
    color: COLORS.textBody,
    fontFamily: FONTS.body,
    fontSize: 13,
    lineHeight: 19,
  },
  prevTime: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.body,
    fontSize: 12,
  },
});
