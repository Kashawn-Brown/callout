import { useRouter } from 'expo-router';
import { useMemo, useState, type ReactElement } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import { Avatar } from '@/components/Avatar';
import { BackButton } from '@/components/BackButton';
import { GradientButton } from '@/components/GradientButton';
import { FormField } from '@/components/FormField';
import { getPlaceholderMember, PLACEHOLDER_MEMBERS } from '@/lib/placeholder-data';
import { COLORS, FONTS, RADII, SECTION_LABEL, SPACING } from '@/lib/theme';

// The prototype's four deadline presets. Phase 3 persists the chosen value as the group's fixed per-turn deadline (server-authoritative, CLAUDE.md §2.1).
const DEADLINE_OPTIONS = [
  { value: '30m', label: '30 min' },
  { value: '1h', label: '1 hour' },
  { value: '6h', label: '6 hours' },
  { value: '1d', label: '1 day' },
] as const;

type DeadlineValue = (typeof DEADLINE_OPTIONS)[number]['value'];

export default function CreateGroupScreen(): ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [groupName, setGroupName] = useState('');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deadline, setDeadline] = useState<DeadlineValue>('6h');

  // Placeholder contact list: everyone but the prototype's "current user". Phase 3 replaces this with a real invite flow.
  const contacts = useMemo(() => PLACEHOLDER_MEMBERS.filter((m) => m.id !== 'u1'), []);
  const filtered = useMemo(
    () => contacts.filter((m) => m.name.toLowerCase().includes(search.trim().toLowerCase())),
    [contacts, search],
  );

  const toggle = (id: string): void => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const canCreate = groupName.trim().length > 0 && selectedIds.length > 0;

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
            placeholder="Search contacts…"
            placeholderTextColor={COLORS.textMuted}
            style={styles.searchInput}
          />
        </View>

        {selectedIds.length > 0 && (
          <View style={styles.chipRow}>
            {selectedIds.map((id) => {
              const m = getPlaceholderMember(id);
              return (
                <Pressable
                  key={id}
                  onPress={() => toggle(id)}
                  style={[
                    styles.chip,
                    { backgroundColor: `${m.color}18`, borderColor: `${m.color}44` },
                  ]}
                >
                  <Avatar initials={m.initials} color={m.color} size={20} />
                  <Text style={[styles.chipName, { color: m.color }]}>{m.name.split(' ')[0]}</Text>
                  <Text style={[styles.chipRemove, { color: m.color }]}>×</Text>
                </Pressable>
              );
            })}
          </View>
        )}

        <View style={styles.contactList}>
          {filtered.map((m, i) => {
            const selected = selectedIds.includes(m.id);
            return (
              <Pressable
                key={m.id}
                onPress={() => toggle(m.id)}
                style={[
                  styles.contactRow,
                  i < filtered.length - 1 && styles.contactRowDivider,
                  selected && { backgroundColor: `${m.color}10` },
                ]}
              >
                <Avatar initials={m.initials} color={m.color} size={38} ring={selected} />
                <View style={styles.contactInfo}>
                  <Text style={styles.contactName}>{m.name}</Text>
                  <Text style={styles.contactHandle}>
                    @{m.name.toLowerCase().replace(/\s+/g, '_')}
                  </Text>
                </View>
                {selected && (
                  <View style={[styles.checkCircle, { backgroundColor: m.color }]}>
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
      </View>

      {/* Deadline */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Response Deadline</Text>
        <View style={styles.deadlineRow}>
          {DEADLINE_OPTIONS.map((option) => {
            const active = deadline === option.value;
            return (
              <Pressable
                key={option.value}
                onPress={() => setDeadline(option.value)}
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

      {/* Create — navigates to the placeholder detail screen; the real create_group RPC arrives in Phase 3 */}
      <View style={styles.section}>
        <GradientButton
          label={
            selectedIds.length > 0
              ? `Create Group · ${selectedIds.length + 1} members`
              : 'Create Group'
          }
          onPress={() => router.push('/group/g1')}
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
  contactHandle: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.body,
    fontSize: 12,
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
