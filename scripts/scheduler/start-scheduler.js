#!/usr/bin/env node

import { ScraperScheduler } from './ScraperScheduler.js';
import { EmbeddingScheduler } from './EmbeddingScheduler.js';
import { LumaContentScheduler } from './LumaContentScheduler.js';
import { MeetupContentScheduler } from './MeetupContentScheduler.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import cron from 'node-cron';

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

// Module scheduler jobs
const moduleCronJobs = [];

async function registerModuleSchedulers() {
  try {
    const { loadModules } = await import('@gatewaze/shared/modules');
    const { default: config } = await import('../../gatewaze.config.js');
    const PROJECT_ROOT = path.resolve(__dirname, '../..');

    const modules = await loadModules(config, PROJECT_ROOT);
    for (const mod of modules) {
      for (const sched of mod.config.schedulers ?? []) {
        const handlerModule = await import(sched.handler);
        const handler = handlerModule.default ?? handlerModule;
        const job = cron.schedule(sched.cron, handler);
        moduleCronJobs.push(job);
        console.log(`[modules] Scheduled "${sched.name}" (${sched.cron}) from ${mod.config.name}`);
      }
    }
  } catch (err) {
    console.error('[modules] Failed to load module schedulers:', err);
  }
}

// Handle graceful shutdown
const shutdown = () => {
  console.log('\n👋 Shutting down gracefully...');
  scraperScheduler.stop();
  embeddingScheduler.stop();
  lumaContentScheduler.stop();
  meetupContentScheduler.stop();
  moduleCronJobs.forEach(job => job.stop());
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
