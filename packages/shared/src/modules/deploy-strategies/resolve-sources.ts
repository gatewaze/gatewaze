import { join } from 'path';
import { readFileSync, existsSync } from 'fs';
import type { LoadedModule } from '../../types/modules';

/**
 * Given a function's entry point, resolve all source files needed for deployment.
 * Scans imports to find _shared/ dependencies transitively.
 *
 * Searches for shared files in multiple directories (in order):
 * 1. The module's own functions/_shared/ directory
 * 2. The platform's supabase/functions/_shared/ directory (for cross-module shared files)
 * 3. Additional shared directories provided by other modules
 */
export function resolveSourceFiles(
  functionDir: string,
  sharedDirs: string[],
): Map<string, string> {
  const files = new Map<string, string>();
  const visited = new Set<string>();

  const entryPath = join(functionDir, 'index.ts');
  if (!existsSync(entryPath)) {
    return files;
  }

  const entryContent = readFileSync(entryPath, 'utf-8');
  files.set('index.ts', entryContent);

  resolveSharedImports(entryContent, sharedDirs, files, visited);

  return files;
}

function resolveSharedImports(
  content: string,
  sharedDirs: string[],
  files: Map<string, string>,
  visited: Set<string>,
): void {
  // Match imports from ../_shared/ (function → shared) or ./ (shared → shared)
  const sharedImportRegex = /from\s+['"](?:\.\.?\/_shared\/|\.\/)([\w.-]+\.ts)['"]/g;
  let match;

  while ((match = sharedImportRegex.exec(content)) !== null) {
    const fileName = match[1];
    if (visited.has(fileName)) continue;
    visited.add(fileName);

    // Search all shared directories for this file
    for (const sharedDir of sharedDirs) {
      const filePath = join(sharedDir, fileName);
      if (existsSync(filePath)) {
        const sharedContent = readFileSync(filePath, 'utf-8');
        files.set(`_shared/${fileName}`, sharedContent);
        resolveSharedImports(sharedContent, sharedDirs, files, visited);
        break;
      }
    }
  }
}

/**
 * Resolve module-specific secrets from configSchema.
 * Module DB config takes priority over env vars.
 */
export function resolveModuleSecrets(mod: LoadedModule): Array<{ name: string; value: string }> {
  const secrets: Array<{ name: string; value: string }> = [];
  const configSchema = mod.config.configSchema;
  if (!configSchema) return secrets;

  for (const [, schema] of Object.entries(configSchema)) {
    if (schema.type !== 'secret') continue;
    const moduleConfigValue = mod.moduleConfig?.[schema.key] as string | undefined;
    const envValue = process.env[schema.key];
    const value = moduleConfigValue || envValue;
    if (value) {
      secrets.push({ name: schema.key, value });
    }
  }

  return secrets;
}
