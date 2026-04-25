import { resolve } from 'path';
import { loadModules } from '@gatewaze/shared/modules';
import type { CronDefinition, GatewazeModule } from '@gatewaze/shared/modules';
import config from '../../../../gatewaze.config.js';

import {
  registerBuiltInQueues,
  upsertCrons,
  pruneCrons,
  closeAllQueues,
  closeAllConnections,
  logger,
  startMetricsServer,
  markReady,
  markNotReady,
  type LoadedCron,
} from '../lib/queue/index.js';

const PROJECT_ROOT = resolve(import.meta.dirname ?? __dirname, '../../../..');
const METRICS_PORT = parseInt(process.env.SCHEDULER_METRICS_PORT ?? '9091', 10);

async function main(): Promise<void> {
  const metricsServer = startMetricsServer(METRICS_PORT);
  logger.info({ port: METRICS_PORT }, 'scheduler metrics listening');

  registerBuiltInQueues();

  // Built-in recurring jobs — retained from the legacy scheduler.
  const builtInCrons: LoadedCron[] = [
    {
      module: 'core',
      def: {
        name: 'send-reminders',
        queue: 'email',
        schedule: { every: 3600_000 },
        data: { kind: 'send-reminder-emails', type: 'reminder' },
      },
    },
  ];

  // Module crons (and legacy `schedulers[]` kept for backward-compat).
  const modules = await loadModules(config as never, PROJECT_ROOT);
  const moduleCrons: LoadedCron[] = [];
  for (const mod of modules) {
    const cfg = mod.config as GatewazeModule & { crons?: CronDefinition[] };
    for (const def of cfg.crons ?? []) {
      moduleCrons.push({ module: cfg.id, def });
    }
  }

  const allCrons = [...builtInCrons, ...moduleCrons];
  const installed = await upsertCrons(allCrons);
  const pruned = await pruneCrons(installed);
  logger.info(
    { total: allCrons.length, pruned, modules: moduleCrons.length },
    'scheduler crons reconciled',
  );

  markReady();

  const shutdown = async (signal: string) => {
    markNotReady(`shutting down (${signal})`);
    logger.info({ signal }, 'scheduler shutting down');
    await closeAllQueues();
    await closeAllConnections();
    await metricsServer.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : String(err) }, 'scheduler bootstrap failed');
  process.exit(1);
});
