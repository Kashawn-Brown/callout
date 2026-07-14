import type { PostgrestError } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';
import type { RpcError, RpcResult } from '@/types/api';

/** The server raises app errors with the stable machine code in DETAIL (surfaced as PostgrestError.details) and the human message in MESSAGE — see private.raise_app_error in the Phase 3 migration. Non-app failures (network, permission) fall back to the SQLSTATE. */
function toRpcError(error: PostgrestError): RpcError {
  return {
    code: error.details || error.code || 'unknown_error',
    message: error.message,
  };
}

/** Single client-side RPC entry point (CLAUDE.md §2.2): every mutation goes through here, returning the structured result-or-error shape instead of throwing. */
export async function callRpc<T>(fn: string, params: Record<string, unknown>): Promise<RpcResult<T>> {
  const { data, error } = await supabase.rpc(fn, params);
  if (error) {
    return { data: null, error: toRpcError(error) };
  }
  return { data: data as T, error: null };
}
