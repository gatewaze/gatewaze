import type { Plugin } from 'vite';
import { readFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve, dirname, isAbsolute, relative } from 'path';
import { execSync } from 'child_process';
import { createRequire, isBuiltin } from 'module';

const VIRTUAL_MODULE_ID = 'virtual:gatewaze-modules';
const RESOLVED_ID = '\0' + VIRTUAL_MODULE_ID;

/**
 * Every package admin has as a direct dependency — these are always
 * handed back to Vite (return undefined from resolveId) rather than
 * pre-resolved to an absolute filesystem path. Vite pre-bundles these
 * via optimizeDeps + the React plugin; resolving them ourselves serves
 * the raw CJS file via /@fs/ and loses named exports (e.g. `jsxDEV`,
 * `parse`, `splitCookiesString`, `Tab`).
 *
 * Built dynamically from packages/admin/package.json so adding a dep
 * doesn't require a plugin edit.
 */
function buildVitePreBundledSet(adminDir: string): Set<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = JSON.parse(readFileSync(resolve(adminDir, 'package.json'), 'utf-8'));
    const names = new Set<string>();
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
      if (pkg[field]) for (const name of Object.keys(pkg[field])) names.add(name);
    }
    return names;
  } catch {
    return new Set();
  }
}

function isVitePreBundled(id: string, preBundledSet: Set<string>): boolean {
  if (preBundledSet.has(id)) return true;
  // Match `@scope/name/subpath` or `name/subpath` against direct dep names.
  const scoped = id.startsWith('@') ? id.split('/').slice(0, 2).join('/') : id.split('/')[0];
  return preBundledSet.has(scoped);
}

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

  // Node resolver rooted at the admin package so bare imports from module
  // files — which live at symlinked absolute paths outside /app — still
  // find deps in /app/node_modules. Without this, Vite's default walk-up
  // from the importer's real path fails for `import('pdf-lib')` etc.
  const adminRequire = createRequire(resolve(__dirname, 'package.json'));

  // Every package in admin/package.json → deferred to Vite's pre-bundler
  // so imports from module files route to the optimized .vite/deps/<pkg>
  // bundle (with CJS→ESM named-export wrapping) instead of /@fs/ raw.
  const preBundledDeps = buildVitePreBundledSet(__dirname);

  // In `vite build` there is no esbuild pre-bundle cache to defer to, so
  // deferring leaves Rollup to resolve the bare specifier from the
  // importer's real path — which for module files symlinked outside /app
  // walks up and never reaches admin/node_modules. The result is a raw
  // `from "react-leaflet"` in the emitted chunk. Track the mode so build
  // always hands Rollup a concrete path.
  let isBuild = false;

  return {
    name: 'gatewaze-modules',
    enforce: 'pre',

    configResolved(config) {
      isBuild = config.command === 'build';
    },

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
        // Bare package imports (react-leaflet, pdf-lib, etc.).
        // Module files live at symlinked absolute paths outside /app, so
        // Vite's default resolver walks up from there and can't see
        // /app/node_modules. Explicitly resolve via adminRequire so the
        // bundler gets a concrete file path to put in the graph —
        // otherwise dynamic imports like `import('pdf-lib')` get left as
        // literal strings in the output and the browser throws
        // "Failed to resolve module specifier".
        if (!id.startsWith('.') && !id.startsWith('/') && !id.startsWith('@/')) {
          // DEFER to Vite for packages it pre-bundles IN DEV ONLY.
          // Resolving these ourselves in dev hands the browser the raw
          // CJS file (served via /@fs/…) which loses named exports like
          // `jsxDEV`, `parse`, etc.; Vite's default resolution rewrites
          // to the optimized `/node_modules/.vite/deps/<pkg>.js` bundle.
          //
          // In build there's no pre-bundle cache. Deferring leaves
          // Rollup to resolve from the importer's real path, which for
          // symlinked module files walks up and never reaches
          // admin/node_modules — result: raw `from "react-leaflet"` in
          // the output. Fall through to adminRequire.resolve below.
          if (!isBuild && isVitePreBundled(id, preBundledDeps)) {
            return;
          }
          try {
            const pkgName = id.startsWith('@') ? id.split('/').slice(0, 2).join('/') : id.split('/')[0];
            // Node builtins (path, fs, crypto, …) — adminRequire.resolve()
            // returns the bare specifier verbatim because the runtime can
            // satisfy them. Vite then leaves `import "path"` literally in
            // the output, which the browser can't parse. Catch builtins
            // explicitly (with or without the `node:` prefix) and stub
            // them. The wider stubbing system already handles `node:foo`
            // transparently because no node_modules/<name> dir exists,
            // but the un-prefixed form leaks through.
            if (isBuiltin(id) || isBuiltin(pkgName)) {
              console.warn(`[gatewaze-modules] Stubbing Node builtin "${id}" imported from module`);
              return `\0stub:${id}`;
            }
            const pkgPath = resolve(projectRoot, 'node_modules', pkgName);
            const adminPkgPath = resolve(__dirname, 'node_modules', pkgName);
            if (!existsSync(pkgPath) && !existsSync(adminPkgPath)) {
              console.warn(`[gatewaze-modules] Stubbing unresolvable package "${id}" imported from module`);
              return `\0stub:${id}`;
            }
            try {
              return adminRequire.resolve(id);
            } catch {
              // require.resolve failed — fall through and let Vite try.
            }
          } catch {
            // Let Vite handle it normally
          }
        }
        // @/ alias imports that resolve to non-existent files
        if (id.startsWith('@/')) {
          // Check if a module util alias exists for this import first
          if (utilAliases[id]) {
            return utilAliases[id];
          }
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
            // Check if this is a module util that was resolved via the @/ prefix
            // but the file was removed from admin src (e.g. scraperService).
            // Reverse-map the absolute path back to an @/utils/<name> alias.
            const adminSrc = resolve(projectRoot, 'packages/admin/src');
            if (id.startsWith(adminSrc)) {
              const relativePath = id.slice(adminSrc.length); // e.g. /utils/scraperService
              const aliasKey = '@' + relativePath;
              if (utilAliases[aliasKey]) {
                return utilAliases[aliasKey];
              }
            }
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
          // Accept HMR updates silently. Without this, any filesystem event
          // under MODULE_SOURCES paths (including the live-tree symlink the
          // API server creates on enable/disable via installLiveSnapshot)
          // invalidates this virtual module — and because no importer
          // declares a hot.accept handler for it, Vite cascades to a full
          // page reload. The runtime source of truth for enabled modules is
          // the installed_modules DB table (read by ModulesProviderWrapper),
          // not this build-time list — so accepting silently is safe.
          // The empty callback means consumers keep their existing reference;
          // the React context refetch (refreshModulesContext) handles state.
          'if (import.meta.hot) import.meta.hot.accept(() => {});',
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
      // Local path — could be a Docker container absolute path (e.g. /premium-gatewaze-modules/modules)
      // or a relative path. If the absolute path doesn't exist, try resolving as a sibling directory.
      const absPath = isAbsolute(url) ? url : resolve(projectRoot, url);
      if (existsSync(absPath)) {
        resolved.push(subPath ? resolve(absPath, subPath) : absPath);
      } else {
        // Try sibling directory: /premium-gatewaze-modules/modules → ../premium-gatewaze-modules/modules
        const segments = url.replace(/^\//, '').split('/');
        const siblingPath = resolve(projectRoot, '..', ...segments);
        if (existsSync(siblingPath)) {
          resolved.push(subPath ? resolve(siblingPath, subPath) : siblingPath);
        }
        // else: path not found — skip silently (module source unavailable in this environment)
      }
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

    // Also read MODULE_SOURCES env var (comma-separated). Each entry can
    // be a git URL (optionally with `#branch=X&path=Y` fragment) or a
    // local absolute path — resolveSources() branches on isGitUrl(). In
    // production this is git URLs only; locally it may include mounted
    // paths like /premium-gatewaze-modules/modules.
    const extraSources = process.env.MODULE_SOURCES;
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

