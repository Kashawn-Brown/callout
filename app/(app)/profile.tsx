import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
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
import {
  addConnection,
  createConnectInvite,
  removeConnection,
  searchUsers,
} from '@/features/connections/api';
import { useConnections } from '@/features/connections/useConnections';
import type { ConnectionView } from '@/features/connections/queries';
import { initialsOf, memberColor } from '@/lib/format';
import type { SearchUserRow } from '@/types/api';
import { COLORS, FONTS, RADII, SECTION_LABEL, SPACING } from '@/lib/theme';

const DISPLAY_NAME_MAX_LENGTH = 50;
/** Above this many connections the list gets a name filter — D034's connections-scoped search surface. */
const FILTER_VISIBLE_THRESHOLD = 6;
const MIN_SEARCH_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 300;

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

  // Add-connection search (D056): exact ID/email reaches anyone; results are tapped to add. Stored with the query they answer, like every debounced search in the app.
  const [addInput, setAddInput] = useState('');
  const [addSearchState, setAddSearchState] = useState<{
    query: string;
    rows: SearchUserRow[];
  } | null>(null);
  const [addBusyId, setAddBusyId] = useState<string | null>(null);
  const [addNotice, setAddNotice] = useState<string | null>(null);
  const [isSharingConnect, setIsSharingConnect] = useState(false);

  // Connections name filter (D034)
  const [filter, setFilter] = useState('');

  useEffect(() => {
    const query = addInput.trim();
    if (query.length < MIN_SEARCH_LENGTH) {
      return;
    }
    const timer = setTimeout(() => {
      searchUsers({ search_query: query }).then((result) => {
        if (result.error) {
          setError(result.error.message);
        } else {
          setError(null);
          setAddSearchState({ query, rows: result.data });
        }
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [addInput]);

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

  // D055/D057: the identity card's share action mints a single-use mutual connect link — when a friend signs up through it, both of you become connected at once. The raw Callout ID rides along for hand-typed adds.
  const handleShareConnectLink = useCallback(async () => {
    if (!profile) {
      return;
    }
    setIsSharingConnect(true);
    setError(null);
    const result = await createConnectInvite();
    setIsSharingConnect(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    const url = Linking.createURL('claim-invite', { queryParams: { token: result.data.token } });
    await Share.share({
      message: `Connect with me on Callout! Install the app, then open this link: ${url} — or add me by my Callout ID ${profile.short_id}. The link works exactly once.`,
    });
  }, [profile]);

  const handleAddConnection = useCallback(
    async (row: SearchUserRow) => {
      setAddBusyId(row.user_id);
      setAddNotice(null);
      setError(null);
      const result = await addConnection({ target_user_id: row.user_id });
      setAddBusyId(null);
      if (result.error) {
        setError(result.error.message);
        return;
      }
      setAddNotice(
        result.data.already_connected
          ? `You’re already connected with ${result.data.display_name}.`
          : `Connected with ${result.data.display_name} 🎉`,
      );
      setAddInput('');
      setAddSearchState(null);
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

  const filterQuery = filter.trim().toLowerCase();
  const visibleConnections = (connections ?? []).filter(
    (c) => filterQuery.length === 0 || c.displayName.toLowerCase().includes(filterQuery),
  );

  const addQuery = addInput.trim();
  const addResults =
    addSearchState !== null && addSearchState.query === addQuery ? addSearchState.rows : [];
  const isAddSearching =
    addQuery.length >= MIN_SEARCH_LENGTH &&
    (addSearchState === null || addSearchState.query !== addQuery);

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

          <View style={styles.shortIdRow}>
            <View>
              <Text style={styles.shortIdLabel}>Your Callout ID</Text>
              <Text style={styles.shortIdValue}>{profile?.short_id ?? '········'}</Text>
            </View>
            {/* Copy and share sit together on the identity card (D057): copy hands out the ID, share mints the D055 mutual connect link. */}
            <View style={styles.idActions}>
              <Pressable
                onPress={handleCopyId}
                style={({ pressed }) => [styles.copyButton, pressed && styles.pressed]}
              >
                <Text style={styles.copyButtonLabel}>{copied ? 'Copied ✓' : 'Copy'}</Text>
              </Pressable>
              <Pressable
                onPress={handleShareConnectLink}
                disabled={isSharingConnect}
                style={({ pressed }) => [styles.copyButton, pressed && styles.pressed]}
              >
                <Text style={styles.copyButtonLabel}>{isSharingConnect ? '…' : 'Share'}</Text>
              </Pressable>
            </View>
          </View>
          <Text style={styles.shortIdHint}>
            Friends add you by this exact ID or your email — there’s no public search. Share sends
            a one-time link that connects you both when they sign up.
          </Text>
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

        <TextInput
          value={addInput}
          onChangeText={(text) => {
            setAddInput(text);
            setAddNotice(null);
          }}
          placeholder="Add by exact Callout ID or email…"
          placeholderTextColor={COLORS.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.addInput}
        />
        {addQuery.length >= MIN_SEARCH_LENGTH &&
          (isAddSearching ? (
            <Text style={styles.addNotice}>Searching…</Text>
          ) : addResults.length === 0 ? (
            <Text style={styles.addEmpty}>
              No exact match — IDs and emails must match exactly, and names only search people
              you’re already connected with.
            </Text>
          ) : (
            <View style={styles.addResultList}>
              {addResults.map((row, i) => (
                <View
                  key={row.user_id}
                  style={[styles.addResultRow, i < addResults.length - 1 && styles.addResultDivider]}
                >
                  <Avatar
                    initials={initialsOf(row.display_name)}
                    color={memberColor(row.user_id)}
                    size={34}
                  />
                  <View style={styles.addResultInfo}>
                    <Text style={styles.addResultName}>{row.display_name}</Text>
                    <Text style={styles.addResultMeta}>ID {row.short_id}</Text>
                  </View>
                  {row.is_connection ? (
                    <Text style={styles.addConnectedLabel}>Connected ✓</Text>
                  ) : (
                    <Pressable
                      onPress={() => handleAddConnection(row)}
                      disabled={addBusyId !== null}
                      style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
                    >
                      <Text style={styles.addButtonLabel}>
                        {addBusyId === row.user_id ? '…' : 'Add'}
                      </Text>
                    </Pressable>
                  )}
                </View>
              ))}
            </View>
          ))}
        {addNotice !== null && <Text style={styles.addNotice}>{addNotice}</Text>}

        {connections === null ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={COLORS.ember} />
          </View>
        ) : connections.length === 0 ? (
          <Text style={styles.emptyText}>
            No connections yet. Add someone by their ID or email, or join a group — groupmates
            connect automatically.
          </Text>
        ) : (
          <>
            {connections.length >= FILTER_VISIBLE_THRESHOLD && (
              <TextInput
                value={filter}
                onChangeText={setFilter}
                placeholder="Search your connections…"
                placeholderTextColor={COLORS.textMuted}
                autoCapitalize="none"
                style={styles.filterInput}
              />
            )}
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
                <Text style={styles.emptyFilterText}>No connections match “{filter.trim()}”.</Text>
              )}
            </View>
          </>
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
  addConnectedLabel: {
    color: COLORS.success,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 12,
  },
  addEmpty: {
    color: COLORS.textMuted,
    fontFamily: FONTS.body,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
  },
  addInput: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: 14,
    borderWidth: 1.5,
    color: COLORS.textPrimary,
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
  addResultDivider: {
    borderBottomColor: COLORS.divider,
    borderBottomWidth: 1,
  },
  addResultInfo: {
    flex: 1,
  },
  addResultList: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: RADII.input,
    borderWidth: 1,
    marginTop: 10,
    overflow: 'hidden',
  },
  addResultMeta: {
    color: COLORS.textMuted,
    fontFamily: FONTS.body,
    fontSize: 11,
    marginTop: 1,
  },
  addResultName: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 13,
  },
  addResultRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
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
    paddingVertical: 8,
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
  filterInput: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: 14,
    borderWidth: 1,
    color: COLORS.textPrimary,
    fontFamily: FONTS.body,
    fontSize: 13,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
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
  idActions: {
    flexDirection: 'row',
    gap: 8,
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
  shortIdRow: {
    alignItems: 'center',
    backgroundColor: COLORS.elevated,
    borderRadius: RADII.input,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 18,
    paddingHorizontal: 16,
    paddingVertical: 12,
    width: '100%',
  },
  shortIdValue: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.display,
    fontSize: 18,
    letterSpacing: 3,
    marginTop: 2,
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
