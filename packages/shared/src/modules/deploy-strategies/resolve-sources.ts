import { join } from 'path';
import { readFileSync, existsSync } from 'fs';
import type { LoadedModule } from '../../types/modules';

/**
 * Given a function's entry point, resolve all source files needed for deployment.
 * Scans imports transitively, picking up:
 *   - sibling files (`./foo.ts`) from the function's own directory, and
 *   - shared files (`../_shared/foo.ts`) from any of the provided sharedDirs.
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
  visited.add('index.ts');

  resolveImports(entryContent, 'fn', functionDir, sharedDirs, files, visited);

  return files;
}

function resolveImports(
  content: string,
  context: 'fn' | 'shared',
  functionDir: string,
  sharedDirs: string[],
  files: Map<string, string>,
  visited: Set<string>,
): void {
  // Three import shapes:
  //   '../_shared/foo.ts' or './_shared/foo.ts'  → always a shared lookup
  //   './foo.ts'                                  → sibling lookup, but its
  //                                                 meaning depends on where
  //                                                 the importing file lives:
  //                                                   - in the function's own
  //                                                     dir → sibling fn file
  //                                                   - inside _shared/ → another
  //                                                     shared file
  const importRe = /from\s+['"](\.\.\/_shared\/|\.\/_shared\/|\.\/)([\w.-]+\.ts)['"]/g;
  let match;
  while ((match = importRe.exec(content)) !== null) {
    const prefix = match[1];
    const fileName = match[2];
    const isShared = prefix !== './' || context === 'shared';

    if (isShared) {
      const key = `_shared/${fileName}`;
      if (visited.has(key)) continue;
      visited.add(key);
      for (const sharedDir of sharedDirs) {
        const filePath = join(sharedDir, fileName);
        if (existsSync(filePath)) {
          const sharedContent = readFileSync(filePath, 'utf-8');
          files.set(key, sharedContent);
          resolveImports(sharedContent, 'shared', functionDir, sharedDirs, files, visited);
          break;
        }
      }
    } else {
      const key = fileName;
      if (visited.has(key)) continue;
      visited.add(key);
      const filePath = join(functionDir, fileName);
      if (existsSync(filePath)) {
        const fileContent = readFileSync(filePath, 'utf-8');
        files.set(key, fileContent);
        resolveImports(fileContent, 'fn', functionDir, sharedDirs, files, visited);
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
