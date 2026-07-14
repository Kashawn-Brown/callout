import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState, type ReactElement } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { Avatar } from '@/components/Avatar';
import { BackButton } from '@/components/BackButton';
import { CountdownRing } from '@/components/CountdownRing';
import { ErrorBanner } from '@/components/ErrorBanner';
import { IconButton } from '@/components/IconButton';
import { useSession } from '@/features/auth/SessionProvider';
import { removePlayer, respondJoinRequest, skipTurn, startGame } from '@/features/groups/api';
import type { GroupDetail, JoinRequestView, MemberView } from '@/features/groups/queries';
import { useCountdown } from '@/features/groups/useCountdown';
import { useGroupDetail } from '@/features/groups/useGroupDetail';
import { deadlineLabel, parseIntervalToMinutes, timeAgoLabel } from '@/lib/format';
import { serverNow } from '@/lib/server-time';
import type { Turn, TurnStatus } from '@/types/models';
import { COLORS, FONTS, GRADIENTS, RADII, SECTION_LABEL, SPACING } from '@/lib/theme';

// Per-member relay status this round, derived from Turn rows — relay position only, never conflated with submission validation (CLAUDE.md §2.5).
type MemberRoundStatus = 'turn' | 'done' | 'missed' | 'skipped' | 'waiting';

const STATUS_LABELS: Record<MemberRoundStatus, string> = {
  turn: 'Up now',
  done: 'Done ✓',
  missed: 'Missed',
  skipped: 'Skipped',
  waiting: 'Waiting',
};

const STATUS_COLORS: Record<MemberRoundStatus, string> = {
  turn: COLORS.ember,
  done: COLORS.success,
  missed: COLORS.warning,
  skipped: COLORS.textSecondary,
  waiting: COLORS.textSecondary,
};

function memberStatusThisRound(userId: string, turnsThisRound: Turn[]): MemberRoundStatus {
  const turn = turnsThisRound.find((t) => t.called_out_user_id === userId);
  if (!turn) {
    return 'waiting';
  }
  const byTurnStatus: Partial<Record<TurnStatus, MemberRoundStatus>> = {
    pending: 'turn',
    submitted: 'done',
    missed: 'missed',
    skipped: 'skipped',
  };
  return byTurnStatus[turn.status] ?? 'waiting';
}

export default function GroupDetailScreen(): ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useSession();
  const { detail, isLoading, error, refetch } = useGroupDetail(id ?? null);

  const [actionError, setActionError] = useState<string | null>(null);
  const [isActing, setIsActing] = useState(false);

  const userId = session?.user.id ?? null;
  const isHost = detail !== null && userId !== null && detail.group.host_id === userId;

  const handleStartGame = useCallback(async () => {
    if (!detail) {
      return;
    }
    setIsActing(true);
    setActionError(null);
    const result = await startGame({ target_group_id: detail.group.id });
    setIsActing(false);
    if (result.error) {
      setActionError(result.error.message);
    } else {
      refetch();
    }
  }, [detail, refetch]);

  const handleSkipTurn = useCallback(() => {
    if (!detail?.activeTurn) {
      return;
    }
    const turnId = detail.activeTurn.id;
    const holder = detail.members.find((m) => m.userId === detail.activeTurn?.called_out_user_id);
    Alert.alert(
      'Skip this turn?',
      `${holder?.displayName ?? 'This player'} loses their turn and the relay moves on.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Skip Turn',
          style: 'destructive',
          onPress: async () => {
            setIsActing(true);
            setActionError(null);
            const result = await skipTurn({ target_turn_id: turnId });
            setIsActing(false);
            if (result.error) {
              setActionError(result.error.message);
            } else {
              refetch();
            }
          },
        },
      ],
    );
  }, [detail, refetch]);

  // Approve or decline a join-by-code request (D051). Decline is deliberately quiet — the requester can always ask again with the same code.
  const handleRespondRequest = useCallback(
    async (request: JoinRequestView, approve: boolean) => {
      if (!detail) {
        return;
      }
      setIsActing(true);
      setActionError(null);
      const result = await respondJoinRequest({
        target_group_id: detail.group.id,
        target_user_id: request.userId,
        approve,
      });
      setIsActing(false);
      if (result.error) {
        setActionError(result.error.message);
      } else {
        refetch();
      }
    },
    [detail, refetch],
  );

  const handleRemoveMember = useCallback(
    (member: MemberView) => {
      if (!detail) {
        return;
      }
      Alert.alert(
        `Remove ${member.displayName}?`,
        member.status === 'invited'
          ? 'Their pending invite will be rescinded.'
          : 'They lose access to the group. If they hold the live turn, the relay moves on without them.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: async () => {
              setIsActing(true);
              setActionError(null);
              const result = await removePlayer({
                target_group_id: detail.group.id,
                target_user_id: member.userId,
              });
              setIsActing(false);
              if (result.error) {
                setActionError(result.error.message);
              } else {
                refetch();
              }
            },
          },
        ],
      );
    },
    [detail, refetch],
  );

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

  const windowMinutes = parseIntervalToMinutes(detail.group.per_turn_deadline);
  const holder = detail.members.find((m) => m.userId === detail.activeTurn?.called_out_user_id);
  const isMyTurn = detail.activeTurn !== null && detail.activeTurn.called_out_user_id === userId;
  const subtitle =
    detail.group.status === 'setup'
      ? `${detail.members.length} joined · waiting to start`
      : detail.group.status === 'paused'
        ? `${detail.members.length} members · paused`
        : `${detail.members.length} members · Round ${detail.currentRound?.round_number ?? '—'}`;

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
          <Text style={styles.title}>{detail.group.name}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
      </View>

      {(error !== null || actionError !== null) && (
        <View style={styles.bannerWrap}>
          <ErrorBanner message={actionError ?? error ?? ''} />
        </View>
      )}

      {/* Setup state: waiting for players, host can start */}
      {detail.group.status === 'setup' && (
        <View style={styles.stateCardWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEmoji}>🚀</Text>
            <Text style={styles.stateTitle}>Waiting to start</Text>
            <Text style={styles.stateBody}>
              {detail.invitedMembers.length > 0
                ? `${detail.members.length} joined · ${detail.invitedMembers.length} invite${detail.invitedMembers.length === 1 ? '' : 's'} pending`
                : `${detail.members.length} joined`}
              {' · '}deadline {windowMinutes !== null ? deadlineLabel(windowMinutes) : '—'}
            </Text>
            {isHost ? (
              <Pressable
                onPress={handleStartGame}
                disabled={isActing || detail.members.length < 2}
                style={({ pressed }) => pressed && styles.pressed}
              >
                <LinearGradient
                  colors={GRADIENTS.ember}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[
                    styles.startButton,
                    detail.members.length < 2 && styles.startButtonDisabled,
                  ]}
                >
                  <Text style={styles.startButtonLabel}>
                    {detail.members.length < 2
                      ? 'Need at least 2 players'
                      : isActing
                        ? 'Starting…'
                        : 'Start Game 🔥'}
                  </Text>
                </LinearGradient>
              </Pressable>
            ) : (
              <Text style={styles.stateHint}>The host starts the game once everyone’s in.</Text>
            )}
          </View>
        </View>
      )}

      {/* Paused state */}
      {detail.group.status === 'paused' && (
        <View style={styles.stateCardWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEmoji}>⏸️</Text>
            <Text style={styles.stateTitle}>Game paused</Text>
            <Text style={styles.stateBody}>
              Not enough active members to keep the relay going. It resumes automatically when
              someone joins.
            </Text>
          </View>
        </View>
      )}

      {/* Active turn card */}
      {detail.group.status === 'active' && detail.activeTurn !== null && holder !== undefined && (
        <ActiveTurnCard
          detail={detail}
          holder={holder}
          isMyTurn={isMyTurn}
          isHost={isHost}
          windowMinutes={windowMinutes}
          onSkip={handleSkipTurn}
        />
      )}

      {/* Pending join requests (D051) — host approves or declines */}
      {isHost && detail.joinRequests.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Join Requests</Text>
          {detail.joinRequests.map((request, i) => (
            <View
              key={request.userId}
              style={[styles.requestRow, i < detail.joinRequests.length - 1 && styles.requestRowGap]}
            >
              <Avatar initials={request.initials} color={request.color} size={38} />
              <View style={styles.requestInfo}>
                <Text style={styles.requestName}>{request.displayName}</Text>
                <Text style={styles.requestMeta}>Wants to join via the group code</Text>
              </View>
              <Pressable
                onPress={() => handleRespondRequest(request, false)}
                disabled={isActing}
                accessibilityLabel={`Decline ${request.displayName}`}
                style={({ pressed }) => [styles.requestDecline, pressed && styles.pressed]}
              >
                <Text style={styles.requestDeclineLabel}>✕</Text>
              </Pressable>
              <Pressable
                onPress={() => handleRespondRequest(request, true)}
                disabled={isActing}
                accessibilityLabel={`Approve ${request.displayName}`}
                style={({ pressed }) => [styles.requestApprove, pressed && styles.pressed]}
              >
                <Text style={styles.requestApproveLabel}>Approve</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {/* Members grid — the host's add-people entry point lives on this row (label left, "+" right), matching the home screen's section-row pattern. */}
      <View style={styles.section}>
        <View style={styles.sectionRow}>
          <Text style={[styles.sectionLabel, styles.sectionLabelInRow]}>Members</Text>
          {isHost && (
            <IconButton
              onPress={() => router.push(`/group/${detail.group.id}/invite`)}
              accessibilityLabel="Add people"
              size={30}
            >
              <Svg width={14} height={14} viewBox="0 0 14 14" fill="none">
                <Path
                  d="M7 2.5v9M2.5 7h9"
                  stroke={COLORS.textSecondary}
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              </Svg>
            </IconButton>
          )}
        </View>
        <View style={styles.membersGrid}>
          {detail.members.map((m) => {
            const status = memberStatusThisRound(m.userId, detail.turnsThisRound);
            const isTurn = status === 'turn';
            const removable = isHost && m.userId !== userId;
            return (
              <Pressable
                key={m.userId}
                onLongPress={removable ? () => handleRemoveMember(m) : undefined}
                style={[styles.memberCard, isTurn && styles.memberCardTurn]}
              >
                <Avatar
                  initials={m.initials}
                  color={m.color}
                  size={36}
                  ring={isTurn}
                  ringColor={STATUS_COLORS[status]}
                />
                <View>
                  <Text style={styles.memberName}>{m.displayName.split(/\s+/)[0]}</Text>
                  <Text style={[styles.memberStatus, { color: STATUS_COLORS[status] }]}>
                    {detail.group.status === 'active'
                      ? STATUS_LABELS[status]
                      : m.role === 'host'
                        ? 'Host'
                        : 'Joined'}
                  </Text>
                </View>
              </Pressable>
            );
          })}
          {detail.invitedMembers.map((m) => (
            <Pressable
              key={m.userId}
              onLongPress={isHost ? () => handleRemoveMember(m) : undefined}
              style={[styles.memberCard, styles.memberCardInvited]}
            >
              <Avatar initials={m.initials} color={m.color} size={36} />
              <View>
                <Text style={styles.memberName}>{m.displayName.split(/\s+/)[0]}</Text>
                <Text style={[styles.memberStatus, { color: COLORS.invite }]}>Invited</Text>
              </View>
            </Pressable>
          ))}
        </View>
        {isHost && <Text style={styles.hostHint}>Long-press a member to remove them.</Text>}
      </View>

      {/* Activity feed */}
      {detail.activity.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Activity</Text>
          {detail.activity.map((item, idx) => {
            const author = detail.members.find((m) => m.userId === item.authorId);
            const nextHolder = detail.members.find((m) => m.userId === item.nextHolderId);
            const isLast = idx === detail.activity.length - 1;
            return (
              <View
                key={item.turnId}
                style={[styles.activityItem, !isLast && styles.activityItemGap]}
              >
                {!isLast && <View style={styles.timelineLine} />}
                <View style={styles.activityAvatar}>
                  <Avatar
                    initials={author?.initials ?? '?'}
                    color={author?.color ?? COLORS.textSecondary}
                    size={34}
                  />
                </View>
                <View style={styles.activityCard}>
                  <View style={styles.activityHeader}>
                    <Text
                      style={[
                        styles.activityAuthor,
                        { color: author?.color ?? COLORS.textSecondary },
                      ]}
                    >
                      {author?.displayName.split(/\s+/)[0] ?? 'Former member'}
                    </Text>
                    <Text style={styles.activityTime}>
                      {timeAgoLabel(item.submittedAt, serverNow().getTime())}
                    </Text>
                  </View>
                  <Text style={styles.activityText}>{item.text}</Text>
                  {nextHolder !== undefined && (
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
                      <Text style={styles.calloutText}>
                        {item.nextWasSystemPick
                          ? `System called ${nextHolder.displayName.split(/\s+/)[0]}`
                          : `Called out ${nextHolder.displayName.split(/\s+/)[0]}`}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

function ActiveTurnCard({
  detail,
  holder,
  isMyTurn,
  isHost,
  windowMinutes,
  onSkip,
}: {
  detail: GroupDetail;
  holder: MemberView;
  isMyTurn: boolean;
  isHost: boolean;
  windowMinutes: number | null;
  onSkip: () => void;
}): ReactElement {
  const router = useRouter();
  const countdown = useCountdown(detail.activeTurn?.deadline_at ?? null, windowMinutes);

  return (
    <View style={styles.activeCardWrap}>
      <View style={styles.activeCard}>
        <View style={styles.activeCardTop}>
          <View style={styles.liveRow}>
            <View style={styles.liveDot} />
            <Text style={styles.liveLabel}>Active Turn</Text>
          </View>
          <Text style={styles.deadlineNote}>
            {windowMinutes !== null ? `${deadlineLabel(windowMinutes)} deadline` : ''}
          </Text>
        </View>

        <View style={styles.activeCardBody}>
          <Avatar
            initials={holder.initials}
            color={COLORS.ember}
            size={52}
            ring
            ringColor={COLORS.ember}
          />
          <View style={styles.activeCardInfo}>
            <Text style={styles.activeName}>{holder.displayName}</Text>
            <Text style={styles.activeSub}>{isMyTurn ? 'That’s you!' : 'On the clock'}</Text>
            {isMyTurn && (
              <View style={styles.respondPill}>
                <Text style={styles.respondPillText}>You’re up — respond now</Text>
              </View>
            )}
          </View>
          <CountdownRing
            timeLabel={countdown.label}
            pct={countdown.pct}
            size={80}
            urgent={countdown.urgent}
          />
        </View>

        {isMyTurn && (
          <Pressable
            onPress={() => router.push(`/group/${detail.group.id}/my-turn`)}
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
        )}

        {isHost && !isMyTurn && (
          <Pressable
            onPress={onSkip}
            style={({ pressed }) => [styles.skipButton, pressed && styles.pressed]}
          >
            <Text style={styles.skipButtonLabel}>Skip this turn</Text>
          </Pressable>
        )}
      </View>
    </View>
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
  bannerWrap: {
    paddingBottom: 16,
    paddingHorizontal: SPACING.screenX,
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
  centerWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
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
  hostHint: {
    color: COLORS.textMuted,
    fontFamily: FONTS.body,
    fontSize: 11,
    marginTop: 8,
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
  memberCardInvited: {
    borderStyle: 'dashed',
    opacity: 0.7,
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
  requestApprove: {
    backgroundColor: 'rgba(0,212,170,0.15)',
    borderColor: 'rgba(0,212,170,0.4)',
    borderRadius: RADII.pill,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  requestApproveLabel: {
    color: COLORS.success,
    fontFamily: FONTS.display,
    fontSize: 12,
  },
  requestDecline: {
    alignItems: 'center',
    borderColor: COLORS.border,
    borderRadius: 15,
    borderWidth: 1,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  requestDeclineLabel: {
    color: COLORS.textSecondary,
    fontSize: 13,
  },
  requestInfo: {
    flex: 1,
  },
  requestMeta: {
    color: COLORS.textMuted,
    fontFamily: FONTS.body,
    fontSize: 11,
    marginTop: 1,
  },
  requestName: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 14,
  },
  requestRow: {
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderColor: 'rgba(123,97,255,0.3)',
    borderRadius: RADII.input,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  requestRowGap: {
    marginBottom: 8,
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
  sectionLabelInRow: {
    marginBottom: 0,
  },
  sectionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  skipButton: {
    alignItems: 'center',
    borderColor: COLORS.border,
    borderRadius: 14,
    borderWidth: 1.5,
    marginTop: 16,
    paddingVertical: 11,
  },
  skipButtonLabel: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.display,
    fontSize: 13,
  },
  startButton: {
    borderRadius: RADII.button,
    marginTop: 16,
    paddingHorizontal: 28,
    paddingVertical: 13,
  },
  startButtonDisabled: {
    opacity: 0.4,
  },
  startButtonLabel: {
    color: COLORS.white,
    fontFamily: FONTS.display,
    fontSize: 14,
  },
  stateBody: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.body,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  stateCard: {
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: RADII.hero,
    borderWidth: 1,
    paddingHorizontal: 24,
    paddingVertical: 28,
  },
  stateCardWrap: {
    paddingBottom: 16,
    paddingHorizontal: SPACING.screenX,
  },
  stateEmoji: {
    fontSize: 34,
    marginBottom: 10,
  },
  stateHint: {
    color: COLORS.textMuted,
    fontFamily: FONTS.body,
    fontSize: 12,
    marginTop: 14,
  },
  stateTitle: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.displayExtraBold,
    fontSize: 20,
    letterSpacing: -0.5,
    marginBottom: 6,
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
