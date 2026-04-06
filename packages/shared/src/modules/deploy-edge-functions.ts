/**
 * Edge function deployment utilities.
 *
 * Copies edge functions from module directories to supabase/functions/
 * and deploys them via the appropriate strategy (local filesystem, cloud API, or k8s).
 */

import type { LoadedModule } from '../types/modules';
import { resolve, join } from 'path';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
import {
  detectDeploymentEnvironment,
  createDeploymentStrategy,
  resolveSourceFiles,
  resolveModuleSecrets,
} from './deploy-strategies';

export interface DeployEdgeFunctionsOptions {
  /** Absolute path to the project root */
  projectRoot: string;
  /** Modules whose edge functions should be deployed */
  modules: LoadedModule[];
  /**
   * All loaded modules (not just those being deployed). Used to resolve
   * cross-module _shared/ dependencies during cloud deployment.
   * If omitted, only the modules being deployed are searched for shared files.
   */
  allModules?: LoadedModule[];
  /** @deprecated Use environment detection instead. Kept for backward compat. */
  deploy?: boolean;
  /** @deprecated Use SUPABASE_PROJECT_REF env var instead. */
  projectRef?: string;
}

export interface DeployFunctionResult {
  module: string;
  functionName: string;
}

export interface DeployResult {
  copied: DeployFunctionResult[];
  deployed: DeployFunctionResult[];
  errors: (DeployFunctionResult & { error: string })[];
}

/**
 * Deploy edge functions from module directories.
 *
 * 1. Detects deployment environment (local, cloud, k8s)
 * 2. Copies files to disk for local/k8s strategies
 * 3. Deploys via Supabase Management API for cloud strategy
 * 4. Syncs module secrets
 * 5. Regenerates platform-main and reloads edge runtime
 */
export async function deployEdgeFunctions(
  opts: DeployEdgeFunctionsOptions
): Promise<DeployResult> {
  const functionsDir = resolve(opts.projectRoot, 'supabase/functions');
  const result: DeployResult = { copied: [], deployed: [], errors: [] };

  let env: ReturnType<typeof detectDeploymentEnvironment>;
  try {
    env = detectDeploymentEnvironment();
  } catch (err) {
    // Misconfigured environment (e.g., SUPABASE_PROJECT_REF without ACCESS_TOKEN)
    console.error('[modules]', err instanceof Error ? err.message : err);
    for (const mod of opts.modules) {
      for (const fnName of mod.config.edgeFunctions ?? []) {
        result.errors.push({
          module: mod.config.id,
          functionName: fnName,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return result;
  }

  const strategy = createDeploymentStrategy(env);
  const isCloudDeploy = env === 'cloud-api';
  const targetFunctionsDir = env === 'k8s-shared-storage'
    ? process.env.EDGE_FUNCTIONS_SHARED_DIR!
    : functionsDir;

  console.log(`[modules] Deployment environment: ${env}`);

  // Build the list of all _shared/ directories for source resolution.
  // Functions may import shared files from their own module or from other modules
  // (e.g., events-registration imports integrationEvents.ts from luma-integration's _shared/).
  // Search ALL loaded modules (not just those being deployed) so cross-module
  // dependencies resolve correctly.
  const allSharedDirs: string[] = [];
  const modulesToSearch = opts.allModules ?? opts.modules;
  for (const mod of modulesToSearch) {
    if (mod.resolvedDir) {
      const moduleShared = join(mod.resolvedDir, 'functions', '_shared');
      if (existsSync(moduleShared)) {
        allSharedDirs.push(moduleShared);
      }
    }
  }
  // Platform _shared/ as fallback (contains files copied by previously enabled modules)
  const platformSharedDir = join(targetFunctionsDir, '_shared');
  if (existsSync(platformSharedDir)) {
    allSharedDirs.push(platformSharedDir);
  }

  for (const mod of opts.modules) {
    const edgeFunctions = mod.config.edgeFunctions;
    const functionFiles = mod.config.functionFiles;
    const hasEdgeFunctions = edgeFunctions && edgeFunctions.length > 0;
    const hasFunctionFiles = functionFiles && functionFiles.length > 0;
    if (!hasEdgeFunctions && !hasFunctionFiles) continue;

    const moduleDir = mod.resolvedDir;
    if (!moduleDir) {
      for (const fnName of edgeFunctions ?? []) {
        result.errors.push({
          module: mod.config.id,
          functionName: fnName,
          error: `Cannot resolve module directory for "${mod.config.id}"`,
        });
      }
      continue;
    }

    // Copy functionFiles (e.g., provider.ts) into _shared/providers/ so they're
    // accessible to the edge runtime's compiled scope (platform-main only sees
    // its own directory + _shared/, not sibling function directories).
    // Format: "source.ts" copies as-is, "source.ts:destname.ts" renames.
    if (!isCloudDeploy && hasFunctionFiles) {
      const providersDir = join(targetFunctionsDir, '_shared', 'providers');
      mkdirSync(providersDir, { recursive: true });
      for (const entry of functionFiles) {
        const [src, dest] = entry.includes(':') ? entry.split(':') : [entry, entry];
        const srcFile = join(moduleDir, src);
        if (existsSync(srcFile)) {
          cpSync(srcFile, join(providersDir, dest));
        }
      }
    }

    const moduleFunctionsDir = join(moduleDir, 'functions');
    const moduleSharedDir = join(moduleFunctionsDir, '_shared');

    // For local/k8s: copy _shared files to platform _shared
    if (!isCloudDeploy && existsSync(moduleSharedDir)) {
      const platformSharedDir = join(targetFunctionsDir, '_shared');
      mkdirSync(platformSharedDir, { recursive: true });
      cpSync(moduleSharedDir, platformSharedDir, { recursive: true });
    }

    // Deploy functions concurrently
    const deployPromises = (edgeFunctions ?? []).map(async (fnName) => {
      const srcDir = join(moduleFunctionsDir, fnName);

      if (!existsSync(srcDir)) {
        result.errors.push({
          module: mod.config.id,
          functionName: fnName,
          error: `Source directory not found: ${srcDir}`,
        });
        return;
      }

      // For local/k8s: copy function files to disk
      if (!isCloudDeploy) {
        try {
          const destDir = join(targetFunctionsDir, fnName);
          mkdirSync(destDir, { recursive: true });
          cpSync(srcDir, destDir, { recursive: true });
          result.copied.push({ module: mod.config.id, functionName: fnName });
        } catch (err) {
          result.errors.push({
            module: mod.config.id,
            functionName: fnName,
            error: `Copy failed: ${err}`,
          });
          return;
        }
      }

      // For cloud: deploy via Management API
      if (isCloudDeploy) {
        const startTime = Date.now();
        // Prioritize the module's own _shared/ dir, then fall back to all others
        const sharedDirs = [moduleSharedDir, ...allSharedDirs.filter(d => d !== moduleSharedDir)];
        const sourceFiles = resolveSourceFiles(srcDir, sharedDirs);

        if (sourceFiles.size === 0) {
          result.errors.push({
            module: mod.config.id,
            functionName: fnName,
            error: `No source files found for ${fnName}`,
          });
          return;
        }

        const deployResult = await strategy.deploy({
          functionName: fnName,
          entrypointPath: 'index.ts',
          sourceFiles,
        });

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);

        if (deployResult.success) {
          console.log(`[modules] Deployed ${fnName} (${duration}s)`);
          result.deployed.push({ module: mod.config.id, functionName: fnName });
        } else {
          console.error(`[modules] Failed ${fnName}: ${deployResult.errorCode} — ${deployResult.error}`);
          result.errors.push({
            module: mod.config.id,
            functionName: fnName,
            error: deployResult.error!,
          });
        }
      }
    });

    await Promise.all(deployPromises);

    // Sync module-specific secrets
    if (mod.config.configSchema) {
      const secrets = resolveModuleSecrets(mod);
      if (secrets.length > 0) {
        try {
          await strategy.syncSecrets(secrets);
        } catch (err) {
          console.error(`[modules] Failed to sync secrets for "${mod.config.id}":`, err);
        }
      }
    }
  }

  // Regenerate platform-main for local/k8s
  if (!isCloudDeploy && result.copied.length > 0) {
    try {
      const moduleFunctionNames = result.copied.map((r) => r.functionName);
      regeneratePlatformMain(targetFunctionsDir, moduleFunctionNames);
    } catch (err) {
      console.warn('[modules] Failed to regenerate platform-main:', err);
    }
  }

  // Reload edge runtime
  try {
    await strategy.reload();
  } catch (err) {
    console.warn('[modules] Edge runtime reload failed:', err);
  }

  const successCount = result.copied.length + result.deployed.length;
  const failCount = result.errors.length;
  console.log(`[modules] Deployment complete: ${successCount} succeeded, ${failCount} failed`);

  return result;
}

/**
 * Remove edge functions for a module being disabled.
 */
export async function removeEdgeFunctions(
  projectRoot: string,
  edgeFunctions: string[],
): Promise<void> {
  let env: ReturnType<typeof detectDeploymentEnvironment>;
  try {
    env = detectDeploymentEnvironment();
  } catch {
    return;
  }

  const strategy = createDeploymentStrategy(env);
  const isCloudDeploy = env === 'cloud-api';
  const targetFunctionsDir = env === 'k8s-shared-storage'
    ? process.env.EDGE_FUNCTIONS_SHARED_DIR!
    : resolve(projectRoot, 'supabase/functions');

  for (const fnName of edgeFunctions) {
    if (isCloudDeploy) {
      const removeResult = await strategy.remove(fnName);
      if (removeResult.success) {
        console.log(`[modules] Removed cloud function: ${fnName}`);
      } else {
        console.warn(`[modules] Failed to remove ${fnName}: ${removeResult.error}`);
      }
    } else {
      // Local/k8s: remove function directory
      const fnDir = join(targetFunctionsDir, fnName);
      if (existsSync(fnDir)) {
        rmSync(fnDir, { recursive: true, force: true });
        console.log(`[modules] Removed function directory: ${fnName}`);
      }
    }
  }

  // Regenerate platform-main without the removed functions
  if (!isCloudDeploy) {
    try {
      regeneratePlatformMain(targetFunctionsDir, []);
    } catch (err) {
      console.warn('[modules] Failed to regenerate platform-main after removal:', err);
    }
  }

  try {
    await strategy.reload();
  } catch (err) {
    console.warn('[modules] Edge runtime reload failed after removal:', err);
  }
}

/**
 * Convert a function directory name to a valid JS identifier for use as an import alias.
 * e.g. "integrations-luma-webhook" → "integrationsLumaWebhook"
 */
function toIdentifier(name: string): string {
  return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * Regenerate supabase/functions/platform-main/index.ts to register module
 * edge functions alongside existing core functions.
 *
 * Preserves existing core imports exactly as-is, then appends module function
 * imports and registrations.
 */
export function regeneratePlatformMain(functionsDir: string, moduleFunctionNames: string[]): void {
  const indexPath = join(functionsDir, 'platform-main', 'index.ts');
  if (!existsSync(indexPath)) return;

  const currentContent = readFileSync(indexPath, 'utf-8');

  // Extract existing imports: identifier → functionName
  const importRegex = /^import\s+(\w+)\s+from\s+'\.\.\/([^']+)\/index\.ts';$/gm;
  const existingImports = new Map<string, string>(); // fnName → identifier
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(currentContent)) !== null) {
    existingImports.set(match[2], match[1]);
  }

  // Combine: keep existing core imports + add module functions (deduped)
  const allFunctions = new Map<string, string>(existingImports);
  for (const fnName of moduleFunctionNames) {
    if (!allFunctions.has(fnName)) {
      allFunctions.set(fnName, toIdentifier(fnName));
    }
  }

  // Sort for deterministic output
  const sorted = [...allFunctions.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  // Separate core (always present) from module (may be missing after reset) functions
  const coreFunctions = new Set(existingImports.keys());
  const coreEntries = sorted.filter(([fn]) => coreFunctions.has(fn));
  const moduleEntries = sorted.filter(([fn]) => !coreFunctions.has(fn));

  const coreImportLines = coreEntries.map(([fn, id]) => `import ${id} from '../${fn}/index.ts';`);
  const coreRegistrationLines = coreEntries.map(([fn, id]) => `  '${fn}': ${id},`);
  const moduleLoadLines = moduleEntries.map(([fn, id]) =>
    `  try { functions['${fn}'] = (await import('../${fn}/index.ts')).default; } catch { /* module not deployed yet */ }`
  );

  const generated = `import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

// Auto-generated — do not edit manually.
// Regenerated by deployEdgeFunctions when module edge functions change.
${coreImportLines.join('\n')}

const functions: Record<string, (req: Request) => Response | Promise<Response>> = {
${coreRegistrationLines.join('\n')}
};

// Module edge functions loaded dynamically (gracefully skipped if not yet deployed)
${moduleLoadLines.length > 0 ? `await (async () => {\n${moduleLoadLines.join('\n')}\n})();` : ''}

serve(async (req: Request) => {
  const url = new URL(req.url);
  const pathSegments = url.pathname.split('/').filter(Boolean);

  // Route: /functionName or /functions/v1/functionName
  let functionName: string | undefined;

  if (pathSegments.length >= 3 && pathSegments[0] === 'functions' && pathSegments[1] === 'v1') {
    functionName = pathSegments[2];
  } else if (pathSegments.length >= 1) {
    functionName = pathSegments[0];
  }

  const handler = functionName ? functions[functionName] : undefined;

  if (!handler) {
    return new Response(
      JSON.stringify({ error: \`Function not found: \${functionName ?? 'unknown'}\` }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    );
  }

  try {
    return await handler(req);
  } catch (error) {
    console.error(\`Error invoking function \${functionName}:\`, error);
    return new Response(
      JSON.stringify({ error: \`Internal error in function \${functionName}\` }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
});
`;

  writeFileSync(indexPath, generated, 'utf-8');
  console.log(`[modules] Regenerated platform-main with ${sorted.length} functions (${moduleFunctionNames.length} from modules)`);
}
