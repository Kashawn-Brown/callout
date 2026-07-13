import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Stash for a share-invite token (D036) that arrived before the user could claim it — a deep link opened while signed out, or a code typed on the sign-up screen. The home screen checks this after auth and routes to the claim screen, so "sign up through the link" works regardless of the order things happen in.
 */

const STORAGE_KEY = 'callout.pendingShareInviteToken';

/** Matches private.random_code(16) from the Phase 3B migration: the lookalike-free uppercase alphabet. Normalization here mirrors the server's upper(btrim(...)). */
const TOKEN_PATTERN = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{16}$/;

export function normalizeInviteToken(raw: string): string | null {
  const token = raw.trim().toUpperCase();
  return TOKEN_PATTERN.test(token) ? token : null;
}

/** Pulls a token out of a deep link like callout://claim-invite?token=… or exp://…/--/claim-invite?token=…; returns null for any other URL. */
export function inviteTokenFromUrl(url: string): string | null {
  if (!url.includes('claim-invite')) {
    return null;
  }
  const match = url.match(/[?&]token=([^&#]+)/);
  return match ? normalizeInviteToken(decodeURIComponent(match[1])) : null;
}

export async function stashPendingInviteToken(token: string): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, token);
}

export async function takePendingInviteToken(): Promise<string | null> {
  const token = await AsyncStorage.getItem(STORAGE_KEY);
  if (token !== null) {
    await AsyncStorage.removeItem(STORAGE_KEY);
  }
  return token !== null ? normalizeInviteToken(token) : null;
}
