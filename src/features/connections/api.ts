import { callRpc } from '@/lib/rpc';
import type {
  AddConnectionByEmailParams,
  AddConnectionByEmailResult,
  AddConnectionByShortIdParams,
  AddConnectionByShortIdResult,
  RemoveConnectionParams,
  RemoveConnectionResult,
  RpcResult,
} from '@/types/api';

export async function addConnectionByShortId(
  params: AddConnectionByShortIdParams,
): Promise<RpcResult<AddConnectionByShortIdResult>> {
  return callRpc<AddConnectionByShortIdResult>('add_connection_by_short_id', params);
}

export async function addConnectionByEmail(
  params: AddConnectionByEmailParams,
): Promise<RpcResult<AddConnectionByEmailResult>> {
  return callRpc<AddConnectionByEmailResult>('add_connection_by_email', params);
}

export async function removeConnection(
  params: RemoveConnectionParams,
): Promise<RpcResult<RemoveConnectionResult>> {
  return callRpc<RemoveConnectionResult>('remove_connection', params);
}
