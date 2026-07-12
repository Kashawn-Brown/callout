import { useEffect, useState } from 'react';

import { timeLeftLabel } from '@/lib/format';
import { serverNow } from '@/lib/server-time';

const TICK_MS = 1000;
/** Below this fraction of the window remaining, countdowns render in the warning treatment. */
const URGENT_THRESHOLD = 0.2;

type CountdownView = {
  label: string;
  /** Fraction of the deadline window remaining, 0–1, for the ring arc. */
  pct: number;
  urgent: boolean;
  expired: boolean;
};

/**
 * Ticking presentation of a server-authoritative deadline (CLAUDE.md §2.1): remaining time is always deadline_at minus serverNow(); the interval only repaints. Nothing here ever drives a transition — when the deadline passes, the scheduled job resolves the turn and Realtime delivers the new state.
 */
export function useCountdown(
  deadlineAt: string | null,
  windowMinutes: number | null,
): CountdownView {
  const [nowMs, setNowMs] = useState(() => serverNow().getTime());

  useEffect(() => {
    if (!deadlineAt) {
      return;
    }
    const interval = setInterval(() => {
      setNowMs(serverNow().getTime());
    }, TICK_MS);
    return () => {
      clearInterval(interval);
    };
  }, [deadlineAt]);

  if (!deadlineAt) {
    return { label: '—', pct: 0, urgent: false, expired: false };
  }

  const remainingMs = new Date(deadlineAt).getTime() - nowMs;
  const windowMs = windowMinutes !== null && windowMinutes > 0 ? windowMinutes * 60_000 : null;
  const pct = windowMs ? Math.min(Math.max(remainingMs / windowMs, 0), 1) : 0;

  return {
    label: timeLeftLabel(remainingMs),
    pct,
    urgent: remainingMs > 0 && pct < URGENT_THRESHOLD,
    expired: remainingMs <= 0,
  };
}
