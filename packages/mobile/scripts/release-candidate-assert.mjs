/**
 * Asserts that a named, claimed feature is really wired into the checked-out mobile source — not just
 * present as dead code, and not just asserted by a changelog entry or an issue number. Exits non-zero
 * naming the first missing marker, so a release script can refuse to upload a build that doesn't
 * actually contain what it claims to.
 *
 * Usage: node scripts/release-candidate-assert.mjs --features=changelog,bug-report-mic [--source-dir=<dir>]
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SOURCE_DIR = resolve(__dirname, '..', 'src');

/**
 * One entry per known feature name. `file` is relative to the mobile package's `src/` dir. Each check
 * must pass for the feature to count as really wired — e.g. `changelog` needs both the import AND the
 * render call, so an import-only (dead code) state still fails.
 */
export const FEATURE_MARKERS = {
  changelog: {
    file: 'core/DrawerHost.tsx',
    checks: [
      { label: "imports ChangelogSheet from './ChangelogSheet'", test: (src) => /from\s+['"]\.\/ChangelogSheet['"]/.test(src) },
      { label: 'renders <ChangelogSheet', test: (src) => /<ChangelogSheet\b/.test(src) },
    ],
  },
  'bug-report-mic': {
    file: 'core/BugReport.tsx',
    // No real marker exists yet: PR #146 (mic/dictation UI) is open and unmerged as of this writing.
    // This feature name intentionally has no passing marker until that PR lands with its real symbol
    // names — failing loudly here is correct, not a bug, per the candidate-selection contract in
    // docs/studio-integration.md (an unapproved/unmerged public PR must never be claimed as shipped).
    checks: [
      { label: 'a recording/dictation call (e.g. expo-audio, Audio.Recording)', test: (src) => /expo-audio|Audio\.Recording|useAudioRecorder/.test(src) },
    ],
  },
};

export function checkFeature(name, readFile = (p) => readFileSync(p, 'utf8'), sourceDir = DEFAULT_SOURCE_DIR) {
  const marker = FEATURE_MARKERS[name];
  if (!marker) return { ok: false, failures: [`unknown feature "${name}" — no marker is defined for it`] };
  let contents;
  try {
    contents = readFile(join(sourceDir, marker.file));
  } catch {
    return { ok: false, failures: [`feature "${name}": could not read ${marker.file}`] };
  }
  const failures = marker.checks
    .filter((c) => !c.test(contents))
    .map((c) => `feature "${name}": missing marker — ${c.label} (checked ${marker.file})`);
  return { ok: failures.length === 0, failures };
}

// Accepts both `--flag=value` and `--flag value` (the shell call site in release-testflight.sh uses
// the space-separated form).
function namedArg(argv, flag) {
  const eq = argv.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  const idx = argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < argv.length) return argv[idx + 1];
  return null;
}

function parseArgs(argv) {
  const featuresArg = namedArg(argv, '--features');
  const sourceDirArg = namedArg(argv, '--source-dir');
  return {
    features: featuresArg
      ? featuresArg
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
    sourceDir: sourceDirArg || DEFAULT_SOURCE_DIR,
  };
}

function main() {
  const { features, sourceDir } = parseArgs(process.argv.slice(2));
  if (features.length === 0) {
    console.error('usage: release-candidate-assert.mjs --features=<comma,separated,names>');
    process.exit(2);
  }
  const allFailures = features.flatMap((f) => checkFeature(f, undefined, sourceDir).failures);
  if (allFailures.length > 0) {
    for (const f of allFailures) console.error(f);
    process.exit(1);
  }
  console.log(`release-candidate-assert: all claimed features verified present — ${features.join(', ')}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
