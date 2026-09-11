import React, { useMemo, useState } from 'react';
import { PanResponder, View, useWindowDimensions } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { requestOpenDrawer, requestOpenSummary } from '../../../src/core/drawerSignal';
import { findScreen, allModules } from '../../../src/core/registry';
import { LazyThunk } from '../../../src/components/LazyThunk';
import { EmptyState, Screen } from '../../../src/components/primitives';
import { CoachBar } from '../../../src/core/CoachBar';
import { ChromeInsetsProvider } from '../../../src/core/chrome';

/**
 * Generic host for module-contributed pushable screens:
 * router.push('/m/<moduleId>/<screenName>?anyParam=...') — extra query
 * params are passed to the screen as props.
 */
export default function ModuleScreenHost() {
  // The segment is `[view]`, NOT `[screen]`: React Navigation reserves
  // `screen` for targeting a route inside a nested navigator, so it consumes
  // the param before it reaches here and every module screen resolved to
  // undefined. The URL is positional, so no caller changes.
  const params = useLocalSearchParams<{ module: string; view: string }>();
  const { module: moduleId, view: screenName, ...rest } = params;
  const [barHeight, setBarHeight] = useState(0);
  const { width: screenWidth } = useWindowDimensions();
  // Every baked module, as the composer's entitlement map. A pushed screen is
  // only reachable once the host has already proved the member is entitled to
  // the module it belongs to.
  // Both drawers are reachable from a pushed screen. The screen cannot open
  // them itself — it sits above the host in the stack — so an edge swipe
  // leaves a request and pops back, and the host opens the drawer when it
  // regains focus. Same trick the header's menu button uses.
  const edgeSwipe = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (evt, g) => {
          const startX = evt.nativeEvent.pageX - g.dx;
          if (Math.abs(g.dx) < 12 || Math.abs(g.dx) <= Math.abs(g.dy) * 1.5) return false;
          return (startX <= 24 && g.dx > 0) || (startX >= screenWidth - 24 && g.dx < 0);
        },
        onPanResponderRelease: (_e, g) => {
          if (g.dx > 0) requestOpenDrawer();
          else requestOpenSummary();
          router.dismissAll();
        },
      }),
    [screenWidth]
  );

  const enabled = useMemo(
    () => Object.fromEntries(allModules().map((m) => [m.id, true])),
    []
  );

  const def = findScreen(String(moduleId), String(screenName));
  if (!def) {
    // In development, say WHICH lookup failed. "Screen not found" on its own
    // cannot tell a missing module from a missing screen from a typo in the
    // name, and those need different fixes.
    const detail = __DEV__
      ? (() => {
          const mod = allModules().find((m) => m.id === String(moduleId));
          if (!mod) {
            return `No module '${moduleId}'. Loaded: ${allModules().map((m) => m.id).join(', ') || 'none'}`;
          }
          return `Module '${moduleId}' has no screen '${screenName}'. It has: ${(mod.screens ?? []).map((sc) => sc.name).join(', ') || 'none'}`;
        })()
      : undefined;
    return (
      <Screen scroll={false}>
        <EmptyState icon="alert-circle-outline" title="Screen not found" body={detail} />
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1 }} {...edgeSwipe.panHandlers}>
      <Stack.Screen options={{ title: def.title ?? def.name }} />
      <ChromeInsetsProvider top={0} bottom={barHeight}>
        <LazyThunk thunk={def.screen} props={rest as Record<string, unknown>} />
      </ChromeInsetsProvider>
      {/* The coach is reachable from a pushed screen too. Sending here leaves
          the handover and pops back to the host, which switches to the coach
          and sends it. This screen has no thread of its own to send into. */}
      <CoachBar
        enabled={enabled}
        onHandoff={() => router.dismissAll()}
        onHeight={setBarHeight}
      />
    </View>
  );
}
