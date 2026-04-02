/**
 * Hooks to check if a Gatewaze module / feature is enabled at runtime.
 *
 * Runtime state comes from the `installed_modules` DB table via
 * ModulesProvider context. A module is considered enabled only when
 * its row exists with status = 'enabled'.
 *
 * @example
 * const hasCIO = useHasModule('customerio');
 * if (hasCIO) { ... }
 *
 * @example
 * const hasSync = useModuleFeature('customerio.sync');
 */

import { useModulesContext } from '@/app/contexts/modules/context';

/**
 * Check if a specific module feature is enabled (runtime).
 */
export function useModuleFeature(feature: string): boolean {
  const { isFeatureEnabled } = useModulesContext();
  return isFeatureEnabled(feature);
}

/**
 * Check if a module is enabled by id (runtime).
 */
export function useHasModule(moduleId: string): boolean {
  const { isModuleEnabled } = useModulesContext();
  return isModuleEnabled(moduleId);
}
