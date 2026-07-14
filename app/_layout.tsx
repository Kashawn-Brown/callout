import {
  Outfit_700Bold,
  Outfit_800ExtraBold,
  Outfit_900Black,
  useFonts,
} from '@expo-google-fonts/outfit';
import {
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { useLinkingURL } from 'expo-linking';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, type ReactElement } from 'react';

import { SessionProvider, useSession } from '@/features/auth/SessionProvider';
import { pendingInviteFromUrl, stashPendingInvite } from '@/features/connections/pending-invite';
import { COLORS } from '@/lib/theme';

// Keep the native splash visible until fonts and the persisted session are both ready, so cold start never flashes the wrong route group or unstyled text.
SplashScreen.preventAutoHideAsync();

export default function RootLayout(): ReactElement {
  return (
    <SessionProvider>
      <RootNavigator />
    </SessionProvider>
  );
}

function RootNavigator(): ReactElement | null {
  const { session, isLoading } = useSession();
  const url = useLinkingURL();

  // Invite deep links (D052/D053): signed in, expo-router routes straight to /claim-invite or /join-group. Signed out, the route guard would drop the URL on the way to sign-in — so the invite is stashed here and the home screen resumes it right after auth.
  useEffect(() => {
    if (!url || session !== null) {
      return;
    }
    const invite = pendingInviteFromUrl(url);
    if (invite) {
      void stashPendingInvite(invite);
    }
  }, [url, session]);

  const [fontsLoaded] = useFonts({
    Outfit_700Bold,
    Outfit_800ExtraBold,
    Outfit_900Black,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  const ready = fontsLoaded && !isLoading;

  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync();
    }
  }, [ready]);

  if (!ready) {
    return null;
  }

  return (
    <>
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: COLORS.background } }}
      >
        {/* Route-group guards: expo-router redirects to the first available screen when a guard flips, so signing in/out swaps the whole navigation tree without manual redirects. */}
        <Stack.Protected guard={session !== null}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
        <Stack.Protected guard={session === null}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
      </Stack>
      <StatusBar style="light" />
    </>
  );
}
