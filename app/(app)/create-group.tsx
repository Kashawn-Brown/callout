import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import { Avatar } from '@/components/Avatar';
import { BackButton } from '@/components/BackButton';
import { ErrorBanner } from '@/components/ErrorBanner';
import { GradientButton } from '@/components/GradientButton';
import { FormField } from '@/components/FormField';
import { createGroup, searchProfiles } from '@/features/groups/api';
import { initialsOf, memberColor } from '@/lib/format';
import type { ProfileSearchRow } from '@/types/api';
import { COLORS, FONTS, RADII, SECTION_LABEL, SPACING } from '@/lib/theme';

// The prototype's four deadline presets, expressed in the minutes the create_group RPC takes; the value persists as the group's fixed per-turn deadline (server-authoritative, CLAUDE.md §2.1).
const DEADLINE_OPTIONS = [
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '1 hour' },
  { minutes: 360, label: '6 hours' },
  { minutes: 1440, label: '1 day' },
] as const;

// The search RPC requires 2+ characters (D030); shorter input just shows the hint state.
const MIN_SEARCH_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 300;

export default function CreateGroupScreen(): ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [groupName, setGroupName] = useState('');
  const [search, setSearch] = useState('');
  // Results are stored with the query they answer and derived below, so stale answers and the too-short case need no synchronous setState in the effect (react-hooks/set-state-in-effect).
  const [searchState, setSearchState] = useState<{
    query: string;
    rows: ProfileSearchRow[];
  } | null>(null);
  const [selected, setSelected] = useState<ProfileSearchRow[]>([]);
  const [deadlineMinutes, setDeadlineMinutes] = useState<number>(360);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

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

  const toggle = useCallback((row: ProfileSearchRow): void => {
    setSelected((prev) =>
      prev.some((s) => s.user_id === row.user_id)
        ? prev.filter((s) => s.user_id !== row.user_id)
        : [...prev, row],
    );
  }, []);

  const handleCreate = useCallback(async () => {
    setIsCreating(true);
    setError(null);
    const result = await createGroup({
      group_name: groupName.trim(),
      deadline_minutes: deadlineMinutes,
      invitee_ids: selected.map((s) => s.user_id),
    });
    setIsCreating(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    router.replace(`/group/${result.data.group_id}`);
  }, [groupName, deadlineMinutes, selected, router]);

  const canCreate = groupName.trim().length > 0 && selected.length > 0 && !isCreating;

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }}
      keyboardShouldPersistTaps="handled"
    >
      {/* Header */}
      <View style={styles.header}>
        <BackButton />
        <Text style={styles.title}>New Group</Text>
      </View>

      {error !== null && (
        <View style={styles.section}>
          <ErrorBanner message={error} />
        </View>
      )}

      {/* Group name */}
      <View style={styles.section}>
        <FormField
          label="Group Name"
          value={groupName}
          onChangeText={setGroupName}
          placeholder="e.g. Weekend Crew, Besties…"
        />
      </View>

      {/* Invite people */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Invite People</Text>

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

        {selected.length > 0 && (
          <View style={styles.chipRow}>
            {selected.map((row) => {
              const color = memberColor(row.user_id);
              return (
                <Pressable
                  key={row.user_id}
                  onPress={() => toggle(row)}
                  style={[
                    styles.chip,
                    { backgroundColor: `${color}18`, borderColor: `${color}44` },
                  ]}
                >
                  <Avatar initials={initialsOf(row.display_name)} color={color} size={20} />
                  <Text style={[styles.chipName, { color }]}>
                    {row.display_name.split(/\s+/)[0]}
                  </Text>
                  <Text style={[styles.chipRemove, { color }]}>×</Text>
                </Pressable>
              );
            })}
          </View>
        )}

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
          <View style={styles.contactList}>
            {results.map((row, i) => {
              const isSelected = selected.some((s) => s.user_id === row.user_id);
              const color = memberColor(row.user_id);
              return (
                <Pressable
                  key={row.user_id}
                  onPress={() => toggle(row)}
                  style={[
                    styles.contactRow,
                    i < results.length - 1 && styles.contactRowDivider,
                    isSelected && { backgroundColor: `${color}10` },
                  ]}
                >
                  <Avatar
                    initials={initialsOf(row.display_name)}
                    color={color}
                    size={38}
                    ring={isSelected}
                  />
                  <View style={styles.contactInfo}>
                    <Text style={styles.contactName}>{row.display_name}</Text>
                  </View>
                  {isSelected && (
                    <View style={[styles.checkCircle, { backgroundColor: color }]}>
                      <Svg width={12} height={12} viewBox="0 0 12 12" fill="none">
                        <Path
                          d="M2 6l3 3 5-5"
                          stroke={COLORS.white}
                          strokeWidth={1.8}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </Svg>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      {/* Deadline */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Response Deadline</Text>
        <View style={styles.deadlineRow}>
          {DEADLINE_OPTIONS.map((option) => {
            const active = deadlineMinutes === option.minutes;
            return (
              <Pressable
                key={option.minutes}
                onPress={() => setDeadlineMinutes(option.minutes)}
                style={[styles.deadlineOption, active && styles.deadlineOptionActive]}
              >
                <Text style={[styles.deadlineText, active && styles.deadlineTextActive]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.hintRow}>
          <Svg width={14} height={14} viewBox="0 0 14 14" fill="none">
            <Circle cx={7} cy={7} r={6} stroke={COLORS.textSecondary} strokeWidth={1.3} />
            <Path
              d="M7 4v4l2.5 2"
              stroke={COLORS.textSecondary}
              strokeWidth={1.3}
              strokeLinecap="round"
            />
          </Svg>
          <Text style={styles.hintText}>
            If no response, the turn auto-advances to another member
          </Text>
        </View>
      </View>

      {/* Create */}
      <View style={styles.section}>
        <GradientButton
          label={
            isCreating
              ? 'Creating…'
              : selected.length > 0
                ? `Create Group · ${selected.length + 1} members`
                : 'Create Group'
          }
          onPress={handleCreate}
          disabled={!canCreate}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  checkCircle: {
    alignItems: 'center',
    borderRadius: 11,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  chip: {
    alignItems: 'center',
    borderRadius: RADII.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingLeft: 6,
    paddingRight: 10,
    paddingVertical: 4,
  },
  chipName: {
    fontFamily: FONTS.bodySemiBold,
    fontSize: 12,
  },
  chipRemove: {
    fontSize: 14,
    opacity: 0.7,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  contactInfo: {
    flex: 1,
  },
  contactList: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: RADII.input,
    borderWidth: 1,
    overflow: 'hidden',
  },
  contactName: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 14,
  },
  contactRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  contactRowDivider: {
    borderBottomColor: COLORS.divider,
    borderBottomWidth: 1,
  },
  deadlineOption: {
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: 14,
    borderWidth: 1.5,
    flex: 1,
    paddingVertical: 12,
  },
  deadlineOptionActive: {
    backgroundColor: 'rgba(255,78,58,0.12)',
    borderColor: COLORS.ember,
  },
  deadlineRow: {
    flexDirection: 'row',
    gap: 8,
  },
  deadlineText: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.display,
    fontSize: 13,
  },
  deadlineTextActive: {
    color: COLORS.ember,
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
  hintRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    marginTop: 10,
  },
  hintText: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.body,
    fontSize: 12,
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
  title: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.displayExtraBold,
    fontSize: 22,
    letterSpacing: -0.6,
  },
});
