import { useEffect, useState } from 'react';

import { useSession } from '@/features/auth/SessionProvider';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types/models';

type UseProfileResult = {
  profile: Profile | null;
  isLoading: boolean;
};

type LoadedProfile = {
  userId: string;
  profile: Profile | null;
};

/** Reads the signed-in user's own profile row (auto-created on signup per D023). Read-only — profile edits arrive in a later phase and will go through an RPC. */
export function useProfile(): UseProfileResult {
  const { session } = useSession();
  const userId = session?.user.id ?? null;

  // State tracks which user the loaded profile belongs to, so signed-out and user-switched cases are handled by derivation below instead of synchronous setState in the effect (react-hooks/set-state-in-effect).
  const [loaded, setLoaded] = useState<LoadedProfile | null>(null);

  useEffect(() => {
    if (!userId) {
      return;
    }

    let cancelled = false;

    supabase
      .from('profile')
      .select('id, display_name, avatar_url')
      .eq('id', userId)
      .single()
      .then(({ data, error }) => {
        if (cancelled) {
          return;
        }
        if (error) {
          // Surfaced as a null profile rather than thrown: the only expected failure here is a transient network error, and every consumer has a sensible fallback (generic greeting). Logged so it is never silently swallowed (CLAUDE.md §5.7).
          // eslint-disable-next-line no-console -- deliberate diagnostic for a swallowed-but-recoverable failure; no error UI exists for a missing greeting
          console.warn(`profile load failed (${error.code}): ${error.message}`);
          setLoaded({ userId, profile: null });
        } else {
          setLoaded({ userId, profile: data });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const isCurrent = userId !== null && loaded !== null && loaded.userId === userId;

  return {
    profile: isCurrent ? loaded.profile : null,
    isLoading: userId !== null && !isCurrent,
  };
}
