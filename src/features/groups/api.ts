import { callRpc } from '@/lib/rpc';
import type {
  CallOutPlayerParams,
  CallOutPlayerResult,
  CreateGroupParams,
  CreateGroupResult,
  InvitePlayerParams,
  InvitePlayerResult,
  JoinGroupByCodeParams,
  JoinGroupByCodeResult,
  RemovePlayerParams,
  RemovePlayerResult,
  RespondJoinRequestParams,
  RespondJoinRequestResult,
  RespondToInviteParams,
  RespondToInviteResult,
  RpcResult,
  SkipTurnParams,
  SkipTurnResult,
  StartGameParams,
  StartGameResult,
  SubmitTurnParams,
  SubmitTurnResult,
} from '@/types/api';

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

export async function joinGroupByCode(
  params: JoinGroupByCodeParams,
): Promise<RpcResult<JoinGroupByCodeResult>> {
  return callRpc<JoinGroupByCodeResult>('join_group_by_code', params);
}

export async function respondJoinRequest(
  params: RespondJoinRequestParams,
): Promise<RpcResult<RespondJoinRequestResult>> {
  return callRpc<RespondJoinRequestResult>('respond_join_request', params);
}
