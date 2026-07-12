import { supabase } from '@/lib/supabase';
import { initialsOf, memberColor } from '@/lib/format';
import type {
  Group,
  Membership,
  MembershipRole,
  MembershipStatus,
  Profile,
  Round,
  Submission,
  Turn,
} from '@/types/models';

/**
 * Read layer for group/game state. Everything here is RLS-filtered table reads (CLAUDE.md §2.2) assembled client-side into view bundles — deliberately explicit queries instead of PostgREST embeddings, because turn's composite/dual foreign keys make embedding disambiguation brittle while id-set queries stay obvious.
 */

export type MemberView = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  role: MembershipRole;
  status: MembershipStatus;
  color: string;
  initials: string;
};

export type LatestUpdate = {
  authorId: string;
  text: string;
  submittedAt: string;
};

export type GroupSummary = {
  group: Group;
  /** Playing roster: active and out_eliminated members (D012 keeps eliminated visible). Removed members never appear; invited ones are listed separately. */
  members: MemberView[];
  invitedMembers: MemberView[];
  currentRound: Round | null;
  activeTurn: Turn | null;
  latestUpdate: LatestUpdate | null;
};

export type ActivityItem = {
  turnId: string;
  authorId: string;
  text: string;
  submittedAt: string;
  /** Holder of the next turn in the same round, when one exists — renders as "Called out X". */
  nextHolderId: string | null;
  /** True when the next turn was a system pick (auto-advance) rather than this author's choice. */
  nextWasSystemPick: boolean;
};

export type GroupDetail = GroupSummary & {
  turnsThisRound: Turn[];
  activity: ActivityItem[];
};

export type PendingInvite = {
  group: Group;
  members: MemberView[];
  inviterName: string | null;
};

export type HomeData = {
  summaries: GroupSummary[];
  invites: PendingInvite[];
};

/** Throws with the PostgREST message so hooks surface it through the shared error UI — reads have no app-level error codes to preserve (CLAUDE.md §5.7). */
function assertNoError(error: { message: string } | null, context: string): void {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}

function toMemberView(membership: Membership, profilesById: Map<string, Profile>): MemberView {
  const profile = profilesById.get(membership.user_id);
  const displayName = profile?.display_name ?? 'Unknown player';
  return {
    userId: membership.user_id,
    displayName,
    avatarUrl: profile?.avatar_url ?? null,
    role: membership.role,
    status: membership.status,
    color: memberColor(membership.user_id),
    initials: initialsOf(displayName),
  };
}

async function fetchProfilesById(userIds: string[]): Promise<Map<string, Profile>> {
  if (userIds.length === 0) {
    return new Map();
  }
  const { data, error } = await supabase
    .from('profile')
    .select('id, display_name, avatar_url')
    .in('id', userIds);
  assertNoError(error, 'load profiles');
  return new Map((data as Profile[]).map((p) => [p.id, p]));
}

const GROUP_COLUMNS = 'id, name, host_id, status, per_turn_deadline, created_at';
const MEMBERSHIP_COLUMNS = 'id, group_id, user_id, role, status, joined_at';
const TURN_COLUMNS =
  'id, round_id, group_id, called_out_user_id, called_by_user_id, deadline_at, status, created_at';

export async function fetchHomeData(userId: string): Promise<HomeData> {
  const { data: myMembershipsData, error: membershipError } = await supabase
    .from('membership')
    .select(MEMBERSHIP_COLUMNS)
    .eq('user_id', userId)
    .in('status', ['invited', 'active', 'out_eliminated']);
  assertNoError(membershipError, 'load memberships');
  const myMemberships = myMembershipsData as Membership[];

  const memberGroupIds = myMemberships
    .filter((m) => m.status === 'active' || m.status === 'out_eliminated')
    .map((m) => m.group_id);
  const invitedGroupIds = myMemberships
    .filter((m) => m.status === 'invited')
    .map((m) => m.group_id);
  const allGroupIds = [...memberGroupIds, ...invitedGroupIds];

  if (allGroupIds.length === 0) {
    return { summaries: [], invites: [] };
  }

  const [groupsRes, rostersRes, roundsRes, pendingTurnsRes] = await Promise.all([
    supabase.from('group').select(GROUP_COLUMNS).in('id', allGroupIds),
    supabase
      .from('membership')
      .select(MEMBERSHIP_COLUMNS)
      .in('group_id', allGroupIds)
      .in('status', ['invited', 'active', 'out_eliminated']),
    supabase
      .from('round')
      .select('id, group_id, round_number, status, started_at')
      .in(
        'group_id',
        memberGroupIds.length > 0 ? memberGroupIds : ['00000000-0000-0000-0000-000000000000'],
      )
      .eq('status', 'in_progress'),
    supabase
      .from('turn')
      .select(TURN_COLUMNS)
      .in(
        'group_id',
        memberGroupIds.length > 0 ? memberGroupIds : ['00000000-0000-0000-0000-000000000000'],
      )
      .eq('status', 'pending'),
  ]);
  assertNoError(groupsRes.error, 'load groups');
  assertNoError(rostersRes.error, 'load rosters');
  assertNoError(roundsRes.error, 'load rounds');
  assertNoError(pendingTurnsRes.error, 'load turns');

  const groups = groupsRes.data as Group[];
  const rosters = rostersRes.data as Membership[];
  const rounds = roundsRes.data as Round[];
  const pendingTurns = pendingTurnsRes.data as Turn[];

  const profilesById = await fetchProfilesById([...new Set(rosters.map((m) => m.user_id))]);

  // Latest text update per group for the card subtitle. Inner-join embedding is safe here: submission -> turn is a single unambiguous FK.
  const { data: latestData, error: latestError } = await supabase
    .from('submission')
    .select('text_content, submitted_at, turn!inner(group_id, called_out_user_id)')
    .in(
      'turn.group_id',
      memberGroupIds.length > 0 ? memberGroupIds : ['00000000-0000-0000-0000-000000000000'],
    )
    .order('submitted_at', { ascending: false })
    .limit(60);
  assertNoError(latestError, 'load latest updates');

  const latestByGroup = new Map<string, LatestUpdate>();
  for (const row of (latestData ?? []) as unknown as {
    text_content: string | null;
    submitted_at: string;
    turn: { group_id: string; called_out_user_id: string };
  }[]) {
    if (row.text_content !== null && !latestByGroup.has(row.turn.group_id)) {
      latestByGroup.set(row.turn.group_id, {
        authorId: row.turn.called_out_user_id,
        text: row.text_content,
        submittedAt: row.submitted_at,
      });
    }
  }

  const summaries: GroupSummary[] = [];
  const invites: PendingInvite[] = [];

  for (const group of groups) {
    const roster = rosters.filter((m) => m.group_id === group.id);
    const members = roster
      .filter((m) => m.status === 'active' || m.status === 'out_eliminated')
      .map((m) => toMemberView(m, profilesById));
    const invitedMembers = roster
      .filter((m) => m.status === 'invited')
      .map((m) => toMemberView(m, profilesById));

    if (invitedGroupIds.includes(group.id)) {
      invites.push({ group, members, inviterName: null });
    } else {
      summaries.push({
        group,
        members,
        invitedMembers,
        currentRound: rounds.find((r) => r.group_id === group.id) ?? null,
        activeTurn: pendingTurns.find((t) => t.group_id === group.id) ?? null,
        latestUpdate: latestByGroup.get(group.id) ?? null,
      });
    }
  }

  // Inviter attribution comes from the group_invited notification row (only the recipient can read it).
  if (invites.length > 0) {
    const { data: inviteNotifications, error: notificationError } = await supabase
      .from('notification')
      .select('group_id, sent_by')
      .eq('recipient_user_id', userId)
      .eq('type', 'group_invited')
      .in(
        'group_id',
        invites.map((i) => i.group.id),
      )
      .order('sent_at', { ascending: false });
    assertNoError(notificationError, 'load invite notifications');

    const inviterByGroup = new Map<string, string>();
    for (const n of (inviteNotifications ?? []) as { group_id: string; sent_by: string | null }[]) {
      if (n.sent_by && !inviterByGroup.has(n.group_id)) {
        inviterByGroup.set(n.group_id, n.sent_by);
      }
    }
    const inviterProfiles = await fetchProfilesById([...new Set(inviterByGroup.values())]);
    for (const invite of invites) {
      const inviterId = inviterByGroup.get(invite.group.id);
      invite.inviterName = inviterId
        ? (inviterProfiles.get(inviterId)?.display_name ?? null)
        : null;
    }
  }

  return { summaries, invites };
}

/** Most recent turns for the activity feed; bounded so a long-running group stays cheap to load. */
const ACTIVITY_TURN_LIMIT = 25;

export async function fetchGroupDetail(groupId: string): Promise<GroupDetail> {
  const [groupRes, rosterRes, roundRes, recentTurnsRes] = await Promise.all([
    supabase.from('group').select(GROUP_COLUMNS).eq('id', groupId).single(),
    supabase
      .from('membership')
      .select(MEMBERSHIP_COLUMNS)
      .eq('group_id', groupId)
      .in('status', ['invited', 'active', 'out_eliminated']),
    supabase
      .from('round')
      .select('id, group_id, round_number, status, started_at')
      .eq('group_id', groupId)
      .eq('status', 'in_progress')
      .maybeSingle(),
    supabase
      .from('turn')
      .select(TURN_COLUMNS)
      .eq('group_id', groupId)
      .order('created_at', { ascending: false })
      .limit(ACTIVITY_TURN_LIMIT),
  ]);
  assertNoError(groupRes.error, 'load group');
  assertNoError(rosterRes.error, 'load roster');
  assertNoError(roundRes.error, 'load round');
  assertNoError(recentTurnsRes.error, 'load turns');

  const group = groupRes.data as Group;
  const roster = rosterRes.data as Membership[];
  const currentRound = (roundRes.data as Round | null) ?? null;
  const recentTurns = recentTurnsRes.data as Turn[];

  const profilesById = await fetchProfilesById([...new Set(roster.map((m) => m.user_id))]);

  const submittedTurnIds = recentTurns.map((t) => t.id);
  let submissions: Submission[] = [];
  if (submittedTurnIds.length > 0) {
    const { data: submissionData, error: submissionError } = await supabase
      .from('submission')
      .select('id, turn_id, type, text_content, submitted_at')
      .in('turn_id', submittedTurnIds)
      .order('submitted_at', { ascending: false });
    assertNoError(submissionError, 'load submissions');
    submissions = submissionData as Submission[];
  }

  const latestSubmissionByTurn = new Map<string, Submission>();
  for (const s of submissions) {
    if (!latestSubmissionByTurn.has(s.turn_id)) {
      latestSubmissionByTurn.set(s.turn_id, s);
    }
  }

  // Successor lookup for "Called out X": recentTurns is created_at-descending, so the previous array element within the same round is the turn that followed this one.
  const activity: ActivityItem[] = [];
  for (let i = 0; i < recentTurns.length; i += 1) {
    const turn = recentTurns[i];
    const submission = latestSubmissionByTurn.get(turn.id);
    if (!submission || submission.text_content === null) {
      continue;
    }
    const successor =
      i > 0 && recentTurns[i - 1].round_id === turn.round_id ? recentTurns[i - 1] : null;
    activity.push({
      turnId: turn.id,
      authorId: turn.called_out_user_id,
      text: submission.text_content,
      submittedAt: submission.submitted_at,
      nextHolderId: successor?.called_out_user_id ?? null,
      nextWasSystemPick: successor !== null && successor.called_by_user_id === null,
    });
  }

  const turnsThisRound = currentRound
    ? recentTurns.filter((t) => t.round_id === currentRound.id).reverse()
    : [];

  const members = roster
    .filter((m) => m.status === 'active' || m.status === 'out_eliminated')
    .map((m) => toMemberView(m, profilesById));
  const invitedMembers = roster
    .filter((m) => m.status === 'invited')
    .map((m) => toMemberView(m, profilesById));

  const latestActivity = activity[0] ?? null;

  return {
    group,
    members,
    invitedMembers,
    currentRound,
    activeTurn: turnsThisRound.find((t) => t.status === 'pending') ?? null,
    latestUpdate: latestActivity
      ? {
          authorId: latestActivity.authorId,
          text: latestActivity.text,
          submittedAt: latestActivity.submittedAt,
        }
      : null,
    turnsThisRound,
    activity,
  };
}
