#!/usr/bin/env node

import { ScraperScheduler } from './ScraperScheduler.js';
import { EmbeddingScheduler } from './EmbeddingScheduler.js';
import { LumaContentScheduler } from './LumaContentScheduler.js';
import { MeetupContentScheduler } from './MeetupContentScheduler.js';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import cron from 'node-cron';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

console.log('🎯 Gatewaze Scheduler');
console.log('=====================\n');

// Create and start schedulers
const scraperScheduler = new ScraperScheduler();
const embeddingScheduler = new EmbeddingScheduler();
const lumaContentScheduler = new LumaContentScheduler();
const meetupContentScheduler = new MeetupContentScheduler();

// Module scheduler jobs (node-cron tasks). For modern modules these
// node-cron callbacks BullMQ-enqueue rather than running work inline.
const moduleCronJobs = [];

// Lazy-built BullMQ Queue cache so we don't spin up an ioredis connection
// for every cron tick. Keyed by queue name; mirrors the prefix the worker
// reads (`bull:${BRAND ?? 'default'}` — see ai/lib/jobs/inspector.ts).
const _queueCache = new Map();
let _redisShared = null;

function getQueue(queueName) {
  if (_queueCache.has(queueName)) return _queueCache.get(queueName);
  if (!_redisShared) {
    _redisShared = new IORedis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
      maxRetriesPerRequest: null,
    });
    _redisShared.on('error', (err) => {
      console.error('[modules] redis connection error:', err.message);
    });
  }
  const prefix = `bull:${process.env.BRAND ?? 'default'}`;
  const q = new Queue(queueName, { connection: _redisShared, prefix });
  _queueCache.set(queueName, q);
  return q;
}

/**
 * Discover modules without depending on `@gatewaze/shared` (which isn't
 * installed in the scheduler image — that's why module schedulers had
 * been silently failing with ERR_MODULE_NOT_FOUND for months).
 *
 * Walks the runtime-clone cache the api populates at startup:
 *   /app/.gatewaze-modules/<slug>/modules/<moduleId>/index.{ts,js}
 *
 * Falls back to the dev-time sibling layout if the runtime cache isn't
 * there (so local `npm run start:scheduler` still finds modules cloned
 * to `<workspace>/gatewaze-modules/modules/...`).
 */
function discoverModuleIndexFiles() {
  const roots = [
    '/app/.gatewaze-modules',
    path.resolve(__dirname, '../../../.gatewaze-modules'),
    // Dev fallbacks: each sibling repo lives next to the gatewaze workspace
    path.resolve(__dirname, '../../../gatewaze-modules'),
    path.resolve(__dirname, '../../../premium-gatewaze-modules'),
    path.resolve(__dirname, '../../../lf-gatewaze-modules'),
  ];
  const found = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    let entries;
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    // For .gatewaze-modules/* we expect <slug>/modules/<id>/index — for
    // the sibling-repo layout we go straight to <repo>/modules/<id>.
    const isCacheLayout = path.basename(root) === '.gatewaze-modules';
    if (isCacheLayout) {
      for (const slug of entries) {
        if (!slug.isDirectory()) continue;
        const modulesDir = path.join(root, slug.name, 'modules');
        if (!fs.existsSync(modulesDir)) continue;
        for (const mod of fs.readdirSync(modulesDir, { withFileTypes: true })) {
          if (!mod.isDirectory()) continue;
          for (const ext of ['ts', 'js']) {
            const idx = path.join(modulesDir, mod.name, `index.${ext}`);
            if (fs.existsSync(idx)) { found.push(idx); break; }
          }
        }
      }
    } else {
      const modulesDir = path.join(root, 'modules');
      if (!fs.existsSync(modulesDir)) continue;
      for (const mod of fs.readdirSync(modulesDir, { withFileTypes: true })) {
        if (!mod.isDirectory()) continue;
        for (const ext of ['ts', 'js']) {
          const idx = path.join(modulesDir, mod.name, `index.${ext}`);
          if (fs.existsSync(idx)) { found.push(idx); break; }
        }
      }
    }
  }
  return found;
}

async function registerModuleSchedulers() {
  const indexFiles = discoverModuleIndexFiles();
  console.log(`[modules] Discovered ${indexFiles.length} module index file(s) for scheduling`);
  let cronCount = 0;
  let schedulerCount = 0;
  let skippedNoCallable = 0;
  let importFailed = 0;

  for (const indexFile of indexFiles) {
    let mod;
    try {
      mod = await import(indexFile);
    } catch (err) {
      importFailed++;
      // Most modules only fail to import here when tsx isn't loaded
      // (.ts files) or the module pulls a peer dep we don't carry.
      // Log once per file at info level rather than spamming stderr —
      // the rest of the scheduler should still come up.
      console.warn(`[modules] skip ${path.basename(path.dirname(indexFile))}: ${err.message ?? err}`);
      continue;
    }
    const cfg = mod.default ?? mod;
    const moduleName = cfg?.name ?? cfg?.id ?? path.basename(path.dirname(indexFile));

    // Modern crons[]: cron tick enqueues a BullMQ job; a worker
    // consumes. Each entry shape:
    //   { name, queue, schedule: { pattern }, data }            (cron-style)
    //   { name, queue, schedule: { every: <ms> }, data }        (interval-style)
    // The packages/api/src/lib/queue/crons.ts path that BullMQ workers feed
    // already supports both shapes via the same ternary; node-cron itself
    // only accepts cron patterns, so we fall back to setInterval for the
    // `every` variant. Without this every interval-style cron was silently
    // skipped here, which is exactly what kept newsletter-dispatch-scheduled
    // from ever firing (scheduled sends sat in 'scheduled' state forever).
    for (const c of cfg?.crons ?? []) {
      if (!c?.name || !c?.queue || !c?.schedule || (!c.schedule.pattern && typeof c.schedule.every !== 'number')) {
        console.warn(`[modules] ${moduleName} cron skipped (missing name/queue/schedule.pattern|schedule.every)`);
        continue;
      }
      try {
        const queue = getQueue(c.queue);
        const tick = async () => {
          try {
            await queue.add(c.name, c.data ?? {});
          } catch (e) {
            console.error(`[modules] enqueue failed for ${c.name}:`, e.message ?? e);
          }
        };
        if (c.schedule.pattern) {
          const job = cron.schedule(c.schedule.pattern, tick);
          moduleCronJobs.push(job);
          console.log(`[modules] cron "${c.name}" (${c.schedule.pattern}) → bull:${process.env.BRAND ?? 'default'}:${c.queue} from ${moduleName}`);
        } else {
          // setInterval doesn't fire immediately — call once first so the
          // first tick lands within the configured interval of process boot
          // rather than `every` ms later. Matches BullMQ repeatable semantics.
          const handle = setInterval(tick, c.schedule.every);
          // Wrap in a node-cron-shaped object so the array's stop() path
          // (graceful shutdown below) works uniformly.
          moduleCronJobs.push({ stop: () => clearInterval(handle) });
          console.log(`[modules] cron "${c.name}" (every ${c.schedule.every}ms) → bull:${process.env.BRAND ?? 'default'}:${c.queue} from ${moduleName}`);
          // Fire-once on boot so a process that just started picks up any
          // already-due rows (e.g. scheduled sends past their target time
          // accumulated while the scheduler was being upgraded).
          tick();
        }
        cronCount++;
      } catch (e) {
        console.error(`[modules] failed to schedule cron ${c.name}:`, e.message ?? e);
      }
    }

    // Legacy schedulers[]: cron tick invokes the handler inline.
    for (const sched of cfg?.schedulers ?? []) {
      if (!sched?.name || !sched?.cron || !sched?.handler) continue;
      try {
        const handlerModule = await import(sched.handler);
        const handler = handlerModule.default ?? handlerModule;
        if (typeof handler !== 'function') { skippedNoCallable++; continue; }
        const job = cron.schedule(sched.cron, handler);
        moduleCronJobs.push(job);
        schedulerCount++;
        console.log(`[modules] scheduler "${sched.name}" (${sched.cron}) inline from ${moduleName}`);
      } catch (e) {
        console.error(`[modules] failed to schedule legacy scheduler ${sched.name}:`, e.message ?? e);
      }
    }
  }

  console.log(`[modules] scheduling summary: ${cronCount} cron(s) + ${schedulerCount} legacy scheduler(s)` +
    (importFailed ? `, ${importFailed} import(s) failed` : '') +
    (skippedNoCallable ? `, ${skippedNoCallable} non-callable handler(s) skipped` : ''));
}

// Handle graceful shutdown
const shutdown = async () => {
  console.log('\n👋 Shutting down gracefully...');
  scraperScheduler.stop();
  embeddingScheduler.stop();
  lumaContentScheduler.stop();
  meetupContentScheduler.stop();
  moduleCronJobs.forEach(job => job.stop());
  // Close all BullMQ Queue instances + the shared Redis client. Without
  // this, the node process hangs for ~15s waiting for the ioredis
  // socket to time out.
  for (const q of _queueCache.values()) {
    try { await q.close(); } catch { /* ignore */ }
  }
  if (_redisShared) {
    try { await _redisShared.quit(); } catch { /* ignore */ }
  }
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start the schedulers
try {
  scraperScheduler.start();
  embeddingScheduler.start();
  lumaContentScheduler.start();
  meetupContentScheduler.start();
  registerModuleSchedulers();
} catch (error) {
  console.error('❌ Failed to start schedulers:', error);
  process.exit(1);
}

// Keep process alive
process.stdin.resume();
