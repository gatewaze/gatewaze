import type { LoadedModule, InstalledModuleRow, ModuleSource } from '../types/modules';
import type { SupabaseClient } from './supabase-types';
import { applyModuleMigrations } from './migrations';
import { isNewerVersion } from './semver';

/**
 * Topologically sort modules so dependencies are processed before dependents.
 * Falls back to original order for modules with no dependency relationships.
 */
function topologicalSort(modules: LoadedModule[]): LoadedModule[] {
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
      // New module: insert row first (module_migrations has FK to installed_modules)
      console.log(`[modules] Installing "${mod.config.name}" v${mod.config.version}...`);

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
          status: 'enabled',
          config: mod.moduleConfig,
          portal_nav: mod.config.portalNav || null,
        });

      if (insertErr) {
        console.error(`[modules] Failed to record installation of "${mod.config.name}":`, insertErr);
      }

      await applyModuleMigrations(mod, supabase);

      if (mod.config.onInstall) {
        await mod.config.onInstall();
      }

      if (mod.config.onEnable) {
        await mod.config.onEnable();
      }

      console.log(`[modules] Installed "${mod.config.name}" v${mod.config.version}`);
    } else if ((existing as InstalledModuleRow).status === 'disabled') {
      // Module exists but is disabled — apply any pending migrations but
      // leave it disabled. Admins enable modules explicitly via the UI.
      if (isNewerVersion(mod.config.version, (existing as InstalledModuleRow).version)) {
        console.log(`[modules] Applying migrations for disabled module "${mod.config.name}" (v${(existing as InstalledModuleRow).version} → v${mod.config.version})...`);
        await applyModuleMigrations(mod, supabase);
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
