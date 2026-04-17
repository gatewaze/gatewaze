import type { GatewazeModule, ModuleWarning } from '../types/modules';

/**
 * Validate that all features in a module's features array
 * follow the namespace convention: feature === module.id || feature.startsWith(module.id + '.')
 *
 * Returns warnings for violations (v1.1 = warn; v1.2 = hard error).
 */
export function validateFeatureNamespace(mod: GatewazeModule): ModuleWarning[] {
  const warnings: ModuleWarning[] = [];

  for (const feature of mod.features) {
    if (feature !== mod.id && !feature.startsWith(mod.id + '.')) {
      warnings.push({
        code: 'MODULE_FEATURE_NAMESPACE_VIOLATION',
        message: `Feature "${feature}" does not start with module ID "${mod.id}". Expected "${mod.id}" or "${mod.id}.<sub-feature>".`,
        details: { feature, moduleId: mod.id },
      });
    }
  }

  return warnings;
}
