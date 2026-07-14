import { useRouter } from 'expo-router';
import { useCallback, useState, type ReactElement } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import { BackButton } from '@/components/BackButton';
import { ErrorBanner } from '@/components/ErrorBanner';
import { GradientButton } from '@/components/GradientButton';
import { FormField } from '@/components/FormField';
import { createGroup } from '@/features/groups/api';
import { COLORS, FONTS, SECTION_LABEL, SPACING } from '@/lib/theme';

// The prototype's four deadline presets, expressed in the minutes the create_group RPC takes; the value persists as the group's fixed per-turn deadline (server-authoritative, CLAUDE.md §2.1).
const DEADLINE_OPTIONS = [
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '1 hour' },
  { minutes: 360, label: '6 hours' },
  { minutes: 1440, label: '1 day' },
] as const;

/** Step one of the three-step creation flow (D049): name and settings only. Creating lands the group in setup and hands off to the add-people screen (step two); starting the game (step three) lives on the group detail screen. */
export default function CreateGroupScreen(): ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [groupName, setGroupName] = useState('');
  const [deadlineMinutes, setDeadlineMinutes] = useState<number>(360);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = useCallback(async () => {
    setIsCreating(true);
    setError(null);
    const result = await createGroup({
      group_name: groupName.trim(),
      deadline_minutes: deadlineMinutes,
    });
    setIsCreating(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    router.replace(`/group/${result.data.group_id}/invite?step=2`);
  }, [groupName, deadlineMinutes, router]);

  const canCreate = groupName.trim().length > 0 && !isCreating;

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }}
      keyboardShouldPersistTaps="handled"
    >
      {/* Header */}
      <View style={styles.header}>
        <BackButton />
        <View>
          <Text style={styles.title}>New Group</Text>
          <Text style={styles.stepLabel}>Step 1 of 3 · Settings</Text>
        </View>
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
          label={isCreating ? 'Creating…' : 'Create & Add People →'}
          onPress={handleCreate}
          disabled={!canCreate}
        />
        <Text style={styles.nextStepHint}>
          Next you’ll add people — search anyone by exact Callout ID or email, pick from your
          connections, or share the group code.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
  nextStepHint: {
    color: COLORS.textMuted,
    fontFamily: FONTS.body,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 12,
    textAlign: 'center',
  },
  section: {
    paddingBottom: 24,
    paddingHorizontal: SPACING.contentX,
  },
  sectionLabel: {
    ...SECTION_LABEL,
    marginBottom: 8,
  },
  stepLabel: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.body,
    fontSize: 12,
    marginTop: 2,
  },
  title: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.displayExtraBold,
    fontSize: 22,
    letterSpacing: -0.6,
  },
});
