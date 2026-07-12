/** RPC parameter and result shapes, typed once here and imported everywhere (CLAUDE.md §5.1). Field names match the Postgres function signatures in supabase/migrations/20260712190000_mvp_core_loop.sql exactly — supabase-js passes them as named arguments. */

/** Structured RPC failure per CLAUDE.md §5.7: `code` is the stable machine code the server raises in DETAIL (e.g. 'not_your_turn', 'deadline_passed'), `message` is the human sentence. */
export type RpcError = {
  code: string;
  message: string;
};

export type RpcResult<T> = { data: T; error: null } | { data: null; error: RpcError };

export type SearchProfilesParams = {
  search_query: string;
};

export type ProfileSearchRow = {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
};

export type CreateGroupParams = {
  group_name: string;
  deadline_minutes: number;
  invitee_ids: string[];
};

export type CreateGroupResult = {
  group_id: string;
};

export type InvitePlayerParams = {
  target_group_id: string;
  target_user_id: string;
};

export type InvitePlayerResult = {
  membership_id: string;
};

export type RespondToInviteParams = {
  target_group_id: string;
  accept: boolean;
};

/** Fields describing a round the server opened as a side effect (start, rollover, resume — D029). game_paused appears instead when fewer than two active members remain. */
export type RoundOpenedFields = {
  round_id?: string;
  round_number?: number;
  turn_id?: string;
  game_paused?: boolean;
};

export type RespondToInviteResult = RoundOpenedFields & {
  status: 'joined' | 'declined';
};

export type StartGameParams = {
  target_group_id: string;
};

export type StartGameResult = RoundOpenedFields;

export type SubmitTurnParams = {
  target_turn_id: string;
  submission_text: string;
};

export type SubmitTurnResult = RoundOpenedFields & {
  submission_id: string;
  /** True when eligible players remain and the submitter must now pick who is next (manual targeting). False means the round completed (D029). */
  handoff_required: boolean;
  round_completed?: boolean;
};

export type CallOutPlayerParams = {
  target_turn_id: string;
  target_user_id: string;
};

export type CallOutPlayerResult = {
  turn_id: string;
};

export type SkipTurnParams = {
  target_turn_id: string;
};

export type SkipTurnResult = RoundOpenedFields & {
  skipped_turn_id: string;
  next_turn_id?: string;
  round_completed?: boolean;
};

export type RemovePlayerParams = {
  target_group_id: string;
  target_user_id: string;
};

export type RemovePlayerResult = RoundOpenedFields & {
  status: 'removed' | 'invite_rescinded';
  next_turn_id?: string;
  round_completed?: boolean;
};

/** Server-enforced submission length (planning doc §5); mirrored client-side for the composer counter only. */
export const MAX_SUBMISSION_LENGTH = 2000;
