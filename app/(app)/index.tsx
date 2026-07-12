import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useCallback, type ReactElement } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { Avatar } from '@/components/Avatar';
import { BottomNav } from '@/components/BottomNav';
import { IconButton } from '@/components/IconButton';
import { signOut } from '@/features/auth/api';
import { useProfile } from '@/features/auth/useProfile';
import {
  getPlaceholderMember,
  PLACEHOLDER_GROUPS,
  type PlaceholderGroup,
} from '@/lib/placeholder-data';
import { COLORS, FONTS, GRADIENTS, RADII, SECTION_LABEL, SPACING } from '@/lib/theme';

export default function HomeScreen(): ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useProfile();

  const myTurnGroup = PLACEHOLDER_GROUPS.find((g) => g.isMyTurn);
  const otherGroups = PLACEHOLDER_GROUPS.filter((g) => !g.isMyTurn);

  const initials =
    profile?.display_name
      .split(/\s+/)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .slice(0, 2)
      .join('') ?? '?';

  const handleAvatarPress = useCallback(() => {
    Alert.alert('Sign out', 'Sign out of Callout on this device?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          const result = await signOut();
          if (result.error) {
            Alert.alert('Sign out failed', result.error.message);
          }
        },
      },
    ]);
  }, []);

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
            <Pressable onPress={handleAvatarPress} accessibilityLabel="Account options">
              <Avatar initials={initials} color={COLORS.invite} size={36} />
            </Pressable>
          </View>
        </View>

        {/* My Turn hero */}
        {myTurnGroup && <MyTurnHero group={myTurnGroup} />}

        {/* Other groups */}
        <Text style={styles.sectionLabel}>Other Groups</Text>
        <View style={styles.groupList}>
          {otherGroups.map((group) => (
            <GroupCard key={group.id} group={group} />
          ))}
        </View>

        {/* Pending invite */}
        <Pressable
          onPress={() => router.push('/join')}
          style={({ pressed }) => [styles.inviteBanner, pressed && styles.pressed]}
        >
          <View style={styles.inviteIcon}>
            <Svg width={18} height={18} viewBox="0 0 18 18" fill="none">
              <Path
                d="M9 3v12M3 9h12"
                stroke={COLORS.invite}
                strokeWidth={2.5}
                strokeLinecap="round"
              />
            </Svg>
          </View>
          <View>
            <Text style={styles.inviteTitle}>You have 1 pending invite</Text>
            <Text style={styles.inviteSub}>Sam invited you to &quot;Fam Vibes&quot; →</Text>
          </View>
        </Pressable>
      </ScrollView>

      <BottomNav active="home" />
    </View>
  );
}

function MyTurnHero({ group }: { group: PlaceholderGroup }): ReactElement {
  const router = useRouter();
  const members = group.memberIds.map(getPlaceholderMember);

  return (
    <View style={styles.heroWrap}>
      <Pressable
        onPress={() => router.push(`/group/${group.id}/my-turn`)}
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
            <Text style={styles.heroTime}>{group.timeLeftLabel} left</Text>
          </View>
          <Text style={styles.heroName}>{group.name}</Text>
          <Text style={styles.heroUpdate}>{group.lastUpdate}</Text>
          <View style={styles.heroBottomRow}>
            <View style={styles.avatarStack}>
              {members.map((m, i) => (
                <View
                  key={m.id}
                  style={{ marginLeft: i === 0 ? 0 : -10, zIndex: members.length - i }}
                >
                  <Avatar
                    initials={m.initials}
                    color={COLORS.white}
                    size={28}
                    ring={m.id === group.currentTurnMemberId}
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

function GroupCard({ group }: { group: PlaceholderGroup }): ReactElement {
  const router = useRouter();
  const members = group.memberIds.map(getPlaceholderMember);
  const turnMember = getPlaceholderMember(group.currentTurnMemberId);
  // Mirrors the prototype's urgency heuristic: minutes-scale time remaining renders amber. Real urgency derives from server deadlines in Phase 3.
  const isUrgent = group.timeLeftLabel.includes('m') && !group.timeLeftLabel.includes('h');

  return (
    <Pressable
      onPress={() => router.push(`/group/${group.id}`)}
      style={({ pressed }) => [styles.groupCard, pressed && styles.pressed]}
    >
      <View style={styles.groupCardTop}>
        <View>
          <Text style={styles.groupName}>{group.name}</Text>
          <Text style={styles.groupTurn}>{turnMember.name}&apos;s turn</Text>
        </View>
        <View style={[styles.timePill, isUrgent && styles.timePillUrgent]}>
          <Text style={[styles.timePillText, isUrgent && styles.timePillTextUrgent]}>
            {group.timeLeftLabel}
          </Text>
        </View>
      </View>
      <Text style={styles.groupUpdate} numberOfLines={1}>
        {group.lastUpdate}
      </Text>
      <View style={styles.avatarStack}>
        {members.map((m, i) => (
          <View key={m.id} style={{ marginLeft: i === 0 ? 0 : -8, zIndex: members.length - i }}>
            <Avatar
              initials={m.initials}
              color={m.color}
              size={26}
              ring={m.id === group.currentTurnMemberId}
            />
          </View>
        ))}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  avatarStack: {
    flexDirection: 'row',
  },
  brand: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.displayBlack,
    fontSize: 28,
    letterSpacing: -0.8,
    lineHeight: 30,
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
