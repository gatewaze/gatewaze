/**
 * Edge function deployment utilities.
 *
 * Copies edge functions from module directories to supabase/functions/
 * and optionally deploys them via the Supabase CLI.
 */

import type { LoadedModule } from '../types/modules';
import { resolve, join } from 'path';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
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

    // Copy module _shared files into the platform _shared directory
    const moduleSharedDir = join(moduleFunctionsDir, '_shared');
    if (existsSync(moduleSharedDir)) {
      const platformSharedDir = join(functionsDir, '_shared');
      mkdirSync(platformSharedDir, { recursive: true });
      cpSync(moduleSharedDir, platformSharedDir, { recursive: true });
    }

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

      // Deploy via CLI if requested (cloud mode)
      if (opts.deploy) {
        try {
          const refFlag = opts.projectRef ? ` --project-ref ${opts.projectRef}` : '';
          // Try 'supabase' binary first (installed in container), fall back to 'npx supabase'
          const cmd = existsSync('/usr/bin/supabase') ? 'supabase' : 'npx supabase';
          execSync(`${cmd} functions deploy ${fnName}${refFlag}`, {
            cwd: opts.projectRoot,
            stdio: 'pipe',
            env: { ...process.env },
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

  // Regenerate platform-main to include newly deployed module functions
  if (result.copied.length > 0) {
    try {
      const moduleFunctionNames = result.copied.map((r) => r.functionName);
      regeneratePlatformMain(functionsDir, moduleFunctionNames);
    } catch (err) {
      console.warn('[deploy-edge-functions] Failed to regenerate platform-main:', err);
    }
  }

  return result;
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

  const importLines = sorted.map(([fn, id]) => `import ${id} from '../${fn}/index.ts';`);
  const registrationLines = sorted.map(([fn, id]) => `  '${fn}': ${id},`);

  const generated = `import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

// Auto-generated — do not edit manually.
// Regenerated by deployEdgeFunctions when module edge functions change.
${importLines.join('\n')}

const functions: Record<string, (req: Request) => Response | Promise<Response>> = {
${registrationLines.join('\n')}
};

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
  console.log(`[deploy-edge-functions] Regenerated platform-main with ${sorted.length} functions (${moduleFunctionNames.length} from modules)`);
}
