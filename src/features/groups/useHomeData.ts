import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useSession } from '@/features/auth/SessionProvider';
import { fetchHomeData, type HomeData } from '@/features/groups/queries';
import { supabase } from '@/lib/supabase';

type UseHomeDataResult = {
  data: HomeData | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
};

/**
 * Home-screen data: group summaries plus pending invites. Refetches on focus (returning from any flow) and live on notification inserts for this user — every relay event that matters to the home screen (called out, round started, member joined, group invited) writes a notification row, so that single RLS-scoped subscription doubles as the in-app indicator trigger.
 */
export function useHomeData(): UseHomeDataResult {
  const { session } = useSession();
  const userId = session?.user.id ?? null;

  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const load = useCallback(() => {
    if (!userId) {
      return;
    }
    requestSeq.current += 1;
    const seq = requestSeq.current;
    fetchHomeData(userId)
      .then((result) => {
        if (seq === requestSeq.current) {
          setData(result);
          setError(null);
        }
      })
      .catch((e: Error) => {
        if (seq === requestSeq.current) {
          setError(e.message);
        }
      });
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => {
    if (!userId) {
      return;
    }
    const channel = supabase
      .channel(`home-notifications-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notification',
          filter: `recipient_user_id=eq.${userId}`,
        },
        () => load(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, load]);

  return { data, isLoading: data === null && error === null, error, refetch: load };
}
