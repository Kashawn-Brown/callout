import { useRouter } from 'expo-router';
import { useCallback, useState, type ReactElement } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
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
import { FormField } from '@/components/FormField';
import { useConnections } from '@/features/connections/useConnections';
import type { ConnectionView } from '@/features/connections/queries';
import { createGroup } from '@/features/groups/api';
import { COLORS, FONTS, RADII, SECTION_LABEL, SPACING } from '@/lib/theme';

// The prototype's four deadline presets, expressed in the minutes the create_group RPC takes; the value persists as the group's fixed per-turn deadline (server-authoritative, CLAUDE.md §2.1).
const DEADLINE_OPTIONS = [
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '1 hour' },
  { minutes: 360, label: '6 hours' },
  { minutes: 1440, label: '1 day' },
] as const;

export default function CreateGroupScreen(): ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { connections, error: connectionsError } = useConnections();

  const [groupName, setGroupName] = useState('');
  const [filter, setFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deadlineMinutes, setDeadlineMinutes] = useState<number>(360);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // The picker draws only from existing connections (D035); the filter searches within them and nothing else (D034). The server enforces the same rule in create_group.
  const filterQuery = filter.trim().toLowerCase();
  const visibleConnections = (connections ?? []).filter(
    (c) => filterQuery.length === 0 || c.displayName.toLowerCase().includes(filterQuery),
  );
  const selected = (connections ?? []).filter((c) => selectedIds.includes(c.userId));

  const toggle = useCallback((connection: ConnectionView): void => {
    setSelectedIds((prev) =>
      prev.includes(connection.userId)
        ? prev.filter((id) => id !== connection.userId)
        : [...prev, connection.userId],
    );
  }, []);

  const handleCreate = useCallback(async () => {
    setIsCreating(true);
    setError(null);
    const result = await createGroup({
      group_name: groupName.trim(),
      deadline_minutes: deadlineMinutes,
      invitee_ids: selectedIds,
    });
    setIsCreating(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    router.replace(`/group/${result.data.group_id}`);
  }, [groupName, deadlineMinutes, selectedIds, router]);

  const canCreate = groupName.trim().length > 0 && selectedIds.length > 0 && !isCreating;

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

      {(error !== null || connectionsError !== null) && (
        <View style={styles.section}>
          <ErrorBanner message={error ?? connectionsError ?? ''} />
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

      {/* Invite people — connections only (D035) */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Invite People</Text>

        {selected.length > 0 && (
          <View style={styles.chipRow}>
            {selected.map((c) => (
              <Pressable
                key={c.userId}
                onPress={() => toggle(c)}
                style={[styles.chip, { backgroundColor: `${c.color}18`, borderColor: `${c.color}44` }]}
              >
                <Avatar initials={c.initials} color={c.color} size={20} />
                <Text style={[styles.chipName, { color: c.color }]}>
                  {c.displayName.split(/\s+/)[0]}
                </Text>
                <Text style={[styles.chipRemove, { color: c.color }]}>×</Text>
              </Pressable>
            ))}
          </View>
        )}

        {connections === null ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={COLORS.ember} />
          </View>
        ) : connections.length === 0 ? (
          <Text style={styles.emptyHint}>
            Groups are built from your connections, and you don’t have any yet. Add friends by
            their Callout ID or email from your profile first — or invite someone new with a share
            link after the group exists.
          </Text>
        ) : (
          <>
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
                value={filter}
                onChangeText={setFilter}
                placeholder="Search your connections…"
                placeholderTextColor={COLORS.textMuted}
                autoCapitalize="none"
                style={styles.searchInput}
              />
            </View>

            {visibleConnections.length === 0 ? (
              <Text style={styles.emptyHint}>No connections match “{filter.trim()}”.</Text>
            ) : (
              <View style={styles.contactList}>
                {visibleConnections.map((c, i) => {
                  const isSelected = selectedIds.includes(c.userId);
                  return (
                    <Pressable
                      key={c.userId}
                      onPress={() => toggle(c)}
                      style={[
                        styles.contactRow,
                        i < visibleConnections.length - 1 && styles.contactRowDivider,
                        isSelected && { backgroundColor: `${c.color}10` },
                      ]}
                    >
                      <Avatar initials={c.initials} color={c.color} size={38} ring={isSelected} />
                      <View style={styles.contactInfo}>
                        <Text style={styles.contactName}>{c.displayName}</Text>
                      </View>
                      {isSelected && (
                        <View style={[styles.checkCircle, { backgroundColor: c.color }]}>
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
          </>
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
              : selectedIds.length > 0
                ? `Create Group · ${selectedIds.length + 1} members`
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
  emptyHint: {
    color: COLORS.textMuted,
    fontFamily: FONTS.body,
    fontSize: 12,
    lineHeight: 18,
    paddingVertical: 8,
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
  loadingWrap: {
    paddingVertical: 24,
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
