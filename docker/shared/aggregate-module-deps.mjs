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

const MODULE_ROOT = '/app/.gatewaze-modules';
const targetPath = process.argv[2] || '/app/packages/api/package.json';

if (!existsSync(MODULE_ROOT)) {
  console.log(`[aggregate-module-deps] No ${MODULE_ROOT}; nothing to aggregate.`);
  process.exit(0);
}

if (!existsSync(targetPath)) {
  console.error(`[aggregate-module-deps] Target package.json not found: ${targetPath}`);
  process.exit(1);
}

const deps = new Map();
for (const slug of readdirSync(MODULE_ROOT)) {
  const modulesPath = join(MODULE_ROOT, slug, 'modules');
  if (!existsSync(modulesPath)) continue;
  for (const modName of readdirSync(modulesPath)) {
    const pkgPath = join(modulesPath, modName, 'package.json');
    if (!existsSync(pkgPath)) continue;
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
