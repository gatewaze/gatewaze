// Dev-only: clone the git module sources BEFORE module deps are aggregated.
//
// Why this exists. dev-install-module-deps.sh aggregates each module's npm
// dependencies and installs the missing ones into /app/node_modules. It scans
// /app/.gatewaze-modules, which is where the app clones git module sources at
// runtime. On a first boot that directory is an empty volume, because nothing
// has cloned into it yet, so the aggregation finds no modules, installs
// nothing, and the app then clones 80+ modules whose dependencies are absent.
// Every module importing openai, cheerio, @supabase/supabase-js or the agent
// SDK fails to register with MODULE_NOT_FOUND, and the container still reports
// healthy, so nothing surfaces it. Restarting the container fixes it, because
// by then the clone is on the volume.
//
// So: clone first, then aggregate, and a first boot behaves like every later
// boot. The prod images do not need this. They aggregate at build time over
// sources cloned during PREBUILD.
//
// This is best effort by design. Any failure here leaves the old behaviour
// intact rather than blocking startup, because the app clones the same sources
// itself a moment later.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PROJECT_ROOT = process.env.GATEWAZE_PROJECT_ROOT || '/app';
const CACHE_DIR = resolve(PROJECT_ROOT, '.gatewaze-modules');
const CONFIG_PATH = resolve(PROJECT_ROOT, 'gatewaze.config.ts');

// Matches loader.ts BRANCH_RE intent: no argv injection through --branch.
const BRANCH_RE = /^[A-Za-z0-9._\-\/]{1,255}$/;

const log = (msg) => console.log(`[prefetch-modules] ${msg}`);

function isGitUrl(url) {
  return (
    url.startsWith('https://') ||
    url.startsWith('git://') ||
    url.startsWith('git@') ||
    url.endsWith('.git')
  );
}

// Must match cloneOrUpdateRepo() in packages/shared/src/modules/loader.ts, or
// the app will clone a second copy under a different directory name and this
// whole step buys nothing.
function repoSlug(gitUrl) {
  return gitUrl
    .replace(/^(https?:\/\/|git:\/\/|git@)/, '')
    .replace(/\.git$/, '')
    .replace(/[^a-zA-Z0-9-]/g, '-');
}

// MODULE_SOURCES: comma-separated `url[#branch=X&path=Y]`, same format the
// loader, the Vite plugin and the portal registry script all accept.
function fromEnv() {
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
      return { url, branch: params.get('branch') ?? undefined };
    });
}

// gatewaze.config.ts is TypeScript, so it cannot be imported from plain node
// here. Read the moduleSources array textually and pull out the git URLs. A
// missed entry costs nothing: the app still clones it, we just do not get the
// dependency install one boot earlier.
function fromConfig() {
  if (!existsSync(CONFIG_PATH)) return [];
  let src;
  try {
    src = readFileSync(CONFIG_PATH, 'utf8');
  } catch {
    return [];
  }

  const start = src.indexOf('moduleSources');
  if (start === -1) return [];
  const open = src.indexOf('[', start);
  if (open === -1) return [];
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) return [];

  // Strip comments so a commented-out example URL is not treated as a source.
  const block = src
    .slice(open, end + 1)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1');

  const out = [];

  // Object form: { url: '...', branch: '...' }
  for (const m of block.matchAll(/\{[^{}]*\}/g)) {
    const obj = m[0];
    const url = obj.match(/url\s*:\s*['"`]([^'"`]+)['"`]/)?.[1];
    if (!url) continue;
    const branch = obj.match(/branch\s*:\s*['"`]([^'"`]+)['"`]/)?.[1];
    out.push({ url, branch });
  }

  // Bare string form: 'https://host/org/repo.git#branch=main'
  const withoutObjects = block.replace(/\{[^{}]*\}/g, '');
  for (const m of withoutObjects.matchAll(/['"`]([^'"`]+)['"`]/g)) {
    const [url, fragment] = m[1].split('#');
    if (!isGitUrl(url)) continue;
    const branch = fragment
      ? new URLSearchParams(fragment).get('branch') ?? undefined
      : undefined;
    out.push({ url, branch });
  }

  return out;
}

function main() {
  const sources = [...fromEnv(), ...fromConfig()].filter((s) => s.url && isGitUrl(s.url));
  if (sources.length === 0) {
    log('no git module sources to prefetch.');
    return;
  }

  mkdirSync(CACHE_DIR, { recursive: true });

  const seen = new Set();
  for (const { url, branch } of sources) {
    const slug = repoSlug(url);
    if (seen.has(slug)) continue;
    seen.add(slug);

    const dir = resolve(CACHE_DIR, slug);
    if (existsSync(resolve(dir, '.git'))) {
      log(`already cloned: ${slug}`);
      continue;
    }

    if (branch && !BRANCH_RE.test(branch)) {
      log(`refusing to clone with invalid branch: ${branch}`);
      continue;
    }

    // A private source needs a token this container does not hold. That is a
    // normal outcome, not an error: skip it and let the app try.
    const args = ['clone', '--depth', '1'];
    if (branch) args.push('--branch', branch);
    args.push(url, dir);

    try {
      log(`cloning ${url}${branch ? ` (${branch})` : ''} -> ${slug}`);
      execFileSync('git', args, { stdio: 'pipe', timeout: 180_000 });
      log(`cloned ${slug}`);
    } catch (err) {
      const detail = (err?.stderr?.toString?.() || err?.message || '').trim().split('\n')[0];
      log(`could not clone ${url} (continuing): ${detail}`);
    }
  }
}

try {
  main();
} catch (err) {
  // Never block container startup on this.
  log(`prefetch failed (continuing): ${err?.message ?? err}`);
}
