import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchGroupDetail, type GroupDetail } from '@/features/groups/queries';
import { supabase } from '@/lib/supabase';

type UseGroupDetailResult = {
  detail: GroupDetail | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
};

/**
 * Live game-state bundle for one group. A Realtime channel on the group's turn, round, membership, and group rows triggers refetches, so hand-offs, misses resolved by the scheduled job, roster changes, and pause/resume all appear without manual refresh. Submission rows need no subscription of their own: every submission lands together with a turn status change.
 */
export function useGroupDetail(groupId: string | null): UseGroupDetailResult {
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const load = useCallback(() => {
    if (!groupId) {
      return;
    }
    requestSeq.current += 1;
    const seq = requestSeq.current;
    fetchGroupDetail(groupId)
      .then((result) => {
        if (seq === requestSeq.current) {
          setDetail(result);
          setError(null);
        }
      })
      .catch((e: Error) => {
        if (seq === requestSeq.current) {
          setError(e.message);
        }
      });
  }, [groupId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => {
    if (!groupId) {
      return;
    }
    const groupFilter = `group_id=eq.${groupId}`;
    const channel = supabase
      .channel(`group-detail-${groupId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'turn', filter: groupFilter },
        () => load(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'round', filter: groupFilter },
        () => load(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'membership', filter: groupFilter },
        () => load(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'group', filter: `id=eq.${groupId}` },
        () => load(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [groupId, load]);

  return { detail, isLoading: detail === null && error === null, error, refetch: load };
}
