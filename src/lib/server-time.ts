import { supabase } from '@/lib/supabase';

/**
 * Server-clock offset (CLAUDE.md §2.1): no client ever owns a clock. Countdown UIs render deadline_at minus serverNow(); the offset corrects for device clock drift. The interval that repaints a countdown is presentation only — every transition (miss, advance, elimination) happens server-side regardless of what any client displays.
 */

let offsetMs = 0;

/** Fetches the server clock once and stores the device-clock offset. Called on app start and on foreground; failures leave the previous (or zero) offset in place, which degrades to trusting the device clock until the next sync. */
export async function syncServerClock(): Promise<void> {
  const { data, error } = await supabase.rpc('get_server_time');
  if (error) {
    // Not surfaced to the user: a failed sync only means countdowns render with device-clock drift until the next sync. Logged so it is never silently swallowed (CLAUDE.md §5.7).
    // eslint-disable-next-line no-console -- deliberate diagnostic for a recoverable background failure with no user-facing surface
    console.warn(`server clock sync failed (${error.code}): ${error.message}`);
    return;
  }
  offsetMs = new Date(data as string).getTime() - Date.now();
}

export function serverNow(): Date {
  return new Date(Date.now() + offsetMs);
}
