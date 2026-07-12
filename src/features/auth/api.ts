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
