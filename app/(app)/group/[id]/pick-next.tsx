import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { Avatar } from '@/components/Avatar';
import { ErrorBanner } from '@/components/ErrorBanner';
import { GradientButton } from '@/components/GradientButton';
import { useSession } from '@/features/auth/SessionProvider';
import { callOutPlayer } from '@/features/groups/api';
import type { MemberView } from '@/features/groups/queries';
import { useCountdown } from '@/features/groups/useCountdown';
import { useGroupDetail } from '@/features/groups/useGroupDetail';
import { deadlineLabel, parseIntervalToMinutes } from '@/lib/format';
import { PICK_WINDOW_MINUTES } from '@/types/api';
import { COLORS, FONTS, RADII, SPACING } from '@/lib/theme';

export default function PickNextScreen(): ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id, turnId } = useLocalSearchParams<{ id: string; turnId?: string }>();
  const { session } = useSession();
  const { detail, isLoading, error } = useGroupDetail(id ?? null);

  const [pickedId, setPickedId] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<MemberView | null>(null);
  const [callError, setCallError] = useState<string | null>(null);
  const [isCalling, setIsCalling] = useState(false);

  const userId = session?.user.id ?? null;

  // The turn being handed off: passed from the submit flow, else this user's submitted turn awaiting hand-off (re-entering after closing the app mid-flow).
  const handoffTurn =
    detail?.turnsThisRound.find((t) =>
      turnId ? t.id === turnId : t.called_out_user_id === userId && t.status === 'submitted',
    ) ?? null;

  // Display mirror of the fairness window (D014): only active members with no turn this round appear, minus the picker. The server enforces the same rule in call_out_player — this list can never offer an ineligible target, and there is no override.
  const eligible =
    detail?.members.filter(
      (m) =>
        m.status === 'active' &&
        m.userId !== userId &&
        !detail.turnsThisRound.some((t) => t.called_out_user_id === m.userId),
    ) ?? [];

  const windowMinutes = detail ? parseIntervalToMinutes(detail.group.per_turn_deadline) : null;
  const windowLabel = windowMinutes !== null ? deadlineLabel(windowMinutes) : 'their window';
  const picked = eligible.find((m) => m.userId === pickedId) ?? null;

  // After submission the turn's deadline_at IS the five-minute pick window (D042); when it lapses the job system-picks and this screen's error paths take over.
  const pickCountdown = useCountdown(handoffTurn?.deadline_at ?? null, PICK_WINDOW_MINUTES);

  // Plain function rather than useCallback: `picked` derives from the fetched roster each render, so manual memoization cannot be preserved (react-hooks/preserve-manual-memoization) and nothing downstream needs a stable reference.
  const handleCallOut = async (): Promise<void> => {
    if (!picked || !handoffTurn) {
      return;
    }
    setIsCalling(true);
    setCallError(null);
    const result = await callOutPlayer({
      target_turn_id: handoffTurn.id,
      target_user_id: picked.userId,
    });
    setIsCalling(false);
    if (result.error) {
      // deadline_passed / handoff_already_made mean the system picked first (D029) — surface it; the group screen shows who is actually up.
      setCallError(result.error.message);
      return;
    }
    setSentTo(picked);
  };

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

  if (sentTo !== null) {
    return (
      <View style={[styles.flex, styles.sentWrap, { paddingTop: insets.top }]}>
        <View style={styles.sentBadge}>
          <Svg width={36} height={36} viewBox="0 0 36 36" fill="none">
            <Path
              d="M8 18l7 7 13-13"
              stroke={COLORS.success}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </View>
        <Text style={styles.sentTitle}>Callout sent!</Text>
        <Text style={styles.sentSub}>
          {sentTo.displayName.split(/\s+/)[0]} is now on the clock ⏱
        </Text>

        <View style={styles.sentCard}>
          <Avatar
            initials={sentTo.initials}
            color={sentTo.color}
            size={44}
            ring
            ringColor={COLORS.success}
          />
          <View>
            <Text style={styles.sentCardName}>{sentTo.displayName}</Text>
            <Text style={styles.sentCardNote}>Has {windowLabel} to respond</Text>
          </View>
        </View>

        <Pressable
          onPress={() => router.dismissTo(`/group/${detail.group.id}`)}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <Text style={styles.backButtonLabel}>Back to Group</Text>
        </Pressable>
      </View>
    );
  }

  if (handoffTurn === null) {
    return (
      <View style={[styles.flex, styles.sentWrap, { paddingTop: insets.top }]}>
        <Text style={styles.sentEmoji}>⏱</Text>
        <Text style={styles.sentTitle}>Nothing to hand off</Text>
        <Text style={styles.sentSub}>
          The relay has already moved on — check the group to see who’s up.
        </Text>
        <Pressable
          onPress={() => router.dismissTo(`/group/${detail.group.id}`)}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <Text style={styles.backButtonLabel}>Back to Group</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Posted chip + heading */}
      <View style={styles.headerBlock}>
        <View style={styles.postedChip}>
          <Svg width={12} height={12} viewBox="0 0 12 12" fill="none">
            <Path
              d="M2 6l3 3 5-5"
              stroke={COLORS.success}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
          <Text style={styles.postedChipText}>Update posted</Text>
        </View>
        <Text style={styles.title}>Who’s up next?</Text>
        <Text style={styles.subtitle}>Pick someone from {detail.group.name} to call out</Text>
        <Text style={[styles.pickWindowNote, pickCountdown.urgent && styles.pickWindowNoteUrgent]}>
          {pickCountdown.expired
            ? 'Time’s up — the system is picking someone for you'
            : `Pick within ${pickCountdown.label} or the system picks for you`}
        </Text>
      </View>

      {callError !== null && (
        <View style={styles.bannerWrap}>
          <ErrorBanner message={callError} />
        </View>
      )}

      {/* Eligible members — the fairness-filtered pool (D014) */}
      <View style={styles.memberList}>
        {eligible.map((m) => {
          const isPicked = pickedId === m.userId;
          return (
            <Pressable
              key={m.userId}
              onPress={() => setPickedId(isPicked ? null : m.userId)}
              style={[
                styles.memberCard,
                isPicked && { backgroundColor: `${m.color}12`, borderColor: m.color },
              ]}
            >
              <Avatar initials={m.initials} color={m.color} size={48} ring={isPicked} />
              <View style={styles.memberInfo}>
                <Text style={styles.memberName}>{m.displayName}</Text>
                <Text style={styles.memberNote}>Hasn’t gone this round</Text>
              </View>
              <View
                style={[styles.radio, isPicked && { backgroundColor: m.color, borderWidth: 0 }]}
              >
                {isPicked && (
                  <Svg width={13} height={13} viewBox="0 0 13 13" fill="none">
                    <Path
                      d="M2.5 6.5l3 3 5-5"
                      stroke={COLORS.white}
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </Svg>
                )}
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* Call out */}
      <View style={styles.ctaWrap}>
        <GradientButton
          label={
            isCalling
              ? 'Calling out…'
              : picked
                ? `Call Out ${picked.displayName.split(/\s+/)[0]} 🔥`
                : 'Select someone first'
          }
          onPress={handleCallOut}
          disabled={!picked || isCalling}
        />
        <Text style={styles.ctaNote}>
          They’ll see it in the app and have {windowLabel} to respond
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  backButton: {
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: RADII.button,
    borderWidth: 1,
    maxWidth: 300,
    paddingVertical: 15,
    width: '100%',
  },
  backButtonLabel: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.display,
    fontSize: 15,
  },
  bannerWrap: {
    paddingBottom: 16,
    paddingHorizontal: SPACING.screenX,
  },
  centerWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  ctaNote: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.body,
    fontSize: 12,
    marginTop: 12,
    textAlign: 'center',
  },
  ctaWrap: {
    paddingHorizontal: SPACING.screenX,
    paddingTop: 24,
  },
  flex: {
    backgroundColor: COLORS.background,
    flex: 1,
  },
  headerBlock: {
    paddingBottom: 24,
    paddingHorizontal: SPACING.contentX,
  },
  memberCard: {
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: RADII.card,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 14,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  memberInfo: {
    flex: 1,
  },
  memberList: {
    gap: 10,
    paddingHorizontal: SPACING.screenX,
  },
  memberName: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.display,
    fontSize: 17,
    letterSpacing: -0.3,
  },
  memberNote: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.body,
    fontSize: 12,
    marginTop: 2,
  },
  pickWindowNote: {
    color: COLORS.textMuted,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 12,
    marginTop: 10,
  },
  pickWindowNoteUrgent: {
    color: COLORS.warning,
  },
  postedChip: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(0,212,170,0.1)',
    borderColor: 'rgba(0,212,170,0.25)',
    borderRadius: RADII.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  postedChipText: {
    color: COLORS.success,
    fontFamily: FONTS.display,
    fontSize: 11,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  pressed: {
    opacity: 0.8,
  },
  radio: {
    alignItems: 'center',
    borderColor: COLORS.border,
    borderRadius: 13,
    borderWidth: 2,
    height: 26,
    justifyContent: 'center',
    width: 26,
  },
  sentBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,212,170,0.15)',
    borderColor: 'rgba(0,212,170,0.4)',
    borderRadius: 40,
    borderWidth: 2,
    height: 80,
    justifyContent: 'center',
    marginBottom: 20,
    width: 80,
  },
  sentCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,212,170,0.08)',
    borderColor: 'rgba(0,212,170,0.2)',
    borderRadius: RADII.card,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 32,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  sentCardName: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.display,
    fontSize: 16,
  },
  sentCardNote: {
    color: COLORS.success,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 12,
    marginTop: 2,
  },
  sentEmoji: {
    fontSize: 40,
    marginBottom: 12,
  },
  sentSub: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.body,
    fontSize: 14,
    marginBottom: 28,
    textAlign: 'center',
  },
  sentTitle: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.displayBlack,
    fontSize: 28,
    letterSpacing: -1.1,
    marginBottom: 8,
    textAlign: 'center',
  },
  sentWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  subtitle: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.body,
    fontSize: 14,
    marginTop: 6,
  },
  title: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.displayBlack,
    fontSize: 28,
    letterSpacing: -1.1,
    lineHeight: 31,
  },
});
