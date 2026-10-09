/**
 * Prints one JSON line describing the commit (and dirty-checkout state) behind a HELF build: the
 * public app-shell commit and the private module checkout commit. A release script uses this to form
 * the (platformSha, moduleSha) pair it checks against health-core's dedup endpoint before building, and
 * to refuse treating an uncommitted edit as part of a build's recorded provenance.
 *
 * Usage: node scripts/release-provenance.mjs [--platform-path=<dir>] [--module-path=<dir>]
 * Env:   MOBILE_MODULE_SOURCES / MODULE_SOURCES — the same vars scripts/generate-mobile-registry.ts
 *        reads; the first comma-separated entry (stripped of any #fragment) is treated as the module
 *        checkout, unless --module-path overrides it.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const m = /^--(platform-path|module-path)=(.+)$/.exec(arg);
    if (m) out[m[1] === 'platform-path' ? 'platformPath' : 'modulePath'] = m[2];
  }
  return out;
}

export function firstModuleSourcePath(envValue) {
  const first = (envValue || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)[0];
  if (!first) return null;
  return first.split('#')[0];
}

/**
 * Returns { sha, dirty } for the git repo containing dirPath. Any failure — a missing path, a path that
 * isn't a git checkout, git itself erroring — returns { sha: null, dirty: true }. Never eligible is the
 * safe default when provenance can't be determined.
 */
export function gitInfo(dirPath, exec = execFileSync) {
  if (!dirPath) return { sha: null, dirty: true };
  try {
    const root = exec('git', ['-C', dirPath, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
    const sha = exec('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const status = exec('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' });
    return { sha, dirty: status.trim().length > 0 };
  } catch {
    return { sha: null, dirty: true };
  }
}

export function resolveProvenance({ platformPath, modulePath, exec = execFileSync } = {}) {
  const platform = gitInfo(platformPath, exec);
  const moduleInfo = gitInfo(modulePath, exec);
  return {
    platformSha: platform.sha,
    platformDirty: platform.dirty,
    moduleSha: moduleInfo.sha,
    moduleDirty: moduleInfo.dirty,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const platformPath = args.platformPath || resolve(__dirname, '..');
  const modulePath =
    args.modulePath || firstModuleSourcePath(process.env.MOBILE_MODULE_SOURCES || process.env.MODULE_SOURCES);
  console.log(JSON.stringify(resolveProvenance({ platformPath, modulePath })));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
