#!/usr/bin/env node
// Aggregate non-platform `dependencies` from every module under
// /app/.gatewaze-modules/*/modules/*/package.json and merge them into
// the target package.json (default: /app/packages/api/package.json).
//
// Used at image-build (PREBUILD) time by:
//   - docker/api/entrypoint.sh    (target: /app/packages/api/package.json, pnpm)
//   - docker/worker/Dockerfile    (target: /app/scripts/package.json,    npm)
//   - docker/scheduler/Dockerfile (target: /app/scripts/package.json,    npm)
//
// Why this exists: modules can declare server-side npm deps (openai,
// ws, ...) that aren't in any of the image's base package.json files.
// At runtime the api/worker/scheduler all `require()` module code,
// Node's resolver walks up from the cloned module path, and any
// unresolvable dep takes down the whole module-route loader. Pre-
// merging the deps + reinstalling at build time means /app/node_modules
// has everything the modules need.
//
// Scopes deliberately skipped:
//   - @gatewaze/*           - workspace siblings (resolved via symlinks
//                             or workspace, never npm)
//   - @gatewaze-modules/*   - sibling modules (same)
// Skipping these stops the install from trying to fetch them from a
// private registry it isn't authed for ("No authorization header").

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const targetPath = process.argv[2] || '/app/packages/api/package.json';

// Roots that may contain modules, in two possible layouts:
//   - slug layout:   <root>/<slug>/modules/<name>/package.json   (git-clone cache)
//   - direct layout: <root>/modules/<name>/package.json          (bind-mounted source)
// Prod PREBUILD only has /app/.gatewaze-modules (slug layout); local dev
// bind-mounts the sibling repos (direct layout). existsSync skips absent
// roots, so this stays backward-compatible with the build-time callers.
// Override with MODULE_DEP_SCAN_ROOTS (colon-separated) if needed.
const DEFAULT_ROOTS = [
  '/app/.gatewaze-modules',
  '/gatewaze-modules',
  '/lf-gatewaze-modules',
  '/premium-gatewaze-modules',
];
const roots = (process.env.MODULE_DEP_SCAN_ROOTS
  ? process.env.MODULE_DEP_SCAN_ROOTS.split(':')
  : DEFAULT_ROOTS
).filter((r) => r && existsSync(r));

// Module-id scoping (SE-runner split): images that must NOT carry a module's deps exclude it
// (standard worker: MODULE_DEPS_EXCLUDE=software-engineer keeps the agent toolchain out — the
// pre-SE parity guarantee); a dedicated runner bakes only its own module (MODULE_DEPS_ONLY).
// Ids are the module DIRECTORY names under <root>/modules/. Both unset → aggregate everything.
const csvIds = (v) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const ONLY_MODULES = csvIds(process.env.MODULE_DEPS_ONLY);
const EXCLUDE_MODULES = csvIds(process.env.MODULE_DEPS_EXCLUDE);
function moduleIncluded(modName) {
  if (ONLY_MODULES.length && !ONLY_MODULES.includes(modName)) return false;
  return !EXCLUDE_MODULES.includes(modName);
}

if (roots.length === 0) {
  console.log('[aggregate-module-deps] No module roots present; nothing to aggregate.');
  process.exit(0);
}

if (!existsSync(targetPath)) {
  console.error(`[aggregate-module-deps] Target package.json not found: ${targetPath}`);
  process.exit(1);
}

// Every <name>/package.json under a root, covering both layouts.
function moduleManifests(root) {
  const modulesDirs = [];
  if (existsSync(join(root, 'modules'))) modulesDirs.push(join(root, 'modules')); // direct
  for (const entry of readdirSync(root)) {                                        // slug
    const md = join(root, entry, 'modules');
    if (existsSync(md)) modulesDirs.push(md);
  }
  const out = [];
  for (const md of modulesDirs) {
    for (const modName of readdirSync(md)) {
      if (!moduleIncluded(modName)) {
        console.log(`[aggregate-module-deps] Skipping module "${modName}" (MODULE_DEPS_ONLY/EXCLUDE scope)`);
        continue;
      }
      const pkgPath = join(md, modName, 'package.json');
      if (existsSync(pkgPath)) out.push(pkgPath);
    }
  }
  return out;
}

const deps = new Map();
for (const root of roots) {
  for (const pkgPath of moduleManifests(root)) {
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    } catch (e) {
      console.error(`[aggregate-module-deps] Skip ${pkgPath}: ${e.message}`);
      continue;
    }
    if (!pkg.dependencies) continue;
    for (const [name, ver] of Object.entries(pkg.dependencies)) {
      if (name.startsWith('@gatewaze/') || name.startsWith('@gatewaze-modules/')) continue;
      // First-seen wins. Version conflicts across modules are uncommon
      // in practice; when they happen, the operator can pin in the
      // target package.json by hand.
      if (!deps.has(name)) deps.set(name, ver);
    }
  }
}

const targetPkg = JSON.parse(readFileSync(targetPath, 'utf8'));
targetPkg.dependencies = targetPkg.dependencies ?? {};
let added = 0;
for (const [name, ver] of deps) {
  if (targetPkg.dependencies[name]) continue;
  targetPkg.dependencies[name] = ver;
  added++;
}
writeFileSync(targetPath, JSON.stringify(targetPkg, null, 2) + '\n');
console.log(
  `[aggregate-module-deps] Merged ${added} module deps into ${targetPath} ` +
  `(total deps: ${Object.keys(targetPkg.dependencies).length})`,
);
