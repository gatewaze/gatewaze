import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import {
  loadModulesWithDbSources,
  reconcileModules,
  seedModuleSources,
  applyModuleMigrations,
  deployEdgeFunctions,
  isNewerVersion,
  compareSemver,
  bootstrapCheck,
  applyCoreMigrations,
  detectEnvironment,
} from '@gatewaze/shared/modules';
import type { InstalledModuleRow, LoadedModule } from '@gatewaze/shared/modules';
import { resolve } from 'path';
import { existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import http from 'http';
import multer from 'multer';
import _configImport from '../../../../gatewaze.config.js';
// Unwrap CJS→ESM double-default wrapping (root package.json has no "type":"module")
const config = (_configImport as any)?.default ?? _configImport;

const PROJECT_ROOT = resolve(import.meta.dirname ?? __dirname, '../../../..');
const UPLOAD_DIR = resolve(PROJECT_ROOT, 'data/uploaded-modules');

const MAX_UPLOAD_SIZE = 50 * 1024 * 1024; // 50MB
const upload = multer({
  dest: resolve(PROJECT_ROOT, 'data/.tmp-uploads'),
  limits: { fileSize: MAX_UPLOAD_SIZE },
});

export const modulesRouter = Router();

/** Helper: create a service-role Supabase client or throw */
function getServiceClient() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(supabaseUrl, serviceRoleKey);
}

/** Helper: load all modules from config + DB sources */
async function loadAllModules() {
  const supabase = getServiceClient();
  let dbSources: Record<string, unknown>[] = [];
  try {
    await seedModuleSources(config.moduleSources ?? [], supabase as never);
    const { data } = await supabase.from('module_sources').select('*');
    dbSources = data ?? [];
  } catch {
    // module_sources table may not exist yet
  }
  return loadModulesWithDbSources(config, dbSources as never[], PROJECT_ROOT);
}

/** Should we deploy edge functions to Supabase (cloud/self-hosted)? */
function shouldDeployEdgeFunctions(): boolean {
  return !!(process.env.DEPLOY_EDGE_FUNCTIONS === 'true' || process.env.SUPABASE_PROJECT_REF);
}

/** Restart the edge runtime container so it picks up newly deployed functions. */
function restartEdgeRuntime(): Promise<void> {
  const container = process.env.EDGE_FUNCTIONS_CONTAINER;
  if (!container) return Promise.resolve();

  return new Promise((resolve) => {
    const req = http.request(
      { socketPath: '/var/run/docker.sock', path: `/containers/${container}/restart`, method: 'POST' },
      (res) => {
        console.log(`[modules] Edge runtime restart: ${res.statusCode === 204 ? 'OK' : res.statusCode}`);
        resolve();
      },
    );
    req.on('error', (err) => {
      console.warn('[modules] Failed to restart edge runtime:', err.message);
      resolve();
    });
    req.end();
  });
}

/**
 * GET /api/modules/bootstrap-check
 *
 * Validates that the Supabase instance (local or cloud) is ready for
 * module operations. Checks environment detection, exec_sql availability,
 * and cloud credentials.
 */
modulesRouter.get('/bootstrap-check', async (_req, res) => {
  try {
    const supabase = getServiceClient();
    const result = await bootstrapCheck(supabase as never);
    return res.json(result);
  } catch (err) {
    console.error('[modules] Bootstrap check failed:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Bootstrap check failed',
    });
  }
});

/**
 * POST /api/modules/bootstrap
 *
 * Apply core platform migrations to a Supabase instance.
 * Used during initial setup of a blank Supabase Cloud instance.
 */
modulesRouter.post('/bootstrap', async (_req, res) => {
  try {
    const supabase = getServiceClient();
    const environment = detectEnvironment();

    // Apply core migrations
    const { applied, errors } = await applyCoreMigrations(supabase as never, PROJECT_ROOT);

    if (errors.length > 0) {
      console.warn('[modules] Bootstrap migration errors:', errors);
    }

    return res.json({
      success: errors.length === 0,
      environment,
      migrationsApplied: applied,
      errors,
    });
  } catch (err) {
    console.error('[modules] Bootstrap failed:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Bootstrap failed',
    });
  }
});

/**
 * POST /api/modules/reconcile
 *
 * Triggers module reconciliation: applies pending migrations,
 * runs lifecycle hooks, and syncs the installed_modules table.
 *
 * Requires service_role key (only the API server has this).
 */
/**
 * POST /api/modules/select
 *
 * Batch enable/disable modules during onboarding.
 * Body: { enabled: string[], disabled: string[] }
 * Uses service_role to bypass RLS.
 */
modulesRouter.post('/select', async (req, res) => {
  try {
    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { enabled, disabled } = req.body as { enabled?: string[]; disabled?: string[] };

    // Reconcile first so all modules are registered in installed_modules.
    // This is important during onboarding when the table may be empty.
    const modules = await loadAllModules();
    await reconcileModules(modules, supabase as never);

    if (disabled?.length) {
      await supabase
        .from('installed_modules')
        .update({ status: 'disabled' })
        .in('id', disabled);
    }

    if (enabled?.length) {
      // Enable each module in dependency order and apply migrations
      for (const moduleId of enabled) {
        const mod = modules.find((m) => m.config.id === moduleId);
        if (mod) {
          try {
            await applyModuleMigrations(mod, supabase as never);
          } catch (migErr) {
            console.error(`[modules] Migration failed for "${moduleId}" during selection:`, migErr);
          }
        }

        await supabase
          .from('installed_modules')
          .update({ status: 'enabled' })
          .eq('id', moduleId);
      }
    }

    // Also update the onboarding step
    await supabase
      .from('platform_settings')
      .upsert({ key: 'onboarding_step', value: 'modules_selected' }, { onConflict: 'key' });

    return res.json({ success: true });
  } catch (err) {
    console.error('[modules] Selection failed:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Module selection failed',
    });
  }
});

/**
 * POST /api/modules/settings
 *
 * Upsert platform_settings via service_role (used during onboarding).
 * Body: { settings: { key: string, value: string }[] }
 */
modulesRouter.post('/settings', async (req, res) => {
  try {
    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { settings } = req.body as { settings?: { key: string; value: string }[] };

    if (settings?.length) {
      for (const s of settings) {
        await supabase
          .from('platform_settings')
          .upsert({ key: s.key, value: s.value }, { onConflict: 'key' });
      }
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('[modules] Settings update failed:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Settings update failed',
    });
  }
});

modulesRouter.post('/reconcile', async (_req, res) => {
  try {
    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({
        error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Try to seed config-file sources and load DB sources.
    // Gracefully degrade if module_sources table doesn't exist yet.
    let dbSources: Record<string, unknown>[] = [];
    try {
      await seedModuleSources(config.moduleSources ?? [], supabase as never);
      const { data } = await supabase.from('module_sources').select('*');
      dbSources = data ?? [];
    } catch {
      console.warn('[modules] module_sources table not available — using config sources only');
    }

    const modules = await loadModulesWithDbSources(
      config,
      dbSources as never[],
      PROJECT_ROOT,
    );

    // Run reconciliation (applies migrations, calls lifecycle hooks)
    await reconcileModules(modules, supabase as never);

    // Deploy edge functions for all enabled modules
    const { data: allInstalled } = await supabase.from('installed_modules').select('id, status');
    const enabledIds = new Set(
      (allInstalled ?? []).filter((r: Record<string, unknown>) => r.status === 'enabled').map((r: Record<string, unknown>) => r.id as string)
    );
    const enabledModulesWithFunctions = modules.filter(
      (m) => enabledIds.has(m.config.id) && m.config.edgeFunctions?.length
    );
    if (enabledModulesWithFunctions.length > 0) {
      const deployResult = await deployEdgeFunctions({
        projectRoot: PROJECT_ROOT,
        modules: enabledModulesWithFunctions,
        deploy: shouldDeployEdgeFunctions(),
        projectRef: process.env.SUPABASE_PROJECT_REF,
      });
      if (deployResult.copied.length > 0) {
        console.log(`[modules] Deployed ${deployResult.copied.length} edge function(s) during reconciliation`);
        await restartEdgeRuntime();
      }
    }

    // Return the current state of all modules
    const { data } = await supabase
      .from('installed_modules')
      .select('id, name, status, version');

    const results = (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
    }));

    return res.json({ success: true, modules: results });
  } catch (err) {
    console.error('[modules] Reconciliation failed:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Module reconciliation failed',
    });
  }
});

// ---------------------------------------------------------------------------
// Module Configuration
// ---------------------------------------------------------------------------

/**
 * PUT /api/modules/:id/config
 *
 * Save module configuration (API keys, settings, etc.).
 * Merges the provided config into the existing config JSON column.
 */
modulesRouter.put('/:id/config', async (req, res) => {
  try {
    const supabase = getServiceClient();
    const moduleId = req.params.id;
    const { config: newConfig } = req.body as { config?: Record<string, unknown> };

    if (!newConfig || typeof newConfig !== 'object') {
      return res.status(400).json({ error: 'config object is required' });
    }

    // Get existing config to merge
    const { data: existing } = await supabase
      .from('installed_modules')
      .select('config')
      .eq('id', moduleId)
      .single();

    if (!existing) {
      return res.status(404).json({ error: `Module "${moduleId}" is not installed` });
    }

    const mergedConfig = {
      ...((existing as Record<string, unknown>).config as Record<string, unknown> ?? {}),
      ...newConfig,
    };

    const { error: updateErr } = await supabase
      .from('installed_modules')
      .update({ config: mergedConfig })
      .eq('id', moduleId);

    if (updateErr) {
      return res.status(500).json({ error: updateErr.message });
    }

    return res.json({ success: true, config: mergedConfig });
  } catch (err) {
    console.error('[modules] Config update failed:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to save config',
    });
  }
});

// ---------------------------------------------------------------------------
// Module Enable / Disable (with edge function deployment)
// ---------------------------------------------------------------------------

/**
 * POST /api/modules/:id/enable
 *
 * Enable a module: apply pending migrations, deploy edge functions,
 * update status, and run lifecycle hooks.
 */
modulesRouter.post('/:id/enable', async (req, res) => {
  try {
    const supabase = getServiceClient();
    const moduleId = req.params.id;

    const modules = await loadAllModules();
    const mod = modules.find((m) => m.config.id === moduleId);

    // Check platform version compatibility
    if (mod?.config.minPlatformVersion && config.platformVersion) {
      if (compareSemver(config.platformVersion, mod.config.minPlatformVersion) < 0) {
        return res.status(409).json({
          error: `Module "${mod.config.name}" requires platform v${mod.config.minPlatformVersion}, but the current platform is v${config.platformVersion}. Please update the platform first.`,
          code: 'PLATFORM_VERSION_INCOMPATIBLE',
          requiredVersion: mod.config.minPlatformVersion,
          currentVersion: config.platformVersion,
        });
      }
    }

    // Theme module enforcement: only one active theme module at a time
    if (mod?.config.type === 'theme') {
      // Disable any currently active theme module
      const { data: activeThemes } = await supabase
        .from('installed_modules')
        .select('id')
        .eq('type', 'theme')
        .eq('status', 'enabled')
        .neq('id', moduleId);

      if (activeThemes?.length) {
        for (const prev of activeThemes) {
          await supabase
            .from('installed_modules')
            .update({ status: 'disabled' })
            .eq('id', (prev as Record<string, unknown>).id);

          // Clear portal overrides from the previous theme's config
          const { data: prevRow } = await supabase
            .from('installed_modules')
            .select('config')
            .eq('id', (prev as Record<string, unknown>).id)
            .single();
          if (prevRow) {
            const prevConfig = { ...((prevRow as Record<string, unknown>).config as Record<string, unknown> ?? {}) };
            delete prevConfig.portalThemeOverrides;
            await supabase
              .from('installed_modules')
              .update({ config: prevConfig })
              .eq('id', (prev as Record<string, unknown>).id);
          }

          // Run onDisable for the previous theme
          const prevMod = modules.find((m) => m.config.id === (prev as Record<string, unknown>).id);
          if (prevMod?.config.onDisable) {
            try { await prevMod.config.onDisable(); } catch { /* non-critical */ }
          }

          console.log(`[modules] Auto-disabled previous theme module: ${(prev as Record<string, unknown>).id}`);
        }
      }
    }

    // Build the update payload
    const updatePayload: Record<string, unknown> = {
      status: 'enabled',
      portal_nav: mod?.config.portalNav || null,
    };

    // For theme modules, write portal overrides into the config column
    // so the portal (Next.js) can read them at runtime without Vite
    if (mod?.config.type === 'theme' && mod.config.themeOverrides?.portal) {
      const { data: currentRow } = await supabase
        .from('installed_modules')
        .select('config')
        .eq('id', moduleId)
        .single();

      const currentConfig = (currentRow as Record<string, unknown>)?.config as Record<string, unknown> ?? {};
      updatePayload.config = {
        ...currentConfig,
        portalThemeOverrides: mod.config.themeOverrides.portal,
      };
    }

    // Update status and portal_nav in DB
    const { error: updateErr } = await supabase
      .from('installed_modules')
      .update(updatePayload)
      .eq('id', moduleId);

    if (updateErr) {
      return res.status(500).json({ error: updateErr.message });
    }

    let migrationsApplied: string[] = [];
    let edgeFunctionsDeployed: string[] = [];

    if (mod) {
      // Apply pending migrations
      await applyModuleMigrations(mod, supabase as never);
      migrationsApplied = mod.config.migrations ?? [];

      // Deploy edge functions
      if (mod.config.edgeFunctions?.length) {
        const deployResult = await deployEdgeFunctions({
          projectRoot: PROJECT_ROOT,
          modules: [mod],
          deploy: shouldDeployEdgeFunctions(),
          projectRef: process.env.SUPABASE_PROJECT_REF,
        });

        edgeFunctionsDeployed = deployResult.copied.map((r) => r.functionName);

        if (deployResult.errors.length > 0) {
          console.warn('[modules] Edge function deployment warnings:', deployResult.errors);
        }

        if (edgeFunctionsDeployed.length > 0) {
          await restartEdgeRuntime();
        }
      }

      // Run lifecycle hook
      if (mod.config.onEnable) {
        await mod.config.onEnable();
      }
    }

    return res.json({
      success: true,
      migrationsApplied,
      edgeFunctionsDeployed,
    });
  } catch (err) {
    console.error('[modules] Enable failed:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to enable module',
    });
  }
});

/**
 * POST /api/modules/:id/disable
 *
 * Disable a module and run lifecycle hooks.
 */
modulesRouter.post('/:id/disable', async (req, res) => {
  try {
    const supabase = getServiceClient();
    const moduleId = req.params.id;

    const { error: updateErr } = await supabase
      .from('installed_modules')
      .update({ status: 'disabled' })
      .eq('id', moduleId);

    if (updateErr) {
      return res.status(500).json({ error: updateErr.message });
    }

    // Run lifecycle hook
    try {
      const modules = await loadAllModules();
      const mod = modules.find((m) => m.config.id === moduleId);

      // Clear portal theme overrides from config column for theme modules
      if (mod?.config.type === 'theme') {
        const { data: row } = await supabase
          .from('installed_modules')
          .select('config')
          .eq('id', moduleId)
          .single();

        if (row) {
          const currentConfig = { ...((row as Record<string, unknown>).config as Record<string, unknown> ?? {}) };
          delete currentConfig.portalThemeOverrides;
          await supabase
            .from('installed_modules')
            .update({ config: currentConfig })
            .eq('id', moduleId);
        }
      }

      if (mod?.config.onDisable) {
        await mod.config.onDisable();
      }
    } catch {
      // Lifecycle hook failure shouldn't block disable
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('[modules] Disable failed:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to disable module',
    });
  }
});

// ---------------------------------------------------------------------------
// Module Update and Version Checking
// ---------------------------------------------------------------------------

/**
 * GET /api/modules/available
 *
 * Returns all modules discovered from live module sources.
 * The admin modules dashboard uses this instead of bundled config.
 */
modulesRouter.get('/available', async (_req, res) => {
  try {
    const modules = await loadAllModules();
    const available = modules.map((m) => ({
      id: m.config.id,
      name: m.config.name,
      description: m.config.description,
      version: m.config.version,
      type: m.config.type ?? 'feature',
      group: m.config.group ?? m.config.type ?? 'feature',
      visibility: m.config.visibility ?? 'public',
      features: m.config.features ?? [],
      minPlatformVersion: m.config.minPlatformVersion,
      sourceLabel: m.sourceLabel,
    }));
    return res.json({ modules: available });
  } catch (err) {
    console.error('[modules] Failed to load available modules:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to load modules',
    });
  }
});

/**
 * GET /api/modules/check-updates
 *
 * Compare source module versions against installed versions.
 * Returns modules where a newer version is available.
 */
modulesRouter.get('/check-updates', async (_req, res) => {
  try {
    const supabase = getServiceClient();
    const modules = await loadAllModules();

    const { data: installed } = await supabase
      .from('installed_modules')
      .select('id, name, version, status');

    const installedMap = new Map(
      (installed ?? []).map((r: Record<string, unknown>) => [r.id as string, r])
    );

    const updates: {
      id: string;
      name: string;
      installedVersion: string;
      availableVersion: string;
      minPlatformVersion?: string;
      platformCompatible: boolean;
    }[] = [];

    for (const mod of modules) {
      const row = installedMap.get(mod.config.id) as InstalledModuleRow | undefined;
      if (!row) continue;

      const installedVersion = row.version;
      if (isNewerVersion(mod.config.version, installedVersion)) {
        const platformCompatible =
          !mod.config.minPlatformVersion ||
          !config.platformVersion ||
          compareSemver(config.platformVersion, mod.config.minPlatformVersion) >= 0;

        updates.push({
          id: mod.config.id,
          name: mod.config.name,
          installedVersion,
          availableVersion: mod.config.version,
          minPlatformVersion: mod.config.minPlatformVersion,
          platformCompatible,
        });
      }
    }

    return res.json({ updates, platformVersion: config.platformVersion });
  } catch (err) {
    console.error('[modules] Check updates failed:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to check updates',
    });
  }
});

/**
 * POST /api/modules/:id/update
 *
 * Update a single module: apply new migrations, deploy edge functions,
 * and update the version in the DB.
 */
modulesRouter.post('/:id/update', async (req, res) => {
  try {
    const supabase = getServiceClient();
    const moduleId = req.params.id;

    const modules = await loadAllModules();
    const mod = modules.find((m) => m.config.id === moduleId);

    if (!mod) {
      return res.status(404).json({ error: `Module "${moduleId}" not found in sources` });
    }

    // Check platform version compatibility
    if (mod.config.minPlatformVersion && config.platformVersion) {
      if (compareSemver(config.platformVersion, mod.config.minPlatformVersion) < 0) {
        return res.status(409).json({
          error: `Module "${mod.config.name}" v${mod.config.version} requires platform v${mod.config.minPlatformVersion}, but the current platform is v${config.platformVersion}. Please update the platform first.`,
          code: 'PLATFORM_VERSION_INCOMPATIBLE',
          requiredVersion: mod.config.minPlatformVersion,
          currentVersion: config.platformVersion,
        });
      }
    }

    // Get current installed version
    const { data: row } = await supabase
      .from('installed_modules')
      .select('version, status')
      .eq('id', moduleId)
      .single();

    if (!row) {
      return res.status(404).json({ error: `Module "${moduleId}" is not installed` });
    }

    const previousVersion = (row as Record<string, unknown>).version as string;

    if (!isNewerVersion(mod.config.version, previousVersion)) {
      return res.json({
        success: true,
        message: 'Already up to date',
        module: { id: moduleId, version: previousVersion },
      });
    }

    // 1. Apply pending migrations
    await applyModuleMigrations(mod, supabase as never);

    // 2. Update version and features in DB
    await supabase
      .from('installed_modules')
      .update({
        version: mod.config.version,
        features: mod.config.features,
        name: mod.config.name,
        description: mod.config.description,
      })
      .eq('id', moduleId);

    // 3. Deploy edge functions if module is enabled
    let edgeFunctionsDeployed: string[] = [];
    if (
      (row as Record<string, unknown>).status === 'enabled' &&
      mod.config.edgeFunctions?.length
    ) {
      const deployResult = await deployEdgeFunctions({
        projectRoot: PROJECT_ROOT,
        modules: [mod],
        deploy: shouldDeployEdgeFunctions(),
        projectRef: process.env.SUPABASE_PROJECT_REF,
      });
      edgeFunctionsDeployed = deployResult.copied.map((r) => r.functionName);
      if (edgeFunctionsDeployed.length > 0) {
        await restartEdgeRuntime();
      }
    }

    console.log(`[modules] Updated "${mod.config.name}" from v${previousVersion} to v${mod.config.version}`);

    return res.json({
      success: true,
      module: {
        id: moduleId,
        name: mod.config.name,
        previousVersion,
        newVersion: mod.config.version,
      },
      edgeFunctionsDeployed,
    });
  } catch (err) {
    console.error('[modules] Update failed:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to update module',
    });
  }
});

/**
 * POST /api/modules/update-all
 *
 * Update all modules that have newer versions available.
 */
modulesRouter.post('/update-all', async (_req, res) => {
  try {
    const supabase = getServiceClient();
    const modules = await loadAllModules();

    const { data: installed } = await supabase
      .from('installed_modules')
      .select('id, version, status');

    const installedMap = new Map(
      (installed ?? []).map((r: Record<string, unknown>) => [r.id as string, r])
    );

    const updated: { id: string; name: string; previousVersion: string; newVersion: string }[] = [];
    const skipped: { id: string; name: string; reason: string }[] = [];
    const modulesToDeploy: LoadedModule[] = [];

    for (const mod of modules) {
      const row = installedMap.get(mod.config.id) as InstalledModuleRow | undefined;
      if (!row) continue;

      if (!isNewerVersion(mod.config.version, row.version)) continue;

      // Skip modules that require a newer platform version
      if (mod.config.minPlatformVersion && config.platformVersion) {
        if (compareSemver(config.platformVersion, mod.config.minPlatformVersion) < 0) {
          skipped.push({
            id: mod.config.id,
            name: mod.config.name,
            reason: `Requires platform v${mod.config.minPlatformVersion}`,
          });
          continue;
        }
      }

      const previousVersion = row.version;

      // Apply migrations
      await applyModuleMigrations(mod, supabase as never);

      // Update DB
      await supabase
        .from('installed_modules')
        .update({
          version: mod.config.version,
          features: mod.config.features,
          name: mod.config.name,
          description: mod.config.description,
        })
        .eq('id', mod.config.id);

      updated.push({
        id: mod.config.id,
        name: mod.config.name,
        previousVersion,
        newVersion: mod.config.version,
      });

      if (row.status === 'enabled' && mod.config.edgeFunctions?.length) {
        modulesToDeploy.push(mod);
      }
    }

    // Deploy edge functions for all updated+enabled modules at once
    let edgeFunctionsDeployed: string[] = [];
    if (modulesToDeploy.length > 0) {
      const deployResult = await deployEdgeFunctions({
        projectRoot: PROJECT_ROOT,
        modules: modulesToDeploy,
        deploy: shouldDeployEdgeFunctions(),
        projectRef: process.env.SUPABASE_PROJECT_REF,
      });
      edgeFunctionsDeployed = deployResult.copied.map((r) => r.functionName);
      if (edgeFunctionsDeployed.length > 0) {
        await restartEdgeRuntime();
      }
    }

    return res.json({
      success: true,
      updated,
      skipped,
      edgeFunctionsDeployed,
    });
  } catch (err) {
    console.error('[modules] Update all failed:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to update modules',
    });
  }
});

// ---------------------------------------------------------------------------
// Module Sources CRUD
// ---------------------------------------------------------------------------

modulesRouter.get('/sources', async (_req, res) => {
  try {
    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({ error: 'Missing Supabase credentials' });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data, error } = await supabase
      .from('module_sources')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Strip tokens — only indicate whether one is set
    const sources = (data ?? []).map((row: Record<string, unknown>) => ({
      ...row,
      token: undefined,
      hasToken: !!row.token,
    }));

    return res.json({ sources });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to fetch sources',
    });
  }
});

modulesRouter.post('/sources', async (req, res) => {
  try {
    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({ error: 'Missing Supabase credentials' });
    }

    const { url, path, branch, label, token } = req.body as {
      url?: string;
      path?: string;
      branch?: string;
      label?: string;
      token?: string;
    };

    if (!url?.trim()) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const trimmedUrl = url.trim();

    // Only git URLs are supported for user-added sources.
    // Local paths are only available via gatewaze.config.ts (bundled at build time).
    const isGit =
      trimmedUrl.startsWith('https://') ||
      trimmedUrl.startsWith('git://') ||
      trimmedUrl.startsWith('git@') ||
      trimmedUrl.endsWith('.git');

    if (!isGit) {
      return res.status(400).json({
        error: 'Only git repository URLs are supported. Use an HTTPS or git:// URL (e.g. https://github.com/org/modules.git).',
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data, error } = await supabase
      .from('module_sources')
      .insert({
        url: url.trim(),
        path: path?.trim() || null,
        branch: branch?.trim() || null,
        label: label?.trim() || null,
        token: token?.trim() || null,
        origin: 'user',
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json({ source: data });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to add source',
    });
  }
});

modulesRouter.delete('/sources/:id', async (req, res) => {
  try {
    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({ error: 'Missing Supabase credentials' });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { error } = await supabase
      .from('module_sources')
      .delete()
      .eq('id', req.params.id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to delete source',
    });
  }
});

// ---------------------------------------------------------------------------
// Module Upload (WordPress-style zip upload)
// ---------------------------------------------------------------------------

modulesRouter.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({ error: 'Missing Supabase credentials' });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Extract zip to a temp location, then move to UPLOAD_DIR
    mkdirSync(UPLOAD_DIR, { recursive: true });
    const extractDir = resolve(UPLOAD_DIR, `.tmp-${Date.now()}`);
    mkdirSync(extractDir, { recursive: true });

    try {
      execSync(`unzip -o "${file.path}" -d "${extractDir}"`, { stdio: 'pipe' });
    } catch {
      // Clean up on extraction failure
      execSync(`rm -rf "${extractDir}"`, { stdio: 'pipe' });
      unlinkSync(file.path);
      return res.status(400).json({ error: 'Failed to extract zip file' });
    }

    // Security: validate no path traversal in extracted files
    try {
      const listOutput = execSync(`unzip -l "${file.path}"`, { stdio: 'pipe' }).toString();
      if (listOutput.includes('../') || listOutput.includes('..\\')) {
        execSync(`rm -rf "${extractDir}"`, { stdio: 'pipe' });
        unlinkSync(file.path);
        return res.status(400).json({ error: 'Zip file contains path traversal sequences' });
      }
    } catch {
      // If we can't list the zip, the extraction above would have also failed
    }

    // Security: verify all extracted files are within the extraction directory
    try {
      const findOutput = execSync(`find "${extractDir}" -type f`, { stdio: 'pipe' }).toString();
      const resolvedExtractDir = resolve(extractDir);
      const hasEscape = findOutput.split('\n').some((f) => {
        if (!f.trim()) return false;
        return !resolve(f).startsWith(resolvedExtractDir);
      });
      if (hasEscape) {
        execSync(`rm -rf "${extractDir}"`, { stdio: 'pipe' });
        unlinkSync(file.path);
        return res.status(400).json({ error: 'Zip file contains files outside extraction directory' });
      }
    } catch {
      // find failure is non-fatal — extraction was already successful
    }

    // Find the module directory (may be nested one level inside the zip)
    let moduleDir = extractDir;
    const entries = readdirSync(extractDir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.'));

    if (!existsSync(resolve(extractDir, 'index.ts')) && dirs.length === 1) {
      moduleDir = resolve(extractDir, dirs[0].name);
    }

    if (!existsSync(resolve(moduleDir, 'index.ts'))) {
      execSync(`rm -rf "${extractDir}"`, { stdio: 'pipe' });
      unlinkSync(file.path);
      return res.status(400).json({
        error: 'Invalid module: no index.ts found in zip root',
      });
    }

    // Determine module slug from directory name
    const slug = moduleDir === extractDir
      ? file.originalname.replace(/\.zip$/i, '').replace(/[^a-zA-Z0-9-]/g, '-')
      : dirs[0].name;

    // Move to final location
    const finalDir = resolve(UPLOAD_DIR, slug);
    if (existsSync(finalDir)) {
      execSync(`rm -rf "${finalDir}"`, { stdio: 'pipe' });
    }
    execSync(`mv "${moduleDir}" "${finalDir}"`, { stdio: 'pipe' });

    // Clean up temp
    if (existsSync(extractDir)) {
      execSync(`rm -rf "${extractDir}"`, { stdio: 'pipe' });
    }
    unlinkSync(file.path);

    // Ensure the upload directory is registered as a module source
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data: existingSource } = await supabase
      .from('module_sources')
      .select('id')
      .eq('url', UPLOAD_DIR)
      .is('path', null)
      .maybeSingle();

    if (!existingSource) {
      await supabase
        .from('module_sources')
        .insert({
          url: UPLOAD_DIR,
          path: null,
          branch: null,
          label: 'Uploaded Modules',
          origin: 'upload',
        });
    }

    return res.json({ success: true, slug });
  } catch (err) {
    // Clean up uploaded file on unexpected errors
    if (req.file) {
      try { unlinkSync(req.file.path); } catch { /* ignore */ }
    }
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Upload failed',
    });
  }
});
