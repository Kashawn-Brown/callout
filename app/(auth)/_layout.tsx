import { Stack } from 'expo-router';
import type { ReactElement } from 'react';

import { COLORS } from '@/lib/theme';

export default function AuthLayout(): ReactElement {
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: COLORS.background } }}
    />
  );
}
