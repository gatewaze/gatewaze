import { ReactNode, useMemo } from 'react';
import { ModulesProviderWrapper } from '@/app/contexts/modules/Provider';
import { ModulesProvider, useModulesContext } from '@/app/contexts/modules/context';

interface HostEnablement {
  moduleIds: string[];
  features: string[];
}

/**
 * Re-provides ModulesContext with the host's `enabled` overlay intersected
 * against the real (DB-backed) enablement from ModulesProviderWrapper.
 * Authority split (spec): GW's own installed_modules/RLS state is the
 * system of record; the host overlay only narrows it further, it never
 * widens it. A module the host didn't list stays disabled even if it's
 * enabled in the DB; a module the DB has disabled stays disabled even if
 * the host lists it.
 *
 * `useModuleSlots` calls `useModulesContext()` unconditionally (even when
 * passed its own `override` argument), so an embed mount needs a real
 * ModulesProvider ancestor regardless — this is that ancestor, not a
 * bypass of it.
 */
function EmbedModulesGate({ overlay, children }: { overlay: HostEnablement; children: ReactNode }) {
  const base = useModulesContext();
  const moduleIdOverlay = useMemo(() => new Set(overlay.moduleIds), [overlay.moduleIds]);
  const featureOverlay = useMemo(() => new Set(overlay.features), [overlay.features]);

  const value = useMemo(
    () => ({
      ...base,
      isModuleEnabled: (id: string) => moduleIdOverlay.has(id) && base.isModuleEnabled(id),
      isFeatureEnabled: (f: string) => featureOverlay.has(f) && base.isFeatureEnabled(f),
      allModuleFeatures: new Set(
        Array.from(base.allModuleFeatures).filter((f) => featureOverlay.has(f)),
      ),
    }),
    [base, moduleIdOverlay, featureOverlay],
  );

  return <ModulesProvider value={value}>{children}</ModulesProvider>;
}

export function EmbedModulesProvider({
  overlay,
  children,
}: {
  overlay: HostEnablement;
  children: ReactNode;
}) {
  return (
    <ModulesProviderWrapper>
      <EmbedModulesGate overlay={overlay}>{children}</EmbedModulesGate>
    </ModulesProviderWrapper>
  );
}
