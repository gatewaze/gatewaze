// Isolates the one place embed.tsx needs the build-time module list.
// Kept in its own file (rather than importing 'virtual:gatewaze-modules'
// directly in embed.tsx) so tests can mock this instead of the virtual
// module id — Vite's import-analysis needs a real resolver for a
// specifier, and 'virtual:...' ids aren't reliably mockable in isolation
// the way a normal relative/aliased module is.
import modules from 'virtual:gatewaze-modules';

export function getCompiledModuleIds(): string[] {
  return modules.map((m) => m.id);
}

export function getCompiledFeatures(): string[] {
  return modules.flatMap((m) => m.features ?? []);
}
