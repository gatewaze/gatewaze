import React from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import { findScreen, allModules } from '../../../src/core/registry';
import { LazyThunk } from '../../../src/components/LazyThunk';
import { EmptyState, Screen } from '../../../src/components/primitives';

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
    <>
      <Stack.Screen options={{ title: def.title ?? def.name }} />
      <LazyThunk thunk={def.screen} props={rest as Record<string, unknown>} />
    </>
  );
}
