import React from 'react';
import { Stack, router } from 'expo-router';
import { Pressable, StatusBar, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  BricolageGrotesque_700Bold,
} from '@expo-google-fonts/bricolage-grotesque';
import { SessionProvider } from '../src/core/auth/session';
import { Icon } from '../src/components/Icon';
import { requestOpenDrawer } from '../src/core/drawerSignal';
import { LoadingState, withAlpha } from '../src/components/primitives';
import { useTheme, layout } from '../src/theme/tokens';

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
          // The living gradient sits behind every pushed screen, and each
          // screen's own background is transparent so it shows through. A
          // module screen reached from the drawer then looks like the same
          // app as the coach, rather than a flat sheet pushed on top of it.
          <View style={{ flex: 1, backgroundColor: theme.background }}>
            <Stack
              screenOptions={{
                headerTransparent: true,
                headerShadowVisible: false,
                headerTintColor: theme.text,
                // Same fade as the coach header, so content passing under it
                // dissolves rather than meeting a hard edge.
                headerBackground: () => (
                  <LinearGradient
                    colors={[
                      withAlpha(theme.headerScrim, layout.headerFadeStops[0]),
                      withAlpha(theme.headerScrim, layout.headerFadeStops[1]),
                      withAlpha(theme.headerScrim, layout.headerFadeStops[2]),
                    ]}
                    locations={[0, 0.75, 1]}
                    style={{ flex: 1 }}
                  />
                ),
                // Opaque. Transparent let the route underneath show through,
                // so a pushed screen showed the coach's hamburger behind its
                // own. Screen draws the living gradient itself.
                contentStyle: { backgroundColor: theme.background },
                // The default back control renders the previous route's name,
                // which is the file name 'index'. A module screen is part of
                // this app rather than a sheet on top of it, so it carries the
                // same menu control as the coach: it returns there and opens
                // the drawer, which is where every destination is chosen.
                headerBackVisible: false,
                headerLeft: () => (
                  <Pressable
                    hitSlop={12}
                    accessibilityRole="button"
                    accessibilityLabel="Menu"
                    onPress={() => {
                      router.dismissAll();
                      requestOpenDrawer();
                    }}
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      borderWidth: 1,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: theme.surface,
                      borderColor: theme.border,
                    }}
                  >
                    <Icon name="menu" size={18} color={theme.text} />
                  </Pressable>
                ),
              }}
            >
              <Stack.Screen name="index" options={{ headerShown: false }} />
              <Stack.Screen name="settings/index" options={{ title: 'Settings' }} />
              <Stack.Screen name="settings/sync" options={{ title: 'Sync status' }} />
              <Stack.Screen name="settings/diagnostics" options={{ title: 'Diagnostics' }} />
              <Stack.Screen name="settings/delete" options={{ title: 'Delete account' }} />
            </Stack>
          </View>
        ) : (
          <LoadingState />
        )}
      </SessionProvider>
    </SafeAreaProvider>
  );
}
