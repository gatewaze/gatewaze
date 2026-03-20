import express from 'express';
import cors from 'cors';
import { healthRouter } from './routes/health.js';
import { eventsRouter } from './routes/events.js';
import { peopleRouter } from './routes/people.js';
import { registrationsRouter } from './routes/registrations.js';
import { csvRouter } from './routes/csv.js';
import { calendarsRouter } from './routes/calendars.js';
import { dbCopyRouter } from './routes/db-copy.js';
import { jobsRouter } from './routes/jobs.js';
import { scrapersRouter } from './routes/scrapers.js';
import { screenshotsRouter } from './routes/screenshots.js';
import { customerioRouter } from './routes/customerio.js';
import { avatarsRouter } from './routes/avatars.js';
import { redirectsRouter } from './routes/redirects.js';
import { slackRouter } from './routes/slack.js';
import { attendanceRouter } from './routes/attendance.js';
import { calendarProxyRouter } from './routes/calendar-proxy.js';
import { modulesRouter } from './routes/modules.js';
import { loadModules, loadModulesWithDbSources } from '@gatewaze/shared/modules';
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

// Routes - existing
app.use('/api', healthRouter);
app.use('/api/events', eventsRouter);
app.use('/api/people', peopleRouter);
app.use('/api/registrations', registrationsRouter);
app.use('/api/csv', csvRouter);
app.use('/api/calendars', calendarsRouter);
app.use('/api/db-copy', dbCopyRouter);

// Routes - added for admin
app.use('/api/jobs', jobsRouter);
app.use('/api/scrapers', scrapersRouter);
app.use('/api/screenshots', screenshotsRouter);
app.use('/api/customerio', customerioRouter);
app.use('/api/avatars', avatarsRouter);
app.use('/api/redirects', redirectsRouter);
app.use('/api/slack', slackRouter);
app.use('/api/attendance', attendanceRouter);
app.use('/api/calendar', calendarProxyRouter);
app.use('/api/modules', modulesRouter);

// Module routes — loaded async before server starts
async function registerModuleRoutes() {
  try {
    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    let dbSources: Record<string, unknown>[] = [];
    if (supabaseUrl && serviceRoleKey) {
      try {
        const supabase = createClient(supabaseUrl, serviceRoleKey);
        const { data } = await supabase.from('module_sources').select('*');
        dbSources = data ?? [];
      } catch {
        console.warn('[modules] module_sources table not available — using config sources only');
      }
    }

    const modules = await loadModulesWithDbSources(config, dbSources as never[], PROJECT_ROOT);
    for (const mod of modules) {
      if (mod.config.apiRoutes) {
        await mod.config.apiRoutes(app, {
          projectRoot: PROJECT_ROOT,
          moduleDir: mod.resolvedDir || PROJECT_ROOT,
        });
        console.log(`[modules] Registered API routes for: ${mod.config.name}`);
      }
    }
    if (modules.length > 0) {
      console.log(`[modules] ${modules.length} module(s) loaded`);
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
