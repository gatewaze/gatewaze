#!/usr/bin/env node

import { ScraperScheduler } from './ScraperScheduler.js';
import { EmbeddingScheduler } from './EmbeddingScheduler.js';
import { LumaContentScheduler } from './LumaContentScheduler.js';
import { MeetupContentScheduler } from './MeetupContentScheduler.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

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

// Handle graceful shutdown
const shutdown = () => {
  console.log('\n👋 Shutting down gracefully...');
  scraperScheduler.stop();
  embeddingScheduler.stop();
  lumaContentScheduler.stop();
  meetupContentScheduler.stop();
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
} catch (error) {
  console.error('❌ Failed to start schedulers:', error);
  process.exit(1);
}

// Keep process alive
process.stdin.resume();
