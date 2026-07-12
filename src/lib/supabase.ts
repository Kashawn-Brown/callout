import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY — copy .env.example to .env and fill in the values from `supabase start` (local) or the Supabase dashboard (hosted).',
  );
}

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Pings the Supabase Auth health endpoint to confirm the configured project is reachable.
 * Used by the Phase 0 skeleton screen as a connectivity check; safe to call before any schema exists.
 */
export async function checkSupabaseConnection(): Promise<boolean> {
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: SUPABASE_ANON_KEY as string },
    });
    return response.ok;
  } catch {
    // Network-level failure (host down, wrong URL). Reported to the caller as unreachable rather than thrown, since "not connected" is an expected state this check exists to detect.
    return false;
  }
}
