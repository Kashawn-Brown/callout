import { Stack } from 'expo-router';
import { useEffect, type ReactElement } from 'react';
import { AppState } from 'react-native';

import { syncServerClock } from '@/lib/server-time';
import { COLORS } from '@/lib/theme';

export default function AppLayout(): ReactElement {
  // Server-clock sync (CLAUDE.md §2.1): countdowns render deadline_at minus serverNow(), so the offset is captured on entry to the signed-in tree and re-captured on foreground, when the device clock may have drifted or jumped.
  useEffect(() => {
    void syncServerClock();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void syncServerClock();
      }
    });
    return () => {
      subscription.remove();
    };
  }, []);

  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: COLORS.background } }}
    />
  );
}
