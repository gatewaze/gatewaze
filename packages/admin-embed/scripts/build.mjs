/**
 * Builds the publishable @gatewaze/admin-embed loader.
 *
 * src/index.ts imports the host contract straight from
 * packages/admin/src/embed/types.ts (type-only) and the build stamps
 * EMBED_CONTRACT from packages/admin/src/embed/contract.ts, so the published
 * package cannot drift from what the embed implements and nothing is
 * hand-written twice. tsc emits under build/ with the monorepo layout; this
 * script flattens that into dist/: one self-contained index.js, index.d.ts,
 * and a verbatim copy of types.ts as types.d.ts (it is import-free and
 * types-only, so the copy is a valid declaration file).
 *
 *   node scripts/build.mjs          # compile, flatten, stamp
 *   node scripts/build.mjs --check  # type-check only, nothing emitted
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const embedSrc = resolve(pkgRoot, '../admin/src/embed');
const build = resolve(pkgRoot, 'build');
const dist = resolve(pkgRoot, 'dist');
const checkOnly = process.argv.includes('--check');

const contractSrc = readFileSync(resolve(embedSrc, 'contract.ts'), 'utf8');
const contractMatch = contractSrc.match(/export const EMBED_CONTRACT = (\d+);/);
if (!contractMatch) {
  console.error('[admin-embed] could not read EMBED_CONTRACT from packages/admin/src/embed/contract.ts');
  process.exit(1);
}
const contract = contractMatch[1];

// TypeScript comes from the admin package (the same compiler that checks the
// contract's source), so this package declares no dependencies of its own.
const tsc = createRequire(resolve(pkgRoot, '../admin/package.json')).resolve('typescript/bin/tsc');
const args = ['-p', resolve(pkgRoot, 'tsconfig.json')];
if (checkOnly) args.push('--noEmit');
else { rmSync(build, { recursive: true, force: true }); rmSync(dist, { recursive: true, force: true }); }
execFileSync(process.execPath, [tsc, ...args], { stdio: 'inherit' });
if (checkOnly) process.exit(0);

const { version } = JSON.parse(readFileSync(resolve(pkgRoot, 'package.json'), 'utf8'));
mkdirSync(dist, { recursive: true });

const js = readFileSync(resolve(build, 'packages/admin-embed/src/index.js'), 'utf8')
  .replace('__ADMIN_EMBED_VERSION__', JSON.stringify(version))
  .replace('__EMBED_CONTRACT__', contract);
if (/__ADMIN_EMBED_VERSION__|__EMBED_CONTRACT__|^import /m.test(js)) {
  console.error('[admin-embed] dist/index.js must be self-contained with both placeholders stamped');
  process.exit(1);
}
writeFileSync(resolve(dist, 'index.js'), js);

const dts = readFileSync(resolve(build, 'packages/admin-embed/src/index.d.ts'), 'utf8')
  .replaceAll("'../../admin/src/embed/types'", "'./types'");
if (dts.includes('../../admin/')) {
  console.error('[admin-embed] dist/index.d.ts still references the monorepo');
  process.exit(1);
}
writeFileSync(resolve(dist, 'index.d.ts'), dts);
copyFileSync(resolve(embedSrc, 'types.ts'), resolve(dist, 'types.d.ts'));
rmSync(build, { recursive: true, force: true });
console.log(`[admin-embed] built ${dist} (loader ${version}, contract ${contract})`);
