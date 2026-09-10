/**
 * Generates the mobile module registry from configured module sources
 * (spec-mobile-app.md, "Module composition").
 *
 * Mirrors the portal's generate-module-registry.ts: module sources come
 * from gatewaze.config.ts `moduleSources` plus the MODULE_SOURCES /
 * MOBILE_MODULE_SOURCES env vars. A module opts in by shipping
 * `mobile/index.ts` exporting a GatewazeMobileModule manifest.
 *
 * Composition is strictly build-time (app stores do not allow fetching
 * native code at runtime), so this runs before every dev start, build and
 * typecheck. A run with no sources configured emits a valid EMPTY registry
 * — the open-source core must always build as a module-free shell.
 *
 * Outputs (all git-ignored):
 *   src/generated/mobile-modules.ts  — static imports of each manifest
 *   src/generated/mobile-dirs.json   — resolved source dirs (metro watchFolders)
 *   src/generated/capabilities.json  — union of requiredCapabilities (app.config.ts)
 *   src/generated/deletion-copy.json — moduleId → deletionCopy map
 *
 * It also enforces the native-capability and shared-dependency contract:
 * every import in a module's mobile/ code must be relative, or on the
 * allowlist (scripts/dep-allowlist.json), or capability-gated AND declared
 * in the module's requiredCapabilities. Any violation fails the build.
 *
 * Run: npx tsx scripts/generate-mobile-registry.ts
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
  mkdirSync,
} from 'fs';
import { resolve, dirname, isAbsolute, join } from 'path';
import { fileURLToPath } from 'url';
import ts from 'typescript';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load packages/mobile/.env the same way Expo CLI does, so MOBILE_MODULE_*
// vars work when the generator runs before expo in a script chain. Real
// environment variables win over .env values.
(() => {
  try {
    const envPath = resolve(__dirname, '../.env');
    if (!existsSync(envPath)) return;
    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m || line.trim().startsWith('#')) continue;
      if (process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  } catch {
    /* .env is optional */
  }
})();

const PACKAGE_ROOT = resolve(__dirname, '..');
const PROJECT_ROOT = resolve(__dirname, '../../..');
const GENERATED_DIR = resolve(PACKAGE_ROOT, 'src/generated');
const CONFIG_PATH = resolve(PROJECT_ROOT, 'gatewaze.config.ts');
const ALLOWLIST_PATH = resolve(__dirname, 'dep-allowlist.json');

interface SourceEntry {
  url: string;
  path?: string;
}

interface DiscoveredModule {
  id: string;
  dir: string; // absolute path to the module dir (containing mobile/)
  entry: string; // absolute path to mobile/index.ts
  capabilities: string[];
  deletionCopy?: string;
  /** Declares coachProvider — exactly one module may, across a build. */
  isCoachProvider: boolean;
}

function writeIfChanged(filePath: string, content: string): void {
  try {
    if (existsSync(filePath) && readFileSync(filePath, 'utf-8') === content) return;
  } catch {
    /* fall through to write */
  }
  writeFileSync(filePath, content, 'utf-8');
}

// ---------------------------------------------------------------------------
// Source resolution (config file + env; local paths only — a mobile build
// environment is expected to have its module sources checked out or mounted,
// the same way EAS/CI checks out the repos it builds from)
// ---------------------------------------------------------------------------

function normalizeSource(source: string): SourceEntry {
  const [url, fragment] = source.split('#');
  if (!fragment) return { url };
  const params = new URLSearchParams(fragment);
  return { url, path: params.get('path') ?? undefined };
}

function parseConfigSources(): SourceEntry[] {
  try {
    const rawContent = readFileSync(CONFIG_PATH, 'utf-8');
    // Strip line comments WITHOUT eating protocol '//' inside URLs (the
    // portal generator's version of this regex truncates 'https://…' and
    // silently falls back to its default source — fixed here).
    const content = rawContent.replace(/(^|[^:'"])\/\/.*$/gm, '$1');
    const sourcesMatch = content.match(/moduleSources\s*:\s*\[([\s\S]*?)\]/);
    const sources: SourceEntry[] = [];
    if (sourcesMatch) {
      const strings = sourcesMatch[1].match(/(?<![:\w])['"](\.{1,2}\/[^'"]+|\/[^'"]+)['"]/g);
      if (strings) {
        for (const s of strings) sources.push(normalizeSource(s.slice(1, -1)));
      }
      const objMatches = sourcesMatch[1].matchAll(
        /\{\s*url\s*:\s*['"]([^'"]+)['"]\s*(?:,\s*path\s*:\s*['"]([^'"]+)['"])?/g
      );
      for (const m of objMatches) {
        sources.push({ url: m[1], path: m[2] || undefined });
      }
    }
    return sources;
  } catch {
    return [];
  }
}

function isGitUrl(url: string): boolean {
  return (
    url.startsWith('https://') ||
    url.startsWith('git://') ||
    url.startsWith('git@') ||
    url.endsWith('.git')
  );
}

function resolveSources(sources: SourceEntry[]): string[] {
  const resolved: string[] = [];
  for (const source of sources) {
    if (source.url.includes('process.env') || /[\n\r]/.test(source.url)) continue;

    if (isGitUrl(source.url)) {
      // Prefer a pre-cloned sibling / mounted checkout, matching the
      // portal generator's convention. The mobile generator does not
      // clone: a build environment provides its sources.
      const repoName = source.url.replace(/.*\//, '').replace(/\.git$/, '');
      const candidates = [resolve('/', repoName), resolve(PROJECT_ROOT, '..', repoName)];
      const found = candidates.find((c) => existsSync(c));
      if (found) {
        const full = source.path ? resolve(found, source.path) : found;
        if (existsSync(full)) resolved.push(full);
      }
      continue;
    }

    const abs = isAbsolute(source.url) ? source.url : resolve(PROJECT_ROOT, source.url);
    const full = source.path ? resolve(abs, source.path) : abs;
    if (existsSync(full)) resolved.push(full);
  }
  return [...new Set(resolved)];
}

// ---------------------------------------------------------------------------
// Manifest discovery — parses SOURCE, never executes module code
// ---------------------------------------------------------------------------

function parseStringArray(src: string, field: string): string[] {
  const m = src.match(new RegExp(`${field}\\s*:\\s*\\[([^\\]]*)\\]`));
  if (!m) return [];
  const items = m[1].match(/['"]([^'"]+)['"]/g);
  return items ? items.map((s) => s.slice(1, -1)) : [];
}

function discoverModules(sourceDirs: string[], allowlist: string[] | null): DiscoveredModule[] {
  const modules: DiscoveredModule[] = [];
  const seen = new Set<string>();

  for (const sourceDir of sourceDirs) {
    let moduleDirs: string[];
    try {
      moduleDirs = readdirSync(sourceDir).filter((name) => {
        if (name.startsWith('.') || name.startsWith('_') || name === 'node_modules') return false;
        try {
          return statSync(resolve(sourceDir, name)).isDirectory();
        } catch {
          return false;
        }
      });
    } catch {
      continue;
    }

    for (const moduleDir of moduleDirs) {
      // Directory names and ids feed generated source and k8s-ish naming;
      // enforce the platform's safe-id shape before anything else touches
      // them (mirrors shared/modules loader's validation; also prevents a
      // crafted name from breaking out of the generated import string).
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(moduleDir)) {
        console.warn(`[generate-mobile-registry] Skipping unsafe module dir name: ${JSON.stringify(moduleDir)}`);
        continue;
      }
      const entry = resolve(sourceDir, moduleDir, 'mobile', 'index.ts');
      if (!existsSync(entry)) continue;

      let src: string;
      try {
        src = readFileSync(entry, 'utf-8');
      } catch {
        continue;
      }

      const idMatch = src.match(/\bid\s*:\s*['"]([^'"]+)['"]/);
      const id = idMatch ? idMatch[1] : moduleDir;
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) {
        console.warn(`[generate-mobile-registry] Skipping module with unsafe id: ${JSON.stringify(id)}`);
        continue;
      }
      if (seen.has(id)) continue;
      if (allowlist && !allowlist.includes(id)) continue;
      seen.add(id);

      const capabilities = parseStringArray(src, 'requiredCapabilities');
      const copyMatch = src.match(/deletionCopy\s*:\s*['"]([^'"]+)['"]/);

      modules.push({
        id,
        dir: resolve(sourceDir, moduleDir),
        entry,
        capabilities,
        deletionCopy: copyMatch ? copyMatch[1] : undefined,
        isCoachProvider: /\bcoachProvider\s*:/.test(src),
      });
    }
  }

  return modules.sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// Import audit — the native-capability + shared-dependency contract
// ---------------------------------------------------------------------------

interface Allowlist {
  allowed: string[];
  capabilityGated: Record<string, string[]>;
}

function loadAllowlist(): Allowlist {
  const raw = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf-8'));
  return { allowed: raw.allowed ?? [], capabilityGated: raw.capabilityGated ?? {} };
}

function packageOf(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function walkFiles(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkFiles(full, out);
    else if (/\.(tsx?|jsx?)$/.test(entry)) out.push(full);
  }
}

/**
 * Import audit — a stated security control, so it is an AST walk, not a
 * regex (regexes are bypassable via side-effect imports, template-literal
 * requires, concatenation, comments, or variables). Every import form is
 * covered, and a NON-LITERAL specifier (`require(x)`, `import(a + b)`) is
 * itself a violation rather than something the audit silently skips.
 */
function collectSpecifiers(
  file: string,
  src: string,
  onSpec: (spec: string) => void,
  onNonLiteral: (desc: string) => void
): void {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  const specOf = (expr: ts.Expression): string | null => {
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text;
    return null;
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) {
        const spec = specOf(node.moduleSpecifier as ts.Expression);
        if (spec !== null) onSpec(spec);
        else onNonLiteral(node.getText(sf).slice(0, 80));
      }
    } else if (ts.isCallExpression(node)) {
      const isRequire =
        ts.isIdentifier(node.expression) && node.expression.text === 'require';
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      if (isRequire || isDynamicImport) {
        const arg = node.arguments[0];
        const spec = arg ? specOf(arg) : null;
        if (spec !== null) onSpec(spec);
        else onNonLiteral(node.getText(sf).slice(0, 80));
      }
    } else if (ts.isImportEqualsDeclaration(node)) {
      const ref = node.moduleReference;
      if (ts.isExternalModuleReference(ref) && ref.expression) {
        const spec = specOf(ref.expression);
        if (spec !== null) onSpec(spec);
        else onNonLiteral(node.getText(sf).slice(0, 80));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

function auditModuleImports(mod: DiscoveredModule, allowlist: Allowlist): string[] {
  const violations: string[] = [];
  const files: string[] = [];
  walkFiles(resolve(mod.dir, 'mobile'), files);

  for (const file of files) {
    let src: string;
    try {
      src = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    collectSpecifiers(
      file,
      src,
      (spec) => {
        if (spec.startsWith('.') || spec.startsWith('@/')) return; // relative / core alias
        const pkg = packageOf(spec);
        if (allowlist.allowed.includes(pkg)) return;
        const gates = allowlist.capabilityGated[pkg];
        if (gates !== undefined) {
          const declared = gates.length === 0 || gates.some((c) => mod.capabilities.includes(c));
          if (declared) return;
          violations.push(
            `${file}: imports '${pkg}' but module '${mod.id}' does not declare a required capability (${gates.join(' | ')})`
          );
          return;
        }
        violations.push(
          `${file}: imports '${pkg}', which is outside the mobile dependency allowlist (scripts/dep-allowlist.json)`
        );
      },
      (desc) => {
        violations.push(
          `${file}: non-literal import/require specifier is not allowed (audit cannot verify it): ${desc}`
        );
      }
    );
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

function generate(): void {
  const envSources = (process.env.MOBILE_MODULE_SOURCES || process.env.MODULE_SOURCES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normalizeSource);

  const allowlistIds = (process.env.MOBILE_MODULE_ALLOWLIST || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const sourceDirs = resolveSources([...parseConfigSources(), ...envSources]);
  const depAllowlist = loadAllowlist();
  const modules = discoverModules(sourceDirs, allowlistIds.length ? allowlistIds : null);

  // Exactly one module may drive the coach conversation. Two providers
  // would mean two owners of the same surface, with no rule for choosing.
  const providers = modules.filter((m) => m.isCoachProvider);
  if (providers.length > 1) {
    console.error(
      `[generate-mobile-registry] More than one module declares coachProvider: ${providers
        .map((m) => m.id)
        .join(', ')}. Exactly one module may own the coach conversation.`
    );
    process.exit(1);
  }

  const allViolations = modules.flatMap((m) => auditModuleImports(m, depAllowlist));
  if (allViolations.length > 0) {
    console.error('[generate-mobile-registry] Dependency contract violations:\n');
    for (const v of allViolations) console.error(`  ✗ ${v}`);
    console.error(
      '\nModule mobile code may import only relative paths, @/ core aliases, and the allowlisted packages.'
    );
    process.exit(1);
  }

  mkdirSync(GENERATED_DIR, { recursive: true });

  const imports = modules
    .map(
      (m, i) =>
        // JSON.stringify the specifier: no hand-spliced quotes into
        // generated source, so a hostile path cannot inject code.
        `import { mobileModule as m${i} } from ${JSON.stringify(m.entry.replace(/\.ts$/, ''))};`
    )
    .join('\n');
  const list = modules.map((_, i) => `m${i}`).join(', ');

  const registry = `// AUTO-GENERATED — do not edit manually
// Run: npx tsx scripts/generate-mobile-registry.ts
/* eslint-disable */

import type { GatewazeMobileModule } from '@gatewaze/shared';

${imports}

export const mobileModules: GatewazeMobileModule[] = [${list}];
`;

  writeIfChanged(resolve(GENERATED_DIR, 'mobile-modules.ts'), registry);

  const dirs = [...new Set(modules.map((m) => m.dir))];
  writeIfChanged(resolve(GENERATED_DIR, 'mobile-dirs.json'), JSON.stringify(dirs, null, 2));

  const capabilities = [...new Set(modules.flatMap((m) => m.capabilities))].sort();
  writeIfChanged(
    resolve(GENERATED_DIR, 'capabilities.json'),
    JSON.stringify(capabilities, null, 2)
  );

  const deletionCopy = Object.fromEntries(
    modules.filter((m) => m.deletionCopy).map((m) => [m.id, m.deletionCopy])
  );
  writeIfChanged(
    resolve(GENERATED_DIR, 'deletion-copy.json'),
    JSON.stringify(deletionCopy, null, 2)
  );

  console.log(
    `[generate-mobile-registry] ${modules.length} mobile module(s) from ${sourceDirs.length} source dir(s); capabilities: [${capabilities.join(', ')}]; coach provider: ${providers[0]?.id ?? 'none'}`
  );
  for (const m of modules) console.log(`  ${m.id}: ${m.dir}`);
}

generate();
