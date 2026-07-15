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
import { useEffect, useRef, type ReactElement } from 'react';
import { Alert } from 'react-native';

import { handleAuthUrl } from '@/features/auth/auth-links';
import { SessionProvider, useSession } from '@/features/auth/SessionProvider';
import { joinCodeFromUrl, stashPendingJoinCode } from '@/features/connections/pending-invite';
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
  const { session, isLoading, isPasswordRecovery, setPasswordRecovery } = useSession();
  const url = useLinkingURL();
  // Each URL is processed exactly once: this effect re-runs when setSession flips the session state, and re-handling the same link would double-fire alerts (and re-consume tokens GoTrue already spent).
  const handledUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!url || url === handledUrlRef.current) {
      return;
    }
    handledUrlRef.current = url;

    // Group share links (D063/D053): signed in, expo-router routes straight to /join-group with the code pre-filled (D064). Signed out, the route guard would drop the URL on the way to sign-in — so the code is stashed here and the home screen resumes it right after auth.
    if (session === null) {
      const code = joinCodeFromUrl(url);
      if (code) {
        void stashPendingJoinCode(code);
        return;
      }
    }

    // Auth email links (D068/D070): GoTrue's redirect carries session tokens or an error in the fragment. Recovery links flip the guard below to the reset screen; confirmation links just sign the user in.
    void handleAuthUrl(url).then((outcome) => {
      if (outcome.kind === 'session' && outcome.type === 'recovery') {
        setPasswordRecovery(true);
      } else if (outcome.kind === 'error') {
        Alert.alert('That link didn’t work', outcome.message);
      }
    });
  }, [url, session, setPasswordRecovery]);

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
        {/* Route-group guards: expo-router redirects to the first available screen when a guard flips, so signing in/out swaps the whole navigation tree without manual redirects. A recovery-link session (D068) is held on the reset screen until the new password is set or the user skips out. */}
        <Stack.Protected guard={session !== null && isPasswordRecovery}>
          <Stack.Screen name="reset-password" />
        </Stack.Protected>
        <Stack.Protected guard={session !== null && !isPasswordRecovery}>
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
