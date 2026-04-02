import { Suspense, lazy, useMemo } from 'react';
import { useModuleSlots } from '@/hooks/useModuleSlots';

interface ModuleSlotProps {
  /** The slot name to render, e.g. 'event-detail:tabs' */
  name: string;
  /** Props forwarded to every slot component */
  props?: Record<string, unknown>;
  /** Optional wrapper around each slot entry (e.g. for layout) */
  wrapper?: React.ComponentType<{ moduleId: string; children: React.ReactNode }>;
  /** Fallback shown while a slot component is loading */
  fallback?: React.ReactNode;
}

/**
 * Renders all module-contributed components for a named extension point.
 *
 * Modules register slot components via the `adminSlots` field on GatewazeModule.
 * Only components from enabled modules (with matching feature flags) are rendered.
 *
 * @example
 * // In the host page — renders all tabs contributed by modules
 * <ModuleSlot name="event-detail:tabs" props={{ eventId, event }} />
 *
 * @example
 * // With a wrapper for layout control
 * <ModuleSlot
 *   name="person-detail:sidebar"
 *   props={{ personId }}
 *   wrapper={({ children }) => <Card>{children}</Card>}
 * />
 */
export function ModuleSlot({ name, props, wrapper: Wrapper, fallback }: ModuleSlotProps) {
  const slots = useModuleSlots(name);

  const components = useMemo(
    () =>
      slots.map(({ moduleId, registration }) => ({
        moduleId,
        Component: lazy(registration.component as () => Promise<{ default: React.ComponentType<any> }>),
      })),
    [slots],
  );

  if (components.length === 0) return null;

  return (
    <>
      {components.map(({ moduleId, Component }) => {
        const element = (
          <Suspense key={moduleId} fallback={fallback ?? null}>
            <Component {...props} />
          </Suspense>
        );

        if (Wrapper) {
          return (
            <Wrapper key={moduleId} moduleId={moduleId}>
              {element}
            </Wrapper>
          );
        }

        return element;
      })}
    </>
  );
}

/**
 * Hook to check if any module has registered components for a given slot.
 * Useful for conditionally rendering container elements around a slot.
 *
 * @example
 * const hasSidebarSlots = useHasSlot('person-detail:sidebar');
 * {hasSidebarSlots && (
 *   <aside>
 *     <ModuleSlot name="person-detail:sidebar" props={{ personId }} />
 *   </aside>
 * )}
 */
export function useHasSlot(slotName: string): boolean {
  const slots = useModuleSlots(slotName);
  return slots.length > 0;
}
