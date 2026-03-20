import type { Plugin } from 'vite';
import { readFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve, isAbsolute } from 'path';
import { execSync } from 'child_process';

const VIRTUAL_MODULE_ID = 'virtual:gatewaze-modules';
const RESOLVED_ID = '\0' + VIRTUAL_MODULE_ID;

/**
 * Vite plugin that reads gatewaze.config.ts and generates a virtual module
 * with static imports for each configured module package.
 *
 * Supports modules from:
 *   - pnpm workspace packages (@gatewaze-modules/*)
 *   - Local filesystem paths (relative or absolute)
 *   - Git repositories (cloned to .gatewaze-modules/ cache)
 */
export function gatewazeModulesPlugin(): Plugin {
  const projectRoot = resolve(__dirname, '../..');

  return {
    name: 'gatewaze-modules',

    resolveId(id) {
      if (id === VIRTUAL_MODULE_ID) {
        return RESOLVED_ID;
      }
    },

    load(id) {
      if (id !== RESOLVED_ID) return;

      const configPath = resolve(projectRoot, 'gatewaze.config.ts');
      const { moduleIds: explicitIds, sources } = parseConfig(configPath);

      // Resolve each source directory to an absolute path (cloning git repos if needed)
      const resolvedSources = resolveSources(sources, projectRoot);

      // Auto-discover modules from sources if none explicitly listed
      const moduleIds = explicitIds.length > 0
        ? explicitIds
        : discoverModulesFromSources(resolvedSources);

      if (moduleIds.length === 0) {
        return 'export default [];\n';
      }

      // Generate imports for each module
      const imports: string[] = [];
      const refs: string[] = [];

      for (let i = 0; i < moduleIds.length; i++) {
        const moduleId = moduleIds[i];
        const importPath = resolveModuleImport(moduleId, resolvedSources, projectRoot);

        if (importPath) {
          imports.push(`import mod${i} from '${importPath}';`);
          refs.push(`mod${i}`);
        } else {
          console.warn(`[gatewaze-modules] Could not resolve module: ${moduleId}`);
        }
      }

      return [
        ...imports,
        `export default [${refs.join(', ')}];`,
        '',
      ].join('\n');
    },
  };
}

/**
 * Resolve the import path for a single module ID.
 * Checks sources in order, then falls back to node_modules.
 */
function resolveModuleImport(
  moduleId: string,
  resolvedSources: string[],
  projectRoot: string,
): string | null {
  // Strip @gatewaze-modules/ prefix if present (for backwards compatibility)
  const slug = moduleId.replace(/^@gatewaze-modules\//, '');

  // 1. Check each resolved source directory
  for (const sourceDir of resolvedSources) {
    const indexTs = resolve(sourceDir, slug, 'index.ts');
    if (existsSync(indexTs)) {
      return indexTs;
    }
  }

  // 2. Check node_modules (pnpm workspace link)
  const nodeModulesPath = resolve(
    projectRoot, 'packages/admin/node_modules', `@gatewaze-modules/${slug}`, 'index.ts'
  );
  if (existsSync(nodeModulesPath)) {
    return null; // Return null to use the package name — pnpm link works
  }

  // 3. Legacy fallback: sibling repo path
  const siblingPath = resolve(projectRoot, '..', 'gatewaze-modules', 'modules', slug, 'index.ts');
  if (existsSync(siblingPath)) {
    return siblingPath;
  }

  return null;
}

/**
 * Resolve module source entries to absolute directory paths.
 * Git URLs are cloned to a local cache directory.
 */
function resolveSources(sources: SourceEntry[], projectRoot: string): string[] {
  const resolved: string[] = [];

  for (const source of sources) {
    const { url, path: subPath, branch } = normalizeSource(source);

    if (isGitUrl(url)) {
      // Clone/update git repo to cache
      const localPath = cloneOrUpdateRepo(url, branch, projectRoot);
      if (localPath) {
        resolved.push(subPath ? resolve(localPath, subPath) : localPath);
      }
    } else {
      // Local path
      const absPath = isAbsolute(url) ? url : resolve(projectRoot, url);
      resolved.push(subPath ? resolve(absPath, subPath) : absPath);
    }
  }

  return resolved;
}

interface SourceEntry {
  url: string;
  path?: string;
  branch?: string;
}

function normalizeSource(source: string | SourceEntry): SourceEntry {
  if (typeof source === 'string') {
    // Parse fragment: 'url#branch=main&path=modules'
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

/**
 * Clone or update a git repo to a local cache directory.
 * Returns the absolute path to the cloned repo.
 */
function cloneOrUpdateRepo(
  gitUrl: string,
  branch: string | undefined,
  projectRoot: string,
): string | null {
  // Cache directory: <projectRoot>/.gatewaze-modules/<repo-slug>
  const cacheDir = resolve(projectRoot, '.gatewaze-modules');
  const repoSlug = gitUrl
    .replace(/^(https?:\/\/|git:\/\/|git@)/, '')
    .replace(/\.git$/, '')
    .replace(/[^a-zA-Z0-9-]/g, '-');
  const repoDir = resolve(cacheDir, repoSlug);

  try {
    mkdirSync(cacheDir, { recursive: true });

    if (existsSync(resolve(repoDir, '.git'))) {
      // Update existing clone
      const branchArg = branch ? `origin ${branch}` : '';
      execSync(`git -C "${repoDir}" pull ${branchArg} --ff-only 2>/dev/null || true`, {
        stdio: 'pipe',
      });
    } else {
      // Fresh clone
      const branchFlag = branch ? `--branch ${branch}` : '';
      execSync(`git clone --depth 1 ${branchFlag} "${gitUrl}" "${repoDir}"`, {
        stdio: 'pipe',
      });
    }

    console.log(`[gatewaze-modules] Resolved git source: ${gitUrl} → ${repoDir}`);
    return repoDir;
  } catch (err) {
    console.error(`[gatewaze-modules] Failed to clone ${gitUrl}:`, err);
    return null;
  }
}

/**
 * Discover all module package names by scanning resolved source directories.
 * Skips directories starting with _ or . (e.g. _template).
 */
function discoverModulesFromSources(resolvedSources: string[]): string[] {
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

/**
 * Extract moduleSources and modules arrays from gatewaze.config.ts.
 */
function parseConfig(configPath: string): {
  moduleIds: string[];
  sources: SourceEntry[];
} {
  try {
    const rawContent = readFileSync(configPath, 'utf-8');
    // Strip single-line comments so commented-out config doesn't get matched
    const content = rawContent.replace(/\/\/.*$/gm, '');

    // Parse modules array (matches "modules:" but not "moduleSources:")
    const modulesMatch = content.match(/\bmodules\s*:\s*\[([\s\S]*?)\]/);
    const moduleIds: string[] = [];
    if (modulesMatch) {
      const strings = modulesMatch[1].match(/['"]([^'"]+)['"]/g);
      if (strings) {
        for (const s of strings) {
          moduleIds.push(s.slice(1, -1));
        }
      }
    }

    // Parse moduleSources array
    const sourcesMatch = content.match(/moduleSources\s*:\s*\[([\s\S]*?)\]/);
    const sources: SourceEntry[] = [];
    if (sourcesMatch) {
      const strings = sourcesMatch[1].match(/['"]([^'"]+)['"]/g);
      if (strings) {
        for (const s of strings) {
          sources.push(normalizeSource(s.slice(1, -1)));
        }
      }
      // Also parse object-style entries: { url: '...', path: '...', branch: '...' }
      const objMatches = sourcesMatch[1].matchAll(
        /\{\s*url\s*:\s*['"]([^'"]+)['"]\s*(?:,\s*path\s*:\s*['"]([^'"]+)['"])?\s*(?:,\s*branch\s*:\s*['"]([^'"]+)['"])?\s*\}/g
      );
      for (const m of objMatches) {
        sources.push({
          url: m[1],
          path: m[2] || undefined,
          branch: m[3] || undefined,
        });
      }
    }

    // Default source if none specified
    if (sources.length === 0) {
      sources.push({ url: '../gatewaze-modules/modules' });
    }

    return { moduleIds, sources };
  } catch {
    return { moduleIds: [], sources: [] };
  }
}
