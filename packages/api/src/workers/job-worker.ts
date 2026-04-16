import { createWorker, createRedisConnection } from '../lib/queue.js';
import { Worker, type Job } from 'bullmq';
import { getSupabase } from '../lib/supabase.js';
import { loadModules } from '@gatewaze/shared/modules';
import { resolve } from 'path';
import config from '../../../../gatewaze.config.js';

const PROJECT_ROOT = resolve(import.meta.dirname ?? __dirname, '../../../..');

// ---------------------------------------------------------------------------
// Screenshot job worker — listens on the jobs-${BRAND} queue used by job-queue.ts
// ---------------------------------------------------------------------------
const BRAND = process.env.BRAND || 'default';
const jobsQueueName = `jobs-${BRAND}`;

// Module job handlers registered at startup — keyed by job type name
const moduleJobHandlers = new Map<string, (job: Job) => Promise<void>>();

const jobsWorker = new Worker(
  jobsQueueName,
  async (job: Job) => {
    if (job.name === 'screenshot:generate') {
      await handleScreenshotJob(job);
    } else if (moduleJobHandlers.has(job.name)) {
      await moduleJobHandlers.get(job.name)!(job);
    } else {
      throw new Error(`Unknown job type: ${job.name}`);
    }
  },
  { connection: createRedisConnection() as never, concurrency: 2 },
);

async function handleScreenshotJob(job: Job) {
  const { eventIds, forceRegenerate, screenshotJobId } = job.data as {
    eventIds: string[] | null;
    forceRegenerate: boolean;
    screenshotJobId?: string;
  };

  const redis = createRedisConnection();
  const channel = screenshotJobId ? `scraper:${screenshotJobId}:logs` : null;

  const publishLog = (data: Record<string, unknown>) => {
    if (channel) {
      redis.publish(channel, JSON.stringify(data));
    }
  };

  const log = (message: string) => {
    console.log(`[screenshot] ${message}`);
    publishLog({ type: 'log', message, timestamp: new Date().toISOString() });
  };

  log('Starting screenshot generation...');

  try {
    const supabase = getSupabase();

    // Fetch events
    let query = supabase
      .from('events')
      .select('event_id, event_title, event_link, event_logo')
      .eq('is_live_in_production', true);

    if (eventIds && eventIds.length > 0) {
      query = query.in('event_id', eventIds);
    }

    const { data: events, error } = await query;
    if (error) throw new Error(`Failed to fetch events: ${error.message}`);
    if (!events || events.length === 0) {
      log('No events found to process');
      publishLog({ type: 'complete', success: true, timestamp: new Date().toISOString() });
      await redis.quit();
      return;
    }

    log(`Processing ${events.length} event(s)...`);
    let completed = 0;

    for (const event of events) {
      try {
        log(`Processing: ${event.event_title}...`);

        // Try to fetch the event page and grab the OG image
        let imageBuffer: Buffer | null = null;

        if (event.event_link) {
          try {
            const pageRes = await fetch(event.event_link, {
              headers: { 'User-Agent': 'Gatewaze-Screenshot/1.0' },
              signal: AbortSignal.timeout(15000),
            });
            const html = await pageRes.text();

            // Extract og:image URL
            const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
              || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);

            if (ogMatch?.[1]) {
              // Decode HTML entities (e.g. &amp; → &)
              const ogUrl = ogMatch[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
              log(`Found OG image: ${ogUrl.substring(0, 100)}...`);
              const imgRes = await fetch(ogUrl, { signal: AbortSignal.timeout(10000) });
              if (imgRes.ok) {
                imageBuffer = Buffer.from(await imgRes.arrayBuffer());
              }
            }
          } catch {
            // Fall through to logo fallback
          }
        }

        // Fallback: use event logo if available
        if (!imageBuffer && event.event_logo) {
          try {
            const logoRes = await fetch(event.event_logo, { signal: AbortSignal.timeout(10000) });
            if (logoRes.ok) {
              imageBuffer = Buffer.from(await logoRes.arrayBuffer());
            }
          } catch {
            // No image available
          }
        }

        if (imageBuffer) {
          // Upload to Supabase Storage
          const filePath = `event-previews/${event.event_id}.jpg`;
          const { error: uploadErr } = await supabase.storage
            .from('media')
            .upload(filePath, imageBuffer, {
              upsert: true,
              contentType: 'image/jpeg',
              cacheControl: '3600',
            });

          if (uploadErr) {
            log(`Failed to upload for ${event.event_title}: ${uploadErr.message}`);
          } else {
            // Store the relative storage path, not the full public URL.
            // See spec-relative-storage-paths.md — readers resolve via toPublicUrl().
            await supabase
              .from('events')
              .update({
                screenshot_generated: true,
                screenshot_url: filePath,
                screenshot_generated_at: new Date().toISOString(),
              })
              .eq('event_id', event.event_id);

            log(`Completed: ${event.event_title}`);
          }
        } else {
          log(`No image source available for: ${event.event_title}`);
        }

        completed++;
        publishLog({
          type: 'progress',
          stats: { percent: Math.round((completed / events.length) * 100) },
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        log(`Failed: ${event.event_title} - ${err.message}`);
        completed++;
      }
    }

    log(`Screenshot generation completed. Processed ${events.length} event(s).`);
    publishLog({ type: 'complete', success: true, timestamp: new Date().toISOString() });
  } catch (err: any) {
    console.error('[screenshot] Error:', err);
    publishLog({ type: 'error', error: err.message, timestamp: new Date().toISOString() });
    throw err;
  } finally {
    await redis.quit();
  }
}

console.log(`[jobs] Listening on queue: ${jobsQueueName}`);

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
async function registerModuleWorkers() {
  try {
    const modules = await loadModules(config, PROJECT_ROOT);
    for (const mod of modules) {
      for (const workerDef of mod.config.workers ?? []) {
        try {
          // Resolve handler path relative to the module's directory
          const handlerPath = mod.resolvedDir
            ? resolve(mod.resolvedDir, workerDef.handler)
            : workerDef.handler;
          const handlerModule = await import(handlerPath);
          const handler = handlerModule.default ?? handlerModule;
          moduleJobHandlers.set(workerDef.name, handler);
          console.log(`[modules] Registered job handler "${workerDef.name}" from ${mod.config.name}`);
        } catch (err) {
          console.error(`[modules] Failed to load worker "${workerDef.name}" from ${mod.config.name}:`, err);
        }
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
  await jobsWorker.close();
  await emailWorker.close();
  await imageWorker.close();
  process.exit(0);
});
