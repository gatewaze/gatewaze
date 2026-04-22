/**
 * Live-tree management per spec-module-deployment-overhaul §5.
 *
 * All install / apply-update / uninstall side effects land here. The API
 * route handlers call these functions; they do NOT invoke migrations or
 * edge-function deploys — those are separate concerns composed at the
 * route layer so failures can be surfaced with the right HTTP status.
 */

import { cpSync, existsSync, mkdirSync, renameSync, rmSync, lstatSync } from 'fs';
import { resolve } from 'path';
import {
  liveModuleDir,
  liveModuleNewDir,
  liveModulePrevDir,
  modulesRoot,
  removeLiveModule,
  writeSnapshot,
  symlinkLiveModule,
  isSymlink,
  type SnapshotMetadata,
} from './module-paths';
import { computeModuleHashFromPath } from './module-hash';

export interface SnapshotInput {
  moduleId: string;
  sourceId?: string;
  sourceSha?: string;
  /** Source directory — already resolved (git clone path or mounted local path). */
  sourceDir: string;
  /** Treat source as a local mount and symlink instead of copy. */
  symlink?: boolean;
}

export interface SnapshotResult {
  moduleId: string;
  snapshotHash: string;
  installedAt: string;
  isSymlinked: boolean;
}

/**
 * Materialise a module into the live tree.
 *
 * For regular (git/upload) sources: copies `sourceDir` → `modules/<mod-id>.new/`,
 * then atomically renames `.new` → live (or swaps via `.prev` if a live
 * copy already exists).
 *
 * For local-path sources: creates a symlink directly from `modules/<mod-id>/`
 * to the source directory — edits reflect immediately for Vite HMR.
 *
 * Returns the snapshot metadata; the caller is responsible for updating
 * the `installed_modules` row and triggering a rebuild.
 */
export function installLiveSnapshot(input: SnapshotInput): SnapshotResult {
  const { moduleId, sourceId, sourceSha, sourceDir, symlink = false } = input;

  if (!existsSync(sourceDir)) {
    throw new Error(`Source directory missing: ${sourceDir}`);
  }

  const installedAt = new Date().toISOString();
  mkdirSync(modulesRoot(), { recursive: true });

  if (symlink) {
    symlinkLiveModule(moduleId, sourceDir);
    const snapshotHash = computeModuleHashFromPath(sourceDir);
    writeSnapshot(moduleId, { moduleId, sourceId, sourceSha, snapshotHash, installedAt });
    return { moduleId, snapshotHash, installedAt, isSymlinked: true };
  }

  // Copy → .new, then atomic swap. Excludes .git and node_modules.
  const newDir = liveModuleNewDir(moduleId);
  const prevDir = liveModulePrevDir(moduleId);
  const liveDir = liveModuleDir(moduleId);

  // Clean up any leftover .new from a prior aborted attempt.
  if (existsSync(newDir)) rmSync(newDir, { recursive: true, force: true });

  cpSync(sourceDir, newDir, {
    recursive: true,
    dereference: false,
    preserveTimestamps: true,
    filter: (src) => {
      if (src.endsWith('/.git') || src.includes('/.git/')) return false;
      if (src.endsWith('/node_modules') || src.includes('/node_modules/')) return false;
      return true;
    },
  });

  const snapshotHash = computeModuleHashFromPath(newDir);

  // Swap: live → .prev (if exists), .new → live, remove .prev.
  const liveExists = existsSync(liveDir) || isSymlink(liveDir);
  if (liveExists) {
    if (existsSync(prevDir)) rmSync(prevDir, { recursive: true, force: true });
    try {
      renameSync(liveDir, prevDir);
    } catch (err) {
      // Leave .new so operator can inspect.
      throw new Error(`RENAME_FAILED: could not move live aside: ${(err as Error).message}`);
    }
  }

  try {
    renameSync(newDir, liveDir);
  } catch (err) {
    // Best-effort roll-forward: put .prev back.
    if (liveExists && existsSync(prevDir) && !existsSync(liveDir)) {
      try { renameSync(prevDir, liveDir); } catch { /* abort rollback */ }
    }
    throw new Error(`RENAME_FAILED: could not install .new: ${(err as Error).message}`);
  }

  if (existsSync(prevDir)) {
    // Best-effort cleanup — not fatal if it fails; background sweeper picks it up.
    try { rmSync(prevDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  writeSnapshot(moduleId, { moduleId, sourceId, sourceSha, snapshotHash, installedAt });
  return { moduleId, snapshotHash, installedAt, isSymlinked: false };
}

/**
 * Uninstall: remove the live tree entry. Called from the API route after
 * DB row status has been set to 'disabled'.
 */
export function removeLiveSnapshot(moduleId: string): void {
  removeLiveModule(moduleId);
}

/**
 * Best-effort read of the currently-installed snapshot hash from the live
 * tree. Returns null if the module isn't installed. Used by check-updates
 * to cross-check the DB-stored hash against the actual on-disk state.
 */
export function readLiveSnapshotHash(moduleId: string): string | null {
  const p = resolve(liveModuleDir(moduleId), '.snapshot');
  if (!existsSync(p)) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readFileSync } = require('fs');
    const meta = JSON.parse(readFileSync(p, 'utf-8')) as SnapshotMetadata;
    return meta.snapshotHash ?? null;
  } catch {
    return null;
  }
}
