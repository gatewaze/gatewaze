#!/usr/bin/env node
/**
 * Admin bundle rebuild supervisor — runs inside the admin container,
 * alongside nginx (production) or Vite dev (dev mode).
 *
 * Watches the shared `<GATEWAZE_DATA_DIR>/modules/.rebuild-requested`
 * sentinel file. When the counter bumps, runs `vite build`, swaps
 * /usr/share/nginx/html, and sends SIGHUP to nginx. Writes progress to
 * `.rebuild-status-admin` so the admin UI can poll.
 *
 * In dev mode with `pnpm dev` (Vite dev server), we skip the build step
 * entirely — Vite's file-watcher picks up source changes directly via
 * the shared modules/ mount, and no static bundle swap is needed. This
 * file still writes the status sentinel so UI polling completes.
 *
 * See spec-module-deployment-overhaul §7.
 */

import chokidar from 'chokidar';
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const DATA_DIR      = process.env.GATEWAZE_DATA_DIR || '/var/lib/gatewaze';
const MODULES_DIR   = resolve(DATA_DIR, 'modules');
const SENTINEL      = resolve(MODULES_DIR, '.rebuild-requested');
const STATUS        = resolve(MODULES_DIR, '.rebuild-status-admin');
const ADMIN_DIR     = '/app/packages/admin';
const NGINX_HTML    = '/usr/share/nginx/html';
const IS_DEV_MODE   = process.env.ADMIN_DEV_MODE === '1';

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
  // Rename is atomic so the status reader never sees a torn file.
  const { renameSync } = await import('node:fs');
  renameSync(tmp, STATUS);
}

function runBuild() {
  return new Promise((resolveBuild) => {
    const start = Date.now();
    const child = spawn('npx', ['vite', 'build'], {
      cwd: ADMIN_DIR,
      stdio: 'inherit',
      env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=2560' },
    });
    child.on('exit', (code) => {
      resolveBuild({ ok: code === 0, durationMs: Date.now() - start });
    });
    child.on('error', (err) => {
      resolveBuild({ ok: false, durationMs: Date.now() - start, error: err.message });
    });
  });
}

async function swapNginxRoot() {
  const dist = resolve(ADMIN_DIR, 'dist');
  if (!existsSync(dist)) {
    throw new Error(`Vite output missing at ${dist}`);
  }
  await cp(dist, NGINX_HTML, { recursive: true, force: true });
}

function reloadNginx() {
  return new Promise((resolveReload) => {
    const child = spawn('nginx', ['-s', 'reload'], { stdio: 'inherit' });
    child.on('exit', (code) => resolveReload(code === 0));
    child.on('error', () => resolveReload(false));
  });
}

async function handleSentinel() {
  if (inFlight) return;
  if (!existsSync(SENTINEL)) return;

  let counter, components;
  try {
    const raw = await readFile(SENTINEL, 'utf-8');
    const parsed = JSON.parse(raw);
    counter = parsed.counter;
    components = parsed.components ?? ['admin'];
  } catch (err) {
    console.error('[admin-supervisor] Failed to read sentinel:', err);
    return;
  }

  if (!Number.isFinite(counter) || counter <= lastProcessed) return;
  if (!components.includes('admin')) {
    // Not our responsibility. Advance the cursor so we don't re-examine.
    lastProcessed = counter;
    return;
  }

  inFlight = true;
  console.log(`[admin-supervisor] Rebuild requested: counter=${counter}`);

  if (IS_DEV_MODE) {
    // Dev mode: Vite HMR handles source changes via the volume mount.
    // Just report success so the UI polling resolves.
    await writeStatus(counter, 'ok', { buildDurationMs: 0 });
    lastProcessed = counter;
    inFlight = false;
    console.log('[admin-supervisor] Dev mode — no build needed, status=ok');
    return;
  }

  const { ok, durationMs, error } = await runBuild();
  if (ok) {
    try {
      await swapNginxRoot();
      await reloadNginx();
      await writeStatus(counter, 'ok', { buildDurationMs: durationMs });
      lastProcessed = counter;
      console.log(`[admin-supervisor] Rebuild complete in ${durationMs}ms`);
    } catch (swapErr) {
      await writeStatus(counter, 'error', {
        buildDurationMs: durationMs,
        error: `swap failed: ${swapErr.message}`,
      });
      console.error('[admin-supervisor] Swap/reload failed:', swapErr);
    }
  } else {
    await writeStatus(counter, 'error', {
      buildDurationMs: durationMs,
      error: error || 'vite build exited non-zero',
    });
    console.error(`[admin-supervisor] Build failed in ${durationMs}ms`);
  }
  inFlight = false;
}

async function main() {
  await mkdir(MODULES_DIR, { recursive: true });
  console.log(`[admin-supervisor] Watching ${SENTINEL} (dev=${IS_DEV_MODE})`);

  const watcher = chokidar.watch(SENTINEL, {
    persistent: true,
    // Polling fallback for NFS/EFS variants where inotify doesn't
    // propagate across the shared volume. Auto-detection is runtime-
    // future work; default polling on to be safe for all storage
    // classes we support per spec §7.1.
    usePolling: true,
    interval: 2000,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
  });

  watcher.on('change', handleSentinel);
  watcher.on('add', handleSentinel);

  // Check once at startup in case a rebuild was requested while we
  // were offline.
  await handleSentinel();

  process.on('SIGTERM', () => {
    console.log('[admin-supervisor] SIGTERM received, exiting');
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[admin-supervisor] Fatal:', err);
  process.exit(1);
});
