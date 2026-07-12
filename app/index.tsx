import { useEffect, useState, type ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { checkSupabaseConnection } from '@/lib/supabase';

type ConnectionState = 'checking' | 'connected' | 'unreachable';

export default function HomeScreen(): ReactElement {
  const [connection, setConnection] = useState<ConnectionState>('checking');

  useEffect(() => {
    let cancelled = false;
    checkSupabaseConnection().then((ok) => {
      if (!cancelled) {
        setConnection(ok ? 'connected' : 'unreachable');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Callout</Text>
      <Text style={styles.subtitle}>Phase 0 — skeleton</Text>
      <Text style={styles.status}>Supabase: {connection}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    flex: 1,
    gap: 8,
    justifyContent: 'center',
  },
  status: {
    fontSize: 14,
    opacity: 0.7,
  },
  subtitle: {
    fontSize: 16,
    opacity: 0.7,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
  },
});
