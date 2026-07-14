import { initialsOf, resolveAvatarColor } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import type { Connection, Profile } from '@/types/models';

/** One entry in the signed-in user's connections list, already resolved to the other person. */
export type ConnectionView = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  color: string;
  initials: string;
  connectedAt: string;
};

function assertNoError(error: { message: string } | null, context: string): void {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}

/** RLS-filtered reads (CLAUDE.md §2.2): connection rows are participant-only, and the profile policy opens connected users' rows even with no shared group (D033). Sorted by name — the list is the search domain for D034's connections-scoped filtering, done client-side because the whole list is small at this scale. */
export async function fetchConnections(userId: string): Promise<ConnectionView[]> {
  const { data: connectionData, error: connectionError } = await supabase
    .from('connection')
    .select('id, user_a_id, user_b_id, created_at');
  assertNoError(connectionError, 'load connections');
  const connections = connectionData as Connection[];

  const otherIdByConnection = new Map<string, string>();
  for (const c of connections) {
    otherIdByConnection.set(c.id, c.user_a_id === userId ? c.user_b_id : c.user_a_id);
  }
  const otherIds = [...new Set(otherIdByConnection.values())];
  if (otherIds.length === 0) {
    return [];
  }

  const { data: profileData, error: profileError } = await supabase
    .from('profile')
    .select('id, display_name, avatar_url, short_id, avatar_color')
    .in('id', otherIds);
  assertNoError(profileError, 'load connection profiles');
  const profilesById = new Map((profileData as Profile[]).map((p) => [p.id, p]));

  const views: ConnectionView[] = [];
  for (const c of connections) {
    const otherId = otherIdByConnection.get(c.id);
    const profile = otherId ? profilesById.get(otherId) : undefined;
    if (!otherId || !profile) {
      continue;
    }
    views.push({
      userId: otherId,
      displayName: profile.display_name,
      avatarUrl: profile.avatar_url,
      color: resolveAvatarColor(otherId, profile.avatar_color),
      initials: initialsOf(profile.display_name),
      connectedAt: c.created_at,
    });
  }

  return views.sort((a, b) => a.displayName.localeCompare(b.displayName));
}
