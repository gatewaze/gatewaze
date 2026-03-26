import type { GatewazeConfig, GatewazeModule, LoadedModule, ModuleSource, ModuleSourceRow } from '../types/modules';
import { existsSync, readdirSync } from 'fs';
import { resolve, isAbsolute } from 'path';
import { execSync, type ExecSyncOptions } from 'child_process';
import { mkdirSync } from 'fs';

/**
 * Validate that a module export satisfies the GatewazeModule interface.
 * Throws descriptive errors for missing or invalid fields.
 */
export function validateModule(mod: unknown, packageName: string): asserts mod is GatewazeModule {
  if (!mod || typeof mod !== 'object') {
    throw new Error(`Module "${packageName}" does not export a valid object`);
  }

  const m = mod as Record<string, unknown>;
  const requiredStrings = ['id', 'name', 'description', 'version'] as const;

  for (const field of requiredStrings) {
    if (typeof m[field] !== 'string' || (m[field] as string).length === 0) {
      throw new Error(`Module "${packageName}" is missing required string field: ${field}`);
    }
  }

  if (!Array.isArray(m.features)) {
    throw new Error(`Module "${packageName}" is missing required array field: features`);
  }
}

/**
 * Load all modules declared in the config.
 * Returns validated LoadedModule objects.
 *
 * Resolves modules from moduleSources (local paths and git URLs) first,
 * then falls back to node_modules (pnpm workspace packages).
 *
 * This is a pure data function — it does NOT run lifecycle hooks or migrations.
 * Each consumer (API server, CLI, admin build) decides which side effects to perform.
 */
/**
 * Discover all module package names by scanning moduleSources directories.
 * Skips directories starting with _ (e.g. _template).
 */
export function discoverModules(
  sources: ModuleSource[],
  projectRoot: string,
): string[] {
  const resolvedSources = resolveSourceDirs(sources, projectRoot);
  const seen = new Set<string>();
  const result: string[] = [];

  for (const sourceDir of resolvedSources) {
    if (!existsSync(sourceDir)) continue;
    const entries = readdirSync(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
      const indexTs = resolve(sourceDir, entry.name, 'index.ts');
      if (!existsSync(indexTs)) continue;
      const packageName = `@gatewaze-modules/${entry.name}`;
      if (!seen.has(packageName)) {
        seen.add(packageName);
        result.push(packageName);
      }
    }
  }

  return result.sort();
}

export async function loadModules(
  config: GatewazeConfig,
  projectRoot?: string,
): Promise<LoadedModule[]> {
  const root = projectRoot ?? process.cwd();
  const resolvedSources = resolveSourceDirs(config.moduleSources ?? [], root);
  const moduleIds = config.modules ?? discoverModules(config.moduleSources ?? [], root);
  const modules: LoadedModule[] = [];

  for (const packageName of moduleIds) {
    try {
      const slug = packageName.replace(/^@gatewaze-modules\//, '');

      // Try moduleSources first
      let mod: Record<string, unknown> | undefined;
      let resolvedDir: string | undefined;
      for (const sourceDir of resolvedSources) {
        const moduleDir = resolve(sourceDir, slug);
        const indexTs = resolve(moduleDir, 'index.ts');
        if (existsSync(indexTs)) {
          mod = await import(indexTs);
          resolvedDir = moduleDir;
          break;
        }
      }

      // Fall back to node_modules / package import
      if (!mod) {
        mod = await import(packageName);
      }

      const moduleExport = (mod as Record<string, unknown>).default ?? mod;

      validateModule(moduleExport, packageName);

      modules.push({
        config: moduleExport,
        packageName,
        moduleConfig: config.moduleConfig?.[moduleExport.id] ?? {},
        resolvedDir,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[modules] Failed to load module "${packageName}": ${message}`);
      // Continue loading other modules — one bad module should not break everything
    }
  }

  return modules;
}

/**
 * Load modules using sources from both config file and database.
 * Merges DB sources with config sources (deduped), then discovers and loads.
 */
export async function loadModulesWithDbSources(
  config: GatewazeConfig,
  dbSources: ModuleSourceRow[],
  projectRoot?: string,
): Promise<LoadedModule[]> {
  const configSources = config.moduleSources ?? [];

  // Convert DB sources to ModuleSource format
  const dbModuleSources: ModuleSource[] = dbSources.map((row) => ({
    url: row.url,
    path: row.path ?? undefined,
    branch: row.branch ?? undefined,
  }));

  // Deduplicate by url+path
  const seen = new Set<string>();
  const merged: ModuleSource[] = [];

  for (const source of [...configSources, ...dbModuleSources]) {
    const normalized = typeof source === 'string'
      ? source
      : `${source.url}|${source.path ?? ''}`;
    if (!seen.has(normalized)) {
      seen.add(normalized);
      merged.push(source);
    }
  }

  // Create a config with merged sources
  const mergedConfig: GatewazeConfig = {
    ...config,
    moduleSources: merged,
  };

  return loadModules(mergedConfig, projectRoot);
}

/**
 * Resolve moduleSources entries to absolute directory paths.
 * Git URLs are cloned/updated in a local cache.
 */
function resolveSourceDirs(sources: ModuleSource[], projectRoot: string): string[] {
  const resolved: string[] = [];

  for (const source of sources) {
    const { url, path: subPath, branch } = normalizeSource(source);

    if (isGitUrl(url)) {
      const localPath = cloneOrUpdateRepo(url, branch, projectRoot);
      if (localPath) {
        resolved.push(subPath ? resolve(localPath, subPath) : localPath);
      }
    } else {
      const absPath = isAbsolute(url) ? url : resolve(projectRoot, url);
      resolved.push(subPath ? resolve(absPath, subPath) : absPath);
    }
  }

  return resolved;
}

function normalizeSource(source: ModuleSource): { url: string; path?: string; branch?: string } {
  if (typeof source === 'string') {
    const [url, fragment] = source.split('#');
    if (!fragment) return { url };
    const params = new URLSearchParams(fragment);
    return {
      url,
      path: params.get('path') ?? undefined,
      branch: params.get('branch') ?? undefined,
    };
  }
  return source;
}

function isGitUrl(url: string): boolean {
  return (
    url.startsWith('https://') ||
    url.startsWith('git://') ||
    url.startsWith('git@') ||
    url.endsWith('.git')
  );
}

function cloneOrUpdateRepo(
  gitUrl: string,
  branch: string | undefined,
  projectRoot: string,
): string | null {
  const cacheDir = resolve(projectRoot, '.gatewaze-modules');
  const repoSlug = gitUrl
    .replace(/^(https?:\/\/|git:\/\/|git@)/, '')
    .replace(/\.git$/, '')
    .replace(/[^a-zA-Z0-9-]/g, '-');
  const repoDir = resolve(cacheDir, repoSlug);
  const execOpts: ExecSyncOptions = { stdio: 'pipe' };

  try {
    mkdirSync(cacheDir, { recursive: true });

    if (existsSync(resolve(repoDir, '.git'))) {
      const branchArg = branch ? `origin ${branch}` : '';
      execSync(`git -C "${repoDir}" pull ${branchArg} --ff-only 2>/dev/null || true`, execOpts);
    } else {
      const branchFlag = branch ? `--branch ${branch}` : '';
      execSync(`git clone --depth 1 ${branchFlag} "${gitUrl}" "${repoDir}"`, execOpts);
    }

    console.log(`[gatewaze-modules] Resolved git source: ${gitUrl} → ${repoDir}`);
    return repoDir;
  } catch (err) {
    console.error(`[gatewaze-modules] Failed to clone ${gitUrl}:`, err);
    return null;
  }
}

/**
 * Synchronous version for contexts where dynamic import is not available
 * (e.g., Vite plugin at build time). Accepts pre-imported module objects.
 */
export function resolveModules(
  moduleExports: GatewazeModule[],
  config: GatewazeConfig
): LoadedModule[] {
  const moduleIds = config.modules ?? [];
  return moduleExports.map((moduleExport, i) => {
    validateModule(moduleExport, moduleIds[i] ?? `module[${i}]`);
    return {
      config: moduleExport,
      packageName: moduleIds[i] ?? moduleExport.id,
      moduleConfig: config.moduleConfig?.[moduleExport.id] ?? {},
    };
  });
}
