import type { GatewazeConfig, GatewazeModule, LoadedModule, ModuleSource, ModuleSourceRow, ModuleWarning } from '../types/modules';
import { existsSync, readdirSync, statSync } from 'fs';
import { resolve, isAbsolute } from 'path';
import { execFileSync, type ExecFileSyncOptions } from 'child_process';
import { mkdirSync } from 'fs';
import { liveModuleDir } from './module-paths';

/** Subdirectories within a module that contribute to its "last modified" time. */
const MTIME_DIRS = ['migrations', 'admin', 'portal', 'api', 'lib', 'workers', 'helm'];

/** Files (relative to module dir) that contribute to its "last modified" time. */
const MTIME_FILES = ['index.ts', 'guide.md', 'package.json'];

/**
 * Walk a module directory and return the most-recent mtime as an ISO
 * timestamp. Returns undefined if nothing exists or anything throws.
 *
 * Skips node_modules / .snapshot / hidden dirs to avoid noise from
 * incidental rebuilds.
 */
function computeModuleLastModifiedAt(moduleDir: string): string | undefined {
  let latestMs = 0;

  const visit = (path: string) => {
    try {
      const s = statSync(path);
      if (s.isFile()) {
        if (s.mtimeMs > latestMs) latestMs = s.mtimeMs;
        return;
      }
      if (s.isDirectory()) {
        for (const entry of readdirSync(path)) {
          if (entry.startsWith('.')) continue;
          if (entry === 'node_modules') continue;
          visit(resolve(path, entry));
        }
      }
    } catch {
      // Permission errors, broken symlinks, etc. — ignore.
    }
  };

  for (const file of MTIME_FILES) {
    const p = resolve(moduleDir, file);
    if (existsSync(p)) visit(p);
  }
  for (const sub of MTIME_DIRS) {
    const p = resolve(moduleDir, sub);
    if (existsSync(p)) visit(p);
  }

  return latestMs > 0 ? new Date(latestMs).toISOString() : undefined;
}

const BRANCH_RE = /^[\w][\w.\-/]{0,254}$/;

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
 * Validate feature namespace conventions.
 * Returns warnings for features that don't follow module.id prefix convention.
 */
export function validateFeatureNamespace(mod: { id: string; features: string[] }): ModuleWarning[] {
  const warnings: ModuleWarning[] = [];
  for (const feature of mod.features) {
    if (feature !== mod.id && !feature.startsWith(mod.id + '.')) {
      warnings.push({
        code: 'MODULE_FEATURE_NAMESPACE_VIOLATION',
        message: `Feature "${feature}" does not start with module ID "${mod.id}". Expected "${mod.id}" or "${mod.id}.<sub-feature>".`,
        details: { feature, moduleId: mod.id },
      });
    }
  }
  return warnings;
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
  const configSources = config.moduleSources ?? [];
  const resolvedSources = resolveSourceDirs(configSources, root);
  const sourceLabels = buildSourceLabelMap(configSources, resolvedSources);
  const moduleIds = config.modules ?? discoverModules(configSources, root);
  const modules: LoadedModule[] = [];

  for (const packageName of moduleIds) {
    try {
      const slug = packageName.replace(/^@gatewaze-modules\//, '');

      // Resolution order per spec-module-deployment-overhaul §8.2:
      //   1. live tree at modules/<slug>/ (dual-tree live snapshot)
      //   2. any resolvedSources entry (bootstrap / not-yet-installed)
      // When both exist, sourceLabel still comes from whichever source
      // dir contains the slug — that's what drives UI tab grouping.
      let mod: Record<string, unknown> | undefined;
      let resolvedDir: string | undefined;
      let sourceLabel: string | undefined;

      // Figure out sourceLabel by scanning source dirs regardless of
      // where the code is loaded from; this preserves the Modules page
      // tab behaviour even when serving from the live tree.
      for (const sourceDir of resolvedSources) {
        const indexTs = resolve(sourceDir, slug, 'index.ts');
        if (existsSync(indexTs)) {
          sourceLabel = sourceLabels.get(sourceDir);
          break;
        }
      }

      const liveDir = liveModuleDir(slug);
      const liveIndex = resolve(liveDir, 'index.ts');
      if (existsSync(liveIndex)) {
        mod = await import(liveIndex);
        resolvedDir = liveDir;
      } else {
        // Bootstrap path: no live snapshot yet. Load straight from source.
        for (const sourceDir of resolvedSources) {
          const moduleDir = resolve(sourceDir, slug);
          const indexTs = resolve(moduleDir, 'index.ts');
          if (existsSync(indexTs)) {
            mod = await import(indexTs);
            resolvedDir = moduleDir;
            break;
          }
        }
      }

      // Warn if module exists in later sources (shadowed)
      if (resolvedDir) {
        const currentSourceIdx = resolvedSources.indexOf(
          resolvedDir.substring(0, resolvedDir.lastIndexOf('/'))
        );
        for (let si = currentSourceIdx + 1; si < resolvedSources.length; si++) {
          const laterDir = resolve(resolvedSources[si], slug);
          const laterIndex = resolve(laterDir, 'index.ts');
          if (existsSync(laterIndex)) {
            console.warn(
              `[modules] MODULE_SHADOWED: "${packageName}" resolved from "${resolvedDir}" but also exists at "${laterDir}". First match wins.`,
            );
          }
        }
      }

      // Fall back to node_modules / package import
      if (!mod) {
        mod = await import(packageName);
      }

      const moduleExport = (mod as Record<string, unknown>).default ?? mod;

      validateModule(moduleExport, packageName);

      // Validate feature namespace conventions (warn in v1.1, hard-fail in v1.2)
      const nsWarnings = validateFeatureNamespace(moduleExport as { id: string; features: string[] });
      for (const w of nsWarnings) {
        console.warn(`[modules] ${w.code}: ${w.message}`);
      }

      modules.push({
        config: moduleExport,
        packageName,
        moduleConfig: config.moduleConfig?.[moduleExport.id] ?? {},
        resolvedDir,
        sourceLabel,
        lastModifiedAt: resolvedDir ? computeModuleLastModifiedAt(resolvedDir) : undefined,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[modules] Failed to load module "${packageName}": ${message}`);
      // Continue loading other modules — one bad module should not break everything
    }
  }

  // Check for MODULE_ID_CONFLICT
  const idMap = new Map<string, string>();
  for (const mod of modules) {
    const existingSource = idMap.get(mod.config.id);
    if (existingSource) {
      console.error(
        `[modules] MODULE_ID_CONFLICT: Module ID "${mod.config.id}" is claimed by both "${existingSource}" and "${mod.packageName}". Module subsystem may be unstable.`,
      );
    }
    idMap.set(mod.config.id, mod.packageName);
  }

  return modules;
}

/**
 * Build a map from resolved source directory → human-readable label.
 * Derives labels from the source config (explicit label, repo name, or directory name).
 */
function buildSourceLabelMap(
  sources: ModuleSource[],
  resolvedDirs: string[],
): Map<string, string> {
  const map = new Map<string, string>();

  for (let i = 0; i < sources.length && i < resolvedDirs.length; i++) {
    const source = sources[i];
    const dir = resolvedDirs[i];

    let label: string | undefined;

    if (typeof source === 'object' && source.label) {
      label = source.label;
    } else {
      // Derive from URL/path: extract the repo or directory name
      const url = typeof source === 'string' ? source : source.url;
      label = deriveSourceLabel(url);
    }

    if (label) {
      map.set(dir, label);
    }
  }

  return map;
}

/**
 * Derive a human-readable label from a source URL or path.
 * '../gatewaze-modules/modules' → 'Gatewaze Modules'
 * 'https://github.com/gatewaze/gatewaze-modules.git' → 'Gatewaze Modules'
 */
function deriveSourceLabel(url: string): string {
  // Strip git suffix and fragments
  let name = url.split('#')[0].replace(/\.git$/, '');

  // Extract the last meaningful path segment
  // For '../gatewaze-modules/modules' → 'gatewaze-modules'
  // For 'https://github.com/org/repo' → 'repo'
  const segments = name.split('/').filter(Boolean);
  // Skip generic trailing segments like 'modules'
  name = segments.length > 1 && segments[segments.length - 1] === 'modules'
    ? segments[segments.length - 2]
    : segments[segments.length - 1] || name;

  // Convert kebab-case to title case: 'gatewaze-modules' → 'Gatewaze Modules'
  return name
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Parse MODULE_SOURCES env var into ModuleSource entries. Each entry is
 * either a git URL (optionally `#branch=X&path=Y`) or a local absolute
 * path. Same format the Vite plugin and portal script use.
 */
function parseEnvModuleSources(): ModuleSource[] {
  const raw = process.env.MODULE_SOURCES;
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [url, fragment] = entry.split('#');
      if (!fragment) return { url };
      const params = new URLSearchParams(fragment);
      return {
        url,
        path: params.get('path') ?? undefined,
        branch: params.get('branch') ?? undefined,
        label: params.get('label') ?? undefined,
      };
    });
}

/**
 * Origin precedence when multiple DB rows share the same label. Higher =
 * wins. Used both to pick the live source for module loading and to hide
 * shadowed rows in the admin UI's sources list.
 */
const ORIGIN_RANK: Record<string, number> = { user: 4, upload: 3, env: 2, config: 1 };

/**
 * Identify module_sources rows that are shadowed by a higher-precedence
 * row sharing the same non-empty label (case-insensitive). Returns the
 * set of shadowed row IDs so callers can exclude them.
 *
 * Example: if a user sets `MODULE_SOURCES=/gatewaze-modules/modules#label=Free`
 * locally, the 'env'-origin row shadows the 'config'-origin row that
 * comes from gatewaze.config.ts's git URL with the same "Free" label.
 */
export function computeShadowedSourceIds(dbSources: ModuleSourceRow[]): Set<string> {
  const byLabel = new Map<string, { id: string; rank: number }>();
  const shadowed = new Set<string>();

  for (const row of dbSources) {
    const label = (row.label ?? '').trim().toLowerCase();
    if (!label) continue;
    const rank = ORIGIN_RANK[row.origin] ?? 0;
    const existing = byLabel.get(label);
    if (!existing) {
      byLabel.set(label, { id: row.id, rank });
    } else if (rank > existing.rank) {
      shadowed.add(existing.id);
      byLabel.set(label, { id: row.id, rank });
    } else if (rank < existing.rank) {
      shadowed.add(row.id);
    }
    // tie on rank: leave earlier row in place
  }

  return shadowed;
}

/**
 * Load modules using sources from config file, MODULE_SOURCES env var,
 * and database. Merges all three (deduped), then discovers and loads.
 *
 * DB rows with a label that's shadowed by a higher-precedence row of
 * the same label are excluded — so a local `env`-origin source with
 * label "Free" hides a `config`-origin git URL also labelled "Free".
 */
export async function loadModulesWithDbSources(
  config: GatewazeConfig,
  dbSources: ModuleSourceRow[],
  projectRoot?: string,
): Promise<LoadedModule[]> {
  const configSources = config.moduleSources ?? [];
  const envSources = parseEnvModuleSources();

  const shadowedIds = computeShadowedSourceIds(dbSources);
  const effectiveDb = dbSources.filter((r) => !shadowedIds.has(r.id));

  // Convert DB sources to ModuleSource format
  const dbModuleSources: ModuleSource[] = effectiveDb.map((row) => ({
    url: row.url,
    path: row.path ?? undefined,
    branch: row.branch ?? undefined,
    token: row.token ?? undefined,
    label: row.label ?? undefined,
  }));

  // Deduplicate by url+path. Env-origin DB rows take precedence over
  // config-origin so local-mount overrides win when labels collide —
  // this is the dev-loop pattern (`MODULE_SOURCES=/gatewaze-modules/...`
  // shadows the upstream git URL of the same name). Within each origin
  // group, insertion order is preserved.
  const dbEnvRows = effectiveDb
    .filter((r) => r.origin === 'env')
    .map((row): ModuleSource => ({
      url: row.url,
      path: row.path ?? undefined,
      branch: row.branch ?? undefined,
      token: row.token ?? undefined,
      label: row.label ?? undefined,
    }));
  const dbNonEnvRows = effectiveDb
    .filter((r) => r.origin !== 'env')
    .map((row): ModuleSource => ({
      url: row.url,
      path: row.path ?? undefined,
      branch: row.branch ?? undefined,
      token: row.token ?? undefined,
      label: row.label ?? undefined,
    }));
  void dbModuleSources; // superseded by the split above

  const seen = new Set<string>();
  const byPath: ModuleSource[] = [];

  // Iteration order: env-DB > env-env-var > non-env-DB > config. So a
  // local bind-mount label shadows a same-labelled git source.
  for (const source of [...dbEnvRows, ...envSources, ...dbNonEnvRows, ...configSources]) {
    const normalized = typeof source === 'string'
      ? source
      : `${source.url}|${source.path ?? ''}`;
    if (!seen.has(normalized)) {
      seen.add(normalized);
      byPath.push(source);
    }
  }

  // Second pass: dedup by label. First match wins — and after the
  // re-ordering above, that's the env-origin source whenever labels
  // collide. (Pre-fix this dropped env sources whose labels matched
  // the upstream config-origin git URL, leaving the API loading the
  // stale git clone instead of the developer's local bind mount.)
  const seenLabels = new Set<string>();
  const merged: ModuleSource[] = [];
  for (const source of byPath) {
    const label = typeof source === 'object' && source.label ? source.label.trim().toLowerCase() : '';
    if (label && seenLabels.has(label)) continue;
    if (label) seenLabels.add(label);
    merged.push(source);
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
    const { url, path: subPath, branch, token } = normalizeSource(source);

    if (isGitUrl(url)) {
      const localPath = cloneOrUpdateRepo(url, branch, projectRoot, token);
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

function normalizeSource(source: ModuleSource): { url: string; path?: string; branch?: string; token?: string } {
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
  token?: string,
): string | null {
  const cacheDir = resolve(projectRoot, '.gatewaze-modules');
  const repoSlug = gitUrl
    .replace(/^(https?:\/\/|git:\/\/|git@)/, '')
    .replace(/\.git$/, '')
    .replace(/[^a-zA-Z0-9-]/g, '-');
  const repoDir = resolve(cacheDir, repoSlug);
  const execOpts: ExecFileSyncOptions = { stdio: 'pipe' };

  // Defense-in-depth: branch is validated at write time in the API, but
  // gatewaze.config.ts paths reach this function too — re-check before
  // letting it flow into git argv.
  if (branch && !BRANCH_RE.test(branch)) {
    console.error(`[gatewaze-modules] Refusing to clone with invalid branch: ${branch}`);
    return null;
  }

  // Inject token into HTTPS URLs for private repo access
  const authUrl = token && gitUrl.startsWith('https://')
    ? gitUrl.replace('https://', `https://x-access-token:${token}@`)
    : gitUrl;

  try {
    mkdirSync(cacheDir, { recursive: true });

    if (existsSync(resolve(repoDir, '.git'))) {
      // Update the remote URL in case the token changed
      if (token) {
        execFileSync('git', ['-C', repoDir, 'remote', 'set-url', 'origin', authUrl], execOpts);
      }
      // `--ff-only` plus an empty refspec list is valid; we used to swallow
      // pull errors with `|| true`. Now we catch the throw instead.
      try {
        const args = ['-C', repoDir, 'pull'];
        if (branch) args.push('origin', branch);
        args.push('--ff-only');
        execFileSync('git', args, execOpts);
      } catch {
        // Non-fast-forward / network blip — proceed with cached repo.
      }
    } else {
      const args = ['clone', '--depth', '1'];
      if (branch) args.push('--branch', branch);
      args.push(authUrl, repoDir);
      execFileSync('git', args, execOpts);
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
