import { useRouter } from 'expo-router';
import { useState, type ReactElement } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { Avatar } from '@/components/Avatar';
import { GradientButton } from '@/components/GradientButton';
import { getPlaceholderMember } from '@/lib/placeholder-data';
import { COLORS, FONTS, RADII, SPACING } from '@/lib/theme';

// Placeholder eligible pool mirroring the prototype: everyone but the member who just went. Phase 3 replaces this with the fairness-window query — only not-yet-gone-this-round members ever appear, with no override (CLAUDE.md §2.6, D014).
const ELIGIBLE_MEMBER_IDS = ['u2', 'u3', 'u4'];

export default function PickNextScreen(): ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const eligible = ELIGIBLE_MEMBER_IDS.map(getPlaceholderMember);
  const picked = pickedId ? getPlaceholderMember(pickedId) : null;

  if (sent && picked) {
    return (
      <View style={[styles.flex, styles.sentWrap, { paddingTop: insets.top }]}>
        <View style={styles.sentBadge}>
          <Svg width={36} height={36} viewBox="0 0 36 36" fill="none">
            <Path
              d="M8 18l7 7 13-13"
              stroke={COLORS.success}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </View>
        <Text style={styles.sentTitle}>Callout sent!</Text>
        <Text style={styles.sentSub}>{picked.name.split(' ')[0]} is now on the clock ⏱</Text>

        <View style={styles.sentCard}>
          <Avatar
            initials={picked.initials}
            color={picked.color}
            size={44}
            ring
            ringColor={COLORS.success}
          />
          <View>
            <Text style={styles.sentCardName}>{picked.name}</Text>
            <Text style={styles.sentCardNote}>Has 6 hours to respond</Text>
          </View>
        </View>

        <Pressable
          onPress={() => router.dismissTo('/')}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <Text style={styles.backButtonLabel}>Back to Groups</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Posted chip + heading */}
      <View style={styles.headerBlock}>
        <View style={styles.postedChip}>
          <Svg width={12} height={12} viewBox="0 0 12 12" fill="none">
            <Path
              d="M2 6l3 3 5-5"
              stroke={COLORS.success}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
          <Text style={styles.postedChipText}>Update posted</Text>
        </View>
        <Text style={styles.title}>Who&apos;s up next?</Text>
        <Text style={styles.subtitle}>Pick someone from Weekend Crew to call out</Text>
      </View>

      {/* Eligible members */}
      <View style={styles.memberList}>
        {eligible.map((m) => {
          const isPicked = pickedId === m.id;
          return (
            <Pressable
              key={m.id}
              onPress={() => setPickedId(isPicked ? null : m.id)}
              style={[
                styles.memberCard,
                isPicked && { backgroundColor: `${m.color}12`, borderColor: m.color },
              ]}
            >
              <Avatar initials={m.initials} color={m.color} size={48} ring={isPicked} />
              <View style={styles.memberInfo}>
                <Text style={styles.memberName}>{m.name}</Text>
                <Text style={styles.memberNote}>Responded 2 rounds ago</Text>
              </View>
              <View
                style={[styles.radio, isPicked && { backgroundColor: m.color, borderWidth: 0 }]}
              >
                {isPicked && (
                  <Svg width={13} height={13} viewBox="0 0 13 13" fill="none">
                    <Path
                      d="M2.5 6.5l3 3 5-5"
                      stroke={COLORS.white}
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </Svg>
                )}
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* Call out — flips to the sent state; the real call_out RPC arrives in Phase 3 */}
      <View style={styles.ctaWrap}>
        <GradientButton
          label={picked ? `Call Out ${picked.name.split(' ')[0]} 🔥` : 'Select someone first'}
          onPress={() => setSent(true)}
          disabled={!picked}
        />
        <Text style={styles.ctaNote}>
          They&apos;ll get a notification and have 6 hours to respond
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  backButton: {
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: RADII.button,
    borderWidth: 1,
    maxWidth: 300,
    paddingVertical: 15,
    width: '100%',
  },
  backButtonLabel: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.display,
    fontSize: 15,
  },
  ctaNote: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.body,
    fontSize: 12,
    marginTop: 12,
    textAlign: 'center',
  },
  ctaWrap: {
    paddingHorizontal: SPACING.screenX,
    paddingTop: 24,
  },
  flex: {
    backgroundColor: COLORS.background,
    flex: 1,
  },
  headerBlock: {
    paddingBottom: 24,
    paddingHorizontal: SPACING.contentX,
  },
  memberCard: {
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: RADII.card,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 14,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  memberInfo: {
    flex: 1,
  },
  memberList: {
    gap: 10,
    paddingHorizontal: SPACING.screenX,
  },
  memberName: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.display,
    fontSize: 17,
    letterSpacing: -0.3,
  },
  memberNote: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.body,
    fontSize: 12,
    marginTop: 2,
  },
  postedChip: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(0,212,170,0.1)',
    borderColor: 'rgba(0,212,170,0.25)',
    borderRadius: RADII.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  postedChipText: {
    color: COLORS.success,
    fontFamily: FONTS.display,
    fontSize: 11,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  pressed: {
    opacity: 0.8,
  },
  radio: {
    alignItems: 'center',
    borderColor: COLORS.border,
    borderRadius: 13,
    borderWidth: 2,
    height: 26,
    justifyContent: 'center',
    width: 26,
  },
  sentBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,212,170,0.15)',
    borderColor: 'rgba(0,212,170,0.4)',
    borderRadius: 40,
    borderWidth: 2,
    height: 80,
    justifyContent: 'center',
    marginBottom: 20,
    width: 80,
  },
  sentCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,212,170,0.08)',
    borderColor: 'rgba(0,212,170,0.2)',
    borderRadius: RADII.card,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 32,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  sentCardName: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.display,
    fontSize: 16,
  },
  sentCardNote: {
    color: COLORS.success,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 12,
    marginTop: 2,
  },
  sentSub: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.body,
    fontSize: 14,
    marginBottom: 28,
    textAlign: 'center',
  },
  sentTitle: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.displayBlack,
    fontSize: 28,
    letterSpacing: -1.1,
    marginBottom: 8,
    textAlign: 'center',
  },
  sentWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  subtitle: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.body,
    fontSize: 14,
    marginTop: 6,
  },
  title: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.displayBlack,
    fontSize: 28,
    letterSpacing: -1.1,
    lineHeight: 31,
  },
});
