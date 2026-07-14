import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import {
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import { Avatar } from '@/components/Avatar';
import { BackButton } from '@/components/BackButton';
import { ErrorBanner } from '@/components/ErrorBanner';
import { GradientButton } from '@/components/GradientButton';
import { SegmentedToggle } from '@/components/SegmentedToggle';
import { searchUsers } from '@/features/connections/api';
import { createShareInvite, invitePlayer } from '@/features/groups/api';
import { useGroupDetail } from '@/features/groups/useGroupDetail';
import { initialsOf, memberColor } from '@/lib/format';
import type { SearchUserRow } from '@/types/api';
import { COLORS, FONTS, RADII, SECTION_LABEL, SPACING } from '@/lib/theme';

const MIN_SEARCH_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 300;

type ShareMode = 'single' | 'open';

/** Add people (host-only; step two of creation, D049, and the mid-game add). One search box does both jobs (D047): a full exact Callout ID or email finds anyone on the platform; a name finds people among the host's connections (D034). Someone without the app gets a share link — single-use personal token or the open join-code link (D052). */
export default function InvitePlayerScreen(): ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id, step } = useLocalSearchParams<{ id: string; step?: string }>();
  const { detail, refetch } = useGroupDetail(id ?? null);

  const [search, setSearch] = useState('');
  // Results are stored with the query they answer and derived below, so stale answers and the too-short case need no synchronous setState in the effect (react-hooks/set-state-in-effect).
  const [searchState, setSearchState] = useState<{ query: string; rows: SearchUserRow[] } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [invitedIds, setInvitedIds] = useState<string[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [shareMode, setShareMode] = useState<ShareMode>('single');
  const [isSharing, setIsSharing] = useState(false);

  const isCreationFlow = step === '2';

  useEffect(() => {
    const query = search.trim();
    if (query.length < MIN_SEARCH_LENGTH) {
      return;
    }
    const timer = setTimeout(() => {
      searchUsers({ search_query: query }).then((result) => {
        if (result.error) {
          setError(result.error.message);
        } else {
          setError(null);
          // The server can return a connection twice when it matches both exactly and by name; keep the first (exact-sorted) row per user.
          const seen = new Set<string>();
          const rows = result.data.filter((row) => {
            if (seen.has(row.user_id)) {
              return false;
            }
            seen.add(row.user_id);
            return true;
          });
          setSearchState({ query, rows });
        }
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [search]);

  const query = search.trim();
  const results = searchState !== null && searchState.query === query ? searchState.rows : [];
  const isSearching =
    query.length >= MIN_SEARCH_LENGTH && (searchState === null || searchState.query !== query);

  const handleInvite = useCallback(
    async (row: SearchUserRow) => {
      if (!id) {
        return;
      }
      setBusyId(row.user_id);
      setError(null);
      const result = await invitePlayer({ target_group_id: id, target_user_id: row.user_id });
      setBusyId(null);
      if (result.error) {
        setError(result.error.message);
        return;
      }
      setInvitedIds((prev) => [...prev, row.user_id]);
      refetch();
    },
    [id, refetch],
  );

  // Share sheet content per mode (D052): a fresh single-use token, or the group's persistent join code wrapped in a URL — the raw code rides along for channels that mangle links.
  const handleShareLink = useCallback(async () => {
    if (!id || !detail) {
      return;
    }
    setError(null);
    if (shareMode === 'single') {
      setIsSharing(true);
      const result = await createShareInvite({ target_group_id: id });
      setIsSharing(false);
      if (result.error) {
        setError(result.error.message);
        return;
      }
      const url = Linking.createURL('claim-invite', { queryParams: { token: result.data.token } });
      await Share.share({
        message: `Join my Callout group “${detail.group.name}”! Install the app, then open this link: ${url} — or sign up and enter invite code ${result.data.token}. This invite is for one person and works exactly once.`,
      });
    } else {
      const url = Linking.createURL('join-group', {
        queryParams: { code: detail.group.join_code },
      });
      await Share.share({
        message: `Join my Callout group “${detail.group.name}”! Install the app, then open this link: ${url} — or use Join Group with code ${detail.group.join_code}. Anyone with the code can use it.`,
      });
    }
  }, [id, detail, shareMode]);

  const memberIds = new Set([
    ...(detail?.members.map((m) => m.userId) ?? []),
    ...(detail?.invitedMembers.map((m) => m.userId) ?? []),
  ]);

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <BackButton />
        <View style={styles.headerText}>
          <Text style={styles.title}>{isCreationFlow ? 'Add People' : 'Invite a Player'}</Text>
          <Text style={styles.subtitle}>
            {isCreationFlow ? 'Step 2 of 3' : ''}
            {isCreationFlow && detail !== null ? ' · ' : ''}
            {detail !== null ? detail.group.name : ''}
          </Text>
        </View>
      </View>

      {error !== null && (
        <View style={styles.section}>
          <ErrorBanner message={error} />
        </View>
      )}

      {/* Search: exact ID/email reaches everyone, names reach connections (D047/D034) */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Find People</Text>
        <View style={styles.searchWrap}>
          <Svg width={16} height={16} viewBox="0 0 16 16" fill="none" style={styles.searchIcon}>
            <Circle cx={7} cy={7} r={5} stroke={COLORS.textSecondary} strokeWidth={1.5} />
            <Path
              d="M11 11l3 3"
              stroke={COLORS.textSecondary}
              strokeWidth={1.5}
              strokeLinecap="round"
            />
          </Svg>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Exact Callout ID or email — or a connection’s name"
            placeholderTextColor={COLORS.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.searchInput}
          />
        </View>

        {query.length < MIN_SEARCH_LENGTH ? (
          <Text style={styles.searchHint}>
            A full Callout ID or exact email finds anyone on Callout. Names only search your own
            connections.
          </Text>
        ) : isSearching ? (
          <Text style={styles.searchHint}>Searching…</Text>
        ) : results.length === 0 ? (
          <Text style={styles.searchHint}>
            No one found. IDs and emails must match exactly — or share the group with them below.
          </Text>
        ) : (
          <View style={styles.resultList}>
            {results.map((row, i) => {
              const color = memberColor(row.user_id);
              const alreadyIn = memberIds.has(row.user_id);
              const justInvited = invitedIds.includes(row.user_id);
              return (
                <View
                  key={row.user_id}
                  style={[styles.resultRow, i < results.length - 1 && styles.resultRowDivider]}
                >
                  <Avatar initials={initialsOf(row.display_name)} color={color} size={38} />
                  <View style={styles.resultInfo}>
                    <Text style={styles.resultName}>{row.display_name}</Text>
                    <Text style={styles.resultMeta}>
                      {row.is_connection ? 'Connection' : `ID ${row.short_id}`}
                    </Text>
                  </View>
                  {alreadyIn || justInvited ? (
                    <Text style={styles.invitedLabel}>{justInvited ? 'Invited ✓' : 'In group'}</Text>
                  ) : (
                    <Pressable
                      onPress={() => handleInvite(row)}
                      disabled={busyId !== null}
                      style={({ pressed }) => [styles.inviteButton, pressed && styles.pressed]}
                    >
                      <Text style={styles.inviteButtonLabel}>
                        {busyId === row.user_id ? 'Inviting…' : 'Invite'}
                      </Text>
                    </Pressable>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </View>

      {/* Share the group (D052): personal single-use link, or the open join-code link */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Share the Group</Text>
        <View style={styles.shareCard}>
          <SegmentedToggle
            options={[
              { id: 'single', label: 'One person' },
              { id: 'open', label: 'Anyone with the link' },
            ]}
            activeId={shareMode}
            onChange={(mode) => setShareMode(mode as ShareMode)}
          />
          <Text style={styles.shareBody}>
            {shareMode === 'single'
              ? 'A private link for one new-to-Callout friend: signing up through it puts them straight into this group and connects you two. Dead after first use.'
              : 'Your group’s permanent code, shareable anywhere (like a group chat). Before the game starts people join instantly; after that, you approve each request.'}
          </Text>
          {shareMode === 'open' && detail !== null && (
            <View style={styles.codeRow}>
              <Text style={styles.codeLabel}>Group code</Text>
              <Text style={styles.codeValue}>{detail.group.join_code}</Text>
            </View>
          )}
          <Pressable
            onPress={handleShareLink}
            disabled={isSharing || detail === null}
            style={({ pressed }) => [styles.shareButton, pressed && styles.pressed]}
          >
            <Text style={styles.shareButtonLabel}>
              {isSharing
                ? 'Creating link…'
                : shareMode === 'single'
                  ? 'Create & Share Private Link'
                  : 'Share Group Link'}
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Step-2 continue (D049) */}
      {isCreationFlow && detail !== null && (
        <View style={styles.section}>
          <GradientButton
            label="Continue to Group →"
            onPress={() => router.replace(`/group/${detail.group.id}`)}
          />
          <Text style={styles.continueHint}>
            You can keep adding people any time. Starting the game is step 3, on the group screen.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  codeLabel: {
    ...SECTION_LABEL,
    fontSize: 10,
  },
  codeRow: {
    alignItems: 'center',
    backgroundColor: COLORS.elevated,
    borderRadius: RADII.input,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  codeValue: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.display,
    fontSize: 16,
    letterSpacing: 3,
  },
  continueHint: {
    color: COLORS.textMuted,
    fontFamily: FONTS.body,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 12,
    textAlign: 'center',
  },
  flex: {
    backgroundColor: COLORS.background,
    flex: 1,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingBottom: 24,
    paddingHorizontal: SPACING.contentX,
  },
  headerText: {
    flex: 1,
  },
  inviteButton: {
    backgroundColor: 'rgba(123,97,255,0.15)',
    borderColor: 'rgba(123,97,255,0.4)',
    borderRadius: RADII.pill,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  inviteButtonLabel: {
    color: COLORS.invite,
    fontFamily: FONTS.display,
    fontSize: 12,
  },
  invitedLabel: {
    color: COLORS.success,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 12,
  },
  pressed: {
    opacity: 0.8,
  },
  resultInfo: {
    flex: 1,
  },
  resultList: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: RADII.input,
    borderWidth: 1,
    overflow: 'hidden',
  },
  resultMeta: {
    color: COLORS.textMuted,
    fontFamily: FONTS.body,
    fontSize: 11,
    marginTop: 1,
  },
  resultName: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 14,
  },
  resultRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  resultRowDivider: {
    borderBottomColor: COLORS.divider,
    borderBottomWidth: 1,
  },
  searchHint: {
    color: COLORS.textMuted,
    fontFamily: FONTS.body,
    fontSize: 12,
    lineHeight: 18,
    paddingVertical: 8,
  },
  searchIcon: {
    left: 14,
    position: 'absolute',
    zIndex: 1,
  },
  searchInput: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: 14,
    borderWidth: 1.5,
    color: COLORS.textPrimary,
    fontFamily: FONTS.body,
    fontSize: 14,
    paddingLeft: 40,
    paddingRight: 16,
    paddingVertical: 12,
  },
  searchWrap: {
    justifyContent: 'center',
    marginBottom: 12,
  },
  section: {
    paddingBottom: 24,
    paddingHorizontal: SPACING.contentX,
  },
  sectionLabel: {
    ...SECTION_LABEL,
    marginBottom: 8,
  },
  shareBody: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.body,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 12,
  },
  shareButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(123,97,255,0.15)',
    borderColor: 'rgba(123,97,255,0.4)',
    borderRadius: RADII.button,
    borderWidth: 1,
    marginTop: 14,
    paddingVertical: 12,
  },
  shareButtonLabel: {
    color: COLORS.invite,
    fontFamily: FONTS.display,
    fontSize: 13,
  },
  shareCard: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: RADII.card,
    borderWidth: 1,
    padding: 16,
  },
  subtitle: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.body,
    fontSize: 12,
    marginTop: 1,
  },
  title: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.displayExtraBold,
    fontSize: 22,
    letterSpacing: -0.6,
  },
});
