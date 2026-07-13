import { useLocalSearchParams } from 'expo-router';
import * as Linking from 'expo-linking';
import { useCallback, useState, type ReactElement } from 'react';
import {
  ActivityIndicator,
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
import { useConnections } from '@/features/connections/useConnections';
import type { ConnectionView } from '@/features/connections/queries';
import { createShareInvite, invitePlayer } from '@/features/groups/api';
import { useGroupDetail } from '@/features/groups/useGroupDetail';
import { COLORS, FONTS, RADII, SECTION_LABEL, SPACING } from '@/lib/theme';

/** Host-only mid-game add. Direct invites draw from the host's connections (D035); anyone outside them gets a single-use share link instead (D036). */
export default function InvitePlayerScreen(): ReactElement {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { detail, refetch } = useGroupDetail(id ?? null);
  const { connections, error: connectionsError } = useConnections();

  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [invitedIds, setInvitedIds] = useState<string[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);

  const handleInvite = useCallback(
    async (connection: ConnectionView) => {
      if (!id) {
        return;
      }
      setBusyId(connection.userId);
      setError(null);
      const result = await invitePlayer({ target_group_id: id, target_user_id: connection.userId });
      setBusyId(null);
      if (result.error) {
        setError(result.error.message);
        return;
      }
      setInvitedIds((prev) => [...prev, connection.userId]);
      refetch();
    },
    [id, refetch],
  );

  // One tap = one fresh single-use token (D036), handed to the OS share sheet with both the deep link and the raw code (the code survives channels that mangle URLs).
  const handleShareLink = useCallback(async () => {
    if (!id || !detail) {
      return;
    }
    setIsSharing(true);
    setError(null);
    const result = await createShareInvite({ target_group_id: id });
    setIsSharing(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    const url = Linking.createURL('claim-invite', { queryParams: { token: result.data.token } });
    await Share.share({
      message: `Join my Callout group “${detail.group.name}”! Open this link after installing the app: ${url} — or sign up and enter invite code ${result.data.token}. This invite works exactly once.`,
    });
  }, [id, detail]);

  const memberIds = new Set([
    ...(detail?.members.map((m) => m.userId) ?? []),
    ...(detail?.invitedMembers.map((m) => m.userId) ?? []),
  ]);

  const filterQuery = filter.trim().toLowerCase();
  const candidates = (connections ?? []).filter(
    (c) =>
      !memberIds.has(c.userId) &&
      (filterQuery.length === 0 || c.displayName.toLowerCase().includes(filterQuery)),
  );

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

      {(error !== null || connectionsError !== null) && (
        <View style={styles.section}>
          <ErrorBanner message={error ?? connectionsError ?? ''} />
        </View>
      )}

      {/* From connections (D035) */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>From Your Connections</Text>

        {connections === null ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={COLORS.ember} />
          </View>
        ) : (
          <>
            {connections.length > 0 && (
              <View style={styles.searchWrap}>
                <Svg
                  width={16}
                  height={16}
                  viewBox="0 0 16 16"
                  fill="none"
                  style={styles.searchIcon}
                >
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
            )}

            {candidates.length === 0 ? (
              <Text style={styles.searchHint}>
                {connections.length === 0
                  ? 'No connections yet — add friends from your profile, or share an invite link below.'
                  : filterQuery.length > 0
                    ? `No connections match “${filter.trim()}”.`
                    : 'Everyone you’re connected with is already in this group — share an invite link below to bring someone new.'}
              </Text>
            ) : (
              <View style={styles.resultList}>
                {candidates.map((c, i) => {
                  const justInvited = invitedIds.includes(c.userId);
                  return (
                    <View
                      key={c.userId}
                      style={[styles.resultRow, i < candidates.length - 1 && styles.resultRowDivider]}
                    >
                      <Avatar initials={c.initials} color={c.color} size={38} />
                      <View style={styles.resultInfo}>
                        <Text style={styles.resultName}>{c.displayName}</Text>
                      </View>
                      {justInvited ? (
                        <Text style={styles.invitedLabel}>Invited ✓</Text>
                      ) : (
                        <Pressable
                          onPress={() => handleInvite(c)}
                          disabled={busyId !== null}
                          style={({ pressed }) => [styles.inviteButton, pressed && styles.pressed]}
                        >
                          <Text style={styles.inviteButtonLabel}>
                            {busyId === c.userId ? 'Inviting…' : 'Invite'}
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  );
                })}
              </View>
            )}
          </>
        )}
      </View>

      {/* Someone new (D036) */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Someone New</Text>
        <View style={styles.shareCard}>
          <Text style={styles.shareTitle}>Share a one-time invite link</Text>
          <Text style={styles.shareBody}>
            For a friend who isn’t on Callout yet. Signing up through it puts them straight into
            this group and connects the two of you. Each link works exactly once.
          </Text>
          <Pressable
            onPress={handleShareLink}
            disabled={isSharing}
            style={({ pressed }) => [styles.shareButton, pressed && styles.pressed]}
          >
            <Text style={styles.shareButtonLabel}>
              {isSharing ? 'Creating link…' : 'Create & Share Link'}
            </Text>
          </Pressable>
        </View>
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
  loadingWrap: {
    paddingVertical: 24,
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
    marginTop: 6,
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
  shareTitle: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.bodyBold,
    fontSize: 14,
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
