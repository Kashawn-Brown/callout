import { useLocalSearchParams, useRouter } from 'expo-router';
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
import { GradientButton } from '@/components/GradientButton';
import { findUserByShortId } from '@/features/connections/api';
import { useConnections } from '@/features/connections/useConnections';
import { invitePlayer } from '@/features/groups/api';
import { useGroupDetail } from '@/features/groups/useGroupDetail';
import { initialsOf, memberColor } from '@/lib/format';
import { COLORS, FONTS, RADII, SECTION_LABEL, SPACING } from '@/lib/theme';

/** One selectable person in the picker: an existing connection, or someone found by exact ID — the latter marked as a new invitee with the "+" badge (D061). */
type PickerPerson = {
  userId: string;
  displayName: string;
  color: string;
  initials: string;
  isNew: boolean;
};

/** Add people (host-only; step two of creation, D049, and the mid-game add). The picker defaults to the full connections list, tap-to-select (D059); typing live-filters it by name (D034), and a full exact Callout ID is looked up only on a deliberate tap (D061). Sharing the group is the join code, sent as one pre-written message (D063). */
export default function InvitePlayerScreen(): ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id, step } = useLocalSearchParams<{ id: string; step?: string }>();
  const { detail, refetch } = useGroupDetail(id ?? null);
  const { connections, error: connectionsError } = useConnections();

  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<PickerPerson[]>([]);
  /** People found via exact-ID lookup this session, pinned to the top of the default list with their "+" badge (D061). */
  const [foundPeople, setFoundPeople] = useState<PickerPerson[]>([]);
  const [findNotice, setFindNotice] = useState<string | null>(null);
  const [isFinding, setIsFinding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isInviting, setIsInviting] = useState(false);
  const [invitedCount, setInvitedCount] = useState<number | null>(null);

  const isCreationFlow = step === '2';

  const memberIds = new Set([
    ...(detail?.members.map((m) => m.userId) ?? []),
    ...(detail?.invitedMembers.map((m) => m.userId) ?? []),
  ]);

  const toggle = useCallback((person: PickerPerson): void => {
    setSelected((prev) =>
      prev.some((p) => p.userId === person.userId)
        ? prev.filter((p) => p.userId !== person.userId)
        : [...prev, person],
    );
  }, []);

  // Deliberate exact-ID lookup (D061): fires on tap, never as-you-type.
  const handleFindById = useCallback(async () => {
    const query = search.trim();
    if (query.length === 0) {
      return;
    }
    setIsFinding(true);
    setError(null);
    setFindNotice(null);
    const result = await findUserByShortId({ short_id_code: query });
    setIsFinding(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    const match = result.data[0];
    if (!match) {
      setFindNotice('No one found with that ID — it has to match exactly.');
      return;
    }
    const person: PickerPerson = {
      userId: match.user_id,
      displayName: match.display_name,
      color: memberColor(match.user_id),
      initials: initialsOf(match.display_name),
      // An existing connection found by ID is just a connection; only a stranger gets the "+" (D061).
      isNew: !match.is_connection,
    };
    if (person.isNew) {
      setFoundPeople((prev) =>
        prev.some((p) => p.userId === person.userId) ? prev : [person, ...prev],
      );
    }
    setSelected((prev) =>
      prev.some((p) => p.userId === person.userId) ? prev : [...prev, person],
    );
    setSearch('');
  }, [search]);

  const handleInviteSelected = useCallback(async () => {
    if (!id || selected.length === 0) {
      return;
    }
    setIsInviting(true);
    setError(null);
    let succeeded = 0;
    for (const person of selected) {
      const result = await invitePlayer({ target_group_id: id, target_user_id: person.userId });
      if (result.error) {
        setError(`${person.displayName.split(/\s+/)[0]}: ${result.error.message}`);
        break;
      }
      succeeded += 1;
    }
    setIsInviting(false);
    setSelected((prev) => prev.slice(succeeded));
    setFoundPeople((prev) => prev.filter((p) => !selected.slice(0, succeeded).some((s) => s.userId === p.userId)));
    setInvitedCount(succeeded > 0 ? succeeded : null);
    refetch();
  }, [id, selected, refetch]);

  // One pre-written message carrying the typeable code and a tap-to-open link (D063); the link only pre-fills Join Group, never auto-joins (D064).
  const handleShare = useCallback(async () => {
    if (!detail) {
      return;
    }
    const url = Linking.createURL('join-group', { queryParams: { code: detail.group.join_code } });
    await Share.share({
      message: `Join my Callout group “${detail.group.name}”! Use group code ${detail.group.join_code} in the app’s Join Group tab, or tap: ${url}`,
    });
  }, [detail]);

  // The default list (D059): pinned new invitees first (with their "+"), then the full connections list, live-filtered by name as you type (D034). People already in the group stay visible but unselectable.
  const filterQuery = search.trim().toLowerCase();
  const connectionPeople: PickerPerson[] = (connections ?? []).map((c) => ({
    userId: c.userId,
    displayName: c.displayName,
    color: c.color,
    initials: c.initials,
    isNew: false,
  }));
  const listPeople = [...foundPeople, ...connectionPeople].filter(
    (p) => filterQuery.length === 0 || p.displayName.toLowerCase().includes(filterQuery),
  );

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

      {(error !== null || connectionsError !== null) && (
        <View style={styles.section}>
          <ErrorBanner message={error ?? connectionsError ?? ''} />
        </View>
      )}

      {/* Share the group — the join code, one mechanism (D063) */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Share the Group</Text>
        <View style={styles.shareCard}>
          <View style={styles.codeRow}>
            <Text style={styles.codeLabel}>Group code</Text>
            <Text style={styles.codeValue}>{detail?.group.join_code ?? '········'}</Text>
          </View>
          <Text style={styles.shareBody}>
            Share this code to allow others to join the group.
          </Text>
          <Pressable
            onPress={handleShare}
            disabled={detail === null}
            style={({ pressed }) => [styles.shareButton, pressed && styles.pressed]}
          >
            <Text style={styles.shareButtonLabel}>Share</Text>
          </Pressable>
        </View>
      </View>

      {/* Picker: search box above the default connections list (D059) */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Add People</Text>

        <View style={styles.searchRow}>
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
              onChangeText={(text) => {
                setSearch(text);
                setFindNotice(null);
              }}
              placeholder="Filter connections, or enter a Callout ID"
              placeholderTextColor={COLORS.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.searchInput}
            />
          </View>
          <Pressable
            onPress={handleFindById}
            disabled={isFinding || search.trim().length === 0}
            style={({ pressed }) => [styles.findButton, pressed && styles.pressed]}
          >
            <Text style={styles.findButtonLabel}>{isFinding ? '…' : 'Find ID'}</Text>
          </Pressable>
        </View>
        {findNotice !== null && <Text style={styles.findNotice}>{findNotice}</Text>}
        <Text style={styles.searchHint}>
          Typing filters your connections by name. To invite someone new, enter their full Callout
          ID and tap Find ID.
        </Text>

        {/* Selection chips — new invitees keep their "+" (D061) */}
        {selected.length > 0 && (
          <View style={styles.chipRow}>
            {selected.map((p) => (
              <Pressable
                key={p.userId}
                onPress={() => toggle(p)}
                style={[styles.chip, { backgroundColor: `${p.color}18`, borderColor: `${p.color}44` }]}
              >
                <Avatar initials={p.initials} color={p.color} size={20} />
                <Text style={[styles.chipName, { color: p.color }]}>
                  {p.displayName.split(/\s+/)[0]}
                </Text>
                <Text style={[styles.chipRemove, { color: p.color }]}>×</Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* Default list: pinned finds, then connections (D059) */}
        {connections === null ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={COLORS.ember} />
          </View>
        ) : listPeople.length === 0 ? (
          <Text style={styles.searchHint}>
            {connections.length === 0
              ? 'No connections yet — find someone by their Callout ID above, or share the group code below.'
              : `No connections match “${search.trim()}”.`}
          </Text>
        ) : (
          <View style={styles.contactList}>
            {listPeople.map((p, i) => {
              const isSelected = selected.some((s) => s.userId === p.userId);
              const alreadyIn = memberIds.has(p.userId);
              return (
                <Pressable
                  key={p.userId}
                  onPress={alreadyIn ? undefined : () => toggle(p)}
                  disabled={alreadyIn}
                  style={[
                    styles.contactRow,
                    i < listPeople.length - 1 && styles.contactRowDivider,
                    isSelected && { backgroundColor: `${p.color}10` },
                    alreadyIn && styles.contactRowDisabled,
                  ]}
                >
                  <Avatar initials={p.initials} color={p.color} size={38} ring={isSelected} />
                  <View style={styles.contactInfo}>
                    <Text style={styles.contactName}>{p.displayName}</Text>
                    {p.isNew && <Text style={styles.contactMeta}>New connection</Text>}
                  </View>
                  {alreadyIn ? (
                    <Text style={styles.inGroupLabel}>In group</Text>
                  ) : (
                    isSelected && (
                      <View style={[styles.checkCircle, { backgroundColor: p.color }]}>
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
                    )
                  )}
                </Pressable>
              );
            })}
          </View>
        )}

        {invitedCount !== null && selected.length === 0 && (
          <Text style={styles.invitedNotice}>
            {invitedCount === 1 ? 'Invite sent ✓' : `${invitedCount} invites sent ✓`}
          </Text>
        )}

        {selected.length > 0 && (
          <View style={styles.inviteButtonWrap}>
            <GradientButton
              label={
                isInviting
                  ? 'Inviting…'
                  : `Invite ${selected.length} ${selected.length === 1 ? 'Person' : 'People'}`
              }
              onPress={handleInviteSelected}
              disabled={isInviting}
              variant="invite"
            />
          </View>
        )}
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
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  codeValue: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.display,
    fontSize: 16,
    letterSpacing: 3,
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
  contactMeta: {
    color: COLORS.invite,
    fontFamily: FONTS.body,
    fontSize: 11,
    marginTop: 1,
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
  contactRowDisabled: {
    opacity: 0.55,
  },
  contactRowDivider: {
    borderBottomColor: COLORS.divider,
    borderBottomWidth: 1,
  },
  continueHint: {
    color: COLORS.textMuted,
    fontFamily: FONTS.body,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 12,
    textAlign: 'center',
  },
  findButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(123,97,255,0.15)',
    borderColor: 'rgba(123,97,255,0.4)',
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  findButtonLabel: {
    color: COLORS.invite,
    fontFamily: FONTS.display,
    fontSize: 12,
  },
  findNotice: {
    color: COLORS.warning,
    fontFamily: FONTS.body,
    fontSize: 12,
    marginTop: 8,
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
  inGroupLabel: {
    color: COLORS.textMuted,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 12,
  },
  invitedNotice: {
    color: COLORS.success,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 12,
    marginTop: 10,
    textAlign: 'center',
  },
  inviteButtonWrap: {
    marginTop: 14,
  },
  loadingWrap: {
    paddingVertical: 24,
  },
  pressed: {
    opacity: 0.8,
  },
  searchHint: {
    color: COLORS.textMuted,
    fontFamily: FONTS.body,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 12,
    marginTop: 8,
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
  searchRow: {
    flexDirection: 'row',
    gap: 8,
  },
  searchWrap: {
    flex: 1,
    justifyContent: 'center',
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
    textAlign: 'center',
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
