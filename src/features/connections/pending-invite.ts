import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Stash for a group join code (D050/D063) that arrived before the user could act on it — a share link opened while signed out, or a code typed on the sign-up screen. The home screen checks this after auth and routes to the Join Group screen pre-filled (never auto-submitted, D064), so links work regardless of the order things happen in (D053's installed-app path).
 */

const STORAGE_KEY = 'callout.pendingJoinCode';

/** Matches group.join_code (D050): 8 characters from the lookalike-free uppercase alphabet. Normalization mirrors the server's upper(btrim(...)). */
const JOIN_CODE_PATTERN = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/;

export function normalizeJoinCode(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  return JOIN_CODE_PATTERN.test(code) ? code : null;
}

/** Pulls a join code out of a share-link deep link (join-group?code=…, D063); returns null for any other URL. */
export function joinCodeFromUrl(url: string): string | null {
  if (!url.includes('join-group')) {
    return null;
  }
  const match = url.match(/[?&]code=([^&#]+)/);
  return match ? normalizeJoinCode(decodeURIComponent(match[1])) : null;
}

export async function stashPendingJoinCode(code: string): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, code);
}

export async function takePendingJoinCode(): Promise<string | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (raw === null) {
    return null;
  }
  await AsyncStorage.removeItem(STORAGE_KEY);
  return normalizeJoinCode(raw);
}
