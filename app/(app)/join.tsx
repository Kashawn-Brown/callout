import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { Avatar } from '@/components/Avatar';
import { ErrorBanner } from '@/components/ErrorBanner';
import { GradientButton } from '@/components/GradientButton';
import { IconButton } from '@/components/IconButton';
import { respondToInvite } from '@/features/groups/api';
import { useHomeData } from '@/features/groups/useHomeData';
import { deadlineLabel, parseIntervalToMinutes } from '@/lib/format';
import { COLORS, FONTS, GRADIENTS, RADII, SPACING } from '@/lib/theme';

type InviteDecision = 'accepted' | 'declined' | null;

export default function JoinScreen(): ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { groupId } = useLocalSearchParams<{ groupId?: string }>();
  const { data, isLoading, error: loadError } = useHomeData();

  const [decision, setDecision] = useState<InviteDecision>(null);
  const [error, setError] = useState<string | null>(null);
  const [isResponding, setIsResponding] = useState(false);

  // A specific invite when deep-linked from the home banner, otherwise the first pending one (D025 gives an invited user the group row and roster to evaluate it).
  const invite = data?.invites.find((i) => i.group.id === groupId) ?? data?.invites[0] ?? null;

  const respond = useCallback(
    async (accept: boolean) => {
      if (!invite) {
        return;
      }
      setIsResponding(true);
      setError(null);
      const result = await respondToInvite({ target_group_id: invite.group.id, accept });
      setIsResponding(false);
      if (result.error) {
        setError(result.error.message);
        return;
      }
      setDecision(accept ? 'accepted' : 'declined');
    },
    [invite],
  );

  if (decision === 'accepted' && invite) {
    return (
      <View style={[styles.flex, styles.resultWrap, { paddingTop: insets.top }]}>
        <Text style={styles.resultEmoji}>🎉</Text>
        <Text style={styles.resultTitle}>You’re in {invite.group.name}!</Text>
        <Text style={styles.resultSub}>Now go check in when it’s your turn</Text>
        <View style={styles.resultButtonWrap}>
          <GradientButton
            label="Go to Group →"
            onPress={() => router.dismissTo(`/group/${invite.group.id}`)}
          />
        </View>
      </View>
    );
  }

  if (decision === 'declined' && invite) {
    return (
      <View style={[styles.flex, styles.resultWrap, { paddingTop: insets.top }]}>
        <Text style={styles.resultEmoji}>👋</Text>
        <Text style={styles.resultTitle}>Invite declined</Text>
        <Text style={styles.resultSub}>
          No worries — {invite.inviterName?.split(/\s+/)[0] ?? 'the host'} won’t be notified
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

  if (isLoading) {
    return (
      <View style={[styles.flex, styles.resultWrap, { paddingTop: insets.top }]}>
        <ActivityIndicator color={COLORS.invite} />
      </View>
    );
  }

  if (!invite) {
    return (
      <View style={[styles.flex, styles.resultWrap, { paddingTop: insets.top }]}>
        <Text style={styles.resultEmoji}>📭</Text>
        <Text style={styles.resultTitle}>No pending invites</Text>
        <Text style={styles.resultSub}>When someone invites you to a group, it shows up here.</Text>
        <Pressable
          onPress={() => router.dismissTo('/')}
          style={({ pressed }) => [styles.plainButton, pressed && styles.pressed]}
        >
          <Text style={styles.plainButtonLabel}>Back to Home</Text>
        </Pressable>
      </View>
    );
  }

  const windowMinutes = parseIntervalToMinutes(invite.group.per_turn_deadline);
  const stats = [
    { label: 'Members', value: String(invite.members.length) },
    { label: 'Deadline', value: windowMinutes !== null ? deadlineLabel(windowMinutes) : '—' },
    { label: 'Status', value: invite.group.status === 'setup' ? 'Starting' : 'Playing' },
  ];

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Close */}
      <View style={styles.closeRow}>
        <IconButton onPress={() => router.back()} accessibilityLabel="Close invite" size={34}>
          <Svg width={12} height={12} viewBox="0 0 12 12" fill="none">
            <Path
              d="M1 1l10 10M11 1L1 11"
              stroke={COLORS.textSecondary}
              strokeWidth={1.8}
              strokeLinecap="round"
            />
          </Svg>
        </IconButton>
      </View>

      <View style={styles.content}>
        {(error !== null || loadError !== null) && (
          <View style={styles.bannerWrap}>
            <ErrorBanner message={error ?? loadError ?? ''} />
          </View>
        )}

        {/* Invited by */}
        {invite.inviterName !== null && (
          <View style={styles.inviterRow}>
            <Text style={styles.inviterText}>
              <Text style={styles.inviterLabel}>Invited by </Text>
              <Text style={styles.inviterName}>{invite.inviterName}</Text>
            </Text>
          </View>
        )}

        {/* Group hero */}
        <View style={styles.heroCard}>
          <LinearGradient
            colors={GRADIENTS.invite}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.heroIcon}
          >
            <Text style={styles.heroIconEmoji}>🏡</Text>
          </LinearGradient>
          <Text style={styles.heroName}>{invite.group.name}</Text>
          <Text style={styles.heroDescription}>An invite-only relay group</Text>

          <View style={styles.statsRow}>
            {stats.map(({ label, value }) => (
              <View key={label} style={styles.stat}>
                <Text style={styles.statValue}>{value}</Text>
                <Text style={styles.statLabel}>{label}</Text>
              </View>
            ))}
          </View>

          <View style={styles.memberStack}>
            {invite.members.map((m, i) => (
              <View
                key={m.userId}
                style={{ marginLeft: i === 0 ? 0 : -10, zIndex: invite.members.length - i }}
              >
                <Avatar initials={m.initials} color={m.color} size={32} />
              </View>
            ))}
          </View>
        </View>

        {/* How it works */}
        <View style={styles.howCard}>
          <View style={styles.howIcon}>
            <Text style={styles.howIconEmoji}>💬</Text>
          </View>
          <View style={styles.howText}>
            <Text style={styles.howTitle}>How Callout works</Text>
            <Text style={styles.howBody}>
              Each person shares a quick update, then passes the turn to someone else. You have{' '}
              {windowMinutes !== null ? deadlineLabel(windowMinutes) : 'a set window'} to respond
              before it auto-advances.
            </Text>
          </View>
        </View>

        {/* Actions */}
        <View style={styles.actionsRow}>
          <Pressable
            onPress={() => respond(false)}
            disabled={isResponding}
            style={({ pressed }) => [styles.declineButton, pressed && styles.pressed]}
          >
            <Text style={styles.declineLabel}>Decline</Text>
          </Pressable>
          <View style={styles.acceptWrap}>
            <GradientButton
              label={isResponding ? 'Joining…' : 'Join Group 🎉'}
              onPress={() => respond(true)}
              disabled={isResponding}
              variant="invite"
            />
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  acceptWrap: {
    flex: 2,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  bannerWrap: {
    marginBottom: 16,
  },
  closeRow: {
    alignItems: 'flex-end',
    paddingBottom: 20,
    paddingHorizontal: SPACING.contentX,
  },
  content: {
    paddingHorizontal: SPACING.contentX,
  },
  declineButton: {
    alignItems: 'center',
    borderColor: COLORS.border,
    borderRadius: RADII.button,
    borderWidth: 1.5,
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 15,
  },
  declineLabel: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.display,
    fontSize: 15,
  },
  flex: {
    backgroundColor: COLORS.background,
    flex: 1,
  },
  heroCard: {
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderColor: 'rgba(123,97,255,0.25)',
    borderRadius: 28,
    borderWidth: 1,
    marginBottom: 20,
    paddingHorizontal: 24,
    paddingVertical: 28,
  },
  heroDescription: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.body,
    fontSize: 13,
    marginBottom: 20,
  },
  heroIcon: {
    alignItems: 'center',
    borderRadius: 22,
    height: 72,
    justifyContent: 'center',
    marginBottom: 16,
    width: 72,
  },
  heroIconEmoji: {
    fontSize: 32,
  },
  heroName: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.displayBlack,
    fontSize: 26,
    letterSpacing: -1,
    marginBottom: 6,
  },
  howBody: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.body,
    fontSize: 12,
    lineHeight: 18,
  },
  howCard: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: RADII.input,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 28,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  howIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(123,97,255,0.15)',
    borderRadius: 10,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  howIconEmoji: {
    fontSize: 16,
  },
  howText: {
    flex: 1,
  },
  howTitle: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.bodyBold,
    fontSize: 13,
    marginBottom: 3,
  },
  inviterLabel: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.body,
    fontSize: 14,
  },
  inviterName: {
    color: COLORS.invite,
    fontFamily: FONTS.bodyBold,
    fontSize: 14,
  },
  inviterRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginBottom: 28,
  },
  inviterText: {
    fontSize: 14,
  },
  memberStack: {
    flexDirection: 'row',
    justifyContent: 'center',
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
  stat: {
    alignItems: 'center',
  },
  statLabel: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 11,
    marginTop: 2,
  },
  statValue: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.displayExtraBold,
    fontSize: 20,
    letterSpacing: -0.4,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 24,
    justifyContent: 'center',
    marginBottom: 20,
  },
});
