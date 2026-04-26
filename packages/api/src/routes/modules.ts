import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import {
  loadModulesWithDbSources,
  reconcileModules,
  seedModuleSources,
  applyModuleMigrations,
  deployEdgeFunctions,
  computeEdgeFunctionsHash,
  isNewerVersion,
  compareSemver,
  bootstrapCheck,
  applyCoreMigrations,
  detectEnvironment,
  computeShadowedSourceIds,
  installLiveSnapshot,
  removeLiveSnapshot,
  triggerRebuild,
  summariseRebuild,
  readSnapshot,
  liveModuleDir,
  sweepOrphanedNewDirs,
} from '@gatewaze/shared/modules';
import type { InstalledModuleRow, LoadedModule } from '@gatewaze/shared/modules';
import { resolve } from 'path';
import { existsSync, mkdirSync, readdirSync, unlinkSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import crypto from 'crypto';
import multer from 'multer';
import { writeAuditLog } from '../lib/audit-log';
import { createRedactedLogger } from '../lib/log-redaction';
import { isLeader } from '../lib/leadership';
import { validateGitUrl } from '../lib/zip-validation';
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

/** Middleware: require leadership for all mutating operations */
function requireLeadership(req: any, res: any, next: any) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }
  if (!isLeader()) {
    return res.status(503).json({
      error: {
        code: 'LEADERSHIP_LOST',
        message: 'This API instance is not the leader. Mutating module operations are not available.',
        details: {},
      },
    });
  }
  next();
}

modulesRouter.use(requireLeadership);

/** Middleware: attach request-id from header or generate one */
modulesRouter.use((req: any, _res: any, next: any) => {
  req.requestId = req.headers['x-request-id'] || crypto.randomUUID();
  next();
});

/** Helper: create a service-role Supabase client or throw */
function getServiceClient() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(supabaseUrl, serviceRoleKey);
}

/**
 * Parse MODULE_SOURCES env var into ModuleSource entries. Each entry is
 * either a git URL (optionally `#branch=X&path=Y`) or a local absolute
 * path. Mirrors the Vite plugin and portal script parsing.
 */
function parseEnvModuleSources(): { url: string; path?: string; branch?: string; label?: string }[] {
  const raw = process.env.MODULE_SOURCES;
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [url, fragment] = entry.split('#');
      if (!fragment) return { url };
      const params = new URLSearchParams(fragment);
      return {
        url,
        path: params.get('path') ?? undefined,
        branch: params.get('branch') ?? undefined,
        label: params.get('label') ?? undefined,
      };
    });
}

/** Helper: load all modules from config + env + DB sources */
async function loadAllModules() {
  const supabase = getServiceClient();
  let dbSources: Record<string, unknown>[] = [];
  try {
    await seedModuleSources(config.moduleSources ?? [], supabase as never, 'config');
    const envSources = parseEnvModuleSources();
    if (envSources.length > 0) {
      await seedModuleSources(envSources, supabase as never, 'env');
    }
    const { data } = await supabase.from('module_sources').select('*');
    dbSources = data ?? [];
  } catch {
    // module_sources table may not exist yet
  }
  return loadModulesWithDbSources(config, dbSources as never[], PROJECT_ROOT);
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
      // Sort in dependency order, auto-including hidden dependencies (e.g., scrapers)
      const enabledSet = new Set(enabled);
      const sorted: LoadedModule[] = [];
      const visited = new Set<string>();

      function visit(mod: LoadedModule) {
        if (visited.has(mod.config.id)) return;
        visited.add(mod.config.id);
        for (const depId of mod.config.dependencies ?? []) {
          const dep = modules.find((m) => m.config.id === depId);
          if (dep) visit(dep);
        }
        sorted.push(mod);
      }
      for (const mod of modules) {
        if (enabledSet.has(mod.config.id)) visit(mod);
      }

      const sortedIds = new Set(sorted.map((m) => m.config.id));
      const remainingIds = enabled.filter((id) => !sortedIds.has(id));

      for (const mod of sorted) {
        try {
          await applyModuleMigrations(mod, supabase as never);
        } catch (migErr) {
          console.error(`[modules] Migration failed for "${mod.config.id}" during selection:`, migErr);
        }

        await supabase
          .from('installed_modules')
          .update({ status: 'enabled' })
          .eq('id', mod.config.id);
      }

      // Enable remaining modules that had no loaded config (just set status)
      for (const moduleId of remainingIds) {
        await supabase
          .from('installed_modules')
          .update({ status: 'enabled' })
          .eq('id', moduleId);
      }
    }

    // Deploy edge functions for newly enabled modules
    if (enabled?.length) {
      const enabledSet = new Set(enabled);
      const enabledModulesWithFunctions = modules.filter(
        (m) => enabledSet.has(m.config.id) && (m.config.edgeFunctions?.length || m.config.functionFiles?.length)
      );
      if (enabledModulesWithFunctions.length > 0) {
        const deployResult = await deployEdgeFunctions({
          projectRoot: PROJECT_ROOT,
          modules: enabledModulesWithFunctions,
          allModules: modules,
        });
        const totalDeployed = deployResult.copied.length + deployResult.deployed.length;
        if (totalDeployed > 0) {
          console.log(`[modules] Deployed ${totalDeployed} edge function(s) during onboarding`);
        }
        if (deployResult.errors.length > 0) {
          console.warn('[modules] Edge function deployment warnings:', deployResult.errors);
        }

        // Store edge function hashes for all deployed modules
        for (const mod of enabledModulesWithFunctions) {
          const hash = computeEdgeFunctionsHash(mod);
          if (hash) {
            await supabase
              .from('installed_modules')
              .update({ edge_functions_hash: hash })
              .eq('id', mod.config.id);
          }
        }
      }
    }

    // Also update the onboarding step
    await supabase
      .from('platform_settings')
      .upsert({ key: 'onboarding_step', value: 'modules_selected' }, { onConflict: 'key' });

    // Audit log
    await writeAuditLog(supabase, (req as any).userId, (req as any).userRole, {
      action: 'modules.select',
      requestId: (req as any).requestId,
      metadata: { enabled, disabled },
    });

    return res.json({ success: true });
  } catch (err) {
    console.error('[modules] Selection failed:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Module selection failed',
    });
  }
});

/**
 * POST /api/modules/select-stream
 *
 * SSE version of /select — streams progress events during module installation.
 * Used by the onboarding UI for real-time progress reporting.
 *
 * Events:
 *   progress: { step, module?, message, current, total }
 *   module-complete: { module, status: 'ok'|'warning'|'error', message? }
 *   complete: { success, enabledCount, deployedCount, errors }
 *   error: { message }
 */
modulesRouter.post('/select-stream', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const send = (event: string, data: Record<string, unknown>) => {
    if (res.destroyed) return;
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* client disconnected */ }
  };

  try {
    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      send('error', { message: 'Missing Supabase credentials' });
      res.end();
      return;
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { enabled, disabled } = req.body as { enabled?: string[]; disabled?: string[] };

    // Phase 1: Reconcile
    send('progress', { step: 'reconcile', message: 'Loading modules...', current: 0, total: 0 });
    const modules = await loadAllModules();
    send('progress', { step: 'reconcile', message: `Reconciling ${modules.length} modules...`, current: 0, total: 0 });
    await reconcileModules(modules, supabase as never);

    // Phase 2: Disable
    if (disabled?.length) {
      send('progress', { step: 'disable', message: `Disabling ${disabled.length} modules...`, current: 0, total: disabled.length });
      await supabase.from('installed_modules').update({ status: 'disabled' }).in('id', disabled);
    }

    // Phase 3: Enable (with dependency sort)
    const migrationErrors: Array<{ module: string; error: string }> = [];

    if (enabled?.length) {
      const enabledSet = new Set(enabled);

      // Topological sort — search ALL modules for dependencies (not just selected ones)
      // so hidden dependency modules (e.g., scrapers) are auto-included
      const sorted: LoadedModule[] = [];
      const visited = new Set<string>();
      function visit(mod: LoadedModule) {
        if (visited.has(mod.config.id)) return;
        visited.add(mod.config.id);
        for (const depId of mod.config.dependencies ?? []) {
          const dep = modules.find((m) => m.config.id === depId);
          if (dep) visit(dep);
        }
        sorted.push(mod);
      }
      // Start from user-selected modules, pulling in dependencies automatically
      for (const mod of modules) {
        if (enabledSet.has(mod.config.id)) visit(mod);
      }

      const sortedIds = new Set(sorted.map((m) => m.config.id));
      const remainingIds = enabled.filter((id) => !sortedIds.has(id));

      // Apply migrations one by one with progress
      for (let i = 0; i < sorted.length; i++) {
        const mod = sorted[i];
        send('progress', {
          step: 'migrate',
          module: mod.config.id,
          message: `Applying migrations for ${mod.config.name}...`,
          current: i + 1,
          total: sorted.length,
        });

        try {
          await applyModuleMigrations(mod, supabase as never);
          await supabase.from('installed_modules').update({ status: 'enabled' }).eq('id', mod.config.id);
          send('module-complete', { module: mod.config.id, name: mod.config.name, status: 'ok' });
        } catch (migErr) {
          const errMsg = migErr instanceof Error ? migErr.message : String(migErr);
          console.error(`[modules] Migration failed for "${mod.config.id}":`, migErr);
          migrationErrors.push({ module: mod.config.id, error: errMsg });
          // Still enable the module (migrations may be partially applied)
          await supabase.from('installed_modules').update({ status: 'enabled' }).eq('id', mod.config.id);
          send('module-complete', { module: mod.config.id, name: mod.config.name, status: 'warning', message: errMsg });
        }
      }

      for (const moduleId of remainingIds) {
        await supabase.from('installed_modules').update({ status: 'enabled' }).eq('id', moduleId);
      }

      // Phase 4: Deploy edge functions
      const enabledModulesWithFunctions = modules.filter(
        (m) => enabledSet.has(m.config.id) && (m.config.edgeFunctions?.length || m.config.functionFiles?.length)
      );

      if (enabledModulesWithFunctions.length > 0) {
        const totalFunctions = enabledModulesWithFunctions.reduce(
          (sum, m) => sum + ((m.config.edgeFunctions?.length || m.config.functionFiles?.length) ?? 0), 0
        );
        send('progress', {
          step: 'deploy',
          message: `Deploying ${totalFunctions} edge functions...`,
          current: 0,
          total: totalFunctions,
        });

        const deployResult = await deployEdgeFunctions({
          projectRoot: PROJECT_ROOT,
          modules: enabledModulesWithFunctions,
          allModules: modules,
        });

        const totalDeployed = deployResult.copied.length + deployResult.deployed.length;
        send('progress', {
          step: 'deploy',
          message: `Deployed ${totalDeployed} of ${totalFunctions} edge functions`,
          current: totalDeployed,
          total: totalFunctions,
        });

        if (deployResult.errors.length > 0) {
          for (const err of deployResult.errors) {
            send('module-complete', {
              module: err.module,
              name: err.functionName,
              status: 'warning',
              message: `Edge function failed: ${err.error}`,
            });
          }
        }

        // Store hashes
        for (const mod of enabledModulesWithFunctions) {
          const hash = computeEdgeFunctionsHash(mod);
          if (hash) {
            await supabase.from('installed_modules').update({ edge_functions_hash: hash }).eq('id', mod.config.id);
          }
        }
      }
    }

    // Phase 5: Finalize
    await supabase
      .from('platform_settings')
      .upsert({ key: 'onboarding_step', value: 'modules_selected' }, { onConflict: 'key' });

    send('complete', {
      success: true,
      enabledCount: enabled?.length ?? 0,
      migrationErrors,
    });
  } catch (err) {
    console.error('[modules] Selection stream failed:', err);
    send('error', { message: err instanceof Error ? err.message : 'Module selection failed' });
  } finally {
    res.end();
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

    // Try to seed config + env sources and load DB sources.
    // Gracefully degrade if module_sources table doesn't exist yet.
    let dbSources: Record<string, unknown>[] = [];
    try {
      await seedModuleSources(config.moduleSources ?? [], supabase as never, 'config');
      const envSources = parseEnvModuleSources();
      if (envSources.length > 0) {
        await seedModuleSources(envSources, supabase as never, 'env');
      }
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
      (m) => enabledIds.has(m.config.id) && (m.config.edgeFunctions?.length || m.config.functionFiles?.length)
    );
    if (enabledModulesWithFunctions.length > 0) {
      const deployResult = await deployEdgeFunctions({
        projectRoot: PROJECT_ROOT,
        modules: enabledModulesWithFunctions,
        allModules: modules,
      });
      if (deployResult.copied.length > 0 || deployResult.deployed.length > 0) {
        console.log(`[modules] Deployed ${deployResult.copied.length + deployResult.deployed.length} edge function(s) during reconciliation`);
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

    // Check dependencies: all required modules must be enabled first
    if (mod?.config.dependencies?.length) {
      const { data: installed } = await supabase
        .from('installed_modules')
        .select('id, status');

      const enabledIds = new Set(
        (installed ?? [])
          .filter((r: Record<string, unknown>) => r.status === 'enabled')
          .map((r: Record<string, unknown>) => r.id as string)
      );

      const missingDeps = mod.config.dependencies.filter((depId) => !enabledIds.has(depId));
      if (missingDeps.length > 0) {
        const depNames = missingDeps.map((depId) => {
          const dep = modules.find((m) => m.config.id === depId);
          return dep ? `"${dep.config.name}"` : `"${depId}"`;
        });
        return res.status(409).json({
          error: `Module "${mod.config.name}" requires ${depNames.join(', ')} to be enabled first.`,
          code: 'MISSING_DEPENDENCIES',
          missingDependencies: missingDeps,
        });
      }
    }

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

    // Upsert status and metadata in DB (handles both new installs and re-enables)
    const upsertPayload: Record<string, unknown> = {
      id: moduleId,
      ...updatePayload,
      name: mod?.config.name || moduleId,
      description: mod?.config.description || '',
      version: mod?.config.version || '1.0.0',
      features: mod?.config.features || [],
      type: mod?.config.type || 'feature',
      visibility: mod?.config.visibility || 'public',
      admin_nav: mod?.config.adminNavItems || null,
    };

    const { error: updateErr } = await supabase
      .from('installed_modules')
      .upsert(upsertPayload, { onConflict: 'id' });

    if (updateErr) {
      return res.status(500).json({ error: updateErr.message });
    }

    let migrationsApplied: string[] = [];
    let edgeFunctionsDeployed: string[] = [];
    let rebuildCounter: number | undefined;

    if (mod) {
      // Dual-tree install per spec-module-deployment-overhaul §5.1:
      // copy source → live before running migrations/edge-function deploy.
      // The loader will now resolve mod.resolvedDir via the live tree on
      // subsequent loads; we also rebind it here so this flow's migration
      // + edge-deploy steps read from the live snapshot, not upstream.
      if (mod.resolvedDir) {
        try {
          // Find source origin — git-cloned / local / upload.
          const isSymlinkSource = isLocalPathSource(mod.resolvedDir, config.moduleSources ?? []);
          const sourceId = await lookupSourceIdFor(mod.resolvedDir, supabase);

          const snap = installLiveSnapshot({
            moduleId,
            sourceId,
            sourceDir: mod.resolvedDir,
            symlink: isSymlinkSource,
          });

          // Rebind resolvedDir so migrations + edge-function paths now
          // resolve relative to the live tree.
          mod.resolvedDir = liveModuleDir(moduleId);

          await supabase
            .from('installed_modules')
            .update({
              source_id: sourceId ?? null,
              source_snapshot_hash: snap.snapshotHash,
              snapshot_taken_at: snap.installedAt,
              last_rebuild_error: null,
            })
            .eq('id', moduleId);
        } catch (snapErr) {
          console.error('[modules] Live snapshot install failed:', snapErr);
          return res.status(500).json({
            error: {
              code: 'SNAPSHOT_INSTALL_FAILED',
              message: snapErr instanceof Error ? snapErr.message : String(snapErr),
            },
          });
        }
      }

      // Apply pending migrations
      await applyModuleMigrations(mod, supabase as never);
      migrationsApplied = mod.config.migrations ?? [];

      // Deploy edge functions
      if (mod.config.edgeFunctions?.length || mod.config.functionFiles?.length) {
        const deployResult = await deployEdgeFunctions({
          projectRoot: PROJECT_ROOT,
          modules: [mod],
          allModules: modules,
        });

        edgeFunctionsDeployed = [...deployResult.copied, ...deployResult.deployed].map((r) => r.functionName);

        if (deployResult.errors.length > 0) {
          console.warn('[modules] Edge function deployment warnings:', deployResult.errors);
        }
      }

      // Store edge functions hash for change detection
      const hash = computeEdgeFunctionsHash(mod);
      if (hash) {
        await supabase
          .from('installed_modules')
          .update({ edge_functions_hash: hash })
          .eq('id', moduleId);
      }

      // Run lifecycle hook
      if (mod.config.onEnable) {
        await mod.config.onEnable();
      }

      // Trigger admin + portal bundle rebuild per §7.
      try {
        rebuildCounter = await triggerRebuild(supabase as never, {
          components: ['admin', 'portal'],
          reason: `enable:${moduleId}`,
        });
      } catch (rebuildErr) {
        console.warn('[modules] Rebuild trigger failed:', rebuildErr);
      }
    }

    return res.json({
      success: true,
      migrationsApplied,
      edgeFunctionsDeployed,
      rebuildCounter,
    });
  } catch (err) {
    console.error('[modules] Enable failed:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to enable module',
    });
  }
});

/**
 * Heuristic: a resolvedDir sourced from a local-path (volume-mounted)
 * entry in MODULE_SOURCES should be symlinked into the live tree rather
 * than copied, so HMR/dev workflows pick up in-place edits.
 */
function isLocalPathSource(resolvedDir: string, configSources: unknown[]): boolean {
  // Any local absolute path MODULE_SOURCES entry produces a resolvedDir
  // that matches one of those mount points. Git sources resolve under
  // .gatewaze-sources/<slug>/ or /<reponame>/.
  if (resolvedDir.includes('/.gatewaze-sources/') || resolvedDir.includes('/.gatewaze-modules/')) return false;
  // Per §3.3 heuristic: local-path mounts appear at /<name>/modules/...
  // or similar absolute paths; git clones live under the cache dir above.
  return !resolvedDir.includes('.git/') && /^\/[a-zA-Z0-9-]+-modules\//.test(resolvedDir);
}

async function lookupSourceIdFor(
  resolvedDir: string,
  supabase: ReturnType<typeof getServiceClient>
): Promise<string | undefined> {
  // Match the source by URL fragment of its path against resolvedDir.
  const { data } = await supabase.from('module_sources').select('id, url');
  for (const row of data ?? []) {
    const url = (row as { url: string }).url;
    if (!url) continue;
    if (resolvedDir.startsWith(url) || resolvedDir.includes(url.replace(/\/+$/, ''))) {
      return (row as { id: string }).id;
    }
  }
  return undefined;
}

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

    // Dual-tree uninstall per spec-module-deployment-overhaul §5.3:
    // remove the live snapshot so the bundle rebuild stops serving it.
    try {
      removeLiveSnapshot(moduleId);
      await supabase
        .from('installed_modules')
        .update({ source_snapshot_hash: null, snapshot_taken_at: null })
        .eq('id', moduleId);
    } catch (snapErr) {
      console.warn('[modules] Live snapshot removal warning:', snapErr);
    }

    // Clear any pending update row.
    try {
      await supabase.from('module_updates_available').delete().eq('module_id', moduleId);
    } catch {
      // Table may not exist pre-migration; non-fatal.
    }

    let rebuildCounter: number | undefined;
    try {
      rebuildCounter = await triggerRebuild(supabase as never, {
        components: ['admin', 'portal'],
        reason: `disable:${moduleId}`,
      });
    } catch (rebuildErr) {
      console.warn('[modules] Rebuild trigger failed:', rebuildErr);
    }

    return res.json({ success: true, rebuildCounter });
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
    const available = modules.map((m) => {
      let guide: string | undefined;
      if (m.resolvedDir) {
        const guidePath = resolve(m.resolvedDir, 'guide.md');
        if (existsSync(guidePath)) {
          try { guide = readFileSync(guidePath, 'utf-8'); } catch { /* skip */ }
        }
      }
      // NOTE: intentionally excludes resolvedDir / rootPath to avoid
      // leaking absolute filesystem paths in the API response.
      return {
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
        locationHint: m.sourceLabel ?? 'built-in',
        guide,
      };
    });
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
      .select('id, name, version, status, edge_functions_hash');

    const installedMap = new Map(
      (installed ?? []).map((r: Record<string, unknown>) => [r.id as string, r])
    );


    const updates: {
      id: string;
      name: string;
      installedVersion: string;
      availableVersion: string;
      reason: 'version' | 'edge_functions_changed';
      minPlatformVersion?: string;
      platformCompatible: boolean;
    }[] = [];

    for (const mod of modules) {
      const row = installedMap.get(mod.config.id) as InstalledModuleRow | undefined;
      if (!row) continue;

      const installedVersion = row.version;
      const platformCompatible =
        !mod.config.minPlatformVersion ||
        !config.platformVersion ||
        compareSemver(config.platformVersion, mod.config.minPlatformVersion) >= 0;

      // Check for version bump
      if (isNewerVersion(mod.config.version, installedVersion)) {
        updates.push({
          id: mod.config.id,
          name: mod.config.name,
          installedVersion,
          availableVersion: mod.config.version,
          reason: 'version',
          minPlatformVersion: mod.config.minPlatformVersion,
          platformCompatible,
        });
        continue;
      }

      // Check for edge function source changes (only for enabled modules with edge functions)
      if (
        row.status === 'enabled' &&
        mod.config.edgeFunctions?.length
      ) {
        const currentHash = computeEdgeFunctionsHash(mod);
        const installedHash = row.edge_functions_hash;
        if (currentHash && currentHash !== installedHash) {
          updates.push({
            id: mod.config.id,
            name: mod.config.name,
            installedVersion,
            availableVersion: mod.config.version,
            reason: 'edge_functions_changed',
            platformCompatible,
          });
        }
      }
    }

    // Also merge in pending updates detected by `/sources/refresh` (git-pull
    // path). Those land in `module_updates_available` keyed by module_id and
    // are otherwise invisible to this endpoint, which is why the admin UI's
    // update banner never appeared after a sources refresh.
    const { data: pending } = await supabase
      .from('module_updates_available')
      .select('module_id, upstream_version, platform_compatible, min_platform_version');
    const alreadyListed = new Set(updates.map((u) => u.id));
    for (const p of (pending ?? []) as Record<string, unknown>[] ) {
      const moduleId = p.module_id as string;
      if (alreadyListed.has(moduleId)) continue;          // version-bump path won
      const row = installedMap.get(moduleId) as InstalledModuleRow | undefined;
      if (!row) continue;
      updates.push({
        id: moduleId,
        name: row.name ?? moduleId,
        installedVersion: row.version,
        availableVersion: (p.upstream_version as string) ?? row.version,
        reason: 'source_changed' as never,                // new reason key
        platformCompatible: (p.platform_compatible as boolean) !== false,
        minPlatformVersion: (p.min_platform_version as string | null) ?? undefined,
      });
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

    // If `/sources/refresh` flagged a pending update for this module
    // (git-pulled new code), the source dir has the new tree but the live
    // tree is still the old one — so loadAllModules() returns stale config.
    // Forward to the snapshot-install flow which copies source → live first.
    const { data: pending } = await supabase
      .from('module_updates_available')
      .select('module_id')
      .eq('module_id', moduleId)
      .maybeSingle();
    if (pending) {
      // Express doesn't expose a direct re-dispatch helper, but the
      // /:id/apply-update handler is just a few lines below — call it via
      // an internal redirect by invoking the same logic. Easiest: 307 the
      // client. But the client uses fetch with credentials, and 307
      // forwards method+body, so this is safe.
      return res.redirect(307, `/api/modules/${encodeURIComponent(moduleId)}/apply-update`);
    }

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

    // Get current installed state
    const { data: row } = await supabase
      .from('installed_modules')
      .select('version, status, edge_functions_hash')
      .eq('id', moduleId)
      .single();

    if (!row) {
      return res.status(404).json({ error: `Module "${moduleId}" is not installed` });
    }

    const previousVersion = (row as Record<string, unknown>).version as string;
    const hasVersionUpdate = isNewerVersion(mod.config.version, previousVersion);

    // Check for any source changes in the module
    const currentHash = computeEdgeFunctionsHash(mod);
    const installedHash = (row as Record<string, unknown>).edge_functions_hash as string | null;
    const hasEdgeFunctionChanges = currentHash !== null && currentHash !== installedHash;

    if (!hasVersionUpdate && !hasEdgeFunctionChanges) {
      return res.json({
        success: true,
        message: 'Already up to date',
        module: { id: moduleId, version: previousVersion },
      });
    }

    // 1. Apply pending migrations (only if version changed)
    if (hasVersionUpdate) {
      await applyModuleMigrations(mod, supabase as never);

      // Update version and features in DB
      await supabase
        .from('installed_modules')
        .update({
          version: mod.config.version,
          features: mod.config.features,
          name: mod.config.name,
          description: mod.config.description,
        })
        .eq('id', moduleId);
    }

    // 2. Deploy edge functions if module is enabled and has changes
    let edgeFunctionsDeployed: string[] = [];
    if (
      (row as Record<string, unknown>).status === 'enabled' &&
      (mod.config.edgeFunctions?.length || mod.config.functionFiles?.length) &&
      (hasVersionUpdate || hasEdgeFunctionChanges)
    ) {
      const deployResult = await deployEdgeFunctions({
        projectRoot: PROJECT_ROOT,
        modules: [mod],
        allModules: modules,
      });
      edgeFunctionsDeployed = [...deployResult.copied, ...deployResult.deployed].map((r) => r.functionName);

      // Update hash after successful deployment
      if (currentHash) {
        await supabase
          .from('installed_modules')
          .update({ edge_functions_hash: currentHash })
          .eq('id', moduleId);
      }
    }

    const reason = hasVersionUpdate ? 'version' : 'edge_functions_changed';
    console.log(`[modules] Updated "${mod.config.name}" (${reason})${hasVersionUpdate ? ` v${previousVersion} → v${mod.config.version}` : ' (edge functions redeployed)'}`);

    return res.json({
      success: true,
      reason,
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
      .select('id, version, status, edge_functions_hash');

    const installedMap = new Map(
      (installed ?? []).map((r: Record<string, unknown>) => [r.id as string, r])
    );

    const updated: { id: string; name: string; previousVersion: string; newVersion: string; reason: string }[] = [];
    const skipped: { id: string; name: string; reason: string }[] = [];
    const modulesToDeploy: LoadedModule[] = [];

    for (const mod of modules) {
      const row = installedMap.get(mod.config.id) as InstalledModuleRow | undefined;
      if (!row) continue;

      const hasVersionUpdate = isNewerVersion(mod.config.version, row.version);
      const currentHash = computeEdgeFunctionsHash(mod);
      const hasSourceChanges = currentHash !== null && currentHash !== row.edge_functions_hash;

      if (!hasVersionUpdate && !hasSourceChanges) continue;

      // Skip modules that require a newer platform version
      if (hasVersionUpdate && mod.config.minPlatformVersion && config.platformVersion) {
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

      // Apply migrations (only if version changed)
      if (hasVersionUpdate) {
        await applyModuleMigrations(mod, supabase as never);
      }

      // Update DB
      const dbUpdate: Record<string, unknown> = {
        name: mod.config.name,
        description: mod.config.description,
      };
      if (hasVersionUpdate) {
        dbUpdate.version = mod.config.version;
        dbUpdate.features = mod.config.features;
      }
      if (currentHash) {
        dbUpdate.edge_functions_hash = currentHash;
      }
      await supabase
        .from('installed_modules')
        .update(dbUpdate)
        .eq('id', mod.config.id);

      const reason = hasVersionUpdate ? 'version' : 'source_changed';
      updated.push({
        id: mod.config.id,
        name: mod.config.name,
        previousVersion,
        newVersion: mod.config.version,
        reason,
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
        allModules: modules,
      });
      edgeFunctionsDeployed = [...deployResult.copied, ...deployResult.deployed].map((r) => r.functionName);
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

    // Ensure config + env sources are seeded so the UI reflects what the
    // loader will actually resolve (including any env-var entries added
    // since last call).
    await loadAllModules().catch(() => {});

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data, error } = await supabase
      .from('module_sources')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Hide rows that are shadowed by a higher-precedence same-label row.
    // e.g. if MODULE_SOURCES has `/gatewaze-modules/modules#label=Free`
    // (origin=env) and gatewaze.config.ts contributes the git URL with
    // label=Free (origin=config), only the env row is shown.
    const shadowed = computeShadowedSourceIds((data ?? []) as never[]);
    const visible = (data ?? []).filter(
      (row: Record<string, unknown>) => !shadowed.has(row.id as string)
    );

    // Strip tokens — only indicate whether one is set
    const sources = visible.map((row: Record<string, unknown>) => ({
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

    // Validate the git URL format and safety
    if (url) {
      const urlErrors = validateGitUrl(url);
      if (urlErrors.length > 0) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: urlErrors.join('; '),
            details: { field: 'url' },
          },
        });
      }
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

modulesRouter.patch('/sources/:id', async (req, res) => {
  try {
    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({ error: 'Missing Supabase credentials' });
    }

    const { label } = req.body as { label?: string | null };

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { error } = await supabase
      .from('module_sources')
      .update({ label: typeof label === 'string' ? (label.trim() || null) : null })
      .eq('id', req.params.id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to update source',
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

    // Check for installed modules using this source
    const { data: usingModules } = await supabase
      .from('installed_modules')
      .select('module_id, status')
      .eq('source_id', req.params.id);

    if (usingModules && usingModules.length > 0) {
      return res.status(409).json({
        error: {
          code: 'SOURCE_IN_USE',
          message: `Cannot delete source: ${usingModules.length} installed module(s) reference it. Disable them first.`,
          details: { modules: usingModules.map((m: any) => ({ id: m.module_id, status: m.status })) },
        },
      });
    }

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
// Dual-tree endpoints (spec-module-deployment-overhaul §10)
// ---------------------------------------------------------------------------

/**
 * POST /api/modules/sources/refresh
 *
 * Manually pull all git sources into .gatewaze-sources/ and recompute
 * upstream hashes for each installed module. Writes results into
 * module_updates_available. Local-path sources are re-hashed in place;
 * upload-origin sources are skipped (immutable per §17).
 */
modulesRouter.post('/sources/refresh', async (_req, res) => {
  try {
    const supabase = getServiceClient();
    const { data: sources } = await supabase.from('module_sources').select('*');
    const now = new Date().toISOString();
    const errors: { sourceId: string; url: string; code: string; message: string }[] = [];

    for (const row of (sources ?? []) as Record<string, unknown>[]) {
      const url = row.url as string;
      const sourceId = row.id as string;
      const branch = (row.branch as string | null) ?? 'main';

      const isGit =
        url.startsWith('https://') ||
        url.startsWith('git://') ||
        url.startsWith('git@') ||
        url.endsWith('.git');

      if (!isGit) continue;

      const { sourcesRoot: srcRoot, repoSlug: slugFn } = await import('@gatewaze/shared/modules');
      const repoDir = resolve(srcRoot(), slugFn(url));
      try {
        if (existsSync(resolve(repoDir, '.git'))) {
          execSync(`git -C "${repoDir}" fetch --depth 1 origin "${branch}"`, { stdio: 'pipe' });
          execSync(`git -C "${repoDir}" reset --hard "origin/${branch}"`, { stdio: 'pipe' });
        } else {
          mkdirSync(srcRoot(), { recursive: true });
          execSync(`git clone --depth 1 --branch "${branch}" "${url}" "${repoDir}"`, { stdio: 'pipe' });
        }
      } catch (cloneErr) {
        const message = cloneErr instanceof Error ? cloneErr.message : String(cloneErr);
        const code = /not possible to fast-forward|non-fast-forward/i.test(message)
          ? 'HISTORY_REWRITTEN'
          : 'FETCH_FAILED';
        errors.push({ sourceId, url, code, message });
      }
    }

    // After refresh, recompute update-available rows by reloading modules
    // and comparing each module's upstream hash against the installed
    // source_snapshot_hash.
    const modules = await loadAllModules();
    const { data: installed } = await supabase
      .from('installed_modules')
      .select('id, status, source_id, source_snapshot_hash, version')
      .in('status', ['enabled', 'bundle_pending']);

    const { computeModuleHashFromPath } = await import('@gatewaze/shared/modules');
    let updatesAvailable = 0;

    for (const row of (installed ?? []) as unknown as InstalledModuleRow[]) {
      const mod = modules.find((m) => m.config.id === row.id);
      if (!mod || !mod.resolvedDir) continue;

      // For the upstream comparison we must hash the SOURCE dir, not the
      // live tree. Since the loader now prefers live → source, walk back
      // to the source directory for this module via its package name.
      const sourceMatch = await resolveSourceDirForModule(mod.config.id, supabase);
      if (!sourceMatch) continue;

      const upstreamHash = (() => {
        try { return computeModuleHashFromPath(sourceMatch); }
        catch { return null; }
      })();
      if (!upstreamHash) continue;

      const snapshotHash = row.source_snapshot_hash as string | null;
      if (upstreamHash !== snapshotHash) {
        const platformCompatible = !mod.config.minPlatformVersion ||
          !config.platformVersion ||
          compareSemver(config.platformVersion, mod.config.minPlatformVersion) >= 0;

        await supabase.from('module_updates_available').upsert({
          module_id: row.id,
          source_id: row.source_id,
          upstream_hash: upstreamHash,
          upstream_version: mod.config.version,
          detected_at: now,
          platform_compatible: platformCompatible,
          min_platform_version: mod.config.minPlatformVersion ?? null,
        });
        updatesAvailable++;
      } else {
        // Clear any stale update row.
        await supabase.from('module_updates_available').delete().eq('module_id', row.id);
      }
    }

    return res.json({
      refreshedAt: now,
      sourcesRefreshed: (sources ?? []).length,
      updatesAvailable,
      errors,
    });
  } catch (err) {
    console.error('[modules] Sources refresh failed:', err);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: err instanceof Error ? err.message : 'Failed to refresh sources' },
    });
  }
});

/**
 * Resolve the current upstream source directory for a given installed
 * module. Walks the active sources in priority order and returns the
 * first dir containing `<source>/<module>/index.ts`.
 */
async function resolveSourceDirForModule(
  moduleId: string,
  supabase: ReturnType<typeof getServiceClient>
): Promise<string | null> {
  const { data: sources } = await supabase.from('module_sources').select('*');
  const { sourcesRoot: srcRoot, repoSlug: slugFn } = await import('@gatewaze/shared/modules');
  for (const row of (sources ?? []) as Record<string, unknown>[]) {
    const url = row.url as string;
    const subPath = (row.path as string | null) ?? null;
    let base: string;
    const isGit = /^(https?:|git:|git@)/.test(url) || url.endsWith('.git');
    if (isGit) {
      base = resolve(srcRoot(), slugFn(url));
    } else {
      // Local path — honour absolute mount points from MODULE_SOURCES.
      base = url;
    }
    if (subPath) base = resolve(base, subPath);
    const candidate = resolve(base, moduleId, 'index.ts');
    if (existsSync(candidate)) {
      return resolve(base, moduleId);
    }
  }
  return null;
}

/**
 * POST /api/modules/:id/apply-update
 *
 * Install the upstream snapshot for an installed module. Atomic .new →
 * .prev → live swap per spec §5.2.
 */
modulesRouter.post('/:id/apply-update', async (req, res) => {
  try {
    const supabase = getServiceClient();
    const moduleId = req.params.id;

    const { data: updateRow } = await supabase
      .from('module_updates_available')
      .select('*')
      .eq('module_id', moduleId)
      .single();

    if (!updateRow) {
      return res.status(404).json({
        error: { code: 'UPDATE_NOT_AVAILABLE', message: `No pending update for module "${moduleId}"` },
      });
    }

    if ((updateRow as Record<string, unknown>).platform_compatible === false) {
      return res.status(409).json({
        error: {
          code: 'PLATFORM_INCOMPATIBLE',
          message: `Module "${moduleId}" update requires a newer platform.`,
          details: {
            minPlatformVersion: (updateRow as Record<string, unknown>).min_platform_version,
            currentVersion: config.platformVersion,
          },
        },
      });
    }

    // Resolve source dir and install as a fresh live snapshot. The same
    // copy-to-.new → rename-to-live logic as /enable, invoked here
    // against the upstream tree.
    const sourceDir = await resolveSourceDirForModule(moduleId, supabase);
    if (!sourceDir) {
      return res.status(500).json({
        error: { code: 'SOURCE_NOT_FOUND', message: `Upstream source for module "${moduleId}" not resolvable.` },
      });
    }

    const modules = await loadAllModules();
    const mod = modules.find((m) => m.config.id === moduleId);
    if (!mod) {
      return res.status(404).json({ error: { code: 'MODULE_NOT_FOUND', message: `Module "${moduleId}" not loaded` } });
    }

    const { data: installed } = await supabase
      .from('installed_modules')
      .select('version, source_snapshot_sha')
      .eq('id', moduleId)
      .single();
    const fromVersion = (installed as Record<string, unknown>)?.version as string | undefined;
    const fromSha = (installed as Record<string, unknown>)?.source_snapshot_sha as string | undefined;

    const isSymlinkSource = isLocalPathSource(sourceDir, config.moduleSources ?? []);
    const sourceId = (updateRow as Record<string, unknown>).source_id as string | undefined;

    const snap = installLiveSnapshot({
      moduleId,
      sourceId,
      sourceDir,
      symlink: isSymlinkSource,
    });

    mod.resolvedDir = liveModuleDir(moduleId);

    // Migrations + edge-function deploy against the new live tree.
    await applyModuleMigrations(mod, supabase as never);
    if (mod.config.edgeFunctions?.length || mod.config.functionFiles?.length) {
      await deployEdgeFunctions({
        projectRoot: PROJECT_ROOT,
        modules: [mod],
        allModules: modules,
      });
    }

    const edgeHash = computeEdgeFunctionsHash(mod);
    await supabase.from('installed_modules').update({
      version: mod.config.version,
      source_id: sourceId ?? null,
      source_snapshot_hash: snap.snapshotHash,
      edge_functions_hash: edgeHash,
      snapshot_taken_at: snap.installedAt,
      last_rebuild_error: null,
    }).eq('id', moduleId);

    await supabase.from('module_updates_available').delete().eq('module_id', moduleId);

    const rebuildCounter = await triggerRebuild(supabase as never, {
      components: ['admin', 'portal'],
      reason: `apply-update:${moduleId}`,
    });

    return res.status(202).json({
      moduleId,
      fromVersion,
      toVersion: mod.config.version,
      fromSha,
      toSha: (updateRow as Record<string, unknown>).upstream_sha ?? null,
      rebuildCounter,
      startedAt: snap.installedAt,
    });
  } catch (err) {
    console.error('[modules] apply-update failed:', err);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: err instanceof Error ? err.message : 'Failed to apply update' },
    });
  }
});

/**
 * POST /api/modules/rebuild/manual
 *
 * Super-admin-callable manual rebuild trigger (nothing else changes).
 * The service-role-only internal counter bump happens from API-to-API
 * calls in /enable, /disable, /apply-update, etc.
 */
modulesRouter.post('/rebuild/manual', async (req, res) => {
  try {
    const supabase = getServiceClient();
    const { reason } = req.body as { reason?: string };
    const counter = await triggerRebuild(supabase as never, {
      components: ['admin', 'portal'],
      reason: reason || 'manual',
    });
    return res.status(202).json({ counter });
  } catch (err) {
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: err instanceof Error ? err.message : 'Failed to trigger rebuild' },
    });
  }
});

/**
 * GET /api/modules/rebuild/:counter
 *
 * Poll the rebuild status for a given counter. Returns per-component
 * state — UI shows "Rebuilding…" until both admin + portal are ok or
 * one reports error.
 */
modulesRouter.get('/rebuild/:counter', async (req, res) => {
  const counter = parseInt(req.params.counter, 10);
  if (!Number.isFinite(counter)) {
    return res.status(400).json({ error: { code: 'INVALID_COUNTER', message: 'counter must be numeric' } });
  }
  return res.json(summariseRebuild(counter));
});

/**
 * GET /api/modules/:id/snapshot
 *
 * Inspect the current live snapshot metadata for an installed module.
 */
modulesRouter.get('/:id/snapshot', async (req, res) => {
  const moduleId = req.params.id;
  const snap = readSnapshot(moduleId);
  if (!snap) {
    return res.status(404).json({ error: { code: 'MODULE_NOT_FOUND', message: `No snapshot for "${moduleId}"` } });
  }
  return res.json({
    moduleId: snap.moduleId,
    snapshotHash: snap.snapshotHash,
    snapshotSha: snap.sourceSha ?? null,
    takenAt: snap.installedAt,
    sourceId: snap.sourceId ?? null,
  });
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

// ---------------------------------------------------------------------------
// Edge Function Proxy
//
// Allows the admin frontend to invoke module-installed edge functions via the
// API server. The API uses its server-side SUPABASE_URL which reaches the
// correct endpoint in both self-hosted (local edge runtime) and cloud mode
// (Supabase Cloud, after `make deploy-functions`).
// ---------------------------------------------------------------------------

modulesRouter.post('/invoke-function/:name', async (req, res) => {
  try {
    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({ error: 'Missing Supabase credentials' });
    }

    // Authenticate: verify the caller has a valid Supabase session
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    // Validate function name: must belong to an enabled module
    const functionName = req.params.name;
    const { data: enabledModules } = await supabase
      .from('installed_modules')
      .select('id, config')
      .eq('status', 'enabled');

    const modules = await loadAllModules();
    const allowedFunctions = new Set<string>();
    for (const row of enabledModules ?? []) {
      const mod = modules.find((m) => m.config.id === (row as Record<string, unknown>).id);
      if (mod?.config.edgeFunctions) {
        for (const fn of mod.config.edgeFunctions) {
          allowedFunctions.add(fn);
        }
      }
    }

    if (!allowedFunctions.has(functionName)) {
      return res.status(404).json({ error: `Function not found: ${functionName}` });
    }

    const response = await fetch(
      `${supabaseUrl}/functions/v1/${encodeURIComponent(functionName)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
        },
        body: JSON.stringify(req.body),
      },
    );

    const contentType = response.headers.get('content-type') ?? '';
    const body = contentType.includes('application/json')
      ? await response.json()
      : await response.text();

    return res.status(response.status).json(body);
  } catch (err) {
    console.error(`[modules] Edge function invoke failed:`, err);
    return res.status(502).json({
      error: err instanceof Error ? err.message : 'Failed to invoke edge function',
    });
  }
});

/**
 * POST /api/modules/secrets/rotate
 *
 * Re-encrypts all secret-typed config fields and source tokens
 * under the current GATEWAZE_SECRETS_KEY.
 * Requires GATEWAZE_SECRETS_KEY_OLD for decrypt fallback.
 * Super admin only.
 */
modulesRouter.post('/secrets/rotate', async (_req, res) => {
  try {
    const _supabase = getServiceClient();

    // This is a placeholder — full implementation requires the secrets module
    // to be imported and wired up. For now, return a 501.
    return res.status(501).json({
      error: {
        code: 'INTERNAL',
        message: 'Secret rotation is not yet fully implemented. Use GATEWAZE_SECRETS_KEY_OLD for manual rotation.',
        details: {},
      },
    });
  } catch (err) {
    return res.status(500).json({
      error: {
        code: 'INTERNAL',
        message: err instanceof Error ? err.message : 'Secret rotation failed',
      },
    });
  }
});
