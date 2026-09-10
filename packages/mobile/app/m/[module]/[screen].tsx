import React from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import { findScreen } from '../../../src/core/registry';
import { LazyThunk } from '../../../src/components/LazyThunk';
import { EmptyState, Screen } from '../../../src/components/primitives';

/**
 * Generic host for module-contributed pushable screens:
 * router.push('/m/<moduleId>/<screenName>?anyParam=...') — extra query
 * params are passed to the screen as props.
 */
export default function ModuleScreenHost() {
  const params = useLocalSearchParams<{ module: string; screen: string }>();
  const { module: moduleId, screen: screenName, ...rest } = params;

  const def = findScreen(String(moduleId), String(screenName));
  if (!def) {
    return (
      <Screen scroll={false}>
        <EmptyState icon="alert-circle-outline" title="Screen not found" />
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
