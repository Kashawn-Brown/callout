import { callRpc } from '@/lib/rpc';
import type {
  AddConnectionParams,
  AddConnectionResult,
  FindUserByShortIdParams,
  FoundUserRow,
  RemoveConnectionParams,
  RemoveConnectionResult,
  RpcResult,
} from '@/types/api';

/** Deliberate exact-ID lookup (D056/D060/D061): the only global search key; returns zero or one row. */
export async function findUserByShortId(
  params: FindUserByShortIdParams,
): Promise<RpcResult<FoundUserRow[]>> {
  return callRpc<FoundUserRow[]>('find_user_by_short_id', params);
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
