import { createWorker } from '../lib/queue.js';
import { getSupabase } from '../lib/supabase.js';
import { loadModules } from '@gatewaze/shared/modules';
import { resolve } from 'path';
import config from '../../../../gatewaze.config.js';

const PROJECT_ROOT = resolve(import.meta.dirname ?? __dirname, '../../../..');

// Email worker
const emailWorker = createWorker('email', async (job) => {
  const { to, subject, html, templateId } = job.data as {
    to: string;
    subject: string;
    html?: string;
    templateId?: string;
  };

  const supabase = getSupabase();

  // Invoke send-email edge function
  const { error } = await supabase.functions.invoke('email-send', {
    body: { to, subject, html, templateId },
  });

  if (error) {
    console.error(`Email job ${job.id} failed:`, error);
    throw error;
  }

  console.log(`Email sent to ${to}: ${subject}`);
});

// Image processing worker
const imageWorker = createWorker('image-processing', async (job) => {
  const { eventId, imageUrl } = job.data as {
    eventId: string;
    imageUrl: string;
  };

  const supabase = getSupabase();
  const { error } = await supabase.functions.invoke('media-process-image', {
    body: { eventId, imageUrl },
  });

  if (error) {
    console.error(`Image processing job ${job.id} failed:`, error);
    throw error;
  }

  console.log(`Image processed for event ${eventId}`);
});

console.log('Gatewaze workers started');

// Module workers
const moduleWorkers: Awaited<ReturnType<typeof createWorker>>[] = [];

async function registerModuleWorkers() {
  try {
    const modules = await loadModules(config, PROJECT_ROOT);
    for (const mod of modules) {
      for (const workerDef of mod.config.workers ?? []) {
        const handlerModule = await import(workerDef.handler);
        const handler = handlerModule.default ?? handlerModule;
        const worker = createWorker(workerDef.name, handler, workerDef.concurrency);
        moduleWorkers.push(worker);
        console.log(`[modules] Registered worker "${workerDef.name}" from ${mod.config.name}`);
      }
    }
  } catch (err) {
    console.error('[modules] Failed to load module workers:', err);
  }
}

registerModuleWorkers();

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down workers...');
  await emailWorker.close();
  await imageWorker.close();
  await Promise.all(moduleWorkers.map(w => w.close()));
  process.exit(0);
});
