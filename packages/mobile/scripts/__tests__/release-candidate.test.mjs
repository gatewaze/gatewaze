/**
 * Runnable assertions for the two release-candidate scripts (issue #83): provenance resolution
 * (commit shas + dirty-checkout detection) and the feature-marker assertions used to refuse a build
 * that doesn't really contain what it claims to.
 *
 *   node scripts/__tests__/release-candidate.test.mjs
 *
 * (No runner is wired up in this package yet beyond this file — see health-core's
 * test/feedback-status.test.ts for the established pattern this follows.)
 */
import { gitInfo, resolveProvenance, firstModuleSourcePath } from '../release-provenance.mjs';
import { checkFeature, FEATURE_MARKERS } from '../release-candidate-assert.mjs';

let failed = 0;
const check = (n, ok) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); };

// --- release-provenance.mjs ---------------------------------------------------------------------

function fakeExec(responses) {
  return (_bin, args) => {
    const key = args.join(' ');
    if (key in responses) return responses[key];
    throw new Error(`unexpected git invocation: ${key}`);
  };
}

check(
  'gitInfo: missing path never becomes eligible',
  (() => {
    const info = gitInfo(null);
    return info.sha === null && info.dirty === true;
  })(),
);

check(
  'gitInfo: git failure (not a checkout) never becomes eligible',
  (() => {
    const exec = () => {
      throw new Error('fatal: not a git repository');
    };
    const info = gitInfo('/nowhere', exec);
    return info.sha === null && info.dirty === true;
  })(),
);

check(
  'gitInfo: clean checkout reports its HEAD sha and dirty=false',
  (() => {
    const exec = fakeExec({
      '-C /repo rev-parse --show-toplevel': '/repo\n',
      '-C /repo rev-parse HEAD': 'abc123\n',
      '-C /repo status --porcelain': '',
    });
    const info = gitInfo('/repo', exec);
    return info.sha === 'abc123' && info.dirty === false;
  })(),
);

check(
  'gitInfo: an uncommitted edit sets dirty=true even though HEAD still resolves',
  (() => {
    const exec = fakeExec({
      '-C /repo rev-parse --show-toplevel': '/repo\n',
      '-C /repo rev-parse HEAD': 'abc123\n',
      '-C /repo status --porcelain': ' M some/file.ts\n',
    });
    const info = gitInfo('/repo', exec);
    return info.sha === 'abc123' && info.dirty === true;
  })(),
);

check(
  'resolveProvenance: combines platform + module results into the documented JSON shape',
  (() => {
    const exec = fakeExec({
      '-C /platform rev-parse --show-toplevel': '/platform\n',
      '-C /platform rev-parse HEAD': 'platformsha\n',
      '-C /platform status --porcelain': '',
      '-C /module rev-parse --show-toplevel': '/module\n',
      '-C /module rev-parse HEAD': 'modulesha\n',
      '-C /module status --porcelain': '',
    });
    const result = resolveProvenance({ platformPath: '/platform', modulePath: '/module', exec });
    return (
      result.platformSha === 'platformsha' &&
      result.platformDirty === false &&
      result.moduleSha === 'modulesha' &&
      result.moduleDirty === false
    );
  })(),
);

check(
  'resolveProvenance: an unresolved module path (no MODULE_SOURCES) never reports clean',
  (() => {
    const exec = fakeExec({
      '-C /platform rev-parse --show-toplevel': '/platform\n',
      '-C /platform rev-parse HEAD': 'platformsha\n',
      '-C /platform status --porcelain': '',
    });
    const result = resolveProvenance({ platformPath: '/platform', modulePath: null, exec });
    return result.moduleSha === null && result.moduleDirty === true;
  })(),
);

check(
  'firstModuleSourcePath: takes the first comma-separated entry and strips any #fragment',
  firstModuleSourcePath('/a/modules#label=Premium, /b/modules#label=LF') === '/a/modules',
);

check('firstModuleSourcePath: empty/unset env yields null', firstModuleSourcePath('') === null && firstModuleSourcePath(undefined) === null);

// --- release-candidate-assert.mjs ----------------------------------------------------------------

check(
  'checkFeature: changelog passes against the real checked-out source (DrawerHost really renders it)',
  checkFeature('changelog').ok === true,
);

check(
  'checkFeature: bug-report-mic FAILS against the real checked-out source — PR #146 is still open',
  checkFeature('bug-report-mic').ok === false,
);

check(
  'checkFeature: an import with no render call is rejected (dead-code guard)',
  (() => {
    const readFile = () => `import { ChangelogSheet } from './ChangelogSheet';\n// never rendered\n`;
    const result = checkFeature('changelog', readFile);
    return result.ok === false && result.failures.some((f) => f.includes('renders <ChangelogSheet'));
  })(),
);

check(
  'checkFeature: a render call with no import is also rejected',
  (() => {
    const readFile = () => `<ChangelogSheet onClose={() => {}} />\n`;
    const result = checkFeature('changelog', readFile);
    return result.ok === false && result.failures.some((f) => f.includes("imports ChangelogSheet"));
  })(),
);

check(
  'checkFeature: an unknown feature name fails loudly rather than silently passing',
  checkFeature('does-not-exist').ok === false,
);

check(
  'checkFeature: a missing source file fails loudly rather than silently passing',
  (() => {
    const readFile = () => {
      throw new Error('ENOENT');
    };
    return checkFeature('changelog', readFile).ok === false;
  })(),
);

check('FEATURE_MARKERS: every known feature has at least one check', Object.values(FEATURE_MARKERS).every((m) => m.checks.length > 0));

console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) FAILED.`);
if (failed > 0) process.exit(1);
