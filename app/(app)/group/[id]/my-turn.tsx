import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, type ReactElement } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { BackButton } from '@/components/BackButton';
import { CountdownRing } from '@/components/CountdownRing';
import { GradientButton } from '@/components/GradientButton';
import {
  getPlaceholderMember,
  PLACEHOLDER_ACTIVITY,
  PLACEHOLDER_GROUPS,
} from '@/lib/placeholder-data';
import { COLORS, FONTS, RADII, SPACING } from '@/lib/theme';

// Text submission cap from the prototype's composer. Phase 3 enforces the same limit server-side in the submit RPC.
const MAX_SUBMISSION_LENGTH = 280;
const COUNTER_WARNING_THRESHOLD = 40;

export default function MyTurnScreen(): ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const group = PLACEHOLDER_GROUPS.find((g) => g.id === id) ?? PLACEHOLDER_GROUPS[0];
  const [update, setUpdate] = useState('');
  const remaining = MAX_SUBMISSION_LENGTH - update.length;

  const prevItem = PLACEHOLDER_ACTIVITY[0];
  const prevMember = getPlaceholderMember(prevItem.memberId);

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <BackButton />
          <Text style={styles.headerGroup}>{group.name}</Text>
          <View style={styles.headerSpacer} />
        </View>

        {/* You're up hero */}
        <View style={styles.hero}>
          <Text style={styles.heroLabel}>🔥 You&apos;ve been called out</Text>
          <CountdownRing timeLabel={group.timeLeftLabel} pct={0.74} size={130} />
          <Text style={styles.heroTitle}>You&apos;re Up!</Text>
          <Text style={styles.heroSub}>Share what&apos;s on your mind right now</Text>
        </View>

        {/* Previous turn context */}
        <View style={styles.prevCard}>
          <View style={styles.prevHeader}>
            <Avatar initials={prevMember.initials} color={prevMember.color} size={28} />
            <Text style={styles.prevMeta}>
              <Text style={[styles.prevName, { color: prevMember.color }]}>
                {prevMember.name.split(' ')[0]}
              </Text>
              <Text style={styles.prevTime}> shared · {prevItem.timeLabel}</Text>
            </Text>
          </View>
          <Text style={styles.prevText}>{prevItem.text}</Text>
        </View>

        {/* Composer */}
        <View style={[styles.composer, update.length > 0 && styles.composerActive]}>
          <TextInput
            value={update}
            onChangeText={(text) => setUpdate(text.slice(0, MAX_SUBMISSION_LENGTH))}
            placeholder="What's going on in your world? Share something — a thought, a moment, a question for the group…"
            placeholderTextColor={COLORS.textMuted}
            multiline
            style={styles.composerInput}
          />
          <View style={styles.composerFooter}>
            <Text style={styles.composerHint}>Keep it real ✨</Text>
            <Text
              style={[
                styles.composerCount,
                remaining < COUNTER_WARNING_THRESHOLD && styles.composerCountWarning,
              ]}
            >
              {remaining}
            </Text>
          </View>
        </View>

        {/* Submit — navigates to pick-next; the real submit RPC arrives in Phase 3 */}
        <GradientButton
          label={update.trim() ? 'Submit & Pick Next →' : 'Write something first…'}
          onPress={() => router.push(`/group/${group.id}/pick-next`)}
          disabled={!update.trim()}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  composer: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: RADII.card,
    borderWidth: 1.5,
    marginBottom: 16,
    padding: 16,
  },
  composerActive: {
    borderColor: 'rgba(123,97,255,0.5)',
  },
  composerCount: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.display,
    fontSize: 12,
  },
  composerCountWarning: {
    color: COLORS.warning,
  },
  composerFooter: {
    alignItems: 'center',
    borderTopColor: COLORS.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 10,
  },
  composerHint: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.body,
    fontSize: 12,
  },
  composerInput: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.body,
    fontSize: 15,
    lineHeight: 24,
    minHeight: 120,
    textAlignVertical: 'top',
  },
  container: {
    paddingHorizontal: SPACING.screenX,
  },
  flex: {
    backgroundColor: COLORS.background,
    flex: 1,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 16,
    paddingHorizontal: 4,
  },
  headerGroup: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 12,
  },
  headerSpacer: {
    width: 36,
  },
  hero: {
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderColor: 'rgba(255,78,58,0.3)',
    borderRadius: 28,
    borderWidth: 1,
    marginBottom: 20,
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  heroLabel: {
    color: COLORS.ember,
    fontFamily: FONTS.display,
    fontSize: 11,
    letterSpacing: 1.8,
    marginBottom: 16,
    textTransform: 'uppercase',
  },
  heroSub: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.body,
    fontSize: 13,
    marginTop: 6,
  },
  heroTitle: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.displayBlack,
    fontSize: 30,
    letterSpacing: -1.2,
    marginTop: 16,
  },
  prevCard: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: RADII.card,
    borderWidth: 1,
    marginBottom: 16,
    padding: 14,
  },
  prevHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  prevMeta: {
    fontSize: 12,
  },
  prevName: {
    fontFamily: FONTS.bodyBold,
    fontSize: 12,
  },
  prevText: {
    color: COLORS.textBody,
    fontFamily: FONTS.body,
    fontSize: 13,
    lineHeight: 19,
  },
  prevTime: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.body,
    fontSize: 12,
  },
});
