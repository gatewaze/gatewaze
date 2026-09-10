import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  BricolageGrotesque_700Bold,
} from '@expo-google-fonts/bricolage-grotesque';
import { SessionProvider } from '../src/core/auth/session';
import { LoadingState } from '../src/components/primitives';
import { useTheme } from '../src/theme/tokens';

export default function RootLayout() {
  const theme = useTheme();
  // The display face is part of the brand, so hold the first paint until
  // it is ready rather than showing the fallback and reflowing.
  const [fontsLoaded] = useFonts({ BricolageGrotesque_700Bold });

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <SessionProvider>
        {fontsLoaded ? (
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: theme.background },
              headerShadowVisible: false,
              headerTintColor: theme.text,
              contentStyle: { backgroundColor: theme.background },
            }}
          >
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="settings/index" options={{ title: 'Settings' }} />
            <Stack.Screen name="settings/sync" options={{ title: 'Sync status' }} />
            <Stack.Screen name="settings/diagnostics" options={{ title: 'Diagnostics' }} />
            <Stack.Screen name="settings/delete" options={{ title: 'Delete account' }} />
          </Stack>
        ) : (
          <LoadingState />
        )}
      </SessionProvider>
    </SafeAreaProvider>
  );
}
