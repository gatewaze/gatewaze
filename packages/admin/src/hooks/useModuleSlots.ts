import { useMemo } from 'react';
// Build-time module list — may be empty in Docker.  Slot components require
// bundled code, so this must remain a build-time import.  When empty, the
// hook simply returns no slots (graceful degradation).
import modules from 'virtual:gatewaze-modules';
import { useModulesContext } from '@/app/contexts/modules/context';
import type { SlotRegistration } from '@gatewaze/shared/modules';

export interface ResolvedSlot {
  moduleId: string;
  registration: SlotRegistration;
}

/**
 * Returns all slot registrations for a given slot name from enabled modules,
 * sorted by order (ascending). Each entry includes the owning module ID
 * so callers can key by module.
 */
export function useModuleSlots(slotName: string): ResolvedSlot[] {
  const { isModuleEnabled, isFeatureEnabled } = useModulesContext();

  return useMemo(() => {
    const result: ResolvedSlot[] = [];

    for (const mod of modules) {
      if (!mod.adminSlots || !isModuleEnabled(mod.id)) continue;

      for (const reg of mod.adminSlots) {
        if (reg.slotName !== slotName) continue;
        if (reg.requiredFeature && !isFeatureEnabled(reg.requiredFeature)) continue;

        result.push({ moduleId: mod.id, registration: reg });
      }
    }

    result.sort((a, b) => (a.registration.order ?? 100) - (b.registration.order ?? 100));
    return result;
  }, [slotName, isModuleEnabled, isFeatureEnabled]);
}
