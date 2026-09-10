/**
 * Renders a MobileComponentThunk from a module manifest — supports both
 * `() => require(...)` and `() => import(...)` forms.
 */

import React, { useEffect, useState, type ComponentType } from 'react';
import type { MobileComponentThunk } from '@gatewaze/shared';
import { LoadingState } from './primitives';

const resolved = new WeakMap<MobileComponentThunk, ComponentType<Record<string, unknown>>>();

export function LazyThunk({
  thunk,
  props,
}: {
  thunk: MobileComponentThunk;
  props?: Record<string, unknown>;
}) {
  const [component, setComponent] = useState<ComponentType<Record<string, unknown>> | null>(
    () => resolved.get(thunk) ?? null
  );

  useEffect(() => {
    if (component) return;
    let cancelled = false;
    Promise.resolve(thunk()).then((mod) => {
      const C = (mod as { default: ComponentType<Record<string, unknown>> }).default;
      resolved.set(thunk, C);
      if (!cancelled) setComponent(() => C);
    });
    return () => {
      cancelled = true;
    };
  }, [thunk, component]);

  if (!component) return <LoadingState />;
  const C = component;
  return <C {...(props ?? {})} />;
}
