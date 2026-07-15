import type { Session } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

import { supabase } from '@/lib/supabase';

type SessionContextValue = {
  session: Session | null;
  /** True until the persisted session (if any) has been read back from storage — routing decisions must wait for this to avoid a sign-in flash on cold start. */
  isLoading: boolean;
  /** True while the session came from a password-recovery link (D068): the root layout routes to the reset screen instead of the app until the new password is set (or the user skips out). Deliberately not persisted — a recovery session that survives an app restart is still a real session, and the user can reset again any time. */
  isPasswordRecovery: boolean;
  setPasswordRecovery: (active: boolean) => void;
};

const SessionContext = createContext<SessionContextValue>({
  session: null,
  isLoading: true,
  isPasswordRecovery: false,
  setPasswordRecovery: () => undefined,
});

export function SessionProvider({ children }: { children: ReactNode }): ReactElement {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setIsLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const setPasswordRecovery = useCallback((active: boolean) => {
    setIsPasswordRecovery(active);
  }, []);

  const value = useMemo(
    () => ({ session, isLoading, isPasswordRecovery, setPasswordRecovery }),
    [session, isLoading, isPasswordRecovery, setPasswordRecovery],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  return useContext(SessionContext);
}
