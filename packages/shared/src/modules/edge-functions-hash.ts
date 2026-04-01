import { createHash } from 'crypto';
import { join } from 'path';
import { existsSync } from 'fs';
import type { LoadedModule } from '../types/modules';
import { resolveSourceFiles } from './deploy-strategies/resolve-sources';

/**
 * Compute a deterministic SHA-256 hash of all edge function source files
 * for a module. Used to detect source changes without a version bump.
 *
 * Returns null if the module has no edge functions.
 */
export function computeEdgeFunctionsHash(
  mod: LoadedModule,
  allSharedDirs: string[],
): string | null {
  const edgeFunctions = mod.config.edgeFunctions;
  if (!edgeFunctions?.length || !mod.resolvedDir) return null;

  const moduleFunctionsDir = join(mod.resolvedDir, 'functions');
  const moduleSharedDir = join(moduleFunctionsDir, '_shared');

  // Prioritize module's own _shared, then all others
  const sharedDirs = existsSync(moduleSharedDir)
    ? [moduleSharedDir, ...allSharedDirs.filter((d) => d !== moduleSharedDir)]
    : allSharedDirs;

  const hash = createHash('sha256');

  // Process functions in sorted order for determinism
  for (const fnName of [...edgeFunctions].sort()) {
    const srcDir = join(moduleFunctionsDir, fnName);
    if (!existsSync(srcDir)) continue;

    const sourceFiles = resolveSourceFiles(srcDir, sharedDirs);

    // Sort entries by key for deterministic hashing
    const sorted = [...sourceFiles.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [path, content] of sorted) {
      hash.update(path);
      hash.update(content);
    }
  }

  return hash.digest('hex');
}
