#!/usr/bin/env node

/**
 * Worker Health Check
 *
 * Verifies the worker can connect to Redis and the queue is accessible.
 * Used as a K8s liveness/readiness probe.
 * Exit code 0 = healthy, 1 = unhealthy.
 */

import Redis from 'ioredis';

const TIMEOUT_MS = 5000;

async function check() {
  const redisUrl = process.env.REDIS_URL;
  const host = process.env.REDIS_HOST || 'redis';
  const port = parseInt(process.env.REDIS_PORT || '6379', 10);

  let client;
  try {
    client = redisUrl ? new Redis(redisUrl, { connectTimeout: TIMEOUT_MS, lazyConnect: true }) : new Redis({ host, port, connectTimeout: TIMEOUT_MS, lazyConnect: true });
    await client.connect();
    const pong = await client.ping();
    if (pong !== 'PONG') {
      throw new Error(`Unexpected PING response: ${pong}`);
    }
    await client.quit();
    process.exit(0);
  } catch (err) {
    console.error(`Health check failed: ${err.message}`);
    if (client) {
      try { await client.quit(); } catch {}
    }
    process.exit(1);
  }
}

// Hard timeout to ensure the process exits even if Redis hangs
setTimeout(() => {
  console.error('Health check timed out');
  process.exit(1);
}, TIMEOUT_MS + 1000);

check();
