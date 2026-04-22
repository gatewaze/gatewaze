/**
 * Central authority for module filesystem paths, per
 * spec-module-deployment-overhaul.md §3.
 *
 * Two trees live under GATEWAZE_DATA_DIR (default /var/lib/gatewaze):
 *
 *   sources/<repo-slug>/<module-slug>/   — upstream cache, writable by API
 *   modules/<mod-id>/                    — live serving tree, only swapped on
 *                                          explicit install/apply-update/uninstall
 *
 * The admin/portal containers mount both read-only and build against the
 * live tree. The API has read-write access.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, rmSync, symlinkSync, lstatSync, statSync } from 'fs';
import { resolve, dirname } from 'path';

/**
 * Root data directory. Defaults to `/var/lib/gatewaze` in containers. Local
 * dev checkouts may override to a project-root path via env var.
 */
export function dataRoot(): string {
  return process.env.GATEWAZE_DATA_DIR || '/var/lib/gatewaze';
}

export function sourcesRoot(): string {
  return resolve(dataRoot(), 'sources');
}

export function modulesRoot(): string {
  return resolve(dataRoot(), 'modules');
}

export function liveModuleDir(moduleId: string): string {
  return resolve(modulesRoot(), moduleId);
}

export function liveModuleNewDir(moduleId: string): string {
  return resolve(modulesRoot(), `${moduleId}.new`);
}

export function liveModulePrevDir(moduleId: string): string {
  return resolve(modulesRoot(), `${moduleId}.prev`);
}

export function snapshotFile(moduleId: string): string {
  return resolve(liveModuleDir(moduleId), '.snapshot');
}

export function rebuildSentinelFile(): string {
  return resolve(modulesRoot(), '.rebuild-requested');
}

export function rebuildStatusFile(component: 'admin' | 'portal'): string {
  return resolve(modulesRoot(), `.rebuild-status-${component}`);
}

/**
 * Derive a repo slug from a git URL. Same rule the Vite plugin and loader
 * use so the symlink/clone paths agree.
 *   https://github.com/org/repo.git → github-com-org-repo
 */
export function repoSlug(gitUrl: string): string {
  return gitUrl
    .replace(/^(https?:\/\/|git:\/\/|git@)/, '')
    .replace(/\.git$/, '')
    .replace(/[^a-zA-Z0-9-]/g, '-');
}

export interface SnapshotMetadata {
  moduleId: string;
  sourceId?: string;
  sourceSha?: string;        // null for local/upload origin
  snapshotHash: string;
  installedAt: string;       // ISO-8601
}

export function readSnapshot(moduleId: string): SnapshotMetadata | null {
  const p = snapshotFile(moduleId);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as SnapshotMetadata;
  } catch {
    return null;
  }
}

/**
 * Write the .snapshot file atomically via temp-rename. Works intra-dir on
 * the same filesystem — matches the dual-tree layout guarantees.
 */
export function writeSnapshot(moduleId: string, meta: SnapshotMetadata): void {
  const dir = liveModuleDir(moduleId);
  mkdirSync(dir, { recursive: true });
  const tmp = resolve(dir, '.snapshot.tmp');
  writeFileSync(tmp, JSON.stringify(meta, null, 2), { mode: 0o600 });
  renameSync(tmp, snapshotFile(moduleId));
}

/**
 * Is `path` a symlink? (Not followed.)
 */
export function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Remove a live module dir, whether it's a regular directory or a symlink.
 * Uses rm -rf semantics; no-op if absent.
 */
export function removeLiveModule(moduleId: string): void {
  const dir = liveModuleDir(moduleId);
  if (!existsSync(dir) && !isSymlink(dir)) return;
  if (isSymlink(dir)) {
    // Remove the symlink itself, not the target it points at.
    rmSync(dir);
  } else {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Sweep any orphaned `.new` directories older than the given threshold
 * (default 10 minutes). Called on API startup per spec §11.
 */
export function sweepOrphanedNewDirs(maxAgeMs = 10 * 60 * 1000): string[] {
  const removed: string[] = [];
  const root = modulesRoot();
  if (!existsSync(root)) return removed;

  // Keep this lightweight — only scan top-level entries.
  const entries = readdirSyncSafe(root);
  const now = Date.now();
  for (const name of entries) {
    if (!name.endsWith('.new')) continue;
    const full = resolve(root, name);
    try {
      const s = statSync(full);
      if (now - s.mtimeMs > maxAgeMs) {
        rmSync(full, { recursive: true, force: true });
        removed.push(full);
      }
    } catch {
      // ignore
    }
  }
  return removed;
}

function readdirSyncSafe(p: string): string[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readdirSync } = require('fs');
    return readdirSync(p);
  } catch {
    return [];
  }
}

/**
 * Create `modules/<mod-id>/` as a symlink to the given source directory.
 * Used for local-path origin sources so HMR picks up in-place edits. The
 * target MUST already exist; this function does not validate the contents.
 */
export function symlinkLiveModule(moduleId: string, targetDir: string): void {
  const linkPath = liveModuleDir(moduleId);
  mkdirSync(modulesRoot(), { recursive: true });
  if (existsSync(linkPath) || isSymlink(linkPath)) {
    removeLiveModule(moduleId);
  }
  symlinkSync(targetDir, linkPath, 'dir');
}
