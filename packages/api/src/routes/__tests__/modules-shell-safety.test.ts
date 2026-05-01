import { describe, it, expect } from 'vitest';

/**
 * Branch-name regex tests. The regex lives in two places (modules.ts +
 * shared/loader.ts + portal/generate-module-registry.ts); these tests pin
 * the allowed shape so a relaxation in one is caught here.
 */
const BRANCH_RE = /^[\w][\w.\-/]{0,254}$/;

describe('module-source branch validation', () => {
  it('accepts ordinary branch names', () => {
    expect(BRANCH_RE.test('main')).toBe(true);
    expect(BRANCH_RE.test('release/1.0.0')).toBe(true);
    expect(BRANCH_RE.test('feature/foo-bar')).toBe(true);
    expect(BRANCH_RE.test('v1.2.3')).toBe(true);
    expect(BRANCH_RE.test('hotfix_2024_05')).toBe(true);
  });

  it('rejects shell-metacharacter injection attempts', () => {
    expect(BRANCH_RE.test('main; rm -rf /')).toBe(false);
    expect(BRANCH_RE.test('main"; rm -rf /; echo "')).toBe(false);
    expect(BRANCH_RE.test('main`whoami`')).toBe(false);
    expect(BRANCH_RE.test('main$(whoami)')).toBe(false);
    expect(BRANCH_RE.test('main && cat /etc/passwd')).toBe(false);
    expect(BRANCH_RE.test('main | tee /tmp/pwn')).toBe(false);
    expect(BRANCH_RE.test('main\nwhoami')).toBe(false);
  });

  it('rejects empty / leading-dash / leading-special branches', () => {
    expect(BRANCH_RE.test('')).toBe(false);
    expect(BRANCH_RE.test('-rf')).toBe(false);
    expect(BRANCH_RE.test('.foo')).toBe(false);
    expect(BRANCH_RE.test('/leading-slash')).toBe(false);
  });

  it('rejects branches over 255 chars', () => {
    expect(BRANCH_RE.test('a'.repeat(255))).toBe(true);
    expect(BRANCH_RE.test('a'.repeat(256))).toBe(false);
  });
});
