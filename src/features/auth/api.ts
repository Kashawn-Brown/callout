import { supabase } from '@/lib/supabase';

/** Structured auth result per CLAUDE.md §5.7 — callers render `error` through the shared error UI instead of catching throws. */
export type AuthResult = {
  error: { code: string; message: string } | null;
  /** True when sign-up succeeded but the project requires email confirmation before a session exists (off locally, may be on for a hosted project). */
  needsEmailConfirmation?: boolean;
};

const FALLBACK_CODE = 'auth_error';

export async function signUpWithEmail(
  email: string,
  password: string,
  displayName: string,
): Promise<AuthResult> {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: {
      // Consumed by private.handle_new_user (migration 20260712170000) to seed public.profile.display_name (D023).
      data: { display_name: displayName.trim() },
    },
  });

  if (error) {
    return { error: { code: error.code ?? FALLBACK_CODE, message: error.message } };
  }

  return { error: null, needsEmailConfirmation: data.session === null };
}

export async function signInWithEmail(email: string, password: string): Promise<AuthResult> {
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });

  if (error) {
    return { error: { code: error.code ?? FALLBACK_CODE, message: error.message } };
  }

  return { error: null };
}

export async function signOut(): Promise<AuthResult> {
  const { error } = await supabase.auth.signOut();

  if (error) {
    return { error: { code: error.code ?? FALLBACK_CODE, message: error.message } };
  }

  return { error: null };
}

/**
 * Loose E.164 normalization for phone auth (D037): strips separators, keeps a leading +, and prefixes one for bare digit runs (the auth server requires country codes). Returns null when the result can't plausibly be a phone number, so screens can reject before a round-trip.
 */
export function normalizePhone(input: string): string | null {
  const stripped = input.replace(/[\s\-().]/g, '');
  const match = stripped.match(/^\+?(\d{8,15})$/);
  return match ? `+${match[1]}` : null;
}

/** Starts phone sign-up (D037): sends the SMS one-time code and passes the display name through metadata to the D023 profile trigger, mirroring email sign-up. No password exists on this path. */
export async function signUpWithPhone(phone: string, displayName: string): Promise<AuthResult> {
  const { error } = await supabase.auth.signInWithOtp({
    phone,
    options: { data: { display_name: displayName.trim() } },
  });

  if (error) {
    return { error: { code: error.code ?? FALLBACK_CODE, message: error.message } };
  }

  return { error: null };
}

/** Starts phone sign-in: sends the code without creating an account, so a typo'd number fails loudly instead of minting a ghost user. */
export async function signInWithPhone(phone: string): Promise<AuthResult> {
  const { error } = await supabase.auth.signInWithOtp({
    phone,
    options: { shouldCreateUser: false },
  });

  if (error) {
    return { error: { code: error.code ?? FALLBACK_CODE, message: error.message } };
  }

  return { error: null };
}

/** Completes phone sign-up/sign-in by verifying the SMS code; on success a session exists and the root layout's guard swaps route groups. */
export async function verifyPhoneOtp(phone: string, token: string): Promise<AuthResult> {
  const { error } = await supabase.auth.verifyOtp({ phone, token: token.trim(), type: 'sms' });

  if (error) {
    return { error: { code: error.code ?? FALLBACK_CODE, message: error.message } };
  }

  return { error: null };
}

/** Links an email to the signed-in account (D041) through the normal confirmation flow: the address only becomes a sign-in method once its confirmation link is clicked. */
export async function linkEmail(email: string): Promise<AuthResult> {
  const { error } = await supabase.auth.updateUser({ email: email.trim() });

  if (error) {
    return { error: { code: error.code ?? FALLBACK_CODE, message: error.message } };
  }

  return { error: null, needsEmailConfirmation: true };
}

/** Starts linking a phone to the signed-in account (D041): sends the SMS code; verifyPhoneChange completes it. */
export async function linkPhone(phone: string): Promise<AuthResult> {
  const { error } = await supabase.auth.updateUser({ phone });

  if (error) {
    return { error: { code: error.code ?? FALLBACK_CODE, message: error.message } };
  }

  return { error: null };
}

/** Completes the phone-link flow with the phone_change verification type — the session already exists, only the phone number's ownership is being proven (D041). */
export async function verifyPhoneChange(phone: string, token: string): Promise<AuthResult> {
  const { error } = await supabase.auth.verifyOtp({
    phone,
    token: token.trim(),
    type: 'phone_change',
  });

  if (error) {
    return { error: { code: error.code ?? FALLBACK_CODE, message: error.message } };
  }

  return { error: null };
}
