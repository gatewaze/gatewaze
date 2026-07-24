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
  /**
   * Collision-safe contribution id `<moduleId>:<localId>` (spec-module-namespacing
   * §6.2). Two modules contributing the same `tabId` get distinct scopedIds, so
   * hosts should key on this instead of moduleId/tabId alone.
   */
  scopedId: string;
  /** Order after band-clamping (§6.3): first-party keep their number; others are floored into the community band (≥500). */
  effectiveOrder: number;
}

/** Community band floor (spec-module-namespacing §6.3): core 0–99, first-party 100–499, community ≥500. */
const COMMUNITY_BAND = 500;

/**
 * Pre-auth override for enablement gating. The modules context only has data
 * once a session exists (installed_modules is admin/service-only under RLS), so
 * pre-auth surfaces like the login page pass an explicitly-fetched enabled set
 * (via the public_enabled_modules RPC) instead of relying on the context.
 */
export interface ModuleEnablementOverride {
  enabledModuleIds: string[];
  enabledFeatures: string[];
}

/**
 * Returns all slot registrations for a given slot name from enabled modules,
 * sorted by order (ascending). Each entry includes the owning module ID
 * so callers can key by module.
 *
 * Pass `override` on pre-auth surfaces (login page) where the modules context
 * has no data; gating then uses the supplied enabled sets.
 */
export function useModuleSlots(slotName: string, override?: ModuleEnablementOverride): ResolvedSlot[] {
  const ctx = useModulesContext();
  const idsKey = override?.enabledModuleIds.join(',');
  const featKey = override?.enabledFeatures.join(',');

  return useMemo(() => {
    const isModuleEnabled = override
      ? (id: string) => override.enabledModuleIds.includes(id)
      : ctx.isModuleEnabled;
    const isFeatureEnabled = override
      ? (f: string) => override.enabledFeatures.includes(f)
      : ctx.isFeatureEnabled;

    const result: ResolvedSlot[] = [];

    for (const mod of modules) {
      if (!mod.adminSlots || !isModuleEnabled(mod.id)) continue;

      const firstParty = (mod as { __identity?: { firstParty?: boolean } }).__identity?.firstParty ?? true;

      for (const reg of mod.adminSlots) {
        if (reg.slotName !== slotName) continue;
        if (reg.requiredFeature && !isFeatureEnabled(reg.requiredFeature)) continue;

        const localId = (reg.meta as { tabId?: string } | undefined)?.tabId ?? reg.slotName;
        const rawOrder = reg.order ?? 100;
        // Clamp out-of-band community orders so first-party contributions stay
        // ahead regardless of author-chosen numbers (§6.3). First-party keep theirs.
        const effectiveOrder = firstParty ? rawOrder : Math.max(COMMUNITY_BAND, rawOrder);

        result.push({
          moduleId: mod.id,
          registration: reg,
          scopedId: `${mod.id}:${localId}`,
          effectiveOrder,
        });
      }
    }

    result.sort((a, b) => a.effectiveOrder - b.effectiveOrder);
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotName, ctx.isModuleEnabled, ctx.isFeatureEnabled, idsKey, featKey]);
}
