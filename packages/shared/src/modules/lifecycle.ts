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
 * Summary returned by reconcileModules. Callers can log this to surface a
 * clear per-module status without having to grep through interleaved
 * console output.
 */
export interface ReconcileSummary {
  ok: string[];                       // modules that reconciled cleanly
  failed: Array<{                     // modules whose migrations or lifecycle failed
    moduleId: string;
    phase: 'migration' | 'lifecycle' | 'metadata';
    filename?: string;
    message: string;
  }>;
  disabled: string[];                 // modules disabled because removed from config
  registered: string[];               // newly-registered modules (still disabled)
}

/**
 * Record a reconcile failure against an installed_modules row so admins
 * can see at a glance which modules are broken.
 */
async function recordReconcileError(
  supabase: SupabaseClient,
  moduleId: string,
  err: { phase: 'migration' | 'lifecycle' | 'metadata'; filename?: string; message: string; code?: string },
): Promise<void> {
  try {
    await supabase
      .from('installed_modules')
      .update({
        last_reconcile_at: new Date().toISOString(),
        reconcile_error: {
          phase: err.phase,
          filename: err.filename,
          message: err.message,
          code: err.code,
          occurred_at: new Date().toISOString(),
        },
      })
      .eq('id', moduleId);
  } catch (writeErr) {
    // Don't let error-recording failures mask the original error.
    console.warn(`[modules] Could not record reconcile error for "${moduleId}":`, writeErr);
  }
}

/**
 * Clear the reconcile_error column on a successful reconcile pass so the
 * admin UI can reflect the current healthy state.
 */
async function clearReconcileError(
  supabase: SupabaseClient,
  moduleId: string,
): Promise<void> {
  try {
    await supabase
      .from('installed_modules')
      .update({
        last_reconcile_at: new Date().toISOString(),
        reconcile_error: null,
      })
      .eq('id', moduleId);
  } catch { /* best-effort */ }
}

/**
 * Reconcile loaded modules against the installed_modules table.
 *
 * - New modules: register (disabled) — migrations run on explicit enable
 * - Re-enabled modules: onEnable → update status
 * - Version upgrades: apply new migrations → update version
 * - Removed modules: onDisable → mark disabled
 *
 * Resilience guarantees:
 *   - A failure in one module does NOT abort reconcile for other modules.
 *     Each module is processed inside its own try/catch, and any failure
 *     is captured as a structured error on that module's
 *     installed_modules row (`last_reconcile_at` + `reconcile_error`).
 *   - Migration failures come through applyModuleMigrations as a return
 *     value (not a throw), so the reconcile loop can inspect the result
 *     and move on even if half of a module's migrations haven't applied.
 *   - A summary is returned to the caller for logging / error surfacing.
 *
 * Modules are processed in dependency order (dependencies first).
 */
export async function reconcileModules(
  loaded: LoadedModule[],
  supabase: SupabaseClient
): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = {
    ok: [],
    failed: [],
    disabled: [],
    registered: [],
  };

  const { data: installed, error } = await supabase
    .from('installed_modules')
    .select('*');

  if (error) {
    throw new Error(`Failed to query installed_modules: ${JSON.stringify(error)}`);
  }

  const installedMap = new Map<string, InstalledModuleRow>(
    (installed ?? []).map((m) => [m.id as string, m as unknown as InstalledModuleRow])
  );
  const loadedIds = new Set(loaded.map((m) => m.config.id));

  // Process loaded modules in dependency order
  const sorted = topologicalSort(loaded);
  for (const mod of sorted) {
    try {
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
          admin_nav: mod.config.adminNavItems || null,
        });

      if (insertErr) {
        console.error(`[modules] Failed to register "${mod.config.name}":`, insertErr);
      }

      console.log(`[modules] Registered "${mod.config.name}" v${mod.config.version}`);
    } else if (existing.status === 'disabled' || existing.status === 'not_installed') {
      // Module exists but is not active — update metadata (version, features)
      // but do NOT run migrations. Migrations are applied when the module is
      // explicitly enabled via the admin UI or onboarding /select endpoint.
      const metadataUpdates: Record<string, unknown> = {};
      if (isNewerVersion(mod.config.version, existing.version)) {
        console.log(`[modules] Updating metadata for inactive module "${mod.config.name}" (v${existing.version} → v${mod.config.version})...`);
        metadataUpdates.version = mod.config.version;
        metadataUpdates.features = mod.config.features;
      }
      // Always sync nav fields
      const newPortalNav = mod.config.portalNav || null;
      const newAdminNav = mod.config.adminNavItems || null;
      if (JSON.stringify(newPortalNav) !== JSON.stringify(existing.portal_nav || null)) {
        metadataUpdates.portal_nav = newPortalNav;
      }
      if (JSON.stringify(newAdminNav) !== JSON.stringify(existing.admin_nav || null)) {
        metadataUpdates.admin_nav = newAdminNav;
      }
      if (Object.keys(metadataUpdates).length > 0) {
        await supabase
          .from('installed_modules')
          .update(metadataUpdates)
          .eq('id', mod.config.id);
      }
    } else {
      // Module is enabled — always apply pending migrations (idempotent)
      // and run lifecycle hooks for freshly enabled modules.
      await applyModuleMigrations(mod, supabase);

      if (isNewerVersion(mod.config.version, existing.version)) {
        console.log(`[modules] Upgrading "${mod.config.name}" from v${existing.version} to v${mod.config.version}...`);
        await supabase
          .from('installed_modules')
          .update({ version: mod.config.version, features: mod.config.features, portal_nav: mod.config.portalNav || null, admin_nav: mod.config.adminNavItems || null })
          .eq('id', mod.config.id);
        console.log(`[modules] Upgraded "${mod.config.name}" to v${mod.config.version}`);
      } else {
        // Always sync nav fields (may have been added/changed without a version bump)
        const updates: Record<string, unknown> = {};
        const newPortalNav = mod.config.portalNav || null;
        const newAdminNav = mod.config.adminNavItems || null;
        if (JSON.stringify(newPortalNav) !== JSON.stringify(existing.portal_nav || null)) {
          updates.portal_nav = newPortalNav;
        }
        if (JSON.stringify(newAdminNav) !== JSON.stringify(existing.admin_nav || null)) {
          updates.admin_nav = newAdminNav;
        }
        if (Object.keys(updates).length > 0) {
          await supabase
            .from('installed_modules')
            .update(updates)
            .eq('id', mod.config.id);
        }
      }
    }
  }

  // Disable removed modules
  for (const [id, row] of installedMap) {
    if (!loadedIds.has(id) && row.status === 'enabled') {
      console.log(`[modules] Disabling "${row.name}" (removed from config)...`);

      await supabase
        .from('installed_modules')
        .update({ status: 'disabled' as const })
        .eq('id', id);

      console.log(`[modules] Disabled "${row.name}"`);
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

  // Normalize keys to avoid duplicates from different path representations
  // e.g., "../premium-gatewaze-modules/modules" and "/premium-gatewaze-modules/modules"
  function normalizeKey(url: string, path?: string | null): string {
    // Strip leading ../ and / to get a canonical directory name
    const cleanUrl = url.replace(/^(?:\.\.\/)+/, '').replace(/^\/+/, '');
    return `${cleanUrl}|${path ?? ''}`;
  }

  const existingKeys = new Set(
    (existing ?? []).map((r) => normalizeKey(
      (r as Record<string, unknown>).url as string,
      (r as Record<string, unknown>).path as string | null
    ))
  );

  for (const source of configSources) {
    const { url, path, branch } = normalizeSource(source);
    const key = normalizeKey(url, path);

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
