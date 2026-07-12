import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { ReactElement } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import { Avatar } from '@/components/Avatar';
import { BackButton } from '@/components/BackButton';
import { CountdownRing } from '@/components/CountdownRing';
import { IconButton } from '@/components/IconButton';
import {
  getPlaceholderMember,
  PLACEHOLDER_ACTIVITY,
  PLACEHOLDER_GROUPS,
} from '@/lib/placeholder-data';
import { COLORS, FONTS, GRADIENTS, RADII, SECTION_LABEL, SPACING } from '@/lib/theme';

// Placeholder per-member round status mirroring the prototype. Real values derive from Turn rows in Phase 3 — turn status is relay position, never conflated with submission validation (CLAUDE.md §2.5).
type MemberRoundStatus = 'turn' | 'pending' | 'done' | 'waiting';

const PLACEHOLDER_STATUSES: Record<string, MemberRoundStatus> = {
  u1: 'turn',
  u2: 'done',
  u3: 'done',
  u4: 'pending',
};

const STATUS_LABELS: Record<MemberRoundStatus, string> = {
  turn: 'Up now',
  pending: 'Pending',
  done: 'Done ✓',
  waiting: 'Waiting',
};

const STATUS_COLORS: Record<MemberRoundStatus, string> = {
  turn: COLORS.ember,
  pending: COLORS.warning,
  done: COLORS.success,
  waiting: COLORS.textSecondary,
};

export default function GroupDetailScreen(): ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const group = PLACEHOLDER_GROUPS.find((g) => g.id === id) ?? PLACEHOLDER_GROUPS[0];
  const members = group.memberIds.map(getPlaceholderMember);

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <BackButton />
        <View style={styles.headerText}>
          <Text style={styles.title}>{group.name}</Text>
          <Text style={styles.subtitle}>{members.length} members · Round 3</Text>
        </View>
        <IconButton onPress={() => {}} accessibilityLabel="Group options">
          <Svg width={16} height={16} viewBox="0 0 16 16" fill="none">
            <Circle cx={4} cy={8} r={1.5} fill={COLORS.textSecondary} />
            <Circle cx={8} cy={8} r={1.5} fill={COLORS.textSecondary} />
            <Circle cx={12} cy={8} r={1.5} fill={COLORS.textSecondary} />
          </Svg>
        </IconButton>
      </View>

      {/* Active turn card */}
      <View style={styles.activeCardWrap}>
        <View style={styles.activeCard}>
          <View style={styles.activeCardTop}>
            <View style={styles.liveRow}>
              <View style={styles.liveDot} />
              <Text style={styles.liveLabel}>Active Turn</Text>
            </View>
            <Text style={styles.deadlineNote}>{group.deadlineLabel} deadline</Text>
          </View>

          <View style={styles.activeCardBody}>
            <Avatar
              initials={getPlaceholderMember(group.currentTurnMemberId).initials}
              color={COLORS.ember}
              size={52}
              ring
              ringColor={COLORS.ember}
            />
            <View style={styles.activeCardInfo}>
              <Text style={styles.activeName}>
                {getPlaceholderMember(group.currentTurnMemberId).name}
              </Text>
              <Text style={styles.activeSub}>That&apos;s you!</Text>
              <View style={styles.respondPill}>
                <Text style={styles.respondPillText}>You&apos;re up — respond now</Text>
              </View>
            </View>
            <CountdownRing timeLabel={group.timeLeftLabel} pct={0.74} size={80} />
          </View>

          <Pressable
            onPress={() => router.push(`/group/${group.id}/my-turn`)}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <LinearGradient
              colors={GRADIENTS.ember}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.openTurnButton}
            >
              <Text style={styles.openTurnLabel}>Open My Turn →</Text>
            </LinearGradient>
          </Pressable>
        </View>
      </View>

      {/* Members grid */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Members</Text>
        <View style={styles.membersGrid}>
          {members.map((m) => {
            const status = PLACEHOLDER_STATUSES[m.id] ?? 'waiting';
            const isTurn = status === 'turn';
            return (
              <View key={m.id} style={[styles.memberCard, isTurn && styles.memberCardTurn]}>
                <Avatar
                  initials={m.initials}
                  color={m.color}
                  size={36}
                  ring={isTurn}
                  ringColor={STATUS_COLORS[status]}
                />
                <View>
                  <Text style={styles.memberName}>{m.name.split(' ')[0]}</Text>
                  <Text style={[styles.memberStatus, { color: STATUS_COLORS[status] }]}>
                    {STATUS_LABELS[status]}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      </View>

      {/* Activity feed */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Activity</Text>
        {PLACEHOLDER_ACTIVITY.map((item, idx) => {
          const member = getPlaceholderMember(item.memberId);
          const passedTo = getPlaceholderMember(item.passedToMemberId);
          const isLast = idx === PLACEHOLDER_ACTIVITY.length - 1;
          return (
            <View key={item.id} style={[styles.activityItem, !isLast && styles.activityItemGap]}>
              {!isLast && <View style={styles.timelineLine} />}
              <View style={styles.activityAvatar}>
                <Avatar initials={member.initials} color={member.color} size={34} />
              </View>
              <View style={styles.activityCard}>
                <View style={styles.activityHeader}>
                  <Text style={[styles.activityAuthor, { color: member.color }]}>
                    {member.name.split(' ')[0]}
                  </Text>
                  <Text style={styles.activityTime}>{item.timeLabel}</Text>
                </View>
                <Text style={styles.activityText}>{item.text}</Text>
                <View style={styles.calloutRow}>
                  <Svg width={10} height={10} viewBox="0 0 10 10" fill="none">
                    <Path
                      d="M1 5h8M6 2l3 3-3 3"
                      stroke={COLORS.textSecondary}
                      strokeWidth={1.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </Svg>
                  <Text style={styles.calloutText}>Called out {passedTo.name.split(' ')[0]}</Text>
                </View>
              </View>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  activeCard: {
    backgroundColor: COLORS.card,
    borderColor: 'rgba(255,78,58,0.25)',
    borderRadius: RADII.hero,
    borderWidth: 1,
    padding: 20,
  },
  activeCardBody: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 16,
  },
  activeCardInfo: {
    flex: 1,
  },
  activeCardTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  activeCardWrap: {
    paddingBottom: 16,
    paddingHorizontal: SPACING.screenX,
  },
  activeName: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.display,
    fontSize: 17,
    letterSpacing: -0.3,
  },
  activeSub: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.body,
    fontSize: 12,
    marginTop: 2,
  },
  activityAuthor: {
    fontFamily: FONTS.bodyBold,
    fontSize: 13,
  },
  activityAvatar: {
    left: 0,
    position: 'absolute',
    top: 0,
  },
  activityCard: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: RADII.input,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  activityHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  activityItem: {
    paddingLeft: 44,
    position: 'relative',
  },
  activityItemGap: {
    paddingBottom: 20,
  },
  activityText: {
    color: COLORS.textBody,
    fontFamily: FONTS.body,
    fontSize: 13,
    lineHeight: 19,
  },
  activityTime: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.body,
    fontSize: 11,
  },
  calloutRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    marginTop: 8,
  },
  calloutText: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 11,
  },
  deadlineNote: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.body,
    fontSize: 12,
  },
  flex: {
    backgroundColor: COLORS.background,
    flex: 1,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingBottom: 20,
    paddingHorizontal: SPACING.contentX,
  },
  headerText: {
    flex: 1,
  },
  liveDot: {
    backgroundColor: COLORS.ember,
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  liveLabel: {
    color: COLORS.ember,
    fontFamily: FONTS.display,
    fontSize: 11,
    letterSpacing: 1.3,
    textTransform: 'uppercase',
  },
  liveRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  memberCard: {
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: RADII.input,
    borderWidth: 1,
    flexBasis: '48%',
    flexDirection: 'row',
    flexGrow: 1,
    gap: 10,
    padding: 12,
  },
  memberCardTurn: {
    backgroundColor: 'rgba(255,78,58,0.08)',
    borderColor: 'rgba(255,78,58,0.25)',
  },
  memberName: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 13,
  },
  memberStatus: {
    fontFamily: FONTS.bodySemiBold,
    fontSize: 11,
    marginTop: 2,
  },
  membersGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  openTurnButton: {
    alignItems: 'center',
    borderRadius: 14,
    marginTop: 16,
    paddingVertical: 12,
  },
  openTurnLabel: {
    color: COLORS.white,
    fontFamily: FONTS.display,
    fontSize: 14,
  },
  pressed: {
    opacity: 0.85,
  },
  respondPill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,78,58,0.15)',
    borderColor: 'rgba(255,78,58,0.3)',
    borderRadius: RADII.pill,
    borderWidth: 1,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  respondPillText: {
    color: COLORS.ember,
    fontFamily: FONTS.bodyBold,
    fontSize: 12,
  },
  section: {
    paddingBottom: 20,
    paddingHorizontal: SPACING.contentX,
  },
  sectionLabel: {
    ...SECTION_LABEL,
    marginBottom: 12,
  },
  subtitle: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.body,
    fontSize: 12,
    marginTop: 1,
  },
  title: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.displayExtraBold,
    fontSize: 20,
    letterSpacing: -0.6,
  },
  timelineLine: {
    backgroundColor: COLORS.border,
    bottom: 0,
    left: 17,
    position: 'absolute',
    top: 36,
    width: 1.5,
  },
});
