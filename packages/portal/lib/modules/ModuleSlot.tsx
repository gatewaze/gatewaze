'use client';

import { Suspense, lazy, useMemo } from 'react';
import { getPortalSlots } from './registry';

interface ModuleSlotProps {
  /** The slot name to render, e.g. 'event-detail:tabs' */
  name: string;
  /** Props forwarded to every slot component */
  props?: Record<string, unknown>;
  /** Set of enabled module IDs (pass from server component) */
  enabledModuleIds: string[];
  /** Set of enabled features (pass from server component) */
  enabledFeatures?: string[];
  /** Fallback shown while a slot component is loading */
  fallback?: React.ReactNode;
}

/**
 * Client component that renders all module-contributed components for a named slot.
 *
 * Since the portal is Next.js, enabled module state must be passed from a server
 * component (fetched via `getEnabledModules()`).
 *
 * @example
 * // In a server component:
 * import { getEnabledModules } from '@/lib/modules/enabledModules';
 * import { ModuleSlot } from '@/lib/modules/ModuleSlot';
 *
 * export default async function EventPage({ params }) {
 *   const modules = await getEnabledModules();
 *   return (
 *     <ModuleSlot
 *       name="event-detail:hero"
 *       enabledModuleIds={[...modules.enabledIds]}
 *       enabledFeatures={[...modules.enabledFeatures]}
 *       props={{ eventId: params.eventId }}
 *     />
 *   );
 * }
 */
export function ModuleSlot({
  name,
  props,
  enabledModuleIds,
  enabledFeatures = [],
  fallback,
}: ModuleSlotProps) {
  const enabledSet = useMemo(() => new Set(enabledModuleIds), [enabledModuleIds]);
  const featureSet = useMemo(() => new Set(enabledFeatures), [enabledFeatures]);

  const components = useMemo(() => {
    const slots = getPortalSlots(name);
    const filtered: Array<{ moduleId: string; Component: React.LazyExoticComponent<React.ComponentType<any>> }> = [];

    for (const entry of slots) {
      if (!enabledSet.has(entry.moduleId)) continue;
      if (entry.requiredFeature && !featureSet.has(entry.requiredFeature)) continue;

      filtered.push({
        moduleId: entry.moduleId,
        Component: lazy(entry.component),
      });
    }

    return filtered;
  }, [name, enabledSet, featureSet]);

  if (components.length === 0) return null;

  return (
    <>
      {components.map(({ moduleId, Component }) => (
        <Suspense key={moduleId} fallback={fallback ?? null}>
          <Component {...props} />
        </Suspense>
      ))}
    </>
  );
}

/**
 * Check if any module has registered components for a given slot.
 * Useful for conditionally rendering containers.
 */
export function hasPortalSlot(
  slotName: string,
  enabledModuleIds: Set<string>,
  enabledFeatures?: Set<string>,
): boolean {
  const slots = getPortalSlots(slotName);
  return slots.some((entry) => {
    if (!enabledModuleIds.has(entry.moduleId)) return false;
    if (entry.requiredFeature && enabledFeatures && !enabledFeatures.has(entry.requiredFeature)) return false;
    return true;
  });
}
