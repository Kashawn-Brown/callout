import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY — copy .env.example to .env and fill in the values from `supabase start` (local) or the Supabase dashboard (hosted).',
  );
}

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // React Native has no URL bar for the web OAuth redirect flow; leaving this on makes the client probe a nonexistent window.location.
    detectSessionInUrl: false,
  },
});

// Token auto-refresh only needs to run while the app is foregrounded; backgrounded apps can't receive the refresh anyway and the OS may kill the timer. Standard supabase-js React Native pattern.
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});

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
