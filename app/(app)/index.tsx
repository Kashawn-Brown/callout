import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { Avatar } from '@/components/Avatar';
import { BottomNav } from '@/components/BottomNav';
import { ErrorBanner } from '@/components/ErrorBanner';
import { IconButton } from '@/components/IconButton';
import { useProfile } from '@/features/auth/useProfile';
import { useSession } from '@/features/auth/SessionProvider';
import { takePendingInviteToken } from '@/features/connections/pending-invite';
import type { GroupSummary, PendingInvite } from '@/features/groups/queries';
import { useCountdown } from '@/features/groups/useCountdown';
import { useHomeData } from '@/features/groups/useHomeData';
import { initialsOf, memberColor, parseIntervalToMinutes } from '@/lib/format';
import { COLORS, FONTS, GRADIENTS, RADII, SECTION_LABEL, SPACING } from '@/lib/theme';

export default function HomeScreen(): ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session } = useSession();
  const { profile } = useProfile();
  const { data, isLoading, error } = useHomeData();

  const userId = session?.user.id ?? null;
  const summaries = data?.summaries ?? [];
  const invites = data?.invites ?? [];

  const myTurnGroups = summaries.filter((s) => s.activeTurn?.called_out_user_id === userId);
  const otherGroups = summaries.filter((s) => s.activeTurn?.called_out_user_id !== userId);

  const handleAvatarPress = useCallback(() => {
    // Profile & settings live behind the avatar (D040); sign-out moved inside it.
    router.push('/profile');
  }, [router]);

  // A share-invite token stashed before auth (deep link while signed out, or a code typed at sign-up) is claimed the moment the signed-in home appears (D036).
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void takePendingInviteToken().then((token) => {
        if (token && !cancelled) {
          router.push(`/claim-invite?token=${token}`);
        }
      });
      return () => {
        cancelled = true;
      };
    }, [router]),
  );

  return (
    <View style={styles.flex}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: 110 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>Callout</Text>
            <Text style={styles.greeting}>
              Hey {profile?.display_name.split(/\s+/)[0] ?? 'there'} 👋
            </Text>
          </View>
          <View style={styles.headerActions}>
            <IconButton
              onPress={() => router.push('/create-group')}
              accessibilityLabel="Create a new group"
            >
              <Svg width={16} height={16} viewBox="0 0 16 16" fill="none">
                <Path
                  d="M8 3v10M3 8h10"
                  stroke={COLORS.textSecondary}
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              </Svg>
            </IconButton>
            <Pressable onPress={handleAvatarPress} accessibilityLabel="Profile and settings">
              <Avatar
                initials={profile ? initialsOf(profile.display_name) : '?'}
                color={userId ? memberColor(userId) : COLORS.invite}
                size={36}
              />
            </Pressable>
          </View>
        </View>

        {error !== null && (
          <View style={styles.bannerWrap}>
            <ErrorBanner message={error} />
          </View>
        )}

        {isLoading && (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={COLORS.ember} />
          </View>
        )}

        {/* My Turn heroes — the primary in-app "you've been called out" indicator */}
        {myTurnGroups.map((summary) => (
          <MyTurnHero key={summary.group.id} summary={summary} />
        ))}

        {/* Other groups */}
        {otherGroups.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>
              {myTurnGroups.length > 0 ? 'Other Groups' : 'Your Groups'}
            </Text>
            <View style={styles.groupList}>
              {otherGroups.map((summary) => (
                <GroupCard key={summary.group.id} summary={summary} />
              ))}
            </View>
          </>
        )}

        {/* Empty state */}
        {!isLoading && error === null && summaries.length === 0 && invites.length === 0 && (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyEmoji}>🔥</Text>
            <Text style={styles.emptyTitle}>No groups yet</Text>
            <Text style={styles.emptySub}>
              Start a group, invite your people, and pass the spotlight around.
            </Text>
            <Pressable
              onPress={() => router.push('/create-group')}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <LinearGradient
                colors={GRADIENTS.ember}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.emptyButton}
              >
                <Text style={styles.emptyButtonLabel}>Create your first group</Text>
              </LinearGradient>
            </Pressable>
          </View>
        )}

        {/* Pending invites */}
        {invites.map((invite) => (
          <InviteBanner key={invite.group.id} invite={invite} />
        ))}
      </ScrollView>

      <BottomNav active="home" />
    </View>
  );
}

function MyTurnHero({ summary }: { summary: GroupSummary }): ReactElement {
  const router = useRouter();
  const windowMinutes = parseIntervalToMinutes(summary.group.per_turn_deadline);
  const countdown = useCountdown(summary.activeTurn?.deadline_at ?? null, windowMinutes);

  return (
    <View style={styles.heroWrap}>
      <Pressable
        onPress={() => router.push(`/group/${summary.group.id}/my-turn`)}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <LinearGradient
          colors={GRADIENTS.ember}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View style={styles.heroTopRow}>
            <View style={styles.heroBadge}>
              <Text style={styles.heroBadgeText}>🔥 Your Turn</Text>
            </View>
            <Text style={styles.heroTime}>{countdown.label} left</Text>
          </View>
          <Text style={styles.heroName}>{summary.group.name}</Text>
          <Text style={styles.heroUpdate} numberOfLines={2}>
            {latestUpdateLine(summary) ?? 'You’re up — share something with the group.'}
          </Text>
          <View style={styles.heroBottomRow}>
            <View style={styles.avatarStack}>
              {summary.members.map((m, i) => (
                <View
                  key={m.userId}
                  style={{ marginLeft: i === 0 ? 0 : -10, zIndex: summary.members.length - i }}
                >
                  <Avatar
                    initials={m.initials}
                    color={COLORS.white}
                    size={28}
                    ring={m.userId === summary.activeTurn?.called_out_user_id}
                    ringColor={COLORS.white}
                  />
                </View>
              ))}
            </View>
            <Text style={styles.heroCta}>Tap to respond →</Text>
          </View>
        </LinearGradient>
      </Pressable>
    </View>
  );
}

function latestUpdateLine(summary: GroupSummary): string | null {
  if (!summary.latestUpdate) {
    return null;
  }
  const author = summary.members.find((m) => m.userId === summary.latestUpdate?.authorId);
  const firstName = author?.displayName.split(/\s+/)[0] ?? 'Someone';
  return `${firstName}: “${summary.latestUpdate.text}”`;
}

function GroupCard({ summary }: { summary: GroupSummary }): ReactElement {
  const router = useRouter();
  const windowMinutes = parseIntervalToMinutes(summary.group.per_turn_deadline);
  const countdown = useCountdown(summary.activeTurn?.deadline_at ?? null, windowMinutes);

  const holder = summary.members.find((m) => m.userId === summary.activeTurn?.called_out_user_id);
  const statusLine =
    summary.group.status === 'setup'
      ? 'Waiting to start'
      : summary.group.status === 'paused'
        ? 'Paused — needs more members'
        : holder
          ? `${holder.displayName.split(/\s+/)[0]}’s turn`
          : 'Between turns';

  return (
    <Pressable
      onPress={() => router.push(`/group/${summary.group.id}`)}
      style={({ pressed }) => [styles.groupCard, pressed && styles.pressed]}
    >
      <View style={styles.groupCardTop}>
        <View>
          <Text style={styles.groupName}>{summary.group.name}</Text>
          <Text style={styles.groupTurn}>{statusLine}</Text>
        </View>
        {summary.activeTurn !== null && (
          <View style={[styles.timePill, countdown.urgent && styles.timePillUrgent]}>
            <Text style={[styles.timePillText, countdown.urgent && styles.timePillTextUrgent]}>
              {countdown.label}
            </Text>
          </View>
        )}
      </View>
      {latestUpdateLine(summary) !== null && (
        <Text style={styles.groupUpdate} numberOfLines={1}>
          {latestUpdateLine(summary)}
        </Text>
      )}
      <View style={styles.avatarStack}>
        {summary.members.map((m, i) => (
          <View
            key={m.userId}
            style={{ marginLeft: i === 0 ? 0 : -8, zIndex: summary.members.length - i }}
          >
            <Avatar
              initials={m.initials}
              color={m.color}
              size={26}
              ring={m.userId === summary.activeTurn?.called_out_user_id}
            />
          </View>
        ))}
      </View>
    </Pressable>
  );
}

function InviteBanner({ invite }: { invite: PendingInvite }): ReactElement {
  const router = useRouter();

  return (
    <Pressable
      onPress={() => router.push(`/join?groupId=${invite.group.id}`)}
      style={({ pressed }) => [styles.inviteBanner, pressed && styles.pressed]}
    >
      <View style={styles.inviteIcon}>
        <Svg width={18} height={18} viewBox="0 0 18 18" fill="none">
          <Path d="M9 3v12M3 9h12" stroke={COLORS.invite} strokeWidth={2.5} strokeLinecap="round" />
        </Svg>
      </View>
      <View>
        <Text style={styles.inviteTitle}>You have a pending invite</Text>
        <Text style={styles.inviteSub}>
          {invite.inviterName
            ? `${invite.inviterName.split(/\s+/)[0]} invited you to “${invite.group.name}” →`
            : `You’ve been invited to “${invite.group.name}” →`}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  avatarStack: {
    flexDirection: 'row',
  },
  bannerWrap: {
    paddingBottom: 16,
    paddingHorizontal: SPACING.screenX,
  },
  brand: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.displayBlack,
    fontSize: 28,
    letterSpacing: -0.8,
    lineHeight: 30,
  },
  emptyButton: {
    borderRadius: RADII.button,
    paddingHorizontal: 28,
    paddingVertical: 14,
  },
  emptyButtonLabel: {
    color: COLORS.white,
    fontFamily: FONTS.display,
    fontSize: 15,
  },
  emptyEmoji: {
    fontSize: 40,
    marginBottom: 12,
  },
  emptySub: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.body,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 24,
    textAlign: 'center',
  },
  emptyTitle: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.displayBlack,
    fontSize: 24,
    letterSpacing: -0.8,
    marginBottom: 8,
  },
  emptyWrap: {
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingVertical: 48,
  },
  flex: {
    backgroundColor: COLORS.background,
    flex: 1,
  },
  greeting: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.body,
    fontSize: 13,
    marginTop: 3,
  },
  groupCard: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: RADII.card,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  groupCardTop: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  groupList: {
    gap: 10,
    paddingHorizontal: SPACING.screenX,
  },
  groupName: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.display,
    fontSize: 16,
    letterSpacing: -0.3,
  },
  groupTurn: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.body,
    fontSize: 12,
    marginTop: 2,
  },
  groupUpdate: {
    color: COLORS.textMuted,
    fontFamily: FONTS.body,
    fontSize: 12,
    marginBottom: 12,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 20,
    paddingHorizontal: 24,
  },
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  hero: {
    borderRadius: RADII.hero,
    overflow: 'hidden',
    paddingHorizontal: 22,
    paddingVertical: 20,
  },
  heroBadge: {
    backgroundColor: 'rgba(0,0,0,0.18)',
    borderRadius: RADII.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  heroBadgeText: {
    color: 'rgba(255,255,255,0.85)',
    fontFamily: FONTS.display,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  heroBottomRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  heroCta: {
    color: COLORS.white,
    fontFamily: FONTS.display,
    fontSize: 13,
  },
  heroName: {
    color: COLORS.white,
    fontFamily: FONTS.displayExtraBold,
    fontSize: 22,
    letterSpacing: -0.4,
    marginBottom: 6,
  },
  heroTime: {
    color: 'rgba(255,255,255,0.9)',
    fontFamily: FONTS.display,
    fontSize: 13,
  },
  heroTopRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  heroUpdate: {
    color: 'rgba(255,255,255,0.8)',
    fontFamily: FONTS.body,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
  },
  heroWrap: {
    paddingBottom: 20,
    paddingHorizontal: SPACING.screenX,
  },
  inviteBanner: {
    alignItems: 'center',
    backgroundColor: 'rgba(123,97,255,0.10)',
    borderColor: 'rgba(123,97,255,0.3)',
    borderRadius: RADII.card,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginHorizontal: SPACING.screenX,
    marginTop: 16,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  inviteIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(123,97,255,0.2)',
    borderRadius: RADII.iconButton,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  inviteSub: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.body,
    fontSize: 12,
    marginTop: 2,
  },
  inviteTitle: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.display,
    fontSize: 14,
  },
  loadingWrap: {
    paddingVertical: 48,
  },
  pressed: {
    opacity: 0.85,
  },
  sectionLabel: {
    ...SECTION_LABEL,
    paddingBottom: 12,
    paddingHorizontal: 24,
    paddingTop: 4,
  },
  timePill: {
    backgroundColor: COLORS.elevated,
    borderRadius: RADII.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  timePillText: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.display,
    fontSize: 12,
  },
  timePillTextUrgent: {
    color: COLORS.warning,
  },
  timePillUrgent: {
    backgroundColor: 'rgba(255,154,46,0.12)',
  },
});
