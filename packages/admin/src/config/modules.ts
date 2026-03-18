import type { GatewazeModule, AdminRouteDefinition, NavigationItem } from '@gatewaze/shared';

const CORE_FEATURES = [
  'dashboard_home',
  'dashboard_members',
  'events',
  'calendars',
  'emails',
  'settings',
  'users',
  'accounts',
  'db_copy',
] as const;

class ModuleRegistry {
  private modules: Map<string, GatewazeModule> = new Map();
  private enabledModules: Set<string> = new Set();

  register(module: GatewazeModule): void {
    this.modules.set(module.id, module);
  }

  enable(moduleId: string): void {
    if (!this.modules.has(moduleId)) {
      console.warn(`Module "${moduleId}" not registered`);
      return;
    }
    this.enabledModules.add(moduleId);
  }

  disable(moduleId: string): void {
    this.enabledModules.delete(moduleId);
  }

  isFeatureEnabled(feature: string): boolean {
    if ((CORE_FEATURES as readonly string[]).includes(feature)) return true;
    for (const moduleId of this.enabledModules) {
      const module = this.modules.get(moduleId);
      if (module?.features.includes(feature)) return true;
    }
    return false;
  }

  getEnabledFeatures(): string[] {
    const features: string[] = [...CORE_FEATURES];
    for (const moduleId of this.enabledModules) {
      const module = this.modules.get(moduleId);
      if (module) features.push(...module.features);
    }
    return features;
  }

  getAdminRoutes(): AdminRouteDefinition[] {
    const routes: AdminRouteDefinition[] = [];
    for (const moduleId of this.enabledModules) {
      const module = this.modules.get(moduleId);
      if (module?.adminRoutes) routes.push(...module.adminRoutes);
    }
    return routes;
  }

  getNavItems(): NavigationItem[] {
    const items: NavigationItem[] = [];
    for (const moduleId of this.enabledModules) {
      const module = this.modules.get(moduleId);
      if (module?.adminNavItems) items.push(...module.adminNavItems);
    }
    return items.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  }

  getModule(moduleId: string): GatewazeModule | undefined {
    return this.modules.get(moduleId);
  }

  getEnabledModules(): GatewazeModule[] {
    return Array.from(this.enabledModules)
      .map((id) => this.modules.get(id))
      .filter((m): m is GatewazeModule => m !== undefined);
  }

  getAllModules(): GatewazeModule[] {
    return Array.from(this.modules.values());
  }
}

export const moduleRegistry = new ModuleRegistry();

export function isFeatureEnabled(feature: string): boolean {
  return moduleRegistry.isFeatureEnabled(feature);
}
