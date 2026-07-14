import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Stash for an invite that arrived before the user could act on it — a deep link opened while signed out, or a code typed on the sign-up screen. Two kinds exist (D052): a 16-character single-use share token (personal group invite or profile connect link) and an 8-character persistent group join code. The home screen checks the stash after auth and routes to the right flow, so links work regardless of the order things happen in (D053's installed-app path).
 */

const STORAGE_KEY = 'callout.pendingInvite';

/** Matches private.random_code(16) from the Phase 3B migration: the lookalike-free uppercase alphabet. Normalization mirrors the server's upper(btrim(...)). */
const TOKEN_PATTERN = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{16}$/;
/** Matches group.join_code (D050): same alphabet, 8 characters. */
const JOIN_CODE_PATTERN = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/;

export type PendingInvite =
  | { kind: 'token'; value: string }
  | { kind: 'join_code'; value: string };

export function normalizeInviteToken(raw: string): string | null {
  const token = raw.trim().toUpperCase();
  return TOKEN_PATTERN.test(token) ? token : null;
}

export function normalizeJoinCode(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  return JOIN_CODE_PATTERN.test(code) ? code : null;
}

/** Classifies free-typed input (the sign-up code field) by length: 16 characters is a share token, 8 a group join code. */
export function classifyInviteInput(raw: string): PendingInvite | null {
  const token = normalizeInviteToken(raw);
  if (token) {
    return { kind: 'token', value: token };
  }
  const code = normalizeJoinCode(raw);
  if (code) {
    return { kind: 'join_code', value: code };
  }
  return null;
}

/** Pulls an invite out of a deep link: claim-invite?token=… (share tokens) or join-group?code=… (open links, D052); returns null for any other URL. */
export function pendingInviteFromUrl(url: string): PendingInvite | null {
  if (url.includes('claim-invite')) {
    const match = url.match(/[?&]token=([^&#]+)/);
    const token = match ? normalizeInviteToken(decodeURIComponent(match[1])) : null;
    return token ? { kind: 'token', value: token } : null;
  }
  if (url.includes('join-group')) {
    const match = url.match(/[?&]code=([^&#]+)/);
    const code = match ? normalizeJoinCode(decodeURIComponent(match[1])) : null;
    return code ? { kind: 'join_code', value: code } : null;
  }
  return null;
}

export async function stashPendingInvite(invite: PendingInvite): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(invite));
}

export async function takePendingInvite(): Promise<PendingInvite | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (raw === null) {
    return null;
  }
  await AsyncStorage.removeItem(STORAGE_KEY);
  try {
    const parsed = JSON.parse(raw) as PendingInvite;
    if (parsed.kind === 'token' && normalizeInviteToken(parsed.value)) {
      return { kind: 'token', value: parsed.value };
    }
    if (parsed.kind === 'join_code' && normalizeJoinCode(parsed.value)) {
      return { kind: 'join_code', value: parsed.value };
    }
    return null;
  } catch {
    // A stash written by an older build (bare token string) or corrupted storage: salvage what classifies, drop the rest.
    return classifyInviteInput(raw);
  }
}
