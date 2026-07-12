import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState, type ReactElement } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { Avatar } from '@/components/Avatar';
import { GradientButton } from '@/components/GradientButton';
import { IconButton } from '@/components/IconButton';
import { getPlaceholderMember } from '@/lib/placeholder-data';
import { COLORS, FONTS, GRADIENTS, RADII, SPACING } from '@/lib/theme';

// Placeholder invite mirroring the prototype's "Fam Vibes" invite. Phase 3 replaces this with real membership rows in status=invited (D025 grants invited users the group row and roster, nothing else).
const INVITER_ID = 'u3';
const INVITE_MEMBER_IDS = ['u3', 'u4', 'u5'];

type InviteDecision = 'accepted' | 'declined' | null;

export default function JoinScreen(): ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [decision, setDecision] = useState<InviteDecision>(null);

  const inviter = getPlaceholderMember(INVITER_ID);
  const members = INVITE_MEMBER_IDS.map(getPlaceholderMember);

  if (decision === 'accepted') {
    return (
      <View style={[styles.flex, styles.resultWrap, { paddingTop: insets.top }]}>
        <Text style={styles.resultEmoji}>🎉</Text>
        <Text style={styles.resultTitle}>You&apos;re in Fam Vibes!</Text>
        <Text style={styles.resultSub}>Now go check in when it&apos;s your turn</Text>
        <View style={styles.resultButtonWrap}>
          <GradientButton label="Go to Groups →" onPress={() => router.dismissTo('/')} />
        </View>
      </View>
    );
  }

  if (decision === 'declined') {
    return (
      <View style={[styles.flex, styles.resultWrap, { paddingTop: insets.top }]}>
        <Text style={styles.resultEmoji}>👋</Text>
        <Text style={styles.resultTitle}>Invite declined</Text>
        <Text style={styles.resultSub}>No worries — Sam won&apos;t be notified</Text>
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
        {/* Invited by */}
        <View style={styles.inviterRow}>
          <Avatar initials={inviter.initials} color={inviter.color} size={42} ring />
          <Text style={styles.inviterText}>
            <Text style={styles.inviterLabel}>Invited by </Text>
            <Text style={[styles.inviterName, { color: inviter.color }]}>{inviter.name}</Text>
          </Text>
        </View>

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
          <Text style={styles.heroName}>Fam Vibes</Text>
          <Text style={styles.heroDescription}>A cozy check-in group for the squad</Text>

          <View style={styles.statsRow}>
            {[
              { label: 'Members', value: '3' },
              { label: 'Deadline', value: '1 day' },
              { label: 'Rounds', value: '12' },
            ].map(({ label, value }) => (
              <View key={label} style={styles.stat}>
                <Text style={styles.statValue}>{value}</Text>
                <Text style={styles.statLabel}>{label}</Text>
              </View>
            ))}
          </View>

          <View style={styles.memberStack}>
            {members.map((m, i) => (
              <View
                key={m.id}
                style={{ marginLeft: i === 0 ? 0 : -10, zIndex: members.length - i }}
              >
                <Avatar initials={m.initials} color={m.color} size={32} />
              </View>
            ))}
            <View style={styles.moreCircle}>
              <Text style={styles.moreCircleText}>+</Text>
            </View>
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
              Each person shares a quick update, then passes the turn to someone else. You have 1
              day to respond before it auto-advances.
            </Text>
          </View>
        </View>

        {/* Actions — flip local state only; the real accept/decline RPCs arrive in Phase 3 */}
        <View style={styles.actionsRow}>
          <Pressable
            onPress={() => setDecision('declined')}
            style={({ pressed }) => [styles.declineButton, pressed && styles.pressed]}
          >
            <Text style={styles.declineLabel}>Decline</Text>
          </Pressable>
          <View style={styles.acceptWrap}>
            <GradientButton
              label="Join Group 🎉"
              onPress={() => setDecision('accepted')}
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
  moreCircle: {
    alignItems: 'center',
    backgroundColor: COLORS.elevated,
    borderColor: COLORS.border,
    borderRadius: 16,
    borderWidth: 2,
    height: 32,
    justifyContent: 'center',
    marginLeft: -10,
    width: 32,
  },
  moreCircleText: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.display,
    fontSize: 12,
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
