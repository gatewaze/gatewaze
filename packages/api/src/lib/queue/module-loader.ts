import { resolve } from 'path';
import type { Job } from 'bullmq';
import type { ZodTypeAny } from 'zod';
import type { LoadedModule } from '@gatewaze/shared/modules';
import type { GatewazeModule, QueueDefinition } from '@gatewaze/shared/modules';
import { registerQueue, registerHandler, startWorker } from './registry.js';
import { startListener, type ListenHandle } from './listen.js';
import { logger } from './logger.js';

type ModuleWithQueues = GatewazeModule & {
  queues?: QueueDefinition[];
};

interface LoadedWorker {
  moduleId: string;
  queueName: string;
  listenHandle?: ListenHandle;
}

async function importDefault<T>(path: string): Promise<T> {
  const mod = await import(path);
  return (mod as { default?: T }).default ?? (mod as T);
}

async function loadSchema(modDir: string | undefined, schemaPath: string | undefined): Promise<ZodTypeAny | undefined> {
  if (!schemaPath || !modDir) return undefined;
  try {
    return await importDefault<ZodTypeAny>(resolve(modDir, schemaPath));
  } catch (err) {
    logger.error(
      { schemaPath, err: (err as Error).message },
      'failed to load handler schema — handler will receive unvalidated payloads',
    );
    return undefined;
  }
}

/**
 * Load module queues, handlers, and workers. Returns handles the caller
 * can close on shutdown.
 *
 * This function is intended to run at worker-process startup, BEFORE any
 * jobs are consumed. The worker process waits for this to resolve then
 * flips /ready to true.
 */
export async function loadModuleQueues(modules: LoadedModule[]): Promise<LoadedWorker[]> {
  const loaded: LoadedWorker[] = [];

  // First pass: register every module-declared Queue (just the queue
  // itself, no handlers / workers yet).
  for (const mod of modules) {
    const modCfg = mod.config as ModuleWithQueues;
    for (const qdef of modCfg.queues ?? []) {
      registerQueue({
        name: qdef.name,
        module: modCfg.id,
        defaultJobOptions: qdef.defaultJobOptions as never,
        defaultConcurrency: qdef.defaultConcurrency,
      });
    }
  }

  // Second pass: register handlers on module-declared queues + shared `jobs` queue.
  for (const mod of modules) {
    const modCfg = mod.config as ModuleWithQueues;

    // Legacy `workers[]` → shared `jobs` queue.
    for (const wdef of modCfg.workers ?? []) {
      try {
        const handlerPath = mod.resolvedDir ? resolve(mod.resolvedDir, wdef.handler) : wdef.handler;
        const handler = await importDefault<(job: Job) => Promise<unknown>>(handlerPath);
        const schema = await loadSchema(mod.resolvedDir, wdef.schemaPath);
        registerHandler('jobs', { name: wdef.name, handler, schema });
        logger.info({ module: modCfg.id, handler: wdef.name, queue: 'jobs' }, 'module handler registered');
      } catch (err) {
        logger.error(
          { module: modCfg.id, handler: wdef.name, err: (err as Error).message },
          'failed to load module worker handler',
        );
      }
    }

    // New `queues[]` → module-owned queues.
    for (const qdef of modCfg.queues ?? []) {
      for (const hdef of qdef.handlers) {
        try {
          const handlerPath = mod.resolvedDir ? resolve(mod.resolvedDir, hdef.handler) : hdef.handler;
          const handler = await importDefault<(job: Job) => Promise<unknown>>(handlerPath);
          const schema = await loadSchema(mod.resolvedDir, hdef.schemaPath);
          registerHandler(qdef.name, { name: hdef.name, handler, schema });
          logger.info({ module: modCfg.id, handler: hdef.name, queue: qdef.name }, 'module handler registered');
        } catch (err) {
          logger.error(
            { module: modCfg.id, handler: hdef.name, queue: qdef.name, err: (err as Error).message },
            'failed to load module queue handler',
          );
        }
      }
    }
  }

  // Third pass: start workers. Only now — after every handler is registered.
  const allQueueNames = new Set<string>();
  for (const mod of modules) {
    const modCfg = mod.config as ModuleWithQueues;
    for (const q of modCfg.queues ?? []) allQueueNames.add(q.name);
  }
  for (const name of allQueueNames) {
    startWorker(name);
  }

  // Fourth pass: open LISTEN/NOTIFY channels for queues that declare them.
  for (const mod of modules) {
    const modCfg = mod.config as ModuleWithQueues;
    for (const qdef of modCfg.queues ?? []) {
      if (!qdef.listen) continue;
      try {
        const handle = await startListener({
          channel: qdef.listen.channel,
          pollIntervalMs: qdef.listen.poll?.intervalMs,
          onNotify: async (payload) => {
            const { enqueue } = await import('./enqueue.js');
            await enqueue(qdef.name, qdef.listen!.onWake, { _trigger: 'listen', payload });
          },
          onPoll: async () => {
            const { enqueue } = await import('./enqueue.js');
            await enqueue(qdef.name, qdef.listen!.onWake, { _trigger: 'poll' });
          },
        });
        loaded.push({ moduleId: modCfg.id, queueName: qdef.name, listenHandle: handle });
      } catch (err) {
        logger.error(
          { module: modCfg.id, queue: qdef.name, channel: qdef.listen.channel, err: (err as Error).message },
          'failed to start LISTEN/NOTIFY',
        );
      }
    }
  }

  return loaded;
}

/**
 * Close any LISTEN handles opened by loadModuleQueues. Call on shutdown.
 */
export async function closeModuleListeners(handles: LoadedWorker[]): Promise<void> {
  await Promise.all(handles.map((h) => h.listenHandle?.close().catch(() => undefined)));
}
