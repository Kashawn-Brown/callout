/** Display helpers for durations, deadlines, and member presentation. Pure functions — no clocks in here; callers pass milliseconds derived from deadline_at minus serverNow() (CLAUDE.md §2.1). */

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 1440;
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/** Member accent palette from the prototype's mock roster, assigned deterministically by user id so a member keeps their color across screens and sessions. Never extend this array: its length feeds the hash below, so adding entries would silently reshuffle every existing user's default color. */
const MEMBER_COLORS = ['#7B61FF', '#00D4AA', '#FF9A2E', '#FF4E3A', '#FF6B9D', '#4ECAFF'] as const;

/** The pickable avatar palette (profile color picker): the six hash colors plus gold and lime. Must stay in sync with the profile.avatar_color check constraint. */
export const AVATAR_COLORS = [...MEMBER_COLORS, '#FFD166', '#A3E635'] as const;

export function memberColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return MEMBER_COLORS[hash % MEMBER_COLORS.length];
}

/** A user's avatar accent: their picked color when set, otherwise the deterministic hash default — so nothing changes for anyone until they choose. */
export function resolveAvatarColor(userId: string, avatarColor: string | null | undefined): string {
  return avatarColor ?? memberColor(userId);
}

export function initialsOf(displayName: string): string {
  const parts = displayName.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '?';
  const second = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : (parts[0]?.[1] ?? '');
  return (first + second).toUpperCase();
}

/**
 * Parses Postgres interval text (PostgREST's default serialization) into minutes. Handles the forms this app produces via make_interval: "HH:MM:SS", "N day(s)", and "N day(s) HH:MM:SS". Returns null for anything unrecognized rather than guessing.
 */
export function parseIntervalToMinutes(interval: string): number | null {
  const match = interval.trim().match(/^(?:(\d+)\s+days?)?\s*(?:(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match || (match[1] === undefined && match[2] === undefined)) {
    return null;
  }
  const days = match[1] ? parseInt(match[1], 10) : 0;
  const hours = match[2] ? parseInt(match[2], 10) : 0;
  const minutes = match[3] ? parseInt(match[3], 10) : 0;
  return days * MINUTES_PER_DAY + hours * MINUTES_PER_HOUR + minutes;
}

/** Compact deadline setting label matching the prototype's presets: "30 min", "6 hours", "1 day". */
export function deadlineLabel(totalMinutes: number): string {
  if (totalMinutes < MINUTES_PER_HOUR) {
    return `${totalMinutes} min`;
  }
  if (totalMinutes < MINUTES_PER_DAY) {
    const hours = Math.round(totalMinutes / MINUTES_PER_HOUR);
    return hours === 1 ? '1 hour' : `${hours} hours`;
  }
  const days = Math.round(totalMinutes / MINUTES_PER_DAY);
  return days === 1 ? '1 day' : `${days} days`;
}

/** Countdown label in the prototype's style: "4h 22m", "47m", "1d 3h", or "0m" once expired (the server resolves the miss; the label just floors at zero). */
export function timeLeftLabel(remainingMs: number): string {
  if (remainingMs <= 0) {
    return '0m';
  }
  const days = Math.floor(remainingMs / MS_PER_DAY);
  const hours = Math.floor((remainingMs % MS_PER_DAY) / MS_PER_HOUR);
  const minutes = Math.floor((remainingMs % MS_PER_HOUR) / MS_PER_MINUTE);
  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

/** Relative timestamp for activity items: "2h ago", "just now". */
export function timeAgoLabel(isoTimestamp: string, nowMs: number): string {
  const elapsed = nowMs - new Date(isoTimestamp).getTime();
  if (elapsed < MS_PER_MINUTE) {
    return 'just now';
  }
  if (elapsed < MS_PER_HOUR) {
    return `${Math.floor(elapsed / MS_PER_MINUTE)}m ago`;
  }
  if (elapsed < MS_PER_DAY) {
    return `${Math.floor(elapsed / MS_PER_HOUR)}h ago`;
  }
  return `${Math.floor(elapsed / MS_PER_DAY)}d ago`;
}
