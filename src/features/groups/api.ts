import type { PostgrestError } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';
import type {
  CallOutPlayerParams,
  CallOutPlayerResult,
  CreateGroupParams,
  CreateGroupResult,
  InvitePlayerParams,
  InvitePlayerResult,
  ProfileSearchRow,
  RemovePlayerParams,
  RemovePlayerResult,
  RespondToInviteParams,
  RespondToInviteResult,
  RpcError,
  RpcResult,
  SearchProfilesParams,
  SkipTurnParams,
  SkipTurnResult,
  StartGameParams,
  StartGameResult,
  SubmitTurnParams,
  SubmitTurnResult,
} from '@/types/api';

/** The server raises app errors with the stable machine code in DETAIL (surfaced as PostgrestError.details) and the human message in MESSAGE — see private.raise_app_error in the Phase 3 migration. Non-app failures (network, permission) fall back to the SQLSTATE. */
function toRpcError(error: PostgrestError): RpcError {
  return {
    code: error.details || error.code || 'unknown_error',
    message: error.message,
  };
}

async function callRpc<T>(fn: string, params: Record<string, unknown>): Promise<RpcResult<T>> {
  const { data, error } = await supabase.rpc(fn, params);
  if (error) {
    return { data: null, error: toRpcError(error) };
  }
  return { data: data as T, error: null };
}

export async function searchProfiles(
  params: SearchProfilesParams,
): Promise<RpcResult<ProfileSearchRow[]>> {
  return callRpc<ProfileSearchRow[]>('search_profiles', params);
}

export async function createGroup(
  params: CreateGroupParams,
): Promise<RpcResult<CreateGroupResult>> {
  return callRpc<CreateGroupResult>('create_group', params);
}

export async function invitePlayer(
  params: InvitePlayerParams,
): Promise<RpcResult<InvitePlayerResult>> {
  return callRpc<InvitePlayerResult>('invite_player', params);
}

export async function respondToInvite(
  params: RespondToInviteParams,
): Promise<RpcResult<RespondToInviteResult>> {
  return callRpc<RespondToInviteResult>('respond_to_invite', params);
}

export async function startGame(params: StartGameParams): Promise<RpcResult<StartGameResult>> {
  return callRpc<StartGameResult>('start_game', params);
}

export async function submitTurn(params: SubmitTurnParams): Promise<RpcResult<SubmitTurnResult>> {
  return callRpc<SubmitTurnResult>('submit_turn', params);
}

export async function callOutPlayer(
  params: CallOutPlayerParams,
): Promise<RpcResult<CallOutPlayerResult>> {
  return callRpc<CallOutPlayerResult>('call_out_player', params);
}

export async function skipTurn(params: SkipTurnParams): Promise<RpcResult<SkipTurnResult>> {
  return callRpc<SkipTurnResult>('skip_turn', params);
}

export async function removePlayer(
  params: RemovePlayerParams,
): Promise<RpcResult<RemovePlayerResult>> {
  return callRpc<RemovePlayerResult>('remove_player', params);
}
