import express from 'express';
import cors from 'cors';
import { healthRouter } from './routes/health.js';
import { peopleRouter } from './routes/people.js';
import { csvRouter } from './routes/csv.js';
import { calendarsRouter } from './routes/calendars.js';
import { dbCopyRouter } from './routes/db-copy.js';
import { jobsRouter } from './routes/jobs.js';
import { screenshotsRouter } from './routes/screenshots.js';
import { customerioRouter } from './routes/customerio.js';
import { avatarsRouter } from './routes/avatars.js';
import { redirectsRouter } from './routes/redirects.js';
import { slackRouter } from './routes/slack.js';
import { calendarProxyRouter } from './routes/calendar-proxy.js';
import { modulesRouter } from './routes/modules.js';
import { apiKeysRouter } from './routes/api-keys.js';
import { hateoasMiddleware } from './lib/hateoas.js';
import { loadModules, loadModulesWithDbSources, reconcileModules } from '@gatewaze/shared/modules';
import type { ModuleRuntimeContext } from '@gatewaze/shared/modules';
import { createClient } from '@supabase/supabase-js';
import { resolve } from 'path';
import _configImport from '../../../gatewaze.config.js';
// Unwrap CJS→ESM double-default wrapping (root package.json has no "type":"module")
const config = (_configImport as any)?.default ?? _configImport;

const PROJECT_ROOT = resolve(import.meta.dirname ?? __dirname, '../../..');

const app = express();
const PORT = parseInt(process.env.PORT ?? '3002', 10);

// Middleware
app.use(cors({ origin: process.env.CORS_ORIGIN ?? '*', credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(hateoasMiddleware);

// Routes - existing
app.use('/api', healthRouter);
app.use('/api/people', peopleRouter);
app.use('/api/csv', csvRouter);
app.use('/api/calendars', calendarsRouter);
app.use('/api/db-copy', dbCopyRouter);

// Routes - added for admin
app.use('/api/jobs', jobsRouter);
app.use('/api/screenshots', screenshotsRouter);
app.use('/api/customerio', customerioRouter);
app.use('/api/avatars', avatarsRouter);
app.use('/api/redirects', redirectsRouter);
app.use('/api/slack', slackRouter);
app.use('/api/calendar', calendarProxyRouter);
app.use('/api/modules', modulesRouter);
app.use('/api/api-keys', apiKeysRouter);

// Module routes — loaded async before server starts
async function registerModuleRoutes() {
  try {
    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    let dbSources: Record<string, unknown>[] = [];
    let enabledModuleIds = new Set<string>();

    if (supabaseUrl && serviceRoleKey) {
      try {
        const supabase = createClient(supabaseUrl, serviceRoleKey);
        const { data } = await supabase.from('module_sources').select('*');
        dbSources = data ?? [];

        // Fetch enabled modules to only register routes for active modules
        const { data: installed } = await supabase
          .from('installed_modules')
          .select('id, status');
        enabledModuleIds = new Set(
          (installed ?? [])
            .filter((r: any) => r.status === 'enabled')
            .map((r: any) => r.id)
        );
      } catch {
        console.warn('[modules] module_sources table not available — using config sources only');
      }
    }

    const modules = await loadModulesWithDbSources(config, dbSources as never[], PROJECT_ROOT);
    for (const mod of modules) {
      // Only register API routes for enabled modules
      if (enabledModuleIds.size > 0 && !enabledModuleIds.has(mod.config.id)) {
        console.log(`[modules] Skipping API routes for disabled module: ${mod.config.name}`);
        continue;
      }
      if (mod.config.apiRoutes) {
        const runtimeCtx: ModuleRuntimeContext = {
          moduleId: mod.config.id,
          moduleDir: mod.resolvedDir || PROJECT_ROOT,
          projectRoot: PROJECT_ROOT,
          logger: {
            info: (msg, meta) => console.log(`[${mod.config.id}]`, msg, meta ?? ''),
            warn: (msg, meta) => console.warn(`[${mod.config.id}]`, msg, meta ?? ''),
            error: (msg, meta) => console.error(`[${mod.config.id}]`, msg, meta ?? ''),
            debug: (msg, meta) => console.debug(`[${mod.config.id}]`, msg, meta ?? ''),
          },
          supabase: null,
          config: config as never,
          moduleConfig: (mod as { moduleConfig?: Record<string, unknown> }).moduleConfig ?? {},
        };
        await mod.config.apiRoutes(app, runtimeCtx);
        console.log(`[modules] Registered API routes for: ${mod.config.name}`);
      }
    }
    if (modules.length > 0) {
      console.log(`[modules] ${modules.length} module(s) loaded`);
    }

    // Register public API v1 routes for enabled modules
    try {
      const { createPublicApiRouter } = await import('./routes/public-api.js');
      const enabledModules = modules.filter(
        m => enabledModuleIds.size === 0 || enabledModuleIds.has(m.config.id)
      );
      const publicApiRouter = await createPublicApiRouter(
        enabledModules,
        supabaseUrl && serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey) : null
      );
      app.use('/api/v1', publicApiRouter);
      console.log('[public-api] Mounted at /api/v1');
    } catch (err) {
      console.warn('[public-api] Failed to mount public API:', err instanceof Error ? err.message : err);
    }

    // Reconcile modules with DB (syncs admin_nav, portal_nav, features, etc.)
    if (supabaseUrl && serviceRoleKey) {
      try {
        const supabase = createClient(supabaseUrl, serviceRoleKey);
        await reconcileModules(modules, supabase as never);
      } catch (err) {
        console.warn('[modules] Reconciliation failed:', err instanceof Error ? err.message : err);
      }
    }
  } catch (err) {
    console.error('[modules] Failed to load module routes:', err);
  }
}

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Only start the server when run directly (not imported by tests)
if (process.env.NODE_ENV !== 'test') {
  registerModuleRoutes().then(() => {
    app.listen(PORT, () => {
      console.log(`Gatewaze API server running on port ${PORT}`);
    });
  });
}

export default app;
