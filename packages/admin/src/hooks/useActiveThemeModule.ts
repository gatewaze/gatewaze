import { useModulesContext } from '@/app/contexts/modules/context';
import type { ActiveThemeModule } from '@/app/contexts/modules/context';

/**
 * Returns the currently active theme module (if any).
 *
 * A theme module is a GatewazeModule with type === 'theme' and status === 'enabled'.
 * Only one theme module can be active at a time (enforced at DB and API level).
 */
export function useActiveThemeModule(): ActiveThemeModule | null {
  const { activeThemeModule } = useModulesContext();
  return activeThemeModule;
}
