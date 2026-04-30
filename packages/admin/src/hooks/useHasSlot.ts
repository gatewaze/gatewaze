import { useModuleSlots } from '@/hooks/useModuleSlots';

/**
 * Convenience hook to check whether any modules contribute to a given
 * slot. Use it to conditionally render slot containers — for example, to
 * skip rendering a sidebar entirely when no modules contribute slots:
 *
 *   const hasSidebarSlots = useHasSlot('person-detail:sidebar');
 *   {hasSidebarSlots && (
 *     <aside>
 *       <ModuleSlot name="person-detail:sidebar" props={{ personId }} />
 *     </aside>
 *   )}
 *
 * Lives in its own file so `ModuleSlot.tsx` stays component-only —
 * react-refresh requires that for fast refresh to work cleanly.
 */
export function useHasSlot(slotName: string): boolean {
  const slots = useModuleSlots(slotName);
  return slots.length > 0;
}
