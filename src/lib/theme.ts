/**
 * Design tokens extracted from the coded prototype (docs/planning-reference/design/callout_mobile_app_design/), the source of truth for visual hierarchy per CLAUDE.md §8.1.
 * Values live here once so screens never hardcode a hex string.
 */

export const COLORS = {
  background: '#0B0B0F',
  card: '#14141C',
  elevated: '#1E1E2A',
  border: '#2A2A3A',
  divider: '#1E1E2A',
  textPrimary: '#FAFAFA',
  textSecondary: '#8888A0',
  textBody: '#C0C0D0',
  textMuted: '#666680',
  textDisabled: '#3A3A50',
  ember: '#FF4E3A',
  emberEnd: '#FF7B2F',
  warning: '#FF9A2E',
  success: '#00D4AA',
  invite: '#7B61FF',
  inviteEnd: '#4ECAFF',
  white: '#FFFFFF',
} as const;

/** Gradient stop pairs used by primary CTAs and hero cards in the prototype. */
export const GRADIENTS = {
  ember: [COLORS.ember, COLORS.emberEnd],
  invite: [COLORS.invite, COLORS.inviteEnd],
} as const;

export const FONTS = {
  /** Display face: headings, buttons, numbers, uppercase labels. */
  display: 'Outfit_700Bold',
  displayExtraBold: 'Outfit_800ExtraBold',
  displayBlack: 'Outfit_900Black',
  /** Body face: paragraphs, names, form text. */
  body: 'PlusJakartaSans_500Medium',
  bodySemiBold: 'PlusJakartaSans_600SemiBold',
  bodyBold: 'PlusJakartaSans_700Bold',
} as const;

export const RADII = {
  input: 16,
  card: 20,
  hero: 24,
  button: 18,
  iconButton: 12,
  pill: 20,
} as const;

export const SPACING = {
  screenX: 16,
  contentX: 20,
  gutter: 10,
} as const;

/** Prototype's uppercase section-label treatment (11px Outfit bold, wide tracking). */
export const SECTION_LABEL = {
  fontFamily: FONTS.display,
  fontSize: 11,
  letterSpacing: 1.3,
  textTransform: 'uppercase' as const,
  color: COLORS.textSecondary,
} as const;
