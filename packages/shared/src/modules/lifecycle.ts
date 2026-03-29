import type { LoadedModule, InstalledModuleRow, ModuleSource } from '../types/modules';
import type { SupabaseClient } from './supabase-types';
import { applyModuleMigrations } from './migrations';
import { isNewerVersion } from './semver';

/**
 * Detect circular dependencies in the module graph.
 * Returns an array of cycle descriptions (empty if no cycles found).
 */
export function detectCircularDependencies(modules: LoadedModule[]): string[] {
  const byId = new Map(modules.map((m) => [m.config.id, m]));
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const cycles: string[] = [];

  function dfs(modId: string, path: string[]): void {
    if (inStack.has(modId)) {
      // Found a cycle — extract the cycle portion from path
      const cycleStart = path.indexOf(modId);
      const cycle = [...path.slice(cycleStart), modId];
      cycles.push(cycle.join(' → '));
      return;
    }
    if (visited.has(modId)) return;

    const mod = byId.get(modId);
    if (!mod) return;

    inStack.add(modId);
    path.push(modId);

    for (const depId of mod.config.dependencies ?? []) {
      if (byId.has(depId)) {
        dfs(depId, path);
      }
    }

    path.pop();
    inStack.delete(modId);
    visited.add(modId);
  }

  for (const mod of modules) {
    if (!visited.has(mod.config.id)) {
      dfs(mod.config.id, []);
    }
  }

  return cycles;
}

/**
 * Topologically sort modules so dependencies are processed before dependents.
 * Falls back to original order for modules with no dependency relationships.
 * Throws an error if circular dependencies are detected.
 */
function topologicalSort(modules: LoadedModule[]): LoadedModule[] {
  // Check for circular dependencies first
  const cycles = detectCircularDependencies(modules);
  if (cycles.length > 0) {
    const cycleList = cycles.map((c) => `  - ${c}`).join('\n');
    console.error(`[modules] Circular dependencies detected:\n${cycleList}`);
    throw new Error(`Circular dependencies detected:\n${cycleList}`);
  }

  const byId = new Map(modules.map((m) => [m.config.id, m]));
  const visited = new Set<string>();
  const sorted: LoadedModule[] = [];

  function visit(mod: LoadedModule) {
    if (visited.has(mod.config.id)) return;
    visited.add(mod.config.id);

    for (const depId of mod.config.dependencies ?? []) {
      const dep = byId.get(depId);
      if (dep) visit(dep);
    }

    sorted.push(mod);
  }

  for (const mod of modules) {
    visit(mod);
  }

  return sorted;
}

/**
 * Reconcile loaded modules against the installed_modules table.
 *
 * - New modules: apply migrations → onInstall → onEnable → insert row
 * - Re-enabled modules: onEnable → update status
 * - Version upgrades: apply new migrations → update version
 * - Removed modules: onDisable → mark disabled
 *
 * Modules are processed in dependency order (dependencies first).
 */
export async function reconcileModules(
  loaded: LoadedModule[],
  supabase: SupabaseClient
): Promise<void> {
  const { data: installed, error } = await supabase
    .from('installed_modules')
    .select('*');

  if (error) {
    throw new Error(`Failed to query installed_modules: ${JSON.stringify(error)}`);
  }

  const installedMap = new Map(
    (installed ?? []).map((m) => [m.id, m])
  );
  const loadedIds = new Set(loaded.map((m) => m.config.id));

  // Process loaded modules in dependency order
  const sorted = topologicalSort(loaded);
  for (const mod of sorted) {
    const existing = installedMap.get(mod.config.id);

    if (!existing) {
      // New module: register it but leave disabled.
      // Migrations and lifecycle hooks run when the admin explicitly enables it.
      console.log(`[modules] Registering "${mod.config.name}" v${mod.config.version}...`);

      const { error: insertErr } = await supabase
        .from('installed_modules')
        .insert({
          id: mod.config.id,
          name: mod.config.name,
          description: mod.config.description ?? '',
          version: mod.config.version,
          features: mod.config.features,
          type: mod.config.type ?? 'feature',
          source: mod.packageName,
          visibility: mod.config.visibility ?? 'public',
          status: 'disabled',
          config: mod.moduleConfig,
          portal_nav: mod.config.portalNav || null,
        });

      if (insertErr) {
        console.error(`[modules] Failed to register "${mod.config.name}":`, insertErr);
      }

      console.log(`[modules] Registered "${mod.config.name}" v${mod.config.version}`);
    } else if ((existing as InstalledModuleRow).status === 'disabled' || (existing as InstalledModuleRow).status === 'not_installed') {
      // Module exists but is not active — update metadata (version, features)
      // but do NOT run migrations. Migrations are applied when the module is
      // explicitly enabled via the admin UI or onboarding /select endpoint.
      if (isNewerVersion(mod.config.version, (existing as InstalledModuleRow).version)) {
        console.log(`[modules] Updating metadata for inactive module "${mod.config.name}" (v${(existing as InstalledModuleRow).version} → v${mod.config.version})...`);
        await supabase
          .from('installed_modules')
          .update({ version: mod.config.version, features: mod.config.features, portal_nav: mod.config.portalNav || null })
          .eq('id', mod.config.id);
      }
    } else {
      // Module is enabled — always apply pending migrations (idempotent)
      // and run lifecycle hooks for freshly enabled modules.
      await applyModuleMigrations(mod, supabase);

      if (isNewerVersion(mod.config.version, (existing as InstalledModuleRow).version)) {
        console.log(`[modules] Upgrading "${mod.config.name}" from v${(existing as InstalledModuleRow).version} to v${mod.config.version}...`);
        await supabase
          .from('installed_modules')
          .update({ version: mod.config.version, features: mod.config.features, portal_nav: mod.config.portalNav || null })
          .eq('id', mod.config.id);
        console.log(`[modules] Upgraded "${mod.config.name}" to v${mod.config.version}`);
      } else {
        // Always sync portal_nav (may have been added/changed without a version bump)
        const newNav = mod.config.portalNav || null;
        const existingNav = (existing as InstalledModuleRow).portal_nav || null;
        if (JSON.stringify(newNav) !== JSON.stringify(existingNav)) {
          await supabase
            .from('installed_modules')
            .update({ portal_nav: newNav })
            .eq('id', mod.config.id);
        }
      }
    }
  }

  // Disable removed modules
  for (const [id, row] of installedMap) {
    if (!loadedIds.has(id) && (row as InstalledModuleRow).status === 'enabled') {
      console.log(`[modules] Disabling "${(row as InstalledModuleRow).name}" (removed from config)...`);

      await supabase
        .from('installed_modules')
        .update({ status: 'disabled' as const })
        .eq('id', id);

      console.log(`[modules] Disabled "${(row as InstalledModuleRow).name}"`);
    }
  }
}

/**
 * Seed module_sources table from config file moduleSources.
 * Inserts config sources with origin='config' if not already present.
 */
export async function seedModuleSources(
  configSources: ModuleSource[],
  supabase: SupabaseClient,
): Promise<void> {
  if (!configSources || configSources.length === 0) return;

  // Fetch existing sources to avoid duplicates
  const { data: existing } = await supabase
    .from('module_sources')
    .select('url,path');

  const existingKeys = new Set(
    (existing ?? []).map((r) => `${(r as Record<string, unknown>).url}|${(r as Record<string, unknown>).path ?? ''}`)
  );

  for (const source of configSources) {
    const { url, path, branch } = normalizeSource(source);
    const key = `${url}|${path ?? ''}`;

    if (existingKeys.has(key)) continue;

    const { error } = await supabase
      .from('module_sources')
      .insert({
        url,
        path: path ?? null,
        branch: branch ?? null,
        label: null,
        origin: 'config',
      });

    if (error) {
      console.error(`[modules] Failed to seed module source "${url}":`, error);
    } else {
      existingKeys.add(key);
    }
  }
}

function normalizeSource(source: ModuleSource): { url: string; path?: string; branch?: string } {
  if (typeof source === 'string') {
    const [url, fragment] = source.split('#');
    if (!fragment) return { url };
    const params = new URLSearchParams(fragment);
    return {
      url,
      path: params.get('path') ?? undefined,
      branch: params.get('branch') ?? undefined,
    };
  }
  return source;
}
