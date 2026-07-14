import { useCallback, useEffect, useState } from 'react';

import { useSession } from '@/features/auth/SessionProvider';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types/models';

type UseProfileResult = {
  profile: Profile | null;
  isLoading: boolean;
  refetch: () => void;
};

type LoadedProfile = {
  userId: string;
  profile: Profile | null;
};

/** Reads the signed-in user's own profile row (auto-created on signup per D023). */
export function useProfile(): UseProfileResult {
  const { session } = useSession();
  const userId = session?.user.id ?? null;

  // State tracks which user the loaded profile belongs to, so signed-out and user-switched cases are handled by derivation below instead of synchronous setState in the effect (react-hooks/set-state-in-effect).
  const [loaded, setLoaded] = useState<LoadedProfile | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!userId) {
      return;
    }

    let cancelled = false;

    supabase
      .from('profile')
      .select('id, display_name, avatar_url, short_id, avatar_color')
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
  }, [userId, reloadKey]);

  const refetch = useCallback(() => {
    setReloadKey((key) => key + 1);
  }, []);

  const isCurrent = userId !== null && loaded !== null && loaded.userId === userId;

  return {
    profile: isCurrent ? loaded.profile : null,
    isLoading: userId !== null && !isCurrent,
    refetch,
  };
}

/**
 * Updates the signed-in user's display name through the one sanctioned client-write surface (the Phase 1 profile self-update policy; CLAUDE.md §2.2's exception). The grant is column-scoped server-side, so identity fields like short_id are untouchable regardless of what this sends.
 */
export async function updateDisplayName(
  userId: string,
  displayName: string,
): Promise<{ error: { code: string; message: string } | null }> {
  const { error } = await supabase
    .from('profile')
    .update({ display_name: displayName.trim() })
    .eq('id', userId);

  if (error) {
    return { error: { code: error.code, message: error.message } };
  }
  return { error: null };
}

/** Saves the picked avatar accent through the same self-update surface; the server's check constraint holds the palette line regardless of what the client sends. */
export async function updateAvatarColor(
  userId: string,
  avatarColor: string,
): Promise<{ error: { code: string; message: string } | null }> {
  const { error } = await supabase
    .from('profile')
    .update({ avatar_color: avatarColor })
    .eq('id', userId);

  if (error) {
    return { error: { code: error.code, message: error.message } };
  }
  return { error: null };
}
