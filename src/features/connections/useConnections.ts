import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { useSession } from '@/features/auth/SessionProvider';
import { fetchConnections, type ConnectionView } from '@/features/connections/queries';

type UseConnectionsResult = {
  connections: ConnectionView[] | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
};

/** The signed-in user's connections list. Refetch-on-focus plus explicit refetch after mutations is enough here — connections are a low-frequency surface (D040), unlike live game state. */
export function useConnections(): UseConnectionsResult {
  const { session } = useSession();
  const userId = session?.user.id ?? null;

  const [connections, setConnections] = useState<ConnectionView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const load = useCallback(() => {
    if (!userId) {
      return;
    }
    requestSeq.current += 1;
    const seq = requestSeq.current;
    fetchConnections(userId)
      .then((result) => {
        if (seq === requestSeq.current) {
          setConnections(result);
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

  return {
    connections,
    isLoading: connections === null && error === null,
    error,
    refetch: load,
  };
}
