/** Row shapes for tables the client reads directly (reads only — all writes go through RPCs per CLAUDE.md §2.2). Only fields the app currently consumes are typed; add fields as phases activate them. */

/** Enum string unions mirroring the Phase 1 Postgres enums — the typed source required by CLAUDE.md §5.8; never compare against a raw string literal at a call site. */
export type GroupStatus = 'setup' | 'active' | 'paused' | 'ended';
export type MembershipRole = 'host' | 'admin' | 'player';
export type MembershipStatus = 'invited' | 'active' | 'removed' | 'out_eliminated';
export type RoundStatus = 'in_progress' | 'completed' | 'force_closed';
export type TurnStatus =
  'pending' | 'submitted' | 'missed' | 'eliminated' | 'redo_pending' | 'skipped';
export type SubmissionType = 'video' | 'photo' | 'text';

export type Profile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
};

export type Group = {
  id: string;
  name: string;
  host_id: string;
  status: GroupStatus;
  /** Postgres interval serialized as text (e.g. "01:00:00" or "1 day"); parse with parseIntervalToMinutes. */
  per_turn_deadline: string;
  created_at: string;
};

export type Membership = {
  id: string;
  group_id: string;
  user_id: string;
  role: MembershipRole;
  status: MembershipStatus;
  joined_at: string | null;
};

export type Round = {
  id: string;
  group_id: string;
  round_number: number;
  status: RoundStatus;
  started_at: string;
};

export type Turn = {
  id: string;
  round_id: string;
  group_id: string;
  called_out_user_id: string;
  /** Null when the system picked (auto-advance, round start — D029). */
  called_by_user_id: string | null;
  /** Server-authoritative (CLAUDE.md §2.1): render deadline_at minus serverNow(), never a local timer. */
  deadline_at: string;
  status: TurnStatus;
  created_at: string;
};

export type Submission = {
  id: string;
  turn_id: string;
  type: SubmissionType;
  text_content: string | null;
  submitted_at: string;
};
