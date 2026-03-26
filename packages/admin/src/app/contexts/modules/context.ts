import { createSafeContext } from '@/utils/createSafeContext';
import type { ThemeOverrides } from '@gatewaze/shared/modules';

export interface ModuleUpdateInfo {
  id: string;
  name: string;
  installedVersion: string;
  availableVersion: string;
  minPlatformVersion?: string;
  platformCompatible: boolean;
}

export interface ActiveThemeModule {
  id: string;
  name: string;
  themeOverrides: ThemeOverrides;
}

export interface ModulesContextType {
  /** True once the initial DB fetch has completed */
  ready: boolean;
  /** Check if a module is enabled (status === 'enabled' in DB) */
  isModuleEnabled: (moduleId: string) => boolean;
  /** Check if a specific feature flag is enabled across all enabled modules */
  isFeatureEnabled: (feature: string) => boolean;
  /** Returns the active theme module (if any) with its overrides */
  activeThemeModule: ActiveThemeModule | null;
  /** Re-fetch module state from DB (e.g. after toggling) */
  refresh: () => Promise<void>;
  /** Modules with available updates */
  availableUpdates: ModuleUpdateInfo[];
  /** Re-check for available updates */
  checkUpdates: () => Promise<void>;
}

export const [ModulesProvider, useModulesContext] =
  createSafeContext<ModulesContextType>(
    'useModulesContext must be used within ModulesProvider',
  );
