#!/usr/bin/env node

/**
 * Job Worker
 *
 * Processes background jobs from the BullMQ queue.
 * Each worker runs in its own container and can be scaled independently.
 */

import '../load-env.js';
import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { JobTypes, getQueue } from '../lib/job-queue.js';
import { supabase } from '../supabase-client.js';

// Import scraper worker logic from premium-gatewaze-modules
// The scraper code lives in the modules repo; we dynamically resolve the path
import path from 'path';
import fsSync from 'fs';
import { fileURLToPath } from 'url';
const __workerFilename = fileURLToPath(import.meta.url);
const __workerDirname = path.dirname(__workerFilename);

// Resolve premium-gatewaze-modules path (sibling repo in the workspace)
const premiumModulesPath = process.env.SCRAPER_MODULE_PATH ||
  path.resolve(__workerDirname, '..', '..', '..', 'premium-gatewaze-modules', 'modules', 'scrapers', 'scripts');

const { runScraperJob, initScraperHandler } = await import(
  path.join(premiumModulesPath, 'scraper-job-handler.js')
);
const { sendScraperAlert } = await import(
  path.join(premiumModulesPath, 'lib', 'scraper-alerts.js')
);

// Initialize the scraper handler with dependencies from this repo
initScraperHandler({
  supabase,
  addJob: (type, data) => getQueue(brand).add(type, { ...data, brand }),
  JobTypes,
});

// Import Slack invitation queue processor from premium-modules.
// Tolerate the legacy `slack-integration` directory name (renamed to
// `slack` in 7b19bfc) so a half-rebuilt environment doesn't crash the
// worker on startup.
function resolveSlackModulePath() {
  const newPath = path.resolve(__workerDirname, '..', '..', '..', 'premium-gatewaze-modules', 'modules', 'slack', 'scripts');
  const legacyPath = path.resolve(__workerDirname, '..', '..', '..', 'premium-gatewaze-modules', 'modules', 'slack-integration', 'scripts');
  return [newPath, legacyPath];
}
let slackModulePath = null;
for (const candidate of resolveSlackModulePath()) {
  try {
    if (fsSync.existsSync(candidate)) { slackModulePath = candidate; break; }
  } catch {}
}
if (!slackModulePath) slackModulePath = resolveSlackModulePath()[0];
const { processQueue: processSlackQueue, initSlackWorker } = await import(
  path.join(slackModulePath, 'slack-invitation-worker.js')
);

// Initialize the slack worker with dependencies
initSlackWorker({ supabase });

// Import the analytics provisioning handler from gatewaze-modules.
// The TS handler at modules/analytics/src/workers/provisioning.ts is the
// canonical implementation; this JS shim mirrors its logic so the dev
// worker (which can't run TS) can drain the analytics_provisioning_jobs
// queue. The cron scheduler enqueues `analytics:provision-property` jobs
// every 60s and the dispatch loop below routes them here.
const analyticsHandlerPath = '/var/lib/gatewaze/modules/analytics/scripts/provision-handler.js';
let analyticsProvisionHandler = null;
try {
  const mod = await import(analyticsHandlerPath);
  mod.init({ supabase });
  analyticsProvisionHandler = mod.default;
  console.log(`✅ Analytics provisioning handler loaded`);
} catch (err) {
  console.warn(`⚠️  Analytics provisioning handler not loadable (${err.message}) — analytics_provisioning_jobs queue will not drain`);
}

const brand = process.env.BRAND || 'default';
const queueName = `jobs-${brand}`;

console.log(`🔧 Starting worker for ${brand}`);
console.log(`📋 Queue: ${queueName}`);

/**
 * Clean up stale scraper jobs from Redis queue
 * Removes jobs that reference scraper_jobs that no longer exist in the database
 */
async function cleanupStaleScraperJobs() {
  console.log(`🧹 Checking for stale scraper jobs in queue...`);

  try {
    const queue = getQueue(brand);

    // Get all waiting and failed jobs
    const waitingJobs = await queue.getJobs(['waiting', 'failed', 'delayed']);

    if (waitingJobs.length === 0) {
      console.log(`✅ No jobs in queue to check`);
      return;
    }

    console.log(`📋 Found ${waitingJobs.length} jobs to validate`);

    // Collect all scraper job IDs from the queue
    const scraperJobIds = waitingJobs
      .filter(job => job.name === JobTypes.SCRAPER_RUN && job.data?.scraperJobId)
      .map(job => ({ redisJob: job, scraperJobId: job.data.scraperJobId }));

    if (scraperJobIds.length === 0) {
      console.log(`✅ No scraper jobs to validate`);
      return;
    }

    // Query database to find which scraper_jobs exist
    const dbJobIds = scraperJobIds.map(j => j.scraperJobId);
    const { data: existingJobs, error } = await supabase
      .from('scrapers_jobs')
      .select('id')
      .in('id', dbJobIds);

    if (error) {
      console.error(`❌ Error querying scraper_jobs:`, error);
      return;
    }

    const existingJobIds = new Set(existingJobs?.map(j => j.id) || []);

    // Remove jobs that don't exist in the database
    let removedCount = 0;
    for (const { redisJob, scraperJobId } of scraperJobIds) {
      if (!existingJobIds.has(scraperJobId)) {
        try {
          await redisJob.remove();
          removedCount++;
          console.log(`🗑️ Removed stale job: scraper job ${scraperJobId} (Redis job ${redisJob.id})`);
        } catch (removeError) {
          console.error(`❌ Failed to remove job ${redisJob.id}:`, removeError.message);
        }
      }
    }

    if (removedCount > 0) {
      console.log(`✅ Cleaned up ${removedCount} stale scraper jobs`);
    } else {
      console.log(`✅ All queued scraper jobs are valid`);
    }
  } catch (error) {
    console.error(`❌ Error during stale job cleanup:`, error);
  }
}

// Redis connection
const getConnection = () => {
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    try {
      const url = new URL(redisUrl);
      return {
        host: url.hostname,
        port: parseInt(url.port || '6379', 10),
        password: url.password || undefined,
        maxRetriesPerRequest: null,
      };
    } catch {
      // Fall through to default
    }
  }

  return {
    host: process.env.REDIS_HOST || 'redis',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    maxRetriesPerRequest: null,
  };
};

// Redis client for pub/sub (log streaming)
let redisPublisher = null;

function getRedisPublisher() {
  if (!redisPublisher) {
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      redisPublisher = new Redis(redisUrl);
    } else {
      redisPublisher = new Redis({
        host: process.env.REDIS_HOST || 'redis',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      });
    }
    redisPublisher.on('error', (err) => console.error('Redis publisher error:', err));
  }
  return redisPublisher;
}

// Publish log to Redis channel for SSE streaming
async function publishLog(scraperJobId, logData) {
  try {
    const publisher = getRedisPublisher();
    await publisher.publish(`scraper:${scraperJobId}:logs`, JSON.stringify(logData));
  } catch (error) {
    console.error('Error publishing log:', error);
  }
}

// Persist log to database for historical viewing
async function persistLog(scraperJobId, message, logType = 'log', logLevel = 'info', metadata = null) {
  if (!scraperJobId) return;

  try {
    await supabase.rpc('scrapers_insert_job_log', {
      p_job_id: scraperJobId,
      p_log_type: logType,
      p_log_level: logLevel,
      p_message: message,
      p_metadata: metadata
    });
  } catch (error) {
    // Silently fail - table may not exist
  }
}

// Job handlers
const handlers = {
  [JobTypes.SCRAPER_RUN]: async (job) => {
    const { scraperJobId, scraperId, scraperName, scraperType, eventType } = job.data;
    console.log(`🤖 Running scraper job ${scraperJobId}: ${scraperName}`);

    // Create logging functions that publish to Redis AND persist to database
    const logger = {
      log: (message, level = 'info', metadata = null) => {
        const logData = {
          type: 'log',
          level,
          message: `[${new Date().toLocaleTimeString()}] ${message}`,
          timestamp: new Date().toISOString(),
          metadata
        };
        console.log(`[Scraper ${scraperJobId}] ${message}`);
        publishLog(scraperJobId, logData);
        persistLog(scraperJobId, logData.message, 'log', level, metadata);
      },
      progress: (stats) => {
        const progressData = {
          type: 'progress',
          stats,
          timestamp: new Date().toISOString()
        };
        job.updateProgress(stats.percent || 0);
        publishLog(scraperJobId, progressData);
        persistLog(scraperJobId, 'Progress update', 'progress', 'info', stats);
      },
      complete: (success, stats = {}) => {
        const completeData = {
          type: 'complete',
          success,
          stats,
          timestamp: new Date().toISOString()
        };
        publishLog(scraperJobId, completeData);
        persistLog(scraperJobId, success ? 'Job completed successfully' : 'Job failed', 'complete', success ? 'info' : 'error', stats);
      },
      error: (error) => {
        const errorData = {
          type: 'error',
          error: error.message || String(error),
          stack: error.stack,
          timestamp: new Date().toISOString()
        };
        console.error(`[Scraper ${scraperJobId}] Error: ${error.message}`);
        publishLog(scraperJobId, errorData);
        persistLog(scraperJobId, error.message || String(error), 'error', 'error', { stack: error.stack });
      }
    };

    // Run the scraper job (pass BullMQ job for heartbeat support)
    const result = await runScraperJob(scraperJobId, logger, job);
    return result;
  },

  [JobTypes.SCRAPER_RUN_ALL]: async (job) => {
    console.log(`🤖 Running all scrapers - not yet implemented via BullMQ`);
    throw new Error('SCRAPER_RUN_ALL not yet implemented');
  },

  [JobTypes.CUSTOMERIO_SYNC_INCREMENTAL]: async (job) => {
    console.log(`📊 Running Customer.io incremental sync`);
    // Dynamic import to avoid loading everything at startup
    const { runIncrementalSync } = await import('../sync-customerio-incremental.js');
    return await runIncrementalSync(job.data);
  },

  [JobTypes.CUSTOMERIO_SYNC_FULL]: async (job) => {
    console.log(`📊 Running Customer.io full sync`);
    const { runFullSync } = await import('../sync-customerio-full.js');
    return await runFullSync(job.data);
  },

  [JobTypes.CUSTOMERIO_SYNC_ACTIVITIES]: async (job) => {
    console.log(`📊 Running Customer.io activities sync`);
    const { runActivitiesSync } = await import('../sync-customerio-activities.js');
    return await runActivitiesSync(job.data);
  },

  [JobTypes.CUSTOMERIO_SYNC_SEGMENTS]: async (job) => {
    console.log(`📊 Running Customer.io segments sync`);
    const { runSegmentsSync } = await import('../sync-customerio-segments.js');
    return await runSegmentsSync(job.data);
  },

  [JobTypes.EMBEDDING_GENERATE]: async (job) => {
    console.log(`🧠 Generating embeddings`);
    const { generateEmbeddings } = await import('../generate-customer-embeddings.js');
    return await generateEmbeddings(job.data);
  },

  [JobTypes.AVATAR_SYNC]: async (job) => {
    console.log(`🖼️ Syncing avatars`);
    const { syncAvatars } = await import('../lib/avatar-sync.js');
    return await syncAvatars(job.data);
  },

  [JobTypes.GRAVATAR_SYNC]: async (job) => {
    console.log(`🖼️ Syncing gravatars`);
    const { syncGravatars } = await import('../sync-gravatar-avatars.ts');
    return await syncGravatars(job.data);
  },

  [JobTypes.SCREENSHOT_GENERATE]: async (job) => {
    const { eventIds, forceRegenerate, forceBrowserless, onlyMissing, screenshotJobId } = job.data;
    console.log(`📸 Generating screenshots${eventIds ? ` for events: ${eventIds.join(', ')}` : ''}${forceBrowserless ? ' (forced BrowserLess.io)' : ''}`);

    // Create logging functions that publish to Redis for SSE streaming
    const logger = {
      log: (message, level = 'info', metadata = null) => {
        const logData = {
          type: 'log',
          level,
          message: `[${new Date().toLocaleTimeString()}] ${message}`,
          timestamp: new Date().toISOString(),
          metadata
        };
        console.log(`[Screenshot ${screenshotJobId || job.id}] ${message}`);
        if (screenshotJobId) {
          publishLog(screenshotJobId, logData);
        }
      },
      progress: (stats) => {
        const progressData = {
          type: 'progress',
          stats,
          timestamp: new Date().toISOString()
        };
        job.updateProgress(stats.percent || 0);
        if (screenshotJobId) {
          publishLog(screenshotJobId, progressData);
        }
      },
      complete: (success, stats = {}) => {
        const completeData = {
          type: 'complete',
          success,
          stats,
          timestamp: new Date().toISOString()
        };
        if (screenshotJobId) {
          publishLog(screenshotJobId, completeData);
        }
      },
      error: (error) => {
        const errorData = {
          type: 'error',
          error: error.message || String(error),
          stack: error.stack,
          timestamp: new Date().toISOString()
        };
        console.error(`[Screenshot ${screenshotJobId || job.id}] Error: ${error.message}`);
        if (screenshotJobId) {
          publishLog(screenshotJobId, errorData);
        }
      }
    };

    logger.log('Starting screenshot generation via worker...');

    try {
      // Dynamic import to avoid loading Puppeteer at startup
      const { generateScreenshots } = await import('../generate-screenshots.js');

      const result = await generateScreenshots({
        eventIds: eventIds || null,
        forceRegenerate: forceRegenerate || false,
        forceBrowserless: forceBrowserless || false,
        onlyMissing: onlyMissing || false,
      });

      logger.complete(true, { message: 'Screenshot generation completed' });
      return result;
    } catch (error) {
      logger.error(error);
      throw error;
    }
  },

  [JobTypes.LUMA_CONTENT_PROCESS]: async (job) => {
    const { eventId, eventTitle, isRetry, isReprocess, manual } = job.data;
    console.log(`📝 Processing Luma content for: ${eventTitle || eventId}`);

    // Create logging function
    const logger = (message) => {
      console.log(`[Luma Content ${eventId}] ${message}`);
    };

    try {
      // Dynamic import to avoid loading at startup
      const { processLumaContent } = await import('./luma-content-handler.js');

      const result = await processLumaContent(eventId, {
        extractSpeakers: true,
        processImages: true,
        forceReprocess: isReprocess || manual || false,
      }, logger);

      if (!result.success) {
        throw new Error(result.error || 'Unknown error');
      }

      return result;
    } catch (error) {
      console.error(`[Luma Content ${eventId}] Error: ${error.message}`);
      throw error;
    }
  },

  [JobTypes.MEETUP_CONTENT_PROCESS]: async (job) => {
    const { eventId, eventTitle, isRetry, isReprocess, manual } = job.data;
    console.log(`📝 Processing Meetup content for: ${eventTitle || eventId}`);

    // Create logging function
    const logger = (message) => {
      console.log(`[Meetup Content ${eventId}] ${message}`);
    };

    try {
      // Dynamic import to avoid loading at startup
      const { processMeetupContent } = await import('./meetup-content-handler.js');

      const result = await processMeetupContent(eventId, {
        extractSpeakers: true,
        processImages: true,
        forceReprocess: isReprocess || manual || false,
      }, logger);

      if (!result.success) {
        throw new Error(result.error || 'Unknown error');
      }

      return result;
    } catch (error) {
      console.error(`[Meetup Content ${eventId}] Error: ${error.message}`);
      throw error;
    }
  },
  // Media zip processing — extracts photos from uploaded ZIP files
  [JobTypes.MEDIA_PROCESS_ZIP]: async (job) => {
    const { zipUploadId } = job.data;
    console.log(`📦 Processing zip upload: ${zipUploadId}`);

    // Update status to processing
    await supabase
      .from('events_media_zip_uploads')
      .update({ status: 'processing', processing_started_at: new Date().toISOString() })
      .eq('id', zipUploadId);

    const { data: zipUpload, error: fetchError } = await supabase
      .from('events_media_zip_uploads')
      .select('*')
      .eq('id', zipUploadId)
      .single();

    if (fetchError || !zipUpload) {
      throw new Error(`Failed to fetch zip upload: ${fetchError?.message}`);
    }

    // Download zip to temp file via streaming (avoids holding entire file in memory)
    const { createWriteStream, readFileSync, unlinkSync } = await import('fs');
    const { Readable } = await import('stream');
    const { pipeline } = await import('stream/promises');
    const { tmpdir } = await import('os');
    const { join } = await import('path');

    const { data: signedUrlData, error: signError } = await supabase.storage
      .from('media')
      .createSignedUrl(zipUpload.storage_path, 3600); // 1 hour

    if (signError || !signedUrlData?.signedUrl) {
      throw new Error(`Failed to get signed URL: ${signError?.message}`);
    }

    const tempPath = join(tmpdir(), `zip-${zipUploadId}-${Date.now()}.zip`);
    console.log(`📦 Downloading to temp file: ${tempPath}`);

    const response = await fetch(signedUrlData.signedUrl);
    if (!response.ok) throw new Error(`Download failed: ${response.status}`);

    const nodeStream = Readable.fromWeb(response.body);
    await pipeline(nodeStream, createWriteStream(tempPath));

    const zipBuffer = readFileSync(tempPath);
    console.log(`📦 Downloaded: ${(zipBuffer.length / 1024 / 1024).toFixed(1)}MB`);

    // Use JSZip (available in Node.js worker container)
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(zipBuffer);

    // Delete temp file now that zip is loaded
    try { unlinkSync(tempPath); } catch {}

    const files = Object.values(zip.files).filter(f =>
      !f.dir && !f.name.startsWith('__MACOSX/') && !f.name.includes('/.') && !f.name.startsWith('.')
    );

    const totalCount = files.length;
    await supabase.from('events_media_zip_uploads').update({ total_count: totalCount }).eq('id', zipUploadId);

    const MIME_TYPES = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
      webp: 'image/webp', bmp: 'image/bmp', mp4: 'video/mp4', mov: 'video/quicktime',
    };
    const getMime = (name) => MIME_TYPES[name.split('.').pop()?.toLowerCase()] || null;

    let processedCount = 0;
    const albumMap = new Map();
    const errors = [];

    for (const file of files) {
      try {
        const fileName = file.name.split('/').pop();
        const mimeType = getMime(fileName);
        if (!mimeType) continue;

        const fileType = mimeType.startsWith('image/') ? 'photo' : 'video';

        // Album from folder
        const parts = file.name.split('/').filter(p => p && p !== '__MACOSX');
        const folderName = parts.length > 1 ? parts.slice(0, -1).join(' - ') : null;

        let albumId = null;
        if (folderName) {
          albumId = albumMap.get(folderName) || null;
          if (!albumId) {
            const { data: existing } = await supabase
              .from('events_media_albums').select('id')
              .eq('event_id', zipUpload.event_id).eq('name', folderName).maybeSingle();
            if (existing) {
              albumId = existing.id;
            } else {
              const { data: newAlbum } = await supabase
                .from('events_media_albums')
                .insert({ event_id: zipUpload.event_id, name: folderName, description: 'Auto-created from zip upload' })
                .select().single();
              albumId = newAlbum?.id || null;
            }
            if (albumId) albumMap.set(folderName, albumId);
          }
        }

        const content = await file.async('uint8array');
        const timestamp = Date.now();
        const sanitized = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
        const storagePath = `events/${zipUpload.event_id}/${fileType}s/original/${timestamp}-${sanitized}`;

        const { error: upErr } = await supabase.storage
          .from('media').upload(storagePath, content, { contentType: mimeType, cacheControl: '3600' });
        if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

        const { data: urlData } = supabase.storage.from('media').getPublicUrl(storagePath);

        const { data: media, error: dbErr } = await supabase
          .from('events_media')
          .insert({
            event_id: zipUpload.event_id, file_name: fileName, storage_path: storagePath,
            url: urlData.publicUrl, file_type: fileType, mime_type: mimeType, file_size: content.length,
          })
          .select().single();

        if (dbErr) throw new Error(`DB insert failed: ${dbErr.message}`);

        if (albumId && media) {
          await supabase.from('event_media_album_items')
            .insert({ media_id: media.id, album_id: albumId, sort_order: processedCount });
        }

        processedCount++;
        if (processedCount % 5 === 0) {
          await supabase.from('events_media_zip_uploads').update({ processed_count: processedCount }).eq('id', zipUploadId);
          await job.updateProgress(Math.round((processedCount / totalCount) * 100));
        }
      } catch (err) {
        errors.push(`${file.name}: ${err.message}`);
        console.error(`❌ ${file.name}: ${err.message}`);
      }
    }

    await supabase.from('events_media_zip_uploads').update({ processed_count: processedCount }).eq('id', zipUploadId);
    await supabase.from('events_media_zip_uploads').update({
      status: 'completed', processing_completed_at: new Date().toISOString(),
      error_message: errors.length > 0 ? errors.join('; ') : null,
    }).eq('id', zipUploadId);

    // Clean up zip
    try { await supabase.storage.from('media').remove([zipUpload.storage_path]); } catch {}

    console.log(`✅ Zip processed: ${processedCount}/${totalCount} files`);
    return { processed: processedCount, total: totalCount, errors: errors.length };
  },

  // Bulk speaker extraction enqueued at the end of every scrape run.
  // Delegates to the premium-gatewaze-modules handler, which carries the
  // Anthropic call + per-brand-budget enforcement via callAnthropic.
  // See spec-scrapling-fetcher-service.md §15.6.
  [JobTypes.SCRAPER_SPEAKER_EXTRACT]: async (job) => {
    const { default: speakerExtractHandler } = await import(
      path.join(premiumModulesPath, 'workers', 'speaker-extract-handler.js')
    );
    return speakerExtractHandler(job);
  },

  // Analytics module's provisioning queue drainer. Cron
  // `analytics-provision-property` (queue: jobs, every 60s) enqueues a
  // job with kind='analytics:provision-property'; we look it up by name
  // and delegate to the handler loaded at startup. The handler walks
  // analytics_provisioning_jobs WHERE status='queued' and creates the
  // matching Umami `website` entries, persisting website_uuid back to
  // analytics_properties.
  'analytics:provision-property': async (job) => {
    if (!analyticsProvisionHandler) {
      throw new Error('analytics provisioning handler not loaded — see startup warning');
    }
    return analyticsProvisionHandler(job);
  },
};

// Create worker
const worker = new Worker(
  queueName,
  async (job) => {
    console.log(`\n📥 Processing job: ${job.name} (${job.id})`);
    console.log(`   Data: ${JSON.stringify(job.data).slice(0, 200)}...`);

    const handler = handlers[job.name];
    if (!handler) {
      throw new Error(`Unknown job type: ${job.name}`);
    }

    const startTime = Date.now();
    try {
      const result = await handler(job);
      const duration = Date.now() - startTime;
      console.log(`✅ Job completed: ${job.name} (${job.id}) in ${duration}ms`);
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ Job failed: ${job.name} (${job.id}) after ${duration}ms`);
      console.error(`   Error: ${error.message}`);

      // If the error has skipRetry flag, remove the job from the queue to prevent retries
      if (error.skipRetry) {
        console.log(`🗑️ Job ${job.id} marked as skipRetry - removing from queue`);
        try {
          await job.remove();
        } catch (removeErr) {
          console.error(`   Failed to remove job: ${removeErr.message}`);
        }
        // Return instead of throwing to prevent retry
        return { skipped: true, reason: error.message };
      }

      throw error;
    }
  },
  {
    connection: getConnection(),
    concurrency: parseInt(process.env.WORKER_CONCURRENCY || '1', 10),
    lockDuration: 300000,      // 5 minutes — worker must renew lock within this window
    stalledInterval: 30000,    // 30 seconds — check for stalled jobs frequently
    maxStalledCount: 2,        // Mark as failed after 2 consecutive stalled checks
    limiter: {
      max: 10,
      duration: 1000,
    },
  }
);

// Event handlers
worker.on('completed', (job, result) => {
  console.log(`✅ Job ${job.id} completed`);
});

worker.on('failed', async (job, error) => {
  console.error(`❌ Job ${job?.id} failed: ${error.message}`);
  if (job) {
    console.error(`   Attempts: ${job.attemptsMade}/${job.opts?.attempts || 3}`);
  }
  // Send alert for scraper failures
  if (job?.name === JobTypes.SCRAPER_RUN) {
    try {
      await sendScraperAlert({
        severity: 'error',
        title: `Job Failed: ${job.data?.scraperName || 'unknown'}`,
        message: `${error.message}\nAttempts: ${job.attemptsMade}/${job.opts?.attempts || 3}`,
        scraperName: job.data?.scraperName,
        jobId: job.data?.scraperJobId,
      });
    } catch (alertErr) {
      console.error(`Failed to send alert: ${alertErr.message}`);
    }
  }
});

worker.on('error', (error) => {
  console.error('Worker error:', error);
});

worker.on('stalled', async (jobId) => {
  console.warn(`⚠️ Job ${jobId} stalled`);
  try {
    const stalledJob = await getQueue(brand).getJob(jobId);
    if (stalledJob?.name === JobTypes.SCRAPER_RUN) {
      await sendScraperAlert({
        severity: 'error',
        title: `Job Stalled: ${stalledJob.data?.scraperName || 'unknown'}`,
        message: `Worker may have crashed. Job will be retried if attempts remain.`,
        scraperName: stalledJob.data?.scraperName,
        jobId: stalledJob.data?.scraperJobId,
      });
    }
  } catch (alertErr) {
    console.error(`Failed to send stalled alert: ${alertErr.message}`);
  }
});

// Graceful shutdown
const shutdown = async (signal) => {
  console.log(`\n📴 Received ${signal}, shutting down worker...`);
  // Cooperative shutdown signal for long-running scrape loops — they check
  // this flag between events so they can stop cleanly instead of thrashing
  // against a soon-to-be-killed Chromium child process.
  globalThis.__scraperShutdown = true;
  await worker.close();
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

console.log(`✅ Worker started for ${brand}`);
console.log(`   Concurrency: ${process.env.WORKER_CONCURRENCY || 1}`);
console.log(`   Redis: ${process.env.REDIS_URL || 'redis://redis:6379'}`);

// Recover stuck scraper jobs (no heartbeat for 10+ minutes)
async function recoverStuckScraperJobs() {
  try {
    const { data: stuckJobs, error } = await supabase.rpc('scrapers_get_stuck_jobs', {
      stale_minutes: 10,
    });
    if (error || !stuckJobs || stuckJobs.length === 0) return;

    console.log(`🔍 Found ${stuckJobs.length} stuck scraper job(s)`);
    for (const stuckJob of stuckJobs) {
      console.log(`⚠️ Recovering stuck job ${stuckJob.id} (${stuckJob.scraper_name || 'unknown'})`);
      await supabase.rpc('scrapers_update_job', {
        job_id: stuckJob.id,
        new_status: 'failed',
        error_msg: 'Job timed out (heartbeat) — no heartbeat for 10+ minutes',
      });
      await sendScraperAlert({
        severity: 'error',
        title: `Stuck Job Recovered`,
        message: `Job had no heartbeat for 10+ minutes and was marked as failed.`,
        scraperName: stuckJob.scraper_name || 'unknown',
        jobId: stuckJob.id,
      });
    }
  } catch (err) {
    // scrapers_get_stuck_jobs RPC may not exist yet during migration rollout
    if (!err.message?.includes('function') && !err.message?.includes('does not exist')) {
      console.error('Stuck job recovery failed:', err.message);
    }
  }
}

// Check scheduler health
async function checkSchedulerHealth() {
  try {
    const redis = getRedisPublisher();
    const lastRun = await redis.get('scheduler:last_run');
    if (lastRun) {
      const minutesSince = (Date.now() - parseInt(lastRun)) / 60000;
      if (minutesSince > 3) {
        await sendScraperAlert({
          severity: 'critical',
          title: 'Scheduler Down',
          message: `Scraper scheduler has not run for ${Math.round(minutesSince)} minutes. Scheduled scrapers are not being triggered.`,
          scraperName: 'system',
          jobId: 'scheduler',
        });
      }
    }
  } catch (err) {
    // Non-fatal — Redis may not have the key yet
  }
}

// Clean up stale jobs on startup
cleanupStaleScraperJobs().catch(err => console.error('Startup cleanup failed:', err));

// Run periodic cleanup every 5 minutes to catch jobs deleted from database manually
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
setInterval(() => {
  cleanupStaleScraperJobs().catch(err => console.error('Periodic cleanup failed:', err));
  recoverStuckScraperJobs().catch(err => console.error('Stuck job recovery failed:', err));
  checkSchedulerHealth().catch(err => console.error('Scheduler health check failed:', err));
}, CLEANUP_INTERVAL_MS);
console.log(`🔄 Periodic cleanup, stuck recovery, and scheduler health check every 5 minutes`);

// Start Slack invitation queue processor if Slack environment variables are present
if (process.env.SLACK_WORKSPACE_URL && process.env.SLACK_ADMIN_EMAIL) {
  console.log(`\n📬 Slack invitation queue processor enabled`);
  console.log(`   Workspace: ${process.env.SLACK_WORKSPACE_URL}`);
  console.log(`   Account: ${process.env.SLACK_ADMIN_EMAIL}`);

  // Process queue every 30 seconds
  const SLACK_QUEUE_INTERVAL_MS = 30 * 1000; // 30 seconds

  // Start immediately
  processSlackQueue().catch(err => console.error('Slack queue processor error:', err));

  // Then run periodically
  setInterval(() => {
    processSlackQueue().catch(err => console.error('Slack queue processor error:', err));
  }, SLACK_QUEUE_INTERVAL_MS);

  console.log(`🔄 Slack invitation queue processor scheduled every 30 seconds`);
} else {
  console.log(`⚠️  Slack invitation queue processor disabled (missing environment variables)`);
}
