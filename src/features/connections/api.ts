import { callRpc } from '@/lib/rpc';
import type {
  AddConnectionParams,
  AddConnectionResult,
  CreateShareInviteResult,
  RemoveConnectionParams,
  RemoveConnectionResult,
  RpcResult,
  SearchUserRow,
  SearchUsersParams,
} from '@/types/api';

/** D047/D056 search: exact ID/email across the whole user base, name matches within the caller's connections only (D034). */
export async function searchUsers(
  params: SearchUsersParams,
): Promise<RpcResult<SearchUserRow[]>> {
  return callRpc<SearchUserRow[]>('search_users', params);
}

export async function addConnection(
  params: AddConnectionParams,
): Promise<RpcResult<AddConnectionResult>> {
  return callRpc<AddConnectionResult>('add_connection', params);
}

export async function removeConnection(
  params: RemoveConnectionParams,
): Promise<RpcResult<RemoveConnectionResult>> {
  return callRpc<RemoveConnectionResult>('remove_connection', params);
}

/** Profile-level mutual connect link (D055): single-use, no group, new-signups-only like every share token (D054). */
export async function createConnectInvite(): Promise<RpcResult<CreateShareInviteResult>> {
  return callRpc<CreateShareInviteResult>('create_connect_invite', {});
}
