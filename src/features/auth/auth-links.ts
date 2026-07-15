import { supabase } from '@/lib/supabase';

/**
 * Auth email links (D068 password recovery, D070 sign-up confirmation, D041 email change) all follow the same shape: the email carries a GoTrue /auth/v1/verify URL, GoTrue verifies the token server-side, then redirects to our deep link with the outcome in the URL fragment — session tokens on success (implicit flow), an error code on failure. This module turns that fragment back into app state; it never sees or handles raw tokens from the email itself.
 */

export type AuthLinkOutcome =
  /** Tokens were present and the session is now set; `type` distinguishes recovery (route to the reset screen) from signup/email_change (nothing more to do). */
  | { kind: 'session'; type: string | null }
  /** GoTrue rejected the link — expired, already used, or malformed. */
  | { kind: 'error'; code: string; message: string }
  /** Not an auth link (e.g. a group share link); caller should ignore it. */
  | { kind: 'none' };

/** Parses the URL fragment (and query, which GoTrue uses for some error redirects) into a flat param map. Hand-rolled because expo-linking's parser drops fragments, which is where the implicit flow puts everything. */
export function authParamsFromUrl(url: string): Record<string, string> {
  const params: Record<string, string> = {};
  const hashIndex = url.indexOf('#');
  const queryIndex = url.indexOf('?');
  const sections = [
    hashIndex >= 0 ? url.slice(hashIndex + 1) : null,
    queryIndex >= 0 ? url.slice(queryIndex + 1, hashIndex >= 0 ? hashIndex : undefined) : null,
  ];
  for (const section of sections) {
    if (!section) {
      continue;
    }
    for (const pair of section.split('&')) {
      const eq = pair.indexOf('=');
      if (eq <= 0) {
        continue;
      }
      const key = decodeURIComponent(pair.slice(0, eq));
      // Fragment params win over query params when both carry the same key, so only first-write each key (fragment section is processed first).
      if (!(key in params)) {
        params[key] = decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, '%20'));
      }
    }
  }
  return params;
}

/** Applies an auth deep link: sets the session from fragment tokens or reports the link's error. Safe to call with any URL — non-auth links return { kind: 'none' }. */
export async function handleAuthUrl(url: string): Promise<AuthLinkOutcome> {
  const params = authParamsFromUrl(url);

  if (params.error_code || params.error) {
    return {
      kind: 'error',
      code: params.error_code ?? params.error,
      message: params.error_description ?? 'This link is invalid or has expired.',
    };
  }

  if (params.access_token && params.refresh_token) {
    const { error } = await supabase.auth.setSession({
      access_token: params.access_token,
      refresh_token: params.refresh_token,
    });
    if (error) {
      return { kind: 'error', code: error.code ?? 'auth_error', message: error.message };
    }
    return { kind: 'session', type: params.type ?? null };
  }

  return { kind: 'none' };
}
