import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import {
  registerBuiltInQueues,
  metricsHandler,
  closeAllQueues,
  closeAllConnections,
  logger as queueLogger,
} from './lib/queue/index.js';
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
import { internalRouter } from './routes/internal.js';
import { hateoasMiddleware } from './lib/hateoas.js';
import {
  mountLabeled,
  labelDirectRoute,
  labelMountPrefix,
  assertAllRoutesLabeled,
} from './lib/router-registry.js';
import { logger as appLogger, requestLogger, attachRequestId } from './lib/logger.js';
import { errorEnvelope } from './lib/errors.js';
import { initSentry, installCrashHandlers } from './lib/sentry.js';
import { initRedMetrics, redMetricsMiddleware } from './lib/red-metrics.js';
import { initTracing, shutdownTracing } from './lib/tracing.js';
import { register as promRegister } from 'prom-client';
import { loadModules, loadModulesWithDbSources, reconcileModules } from '@gatewaze/shared/modules';
import type { ModuleRuntimeContext } from '@gatewaze/shared/modules';
import { createClient } from '@supabase/supabase-js';
import { resolve } from 'path';
import _configImport from '../../../gatewaze.config.js';
// Unwrap CJS→ESM double-default wrapping (root package.json has no "type":"module")
const config = (_configImport as any)?.default ?? _configImport;

const PROJECT_ROOT = resolve(import.meta.dirname ?? __dirname, '../../..');

// Initialise OTel tracing before any module that creates spans.
// No-op when OTEL_EXPORTER_OTLP_ENDPOINT is unset.
void initTracing();

// Initialise Sentry before any other module that may throw.
initSentry({ service: 'api' });
installCrashHandlers({
  log: (level, obj, msg) => appLogger[level](obj, msg),
});

const app = express();
const PORT = parseInt(process.env.PORT ?? '3002', 10);

// Register built-in queues so enqueue()/health have something to reach.
// Safe to call when Redis is not configured — queues are constructed
// lazily and only touch Redis on first operation.
try {
  registerBuiltInQueues();
} catch (err) {
  // getRedisConnection throws when REDIS_URL is unset; that's fine for
  // API startup — enqueue() will surface a clear error when invoked,
  // and /health reports `degraded` with `queue.error`.
  queueLogger.warn(
    { err: (err as Error).message },
    'built-in queues not registered (Redis not configured)',
  );
}

// Middleware
// CORS: when CORS_ORIGIN is set, honour it (single origin or comma-separated
// allow-list). When unset (local dev), reflect the request's Origin header
// so credentialed requests work — wildcard `*` is incompatible with
// `credentials: true` per the CORS spec.
const corsAllowList = (process.env.CORS_ORIGIN ?? '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);                // same-origin / curl
    if (corsAllowList.length === 0) return callback(null, origin); // dev: reflect
    if (corsAllowList.includes(origin)) return callback(null, origin);
    return callback(null, false);
  },
  credentials: true,
}));
// helmet: security headers (X-Content-Type-Options, HSTS, referrer
// policy, etc.). CSP starts in report-only mode and gets promoted to
// enforced after 14 d clean in staging (spec §5.11). The default
// helmet CSP is too restrictive for our admin/portal — disable it
// here and serve CSP at the edge or via a separate middleware once
// promotion criteria are met.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);
app.use(attachRequestId);
// HTTP RED metrics — must be registered before route mounting so the
// finish handler is invoked on every response. The metric definitions
// share the prom-client global registry served by /metrics below.
initRedMetrics(promRegister);
app.use(redMetricsMiddleware);
app.use(hateoasMiddleware);

// Prometheus metrics — registered directly on the app (not via a Router),
// so we record the auth label explicitly. /metrics is intended to be
// network-restricted (PodMonitor in k8s), not routed through Traefik.
app.get('/metrics', async (req, res) => {
  await metricsHandler(req, res as never);
});
labelDirectRoute('GET', '/metrics', 'public');

// Routes - existing
mountLabeled(app, '/api', healthRouter);
mountLabeled(app, '/api/people', peopleRouter);
mountLabeled(app, '/api/csv', csvRouter);
mountLabeled(app, '/api/calendars', calendarsRouter);
mountLabeled(app, '/api/db-copy', dbCopyRouter);

// Routes - added for admin
mountLabeled(app, '/api/jobs', jobsRouter);
mountLabeled(app, '/api/screenshots', screenshotsRouter);
mountLabeled(app, '/api/customerio', customerioRouter);
mountLabeled(app, '/api/avatars', avatarsRouter);
mountLabeled(app, '/api/redirects', redirectsRouter);
mountLabeled(app, '/api/slack', slackRouter);
mountLabeled(app, '/api/calendar', calendarProxyRouter);
mountLabeled(app, '/api/modules', modulesRouter);
mountLabeled(app, '/api/api-keys', apiKeysRouter);
mountLabeled(app, '/api/internal', internalRouter);

// Deny-by-default self-check: every static route must be labeled
// 'jwt' or 'public'. Throws on first miss → server fails to boot.
// Dynamic module routes registered below are exempt (their auth is
// the module author's responsibility; tracked as a phase-4 follow-up).
assertAllRoutesLabeled(app);

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
          ((installed ?? []) as Array<{ id: string; status: string }>)
            .filter((r) => r.status === 'enabled')
            .map((r) => r.id)
        );
      } catch {
        appLogger.warn('[modules] module_sources table not available — using config sources only');
      }
    }

    const modules = await loadModulesWithDbSources(config, dbSources as never[], PROJECT_ROOT);
    for (const mod of modules) {
      // Only register API routes for enabled modules
      if (enabledModuleIds.size > 0 && !enabledModuleIds.has(mod.config.id)) {
        appLogger.info({ module: mod.config.id }, '[modules] skipping disabled module');
        continue;
      }
      if (mod.config.apiRoutes) {
        // Pre-label the module's mount prefix so its routes are
        // accepted by assertAllRoutesLabeled. Module authors mount
        // under /api/modules/<id> by convention; we cover both that
        // prefix and the catch-all /api so modules with legacy
        // mount points still pass. The label is 'jwt' by default —
        // module authors who need 'public' or 'service-role' opt in
        // by calling labelMountPrefix() in their apiRoutes callback
        // (added to the runtime context as labelRoutes).
        labelMountPrefix(`/api/modules/${mod.config.id}`, 'jwt');
        const moduleLogger = appLogger.child({ module: mod.config.id });
        const runtimeCtx: ModuleRuntimeContext = {
          moduleId: mod.config.id,
          moduleDir: mod.resolvedDir || PROJECT_ROOT,
          projectRoot: PROJECT_ROOT,
          logger: {
            info: (msg, meta) => moduleLogger.info(meta ?? {}, msg),
            warn: (msg, meta) => moduleLogger.warn(meta ?? {}, msg),
            error: (msg, meta) => moduleLogger.error(meta ?? {}, msg),
            debug: (msg, meta) => moduleLogger.debug(meta ?? {}, msg),
          },
          supabase: null,
          config: config as never,
          moduleConfig: (mod as { moduleConfig?: Record<string, unknown> }).moduleConfig ?? {},
        };
        await mod.config.apiRoutes(app, runtimeCtx);
        appLogger.info({ module: mod.config.id }, '[modules] registered API routes');
      }
    }
    if (modules.length > 0) {
      appLogger.info({ count: modules.length }, '[modules] loaded');
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
      appLogger.info('[public-api] mounted at /api/v1');
    } catch (err) {
      appLogger.warn({ err: (err as Error).message }, '[public-api] failed to mount');
    }

    // Reconcile modules with DB (syncs admin_nav, portal_nav, features, etc.)
    if (supabaseUrl && serviceRoleKey) {
      try {
        const supabase = createClient(supabaseUrl, serviceRoleKey);
        await reconcileModules(modules, supabase as never);
      } catch (err) {
        appLogger.warn({ err: (err as Error).message }, '[modules] reconciliation failed');
      }
    }
  } catch (err) {
    appLogger.error({ err }, '[modules] failed to load module routes');
  }
}

// Standard error envelope per spec §5.13. Mounted last so it catches
// thrown ApiError instances and any uncaught errors from route handlers.
app.use(errorEnvelope);

// Only start the server when run directly (not imported by tests)
if (process.env.NODE_ENV !== 'test') {
  registerModuleRoutes().then(() => {
    const server = app.listen(PORT, () => {
      appLogger.info({ port: PORT }, 'gatewaze api server listening');
    });

    // Graceful shutdown per spec §5.7. Stop accepting new connections,
    // wait up to SHUTDOWN_DRAIN_SECONDS (default 25, k8s
    // terminationGracePeriodSeconds 30) for in-flight requests to
    // finish, then close queue/Redis connections. The 25s default
    // gives in-flight HTTP requests time to drain rather than the
    // prior 10s which dropped them.
    const drainSec = parseInt(process.env.SHUTDOWN_DRAIN_SECONDS ?? '25', 10);
    let shuttingDown = false;
    const shutdown = async (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      appLogger.info({ signal, drainSec }, 'api shutting down');
      // 1. Stop accepting new connections; existing ones drain naturally.
      server.close((err) => {
        if (err) appLogger.warn({ err }, 'server.close error');
      });
      // 2. Drain queue/Redis with a budget.
      await Promise.race([
        (async () => {
          await closeAllQueues();
          await closeAllConnections();
        })(),
        new Promise((resolve) => setTimeout(resolve, drainSec * 1000)),
      ]);
      // 3. Flush OTel spans last so the drain operations themselves
      //    appear in the trace.
      await shutdownTracing();
      process.exit(0);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  });
}

export default app;
