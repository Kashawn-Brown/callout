import { useRouter } from 'expo-router';
import type { ReactElement } from 'react';
import Svg, { Path } from 'react-native-svg';

import { IconButton } from '@/components/IconButton';
import { COLORS } from '@/lib/theme';

/** Chevron back button used in every screen header, matching the prototype's back affordance. */
export function BackButton(): ReactElement {
  const router = useRouter();

  return (
    <IconButton onPress={() => router.back()} accessibilityLabel="Go back">
      <Svg width={16} height={16} viewBox="0 0 16 16" fill="none">
        <Path
          d="M10 3L5 8l5 5"
          stroke={COLORS.textSecondary}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </IconButton>
  );
}
