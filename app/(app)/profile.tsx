import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { BackButton } from '@/components/BackButton';
import { ErrorBanner } from '@/components/ErrorBanner';
import {
  linkEmail,
  linkPhone,
  normalizePhone,
  signOut,
  verifyPhoneChange,
} from '@/features/auth/api';
import { useSession } from '@/features/auth/SessionProvider';
import { updateDisplayName, useProfile } from '@/features/auth/useProfile';
import { addConnection, findUserByShortId, removeConnection } from '@/features/connections/api';
import { useConnections } from '@/features/connections/useConnections';
import type { ConnectionView } from '@/features/connections/queries';
import { APP_DOWNLOAD_URL } from '@/lib/app-links';
import { initialsOf, memberColor } from '@/lib/format';
import type { FoundUserRow } from '@/types/api';
import { COLORS, FONTS, RADII, SECTION_LABEL, SPACING } from '@/lib/theme';

const DISPLAY_NAME_MAX_LENGTH = 50;

/** Profile & settings (D040): identity, sign-in methods (D041), and the connections list live here — deliberately not a top-level tab, since this is a low-frequency destination. */
export default function ProfileScreen(): ReactElement {
  const insets = useSafeAreaInsets();
  const { session } = useSession();
  const { profile, refetch: refetchProfile } = useProfile();
  const { connections, error: connectionsError, refetch: refetchConnections } = useConnections();

  const userId = session?.user.id ?? null;

  // Identity
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [nameSaving, setNameSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One search box over the connections list (D059): typing live-filters by name (D034); a full Callout ID is looked up only on a deliberate tap (D061), surfacing the match as an addable row.
  const [search, setSearch] = useState('');
  const [foundUser, setFoundUser] = useState<FoundUserRow | null>(null);
  const [findNotice, setFindNotice] = useState<string | null>(null);
  const [isFinding, setIsFinding] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [addNotice, setAddNotice] = useState<string | null>(null);

  const displayName = nameDraft ?? profile?.display_name ?? '';
  const nameDirty = nameDraft !== null && nameDraft.trim() !== (profile?.display_name ?? '');
  const canSaveName =
    nameDirty && displayName.trim().length > 0 && displayName.trim().length <= DISPLAY_NAME_MAX_LENGTH;

  const handleSaveName = useCallback(async () => {
    if (!userId || nameDraft === null) {
      return;
    }
    setNameSaving(true);
    setError(null);
    const result = await updateDisplayName(userId, nameDraft);
    setNameSaving(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setNameDraft(null);
    refetchProfile();
  }, [userId, nameDraft, refetchProfile]);

  const handleCopyId = useCallback(async () => {
    if (!profile) {
      return;
    }
    await Clipboard.setStringAsync(profile.short_id);
    setCopied(true);
  }, [profile]);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);

  // D066: a plain, static app-download link — no token, no connection created. The Callout ID rides along so a friend who already has the app can add the sharer directly.
  const handleShareApp = useCallback(async () => {
    await Share.share({
      message: `Come play Callout with me! Get the app here: ${APP_DOWNLOAD_URL}${profile ? ` — then add me with my Callout ID ${profile.short_id}.` : ''}`,
    });
  }, [profile]);

  // Deliberate exact-ID lookup (D061): fires on tap, never as-you-type.
  const handleFindById = useCallback(async () => {
    const query = search.trim();
    if (query.length === 0) {
      return;
    }
    setIsFinding(true);
    setError(null);
    setFindNotice(null);
    setFoundUser(null);
    const result = await findUserByShortId({ short_id_code: query });
    setIsFinding(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    const match = result.data[0] ?? null;
    if (!match) {
      setFindNotice('No one found with that ID — it has to match exactly.');
      return;
    }
    setFoundUser(match);
  }, [search]);

  const handleAddConnection = useCallback(
    async (row: FoundUserRow) => {
      setAddBusy(true);
      setAddNotice(null);
      setError(null);
      const result = await addConnection({ target_user_id: row.user_id });
      setAddBusy(false);
      if (result.error) {
        setError(result.error.message);
        return;
      }
      setAddNotice(
        result.data.already_connected
          ? `You’re already connected with ${result.data.display_name}.`
          : `Connected with ${result.data.display_name} 🎉`,
      );
      setSearch('');
      setFoundUser(null);
      refetchConnections();
    },
    [refetchConnections],
  );

  const handleRemoveConnection = useCallback(
    (connection: ConnectionView) => {
      Alert.alert(
        'Remove connection',
        `Remove ${connection.displayName}? This doesn't affect any group you're both in, and you can reconnect later.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: async () => {
              const result = await removeConnection({ target_user_id: connection.userId });
              if (result.error) {
                setError(result.error.message);
                return;
              }
              refetchConnections();
            },
          },
        ],
      );
    },
    [refetchConnections],
  );

  const handleSignOut = useCallback(() => {
    Alert.alert('Sign out', 'Sign out of Callout on this device?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          const result = await signOut();
          if (result.error) {
            Alert.alert('Sign out failed', result.error.message);
          }
        },
      },
    ]);
  }, []);

  // The default list is the full connections list, live-filtered by the search box (D059/D034).
  const filterQuery = search.trim().toLowerCase();
  const visibleConnections = (connections ?? []).filter(
    (c) => filterQuery.length === 0 || c.displayName.toLowerCase().includes(filterQuery),
  );

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <BackButton />
        <Text style={styles.title}>Profile</Text>
      </View>

      {(error !== null || connectionsError !== null) && (
        <View style={styles.section}>
          <ErrorBanner message={error ?? connectionsError ?? ''} />
        </View>
      )}

      {/* Identity */}
      <View style={styles.section}>
        <View style={styles.identityCard}>
          <Avatar
            initials={profile ? initialsOf(profile.display_name) : '?'}
            color={userId ? memberColor(userId) : COLORS.invite}
            size={64}
          />
          <View style={styles.nameRow}>
            <TextInput
              value={displayName}
              onChangeText={setNameDraft}
              placeholder="Your name"
              placeholderTextColor={COLORS.textMuted}
              maxLength={DISPLAY_NAME_MAX_LENGTH}
              style={styles.nameInput}
            />
            {nameDirty && (
              <Pressable
                onPress={handleSaveName}
                disabled={!canSaveName || nameSaving}
                style={({ pressed }) => [styles.saveButton, pressed && styles.pressed]}
              >
                <Text style={styles.saveButtonLabel}>{nameSaving ? 'Saving…' : 'Save'}</Text>
              </Pressable>
            )}
          </View>

          {/* Centered ID block (D062): label, the ID itself, and Copy stacked beneath it; the share action lives on its own row below so it never disturbs this block. */}
          <View style={styles.shortIdBlock}>
            <Text style={styles.shortIdLabel}>Your Callout ID</Text>
            <Text style={styles.shortIdValue}>{profile?.short_id ?? '········'}</Text>
            <Pressable
              onPress={handleCopyId}
              style={({ pressed }) => [styles.copyButton, pressed && styles.pressed]}
            >
              <Text style={styles.copyButtonLabel}>{copied ? 'Copied ✓' : 'Copy'}</Text>
            </Pressable>
          </View>
          <Text style={styles.shortIdHint}>
            Friends add you by this exact ID — there’s no public search.
          </Text>
          {/* D066: a plain app-download link, nothing more — no token, no connection. */}
          <Pressable
            onPress={handleShareApp}
            style={({ pressed }) => [styles.shareAppRow, pressed && styles.pressed]}
          >
            <Text style={styles.shareAppLabel}>Share Callout with a friend →</Text>
          </Pressable>
        </View>
      </View>

      {/* Sign-in methods (D041) */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Sign-in Methods</Text>
        <SignInMethods onError={setError} />
      </View>

      {/* Connections (D033/D034/D038/D040) */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Connections</Text>

        {/* Search box above the default list (D059): typing filters connections by name; Find ID is the deliberate exact-lookup action (D061). */}
        <View style={styles.searchRow}>
          <TextInput
            value={search}
            onChangeText={(text) => {
              setSearch(text);
              setAddNotice(null);
              setFindNotice(null);
              setFoundUser(null);
            }}
            placeholder="Filter connections, or enter a Callout ID"
            placeholderTextColor={COLORS.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.addInput}
          />
          <Pressable
            onPress={handleFindById}
            disabled={isFinding || search.trim().length === 0}
            style={({ pressed }) => [styles.findButton, pressed && styles.pressed]}
          >
            <Text style={styles.findButtonLabel}>{isFinding ? '…' : 'Find ID'}</Text>
          </Pressable>
        </View>
        {findNotice !== null && <Text style={styles.findNotice}>{findNotice}</Text>}
        {addNotice !== null && <Text style={styles.addNotice}>{addNotice}</Text>}

        {/* A found match renders like a connection row but wears the "+" new-person badge (D061); tapping Add connects instantly (D033). */}
        {foundUser !== null && (
          <View style={styles.foundRow}>
            <Avatar
              initials={initialsOf(foundUser.display_name)}
              color={memberColor(foundUser.user_id)}
              size={38}
            />
            <View style={styles.foundInfo}>
              <Text style={styles.foundName}>{foundUser.display_name}</Text>
              <Text style={styles.foundMeta}>ID {foundUser.short_id}</Text>
            </View>
            {foundUser.is_connection ? (
              <Text style={styles.foundConnectedLabel}>Connected ✓</Text>
            ) : (
              <Pressable
                onPress={() => handleAddConnection(foundUser)}
                disabled={addBusy}
                style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
              >
                <Text style={styles.addButtonLabel}>{addBusy ? '…' : 'Add'}</Text>
              </Pressable>
            )}
          </View>
        )}

        {connections === null ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={COLORS.ember} />
          </View>
        ) : connections.length === 0 ? (
          <Text style={styles.emptyText}>
            No connections yet. Find someone by their Callout ID above, or join a group —
            groupmates connect automatically.
          </Text>
        ) : (
          <View style={styles.connectionList}>
            {visibleConnections.map((c, i) => (
              <View
                key={c.userId}
                style={[
                  styles.connectionRow,
                  i < visibleConnections.length - 1 && styles.connectionRowDivider,
                ]}
              >
                <Avatar initials={c.initials} color={c.color} size={38} />
                <Text style={styles.connectionName}>{c.displayName}</Text>
                <Pressable
                  onPress={() => handleRemoveConnection(c)}
                  accessibilityLabel={`Remove ${c.displayName}`}
                  style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}
                >
                  <Text style={styles.removeButtonLabel}>×</Text>
                </Pressable>
              </View>
            ))}
            {visibleConnections.length === 0 && (
              <Text style={styles.emptyFilterText}>No connections match “{search.trim()}”.</Text>
            )}
          </View>
        )}
      </View>

      {/* Sign out */}
      <View style={styles.section}>
        <Pressable
          onPress={handleSignOut}
          style={({ pressed }) => [styles.signOutButton, pressed && styles.pressed]}
        >
          <Text style={styles.signOutLabel}>Sign Out</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

type PhoneLinkStage = 'idle' | 'entering' | 'verifying';

/** Linked sign-in methods with add-the-other flows (D041): email links via its confirmation email; phone links via an SMS code, both the methods' normal verification — no shortcuts. */
function SignInMethods({ onError }: { onError: (message: string | null) => void }): ReactElement {
  const { session } = useSession();

  const [emailDraft, setEmailDraft] = useState('');
  const [emailStage, setEmailStage] = useState<'idle' | 'entering' | 'sent'>('idle');
  const [emailBusy, setEmailBusy] = useState(false);

  const [phoneDraft, setPhoneDraft] = useState('');
  const [phonePending, setPhonePending] = useState<string | null>(null);
  const [phoneCode, setPhoneCode] = useState('');
  const [phoneStage, setPhoneStage] = useState<PhoneLinkStage>('idle');
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [phoneLinkedNow, setPhoneLinkedNow] = useState(false);

  const email = session?.user.email ?? null;
  const phone = session?.user.phone ? `+${session.user.phone}` : null;

  const handleSendEmailLink = useCallback(async () => {
    setEmailBusy(true);
    onError(null);
    const result = await linkEmail(emailDraft);
    setEmailBusy(false);
    if (result.error) {
      onError(result.error.message);
      return;
    }
    setEmailStage('sent');
  }, [emailDraft, onError]);

  const handleSendPhoneCode = useCallback(async () => {
    const normalized = normalizePhone(phoneDraft);
    if (!normalized) {
      onError('Enter a phone number with country code, like +1 555 012 3456.');
      return;
    }
    setPhoneBusy(true);
    onError(null);
    const result = await linkPhone(normalized);
    setPhoneBusy(false);
    if (result.error) {
      onError(result.error.message);
      return;
    }
    setPhonePending(normalized);
    setPhoneStage('verifying');
  }, [phoneDraft, onError]);

  const handleVerifyPhoneCode = useCallback(async () => {
    if (!phonePending) {
      return;
    }
    setPhoneBusy(true);
    onError(null);
    const result = await verifyPhoneChange(phonePending, phoneCode);
    setPhoneBusy(false);
    if (result.error) {
      onError(result.error.message);
      return;
    }
    // The USER_UPDATED auth event refreshes the session; this local flag keeps the UI truthful in the meantime.
    setPhoneLinkedNow(true);
    setPhoneStage('idle');
  }, [phonePending, phoneCode, onError]);

  return (
    <View style={styles.methodsCard}>
      {/* Email */}
      <View style={styles.methodRow}>
        <View style={styles.methodInfo}>
          <Text style={styles.methodLabel}>Email</Text>
          <Text style={styles.methodValue}>{email ?? 'Not linked'}</Text>
        </View>
        {email === null && emailStage === 'idle' && (
          <Pressable
            onPress={() => setEmailStage('entering')}
            style={({ pressed }) => [styles.methodAction, pressed && styles.pressed]}
          >
            <Text style={styles.methodActionLabel}>Add</Text>
          </Pressable>
        )}
      </View>
      {emailStage === 'entering' && (
        <View style={styles.methodFlow}>
          <TextInput
            value={emailDraft}
            onChangeText={setEmailDraft}
            placeholder="you@example.com"
            placeholderTextColor={COLORS.textMuted}
            autoCapitalize="none"
            keyboardType="email-address"
            style={styles.methodInput}
          />
          <Pressable
            onPress={handleSendEmailLink}
            disabled={emailBusy || emailDraft.trim().length === 0}
            style={({ pressed }) => [styles.methodAction, pressed && styles.pressed]}
          >
            <Text style={styles.methodActionLabel}>{emailBusy ? '…' : 'Send link'}</Text>
          </Pressable>
        </View>
      )}
      {emailStage === 'sent' && (
        <Text style={styles.methodNote}>
          Check {emailDraft.trim()} for a confirmation link — the email becomes a sign-in method
          once confirmed.
        </Text>
      )}

      <View style={styles.methodDivider} />

      {/* Phone */}
      <View style={styles.methodRow}>
        <View style={styles.methodInfo}>
          <Text style={styles.methodLabel}>Phone</Text>
          <Text style={styles.methodValue}>
            {phone ?? (phoneLinkedNow ? (phonePending ?? 'Linked') : 'Not linked')}
          </Text>
        </View>
        {phone === null && !phoneLinkedNow && phoneStage === 'idle' && (
          <Pressable
            onPress={() => setPhoneStage('entering')}
            style={({ pressed }) => [styles.methodAction, pressed && styles.pressed]}
          >
            <Text style={styles.methodActionLabel}>Add</Text>
          </Pressable>
        )}
      </View>
      {phoneStage === 'entering' && (
        <View style={styles.methodFlow}>
          <TextInput
            value={phoneDraft}
            onChangeText={setPhoneDraft}
            placeholder="+1 555 012 3456"
            placeholderTextColor={COLORS.textMuted}
            keyboardType="phone-pad"
            style={styles.methodInput}
          />
          <Pressable
            onPress={handleSendPhoneCode}
            disabled={phoneBusy || phoneDraft.trim().length === 0}
            style={({ pressed }) => [styles.methodAction, pressed && styles.pressed]}
          >
            <Text style={styles.methodActionLabel}>{phoneBusy ? '…' : 'Send code'}</Text>
          </Pressable>
        </View>
      )}
      {phoneStage === 'verifying' && (
        <View style={styles.methodFlow}>
          <TextInput
            value={phoneCode}
            onChangeText={setPhoneCode}
            placeholder="6-digit code"
            placeholderTextColor={COLORS.textMuted}
            keyboardType="number-pad"
            maxLength={6}
            style={styles.methodInput}
          />
          <Pressable
            onPress={handleVerifyPhoneCode}
            disabled={phoneBusy || phoneCode.trim().length < 6}
            style={({ pressed }) => [styles.methodAction, pressed && styles.pressed]}
          >
            <Text style={styles.methodActionLabel}>{phoneBusy ? '…' : 'Verify'}</Text>
          </Pressable>
        </View>
      )}
      <Text style={styles.methodNote}>
        Linking a second method means you can still sign in if you ever lose access to the first.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  addButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(123,97,255,0.15)',
    borderColor: 'rgba(123,97,255,0.4)',
    borderRadius: RADII.pill,
    borderWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  addButtonLabel: {
    color: COLORS.invite,
    fontFamily: FONTS.display,
    fontSize: 12,
  },
  addInput: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: 14,
    borderWidth: 1.5,
    color: COLORS.textPrimary,
    flex: 1,
    fontFamily: FONTS.body,
    fontSize: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  addNotice: {
    color: COLORS.success,
    fontFamily: FONTS.body,
    fontSize: 12,
    marginTop: 8,
  },
  connectionList: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: RADII.input,
    borderWidth: 1,
    marginTop: 12,
    overflow: 'hidden',
  },
  connectionName: {
    color: COLORS.textPrimary,
    flex: 1,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 14,
  },
  connectionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  connectionRowDivider: {
    borderBottomColor: COLORS.divider,
    borderBottomWidth: 1,
  },
  copyButton: {
    backgroundColor: COLORS.elevated,
    borderRadius: RADII.pill,
    paddingHorizontal: 16,
  },
  copyButtonLabel: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.display,
    fontSize: 12,
  },
  emptyFilterText: {
    color: COLORS.textMuted,
    fontFamily: FONTS.body,
    fontSize: 12,
    padding: 16,
  },
  emptyText: {
    color: COLORS.textMuted,
    fontFamily: FONTS.body,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 12,
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
  foundConnectedLabel: {
    color: COLORS.success,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 12,
  },
  foundInfo: {
    flex: 1,
  },
  foundMeta: {
    color: COLORS.textMuted,
    fontFamily: FONTS.body,
    fontSize: 11,
    marginTop: 1,
  },
  foundName: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 14,
  },
  foundRow: {
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderColor: 'rgba(123,97,255,0.35)',
    borderRadius: RADII.input,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingBottom: 24,
    paddingHorizontal: SPACING.contentX,
  },
  identityCard: {
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: RADII.card,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  loadingWrap: {
    paddingVertical: 24,
  },
  methodAction: {
    backgroundColor: 'rgba(123,97,255,0.15)',
    borderColor: 'rgba(123,97,255,0.4)',
    borderRadius: RADII.pill,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  methodActionLabel: {
    color: COLORS.invite,
    fontFamily: FONTS.display,
    fontSize: 12,
  },
  methodDivider: {
    backgroundColor: COLORS.divider,
    height: 1,
    marginVertical: 12,
  },
  methodFlow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  methodInfo: {
    flex: 1,
  },
  methodInput: {
    backgroundColor: COLORS.elevated,
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    color: COLORS.textPrimary,
    flex: 1,
    fontFamily: FONTS.body,
    fontSize: 13,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  methodLabel: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 12,
  },
  methodNote: {
    color: COLORS.textMuted,
    fontFamily: FONTS.body,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 10,
  },
  methodRow: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  methodValue: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.body,
    fontSize: 14,
    marginTop: 2,
  },
  methodsCard: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: RADII.card,
    borderWidth: 1,
    padding: 16,
  },
  nameInput: {
    borderBottomColor: COLORS.border,
    borderBottomWidth: 1,
    color: COLORS.textPrimary,
    fontFamily: FONTS.displayExtraBold,
    fontSize: 20,
    letterSpacing: -0.4,
    minWidth: 160,
    paddingVertical: 4,
    textAlign: 'center',
  },
  nameRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  pressed: {
    opacity: 0.8,
  },
  removeButton: {
    alignItems: 'center',
    borderColor: COLORS.border,
    borderRadius: 14,
    borderWidth: 1,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  removeButtonLabel: {
    color: COLORS.textSecondary,
    fontSize: 16,
    lineHeight: 18,
  },
  saveButton: {
    backgroundColor: 'rgba(0,212,170,0.15)',
    borderColor: 'rgba(0,212,170,0.4)',
    borderRadius: RADII.pill,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  saveButtonLabel: {
    color: COLORS.success,
    fontFamily: FONTS.display,
    fontSize: 12,
  },
  section: {
    paddingBottom: 24,
    paddingHorizontal: SPACING.contentX,
  },
  sectionLabel: {
    ...SECTION_LABEL,
    marginBottom: 8,
  },
  searchRow: {
    flexDirection: 'row',
    gap: 8,
  },
  shareAppLabel: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 12,
  },
  shareAppRow: {
    marginTop: 12,
    paddingVertical: 4,
  },
  shortIdHint: {
    color: COLORS.textMuted,
    fontFamily: FONTS.body,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 10,
    textAlign: 'center',
  },
  shortIdLabel: {
    ...SECTION_LABEL,
    fontSize: 10,
  },
  shortIdBlock: {
    alignItems: 'center',
    backgroundColor: COLORS.elevated,
    borderRadius: RADII.input,
    marginTop: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    width: '100%',
  },
  shortIdValue: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.display,
    fontSize: 20,
    letterSpacing: 4,
    marginBottom: 10,
    marginTop: 4,
    textAlign: 'center',
  },
  signOutButton: {
    alignItems: 'center',
    borderColor: 'rgba(255,78,58,0.4)',
    borderRadius: RADII.button,
    borderWidth: 1.5,
    paddingVertical: 14,
  },
  signOutLabel: {
    color: COLORS.ember,
    fontFamily: FONTS.display,
    fontSize: 15,
  },
  title: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.displayExtraBold,
    fontSize: 22,
    letterSpacing: -0.6,
  },
});
