import { createHash } from 'crypto';
import { join, relative } from 'path';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import type { LoadedModule } from '../types/modules';

/**
 * Compute a deterministic SHA-256 hash of all files in a module directory.
 * Used to detect any source changes (edge functions, migrations, config,
 * admin components, etc.) without requiring a version bump.
 *
 * Returns null if the module directory cannot be resolved.
 */
export function computeModuleHash(mod: LoadedModule): string | null {
  if (!mod.resolvedDir || !existsSync(mod.resolvedDir)) return null;
  return hashDir(mod.resolvedDir);
}

/**
 * Compute a deterministic SHA-256 of the module files in a directory.
 * Same algorithm as computeModuleHash but accepts a bare path — used by
 * the dual-tree install/apply-update flows per
 * spec-module-deployment-overhaul §5.
 */
export function computeModuleHashFromPath(dir: string): string {
  if (!existsSync(dir)) {
    throw new Error(`Cannot hash missing directory: ${dir}`);
  }
  return hashDir(dir);
}

function hashDir(dir: string): string {
  const hash = createHash('sha256');
  hashDirectory(dir, dir, hash);
  return hash.digest('hex');
}

/**
 * Recursively hash all files in a directory.
 * Files are processed in sorted order for deterministic output.
 */
function hashDirectory(dir: string, rootDir: string, hash: ReturnType<typeof createHash>): void {
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules')
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relPath = relative(rootDir, fullPath);

    if (entry.isDirectory()) {
      hashDirectory(fullPath, rootDir, hash);
    } else if (entry.isFile()) {
      hash.update(relPath);
      hash.update(readFileSync(fullPath, 'utf-8'));
    }
  }
}

// Keep backward-compatible export name
export { computeModuleHash as computeEdgeFunctionsHash };
