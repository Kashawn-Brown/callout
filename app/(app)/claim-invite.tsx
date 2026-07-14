import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
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

import { BackButton } from '@/components/BackButton';
import { ErrorBanner } from '@/components/ErrorBanner';
import { GradientButton } from '@/components/GradientButton';
import { normalizeInviteToken } from '@/features/connections/pending-invite';
import { claimShareInvite, previewShareInvite } from '@/features/groups/api';
import { COLORS, FONTS, RADII, SPACING } from '@/lib/theme';
import type { PreviewShareInviteResult } from '@/types/api';

/** Claim a share-invite (D036): preview what's being joined, then join and auto-connect with the inviter in one action. Reached by deep link, by the post-auth pending-token hand-off, or with a manually pasted code. */
export default function ClaimInviteScreen(): ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token: tokenParam } = useLocalSearchParams<{ token?: string }>();

  const [manualCode, setManualCode] = useState('');
  const [token, setToken] = useState<string | null>(() =>
    tokenParam ? normalizeInviteToken(tokenParam) : null,
  );
  const [preview, setPreview] = useState<PreviewShareInviteResult | null>(null);
  const [connectedWith, setConnectedWith] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isClaiming, setIsClaiming] = useState(false);

  useEffect(() => {
    if (!token) {
      return;
    }
    let cancelled = false;
    previewShareInvite({ invite_token: token }).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.error) {
        setError(result.error.message);
        setToken(null);
      } else {
        setError(null);
        setPreview(result.data);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleUseCode = useCallback(() => {
    const normalized = normalizeInviteToken(manualCode);
    if (!normalized) {
      setError('That doesn’t look like an invite code — it’s 16 letters and numbers.');
      return;
    }
    setError(null);
    setPreview(null);
    setToken(normalized);
  }, [manualCode]);

  const handleClaim = useCallback(async () => {
    if (!token) {
      return;
    }
    setIsClaiming(true);
    setError(null);
    const result = await claimShareInvite({ invite_token: token });
    setIsClaiming(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    if (result.data.status === 'connected') {
      // Connect links (D055) have no group to land in; show the mutual-connection result instead.
      setConnectedWith(preview?.inviter_name ?? null);
      return;
    }
    router.dismissTo(`/group/${result.data.group_id}`);
  }, [token, router, preview]);

  if (connectedWith !== null) {
    return (
      <View style={[styles.flex, styles.connectedWrap, { paddingTop: insets.top }]}>
        <Text style={styles.connectedEmoji}>🤝</Text>
        <Text style={styles.connectedTitle}>
          {connectedWith ? `You’re connected with ${connectedWith.split(/\s+/)[0]}!` : 'You’re connected!'}
        </Text>
        <Text style={styles.connectedSub}>
          You can now invite each other to groups. Find them any time in your connections.
        </Text>
        <View style={styles.connectedButtonWrap}>
          <GradientButton label="Back to Home" onPress={() => router.dismissTo('/')} variant="invite" />
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <BackButton />
        <Text style={styles.title}>Join by Invite</Text>
      </View>

      {error !== null && (
        <View style={styles.section}>
          <ErrorBanner message={error} />
        </View>
      )}

      {token === null ? (
        <View style={styles.section}>
          <Text style={styles.hint}>
            Got an invite code from a friend? Paste it here to join their group.
          </Text>
          <TextInput
            value={manualCode}
            onChangeText={setManualCode}
            placeholder="16-character invite code"
            placeholderTextColor={COLORS.textMuted}
            autoCapitalize="characters"
            autoCorrect={false}
            style={styles.codeInput}
          />
          <GradientButton
            label="Look Up Invite"
            onPress={handleUseCode}
            disabled={manualCode.trim().length === 0}
            variant="invite"
          />
        </View>
      ) : preview === null ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={COLORS.invite} />
        </View>
      ) : (
        <View style={styles.section}>
          <View style={styles.previewCard}>
            <Text style={styles.previewEmoji}>{preview.kind === 'connect' ? '🤝' : '💌'}</Text>
            <Text style={styles.previewTitle}>
              {preview.kind === 'connect'
                ? (preview.inviter_name ?? 'A Callout user')
                : preview.group_name}
            </Text>
            <Text style={styles.previewSub}>
              {preview.kind === 'connect'
                ? 'wants to connect on Callout — accepting links you both as connections, no group involved.'
                : preview.inviter_name
                  ? `${preview.inviter_name.split(/\s+/)[0]} invited you — joining also connects the two of you.`
                  : 'You’ve been invited to join this group.'}
            </Text>
            {preview.kind === 'group' && (
              <Text style={styles.previewMeta}>
                {preview.member_count} {preview.member_count === 1 ? 'member' : 'members'}
              </Text>
            )}
          </View>

          {preview.status === 'used' ? (
            <>
              <Text style={styles.usedText}>
                This invite link has already been used — each one works exactly once. Ask for a new
                link or a direct invite.
              </Text>
              <Pressable
                onPress={() => router.dismissTo('/')}
                style={({ pressed }) => [styles.plainButton, pressed && styles.pressed]}
              >
                <Text style={styles.plainButtonLabel}>Back to Home</Text>
              </Pressable>
            </>
          ) : (
            <GradientButton
              label={
                isClaiming
                  ? preview.kind === 'connect'
                    ? 'Connecting…'
                    : 'Joining…'
                  : preview.kind === 'connect'
                    ? 'Connect 🤝'
                    : 'Join Group 🎉'
              }
              onPress={handleClaim}
              disabled={isClaiming}
              variant="invite"
            />
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  codeInput: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: 14,
    borderWidth: 1.5,
    color: COLORS.textPrimary,
    fontFamily: FONTS.display,
    fontSize: 16,
    letterSpacing: 2,
    marginBottom: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    textAlign: 'center',
  },
  connectedButtonWrap: {
    maxWidth: 280,
    width: '100%',
  },
  connectedEmoji: {
    fontSize: 40,
    marginBottom: 12,
  },
  connectedSub: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.body,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 32,
    textAlign: 'center',
  },
  connectedTitle: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.displayBlack,
    fontSize: 26,
    letterSpacing: -1,
    marginBottom: 8,
    textAlign: 'center',
  },
  connectedWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
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
  hint: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.body,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 16,
  },
  loadingWrap: {
    paddingVertical: 48,
  },
  plainButton: {
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: RADII.button,
    borderWidth: 1,
    paddingVertical: 14,
  },
  plainButtonLabel: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.display,
    fontSize: 15,
  },
  pressed: {
    opacity: 0.8,
  },
  previewCard: {
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderColor: 'rgba(123,97,255,0.25)',
    borderRadius: 28,
    borderWidth: 1,
    marginBottom: 20,
    paddingHorizontal: 24,
    paddingVertical: 28,
  },
  previewEmoji: {
    fontSize: 36,
    marginBottom: 12,
  },
  previewMeta: {
    color: COLORS.textMuted,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 12,
    marginTop: 14,
  },
  previewSub: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.body,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
    textAlign: 'center',
  },
  previewTitle: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.displayBlack,
    fontSize: 26,
    letterSpacing: -1,
    textAlign: 'center',
  },
  section: {
    paddingBottom: 24,
    paddingHorizontal: SPACING.contentX,
  },
  title: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.displayExtraBold,
    fontSize: 22,
    letterSpacing: -0.6,
  },
  usedText: {
    color: COLORS.warning,
    fontFamily: FONTS.body,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 16,
    textAlign: 'center',
  },
});
