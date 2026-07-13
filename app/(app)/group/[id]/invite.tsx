import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import { Avatar } from '@/components/Avatar';
import { BackButton } from '@/components/BackButton';
import { ErrorBanner } from '@/components/ErrorBanner';
import { invitePlayer, searchProfiles } from '@/features/groups/api';
import { useGroupDetail } from '@/features/groups/useGroupDetail';
import { initialsOf, memberColor } from '@/lib/format';
import type { ProfileSearchRow } from '@/types/api';
import { COLORS, FONTS, RADII, SECTION_LABEL, SPACING } from '@/lib/theme';

const MIN_SEARCH_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 300;

/** Host-only mid-game add (invite_player RPC): the invitee still accepts through the normal join flow, exactly like a creation-time invite. */
export default function InvitePlayerScreen(): ReactElement {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { detail, refetch } = useGroupDetail(id ?? null);

  const [search, setSearch] = useState('');
  // Results are stored with the query they answer and derived below, so stale answers and the too-short case need no synchronous setState in the effect (react-hooks/set-state-in-effect).
  const [searchState, setSearchState] = useState<{
    query: string;
    rows: ProfileSearchRow[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invitedIds, setInvitedIds] = useState<string[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const query = search.trim();
    if (query.length < MIN_SEARCH_LENGTH) {
      return;
    }
    const timer = setTimeout(() => {
      searchProfiles({ search_query: query }).then((result) => {
        if (result.error) {
          setError(result.error.message);
        } else {
          setError(null);
          setSearchState({ query, rows: result.data });
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
    async (row: ProfileSearchRow) => {
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
        <View>
          <Text style={styles.title}>Invite a Player</Text>
          {detail !== null && <Text style={styles.subtitle}>{detail.group.name}</Text>}
        </View>
      </View>

      {error !== null && (
        <View style={styles.section}>
          <ErrorBanner message={error} />
        </View>
      )}

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
            placeholder="Search by name or exact email…"
            placeholderTextColor={COLORS.textMuted}
            autoCapitalize="none"
            style={styles.searchInput}
          />
        </View>

        {search.trim().length < MIN_SEARCH_LENGTH ? (
          <Text style={styles.searchHint}>
            Type at least 2 characters to find people by name, or enter their exact email.
          </Text>
        ) : isSearching ? (
          <Text style={styles.searchHint}>Searching…</Text>
        ) : results.length === 0 ? (
          <Text style={styles.searchHint}>
            No one found — they may need to sign up for Callout first.
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
                  </View>
                  {alreadyIn || justInvited ? (
                    <Text style={styles.invitedLabel}>
                      {justInvited ? 'Invited ✓' : 'In group'}
                    </Text>
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
