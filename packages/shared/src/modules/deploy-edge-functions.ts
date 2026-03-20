/**
 * Edge function deployment utilities.
 *
 * Copies edge functions from module directories to supabase/functions/
 * and optionally deploys them via the Supabase CLI.
 */

import type { LoadedModule } from '../types/modules';
import { resolve, join } from 'path';
import { cpSync, existsSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';

export interface DeployEdgeFunctionsOptions {
  /** Absolute path to the project root */
  projectRoot: string;
  /** Modules whose edge functions should be deployed */
  modules: LoadedModule[];
  /** If true, also run `supabase functions deploy` after copying */
  deploy?: boolean;
  /** Supabase project ref for cloud deployments */
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
 * 1. Copies each module's functions/ subdirectories to supabase/functions/
 * 2. Optionally deploys via Supabase CLI (for cloud/self-hosted)
 */
export async function deployEdgeFunctions(
  opts: DeployEdgeFunctionsOptions
): Promise<DeployResult> {
  const functionsDir = resolve(opts.projectRoot, 'supabase/functions');
  const result: DeployResult = { copied: [], deployed: [], errors: [] };

  for (const mod of opts.modules) {
    const edgeFunctions = mod.config.edgeFunctions;
    if (!edgeFunctions || edgeFunctions.length === 0) continue;

    // Resolve module directory
    const moduleDir = mod.resolvedDir;
    if (!moduleDir) {
      for (const fnName of edgeFunctions) {
        result.errors.push({
          module: mod.config.id,
          functionName: fnName,
          error: `Cannot resolve module directory for "${mod.config.id}"`,
        });
      }
      continue;
    }

    const moduleFunctionsDir = join(moduleDir, 'functions');

    for (const fnName of edgeFunctions) {
      const srcDir = join(moduleFunctionsDir, fnName);
      const destDir = join(functionsDir, fnName);

      if (!existsSync(srcDir)) {
        result.errors.push({
          module: mod.config.id,
          functionName: fnName,
          error: `Source directory not found: ${srcDir}`,
        });
        continue;
      }

      // Copy function directory
      try {
        mkdirSync(destDir, { recursive: true });
        cpSync(srcDir, destDir, { recursive: true });
        result.copied.push({ module: mod.config.id, functionName: fnName });
      } catch (err) {
        result.errors.push({
          module: mod.config.id,
          functionName: fnName,
          error: `Copy failed: ${err}`,
        });
        continue;
      }

      // Deploy via CLI if requested
      if (opts.deploy) {
        try {
          const refFlag = opts.projectRef ? ` --project-ref ${opts.projectRef}` : '';
          execSync(`npx supabase functions deploy ${fnName}${refFlag}`, {
            cwd: opts.projectRoot,
            stdio: 'pipe',
          });
          result.deployed.push({ module: mod.config.id, functionName: fnName });
        } catch (err) {
          result.errors.push({
            module: mod.config.id,
            functionName: fnName,
            error: `Deploy failed: ${err}`,
          });
        }
      }
    }
  }

  return result;
}
