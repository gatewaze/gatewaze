#!/usr/bin/env node
/**
 * Portal bundle rebuild supervisor. Analogue of the admin supervisor
 * but runs `npx next build` and restarts the Next standalone server
 * via SIGTERM (container restart policy or PM2 brings it back up).
 *
 * See spec-module-deployment-overhaul §7.
 */

import chokidar from 'chokidar';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const DATA_DIR     = process.env.GATEWAZE_DATA_DIR || '/var/lib/gatewaze';
const MODULES_DIR  = resolve(DATA_DIR, 'modules');
const SENTINEL     = resolve(MODULES_DIR, '.rebuild-requested');
const STATUS       = resolve(MODULES_DIR, '.rebuild-status-portal');
const PORTAL_DIR   = '/app/packages/portal';
const IS_DEV_MODE  = process.env.PORTAL_DEV_MODE === '1';

let lastProcessed = 0;
let inFlight = false;

async function writeStatus(counter, status, opts = {}) {
  await mkdir(MODULES_DIR, { recursive: true });
  const payload = {
    counter,
    status,
    completedAt: new Date().toISOString(),
    buildDurationMs: opts.buildDurationMs ?? null,
    error: opts.error ?? null,
  };
  const tmp = STATUS + '.tmp';
  await writeFile(tmp, JSON.stringify(payload, null, 2));
  const { renameSync } = await import('node:fs');
  renameSync(tmp, STATUS);
}

function runBuild() {
  return new Promise((resolveBuild) => {
    const start = Date.now();
    const child = spawn('pnpm', ['build'], {
      cwd: PORTAL_DIR,
      stdio: 'inherit',
    });
    child.on('exit', (code) => {
      resolveBuild({ ok: code === 0, durationMs: Date.now() - start });
    });
    child.on('error', (err) => {
      resolveBuild({ ok: false, durationMs: Date.now() - start, error: err.message });
    });
  });
}

function restartNextServer() {
  // The Next standalone server runs as PID 1 in the portal container.
  // Sending SIGTERM here exits the container; the orchestrator (docker
  // or k8s) restarts it with the new .next/ directory mounted.
  // Prefer a soft restart via PM2 if present; fall back to exit.
  return new Promise((resolveRestart) => {
    const pm2 = spawn('pm2', ['restart', 'portal'], { stdio: 'ignore' });
    pm2.on('exit', (code) => {
      if (code === 0) return resolveRestart(true);
      // Fall back to process exit — container orchestrator will recycle.
      process.kill(1, 'SIGTERM');
      resolveRestart(true);
    });
    pm2.on('error', () => {
      process.kill(1, 'SIGTERM');
      resolveRestart(true);
    });
  });
}

async function handleSentinel() {
  if (inFlight) return;
  if (!existsSync(SENTINEL)) return;

  let counter, components;
  try {
    const parsed = JSON.parse(await readFile(SENTINEL, 'utf-8'));
    counter = parsed.counter;
    components = parsed.components ?? ['portal'];
  } catch (err) {
    console.error('[portal-supervisor] Failed to read sentinel:', err);
    return;
  }

  if (!Number.isFinite(counter) || counter <= lastProcessed) return;
  if (!components.includes('portal')) {
    lastProcessed = counter;
    return;
  }

  inFlight = true;
  console.log(`[portal-supervisor] Rebuild requested: counter=${counter}`);

  if (IS_DEV_MODE) {
    await writeStatus(counter, 'ok', { buildDurationMs: 0 });
    lastProcessed = counter;
    inFlight = false;
    console.log('[portal-supervisor] Dev mode — HMR handles it, status=ok');
    return;
  }

  const { ok, durationMs, error } = await runBuild();
  if (ok) {
    await writeStatus(counter, 'ok', { buildDurationMs: durationMs });
    lastProcessed = counter;
    console.log(`[portal-supervisor] Rebuild complete in ${durationMs}ms; restarting Next`);
    await restartNextServer();
  } else {
    await writeStatus(counter, 'error', {
      buildDurationMs: durationMs,
      error: error || 'next build exited non-zero',
    });
    console.error(`[portal-supervisor] Build failed in ${durationMs}ms`);
  }
  inFlight = false;
}

async function main() {
  await mkdir(MODULES_DIR, { recursive: true });
  console.log(`[portal-supervisor] Watching ${SENTINEL} (dev=${IS_DEV_MODE})`);

  const watcher = chokidar.watch(SENTINEL, {
    persistent: true,
    usePolling: true,
    interval: 2000,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
  });

  watcher.on('change', handleSentinel);
  watcher.on('add', handleSentinel);
  await handleSentinel();

  process.on('SIGTERM', () => process.exit(0));
}

main().catch((err) => {
  console.error('[portal-supervisor] Fatal:', err);
  process.exit(1);
});
