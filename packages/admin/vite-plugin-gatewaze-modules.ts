import type { Plugin } from 'vite';
import { readFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve, dirname, isAbsolute, relative } from 'path';
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
  // Map of @/utils/<name> → absolute path to module's admin/utils/<name>.ts
  let utilAliases: Record<string, string> = {};

  return {
    name: 'gatewaze-modules',
    enforce: 'pre',

    config() {
      const configPath = resolve(projectRoot, 'gatewaze.config.ts');
      const { sources } = parseConfig(configPath);
      const resolvedSources = resolveSources(sources, projectRoot);

      // Auto-discover admin/utils exports from all modules and register
      // them as @/utils/<name> aliases so cross-module imports resolve
      // without hard-coding module paths in the admin app.
      utilAliases = discoverModuleUtilAliases(resolvedSources);

      if (Object.keys(utilAliases).length > 0) {
        console.log(
          `[gatewaze-modules] Registered ${Object.keys(utilAliases).length} module util alias(es)`
        );
      }

      return {
        resolve: {
          alias: utilAliases,
        },
      };
    },

    resolveId(id, importer) {
      if (id === VIRTUAL_MODULE_ID) {
        return RESOLVED_ID;
      }
      // For imports from module files that can't be resolved,
      // return an empty stub module instead of failing the build
      if (importer && importer.includes('gatewaze-modules') && !id.startsWith('\0')) {
        // Bare package imports (react-leaflet, etc.)
        if (!id.startsWith('.') && !id.startsWith('/') && !id.startsWith('@/')) {
          try {
            const pkgName = id.startsWith('@') ? id.split('/').slice(0, 2).join('/') : id.split('/')[0];
            const pkgPath = resolve(projectRoot, 'node_modules', pkgName);
            const adminPkgPath = resolve(__dirname, 'node_modules', pkgName);
            if (!existsSync(pkgPath) && !existsSync(adminPkgPath)) {
              console.warn(`[gatewaze-modules] Stubbing unresolvable package "${id}" imported from module`);
              return `\0stub:${id}`;
            }
          } catch {
            // Let Vite handle it normally
          }
        }
        // @/ alias imports that resolve to non-existent files
        if (id.startsWith('@/')) {
          const resolved = resolve(projectRoot, 'packages/admin/src', id.slice(2));
          const extensions = ['.ts', '.tsx', '.js', '.jsx', ''];
          const exists = extensions.some(ext => existsSync(resolved + ext))
            || extensions.some(ext => existsSync(resolve(resolved, 'index' + ext)));
          if (!exists) {
            console.warn(`[gatewaze-modules] Stubbing missing @/ import "${id}" from module`);
            return `\0stub:${id}`;
          }
        }

        // Resolved absolute paths that don't exist (after alias resolution by other plugins)
        if (id.startsWith('/') && !id.includes('node_modules')) {
          const extensions = ['', '.ts', '.tsx', '.js', '.jsx'];
          const fileExists = extensions.some(ext => existsSync(id + ext))
            || extensions.some(ext => existsSync(resolve(id, 'index' + ext)));
          if (!fileExists) {
            console.warn(`[gatewaze-modules] Stubbing missing resolved path "${id}" from module`);
            return `\0stub:${id}`;
          }
        }
      }
    },

    load(id) {
      // Return empty module for stubbed packages — MUST be first check
      if (id.startsWith('\0stub:')) {
        if (id.endsWith('.css')) return '';
        return { code: 'export default {};', syntheticNamedExports: true };
      }
      // Virtual module for gatewaze-modules
      if (id === RESOLVED_ID) {
        const configPath = resolve(projectRoot, 'gatewaze.config.ts');
        const { moduleIds: explicitIds, sources } = parseConfig(configPath);
        const resolvedSources = resolveSources(sources, projectRoot);
        const moduleIds = explicitIds.length > 0
          ? explicitIds
          : discoverModulesFromSources(resolvedSources);

        if (moduleIds.length === 0) {
          return 'export default [];\n';
        }

        const imports: string[] = [];
        const refs: string[] = [];
        const cssImports: string[] = [];

        for (let i = 0; i < moduleIds.length; i++) {
          const moduleId = moduleIds[i];
          const importPath = resolveModuleImport(moduleId, resolvedSources, projectRoot);
          if (importPath) {
            imports.push(`import mod${i} from '${importPath}';`);
            refs.push(`mod${i}`);
            const moduleCssPath = resolveThemeCustomCss(importPath, resolvedSources, moduleId);
            if (moduleCssPath) {
              cssImports.push(`import '${moduleCssPath}';`);
              console.log(`[gatewaze-modules] Bundling theme CSS: ${moduleCssPath}`);
            }
          } else {
            console.warn(`[gatewaze-modules] Could not resolve module: ${moduleId}`);
          }
        }

        const guideAssignments: string[] = [];
        for (let i = 0; i < moduleIds.length; i++) {
          const moduleId = moduleIds[i];
          const slug = moduleId.replace(/^@gatewaze-modules\//, '');
          for (const sourceDir of resolvedSources) {
            const guidePath = resolve(sourceDir, slug, 'guide.md');
            if (existsSync(guidePath)) {
              const guideVarName = `guide${i}`;
              imports.push(`import ${guideVarName} from '${guidePath}?raw';`);
              guideAssignments.push(`mod${i}.guide = ${guideVarName};`);
              break;
            }
          }
        }

        return [
          ...imports,
          ...cssImports,
          ...guideAssignments,
          `export default [${refs.join(', ')}];`,
          '',
        ].join('\n');
      }
      // Catch resolved paths that don't exist on disk (e.g. @/ alias imports
      // from module files that point to admin components not in this build).
      // Only stub paths that look like source file imports (contain /app/, /packages/, or /gatewaze-modules/).
      if (id.startsWith('/') && !id.includes('node_modules') && !id.includes('\0') &&
          (id.includes('/app/') || id.includes('/packages/') || id.includes('gatewaze-modules'))) {
        // Check if file exists with any extension
        const extensions = ['', '.ts', '.tsx', '.js', '.jsx'];
        const fileExists = extensions.some(ext => {
          try { return existsSync(id + ext); } catch { return false; }
        }) || extensions.some(ext => {
          try { return existsSync(resolve(id, 'index' + ext)); } catch { return false; }
        });
        if (!fileExists) {
          console.warn(`[gatewaze-modules] Stubbing missing resolved path: ${id}`);
          if (id.endsWith('.css')) return '';
        return { code: 'export default {};', syntheticNamedExports: true };
        }
      }
    },

    // Rewrite imports from missing files in .gatewaze-modules source files.
    // Instead of stubbing at the module level, we transform the importer to
    // replace broken import statements with inline no-op declarations.
    transform(code, id) {
      if (!id.includes('gatewaze-modules')) return;

      const fileDir = dirname(id);
      // Match all import statements with named imports from relative paths
      const importRe = /import\s*\{([^}]+)\}\s*from\s*['"](\.[^'"]+)['"]\s*;?/g;
      let modified = false;
      let result = code;

      for (const match of code.matchAll(importRe)) {
        const [fullMatch, specifiers, importPath] = match;
        const candidate = resolve(fileDir, importPath);
        const extensions = ['', '.ts', '.tsx', '.js', '.jsx'];
        const found = extensions.some(ext => existsSync(candidate + ext))
          || extensions.some(ext => existsSync(resolve(candidate, 'index' + ext)));

        if (!found) {
          // Parse the named imports and generate inline no-op stubs
          const stubs: string[] = [];
          for (const spec of specifiers.split(',')) {
            const trimmed = spec.trim();
            if (!trimmed) continue;
            if (trimmed.startsWith('type ')) continue;
            // Handle "Foo as Bar" — declare as Bar
            const asMatch = trimmed.match(/^(\w+)\s+as\s+(\w+)$/);
            const localName = asMatch ? asMatch[2] : trimmed;
            stubs.push(`const ${localName} = (() => {}) as any;`);
          }
          const replacement = `/* [gatewaze-modules] stubbed missing: ${importPath} */\n${stubs.join('\n')}`;
          result = result.replace(fullMatch, replacement);
          modified = true;
          console.warn(`[gatewaze-modules] Stubbed missing import "${importPath}" in ${relative(projectRoot, id)} → [${stubs.length} exports]`);
        }
      }

      if (modified) return { code: result, map: null };
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
      // Check if repo was already cloned by the Docker entrypoint (symlinked at /<reponame>)
      const repoName = url.replace(/.*\//, '').replace(/\.git$/, '');
      const symlinkedPath = resolve('/', repoName);
      const localSiblingPath = resolve(projectRoot, '..', repoName);
      const preClonedPath = existsSync(symlinkedPath) ? symlinkedPath
        : existsSync(localSiblingPath) ? localSiblingPath
        : null;

      if (preClonedPath) {
        const fullPath = subPath ? resolve(preClonedPath, subPath) : preClonedPath;
        if (existsSync(fullPath)) {
          resolved.push(fullPath);
          continue;
        }
      }

      // Fall back to cloning
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
 * Scan all modules for admin/utils/*.ts files and build a map of
 * @/utils/<name> → absolute path aliases. When multiple modules export
 * the same util name, the first one found wins (source order matters).
 */
function discoverModuleUtilAliases(resolvedSources: string[]): Record<string, string> {
  const adminSrcUtils = resolve(__dirname, 'src/utils');
  const aliases: Record<string, string> = {};

  for (const sourceDir of resolvedSources) {
    if (!existsSync(sourceDir)) continue;

    const modules = readdirSync(sourceDir, { withFileTypes: true });
    for (const mod of modules) {
      if (!mod.isDirectory() || mod.name.startsWith('_') || mod.name.startsWith('.')) continue;

      const utilsDir = resolve(sourceDir, mod.name, 'admin', 'utils');
      if (!existsSync(utilsDir)) continue;

      const utilFiles = readdirSync(utilsDir, { withFileTypes: true });
      for (const file of utilFiles) {
        if (!file.isFile() || !file.name.endsWith('.ts')) continue;

        const utilName = file.name.replace(/\.ts$/, '');
        const aliasKey = `@/utils/${utilName}`;
        const aliasTarget = resolve(utilsDir, file.name);

        // Skip if the admin app already has this file (app takes precedence)
        if (existsSync(resolve(adminSrcUtils, file.name))) continue;

        if (!aliases[aliasKey]) {
          aliases[aliasKey] = aliasTarget;
        }
      }
    }
  }

  return aliases;
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
 * Check if a module's index.ts declares a themeOverrides.admin.customCss path.
 * If so, resolve it to an absolute path relative to the module directory.
 *
 * This is a lightweight static parse — it looks for `customCss:` in the source
 * file and extracts the string value. No actual TS execution is involved.
 */
function resolveThemeCustomCss(
  importPath: string,
  _resolvedSources: string[],
  _moduleId: string,
): string | null {
  try {
    const moduleDir = dirname(importPath);
    const content = readFileSync(importPath, 'utf-8');

    // Look for customCss: './path/to/file.css' or customCss: "../path/to/file.css"
    const match = content.match(/customCss\s*:\s*['"]([^'"]+)['"]/);
    if (!match) return null;

    const cssRelPath = match[1];
    const cssAbsPath = resolve(moduleDir, cssRelPath);
    if (existsSync(cssAbsPath)) {
      return cssAbsPath;
    }

    console.warn(`[gatewaze-modules] Theme customCss not found: ${cssAbsPath}`);
    return null;
  } catch {
    return null;
  }
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
    // Strip single-line comments but preserve URLs (https://)
    const content = rawContent.replace(/\r/g, '').replace(/(?<![:'"])\/\/.*$/gm, '');

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
      let sourcesBody = sourcesMatch[1];

      // Parse object-style entries first: { url: '...', path: '...', branch: '...' }
      const objMatches = sourcesBody.matchAll(
        /\{\s*url\s*:\s*['"]([^'"]+)['"]\s*(?:,\s*path\s*:\s*['"]([^'"]+)['"])?\s*(?:,\s*branch\s*:\s*['"]([^'"]+)['"])?\s*\}/g
      );
      for (const m of objMatches) {
        sources.push({
          url: m[1],
          path: m[2] || undefined,
          branch: m[3] || undefined,
        });
      }

      // Strip object entries so their inner strings aren't matched as bare sources
      const bareBody = sourcesBody.replace(/\{[^}]*\}/g, '');
      const strings = bareBody.match(/['"]([^'"]+)['"]/g);
      if (strings) {
        for (const s of strings) {
          sources.push(normalizeSource(s.slice(1, -1)));
        }
      }
    }

    // Default source if none specified
    if (sources.length === 0) {
      sources.push({ url: '../gatewaze-modules/modules' });
    }

    // Also read EXTRA_MODULE_SOURCES env var (comma-separated paths).
    // The gatewaze.config.ts uses a runtime spread for this, which the
    // static parser can't evaluate, so we read it directly from the env.
    const extraSources = process.env.EXTRA_MODULE_SOURCES;
    if (extraSources) {
      for (const s of extraSources.split(',').map(p => p.trim()).filter(Boolean)) {
        sources.push(normalizeSource(s));
      }
    }

    return { moduleIds, sources };
  } catch {
    return { moduleIds: [], sources: [] };
  }
}

