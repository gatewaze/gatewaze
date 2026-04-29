import { describe, it, expect } from 'vitest';
import { safeExec, DisallowedBinaryError, _allowedBinaries } from '../safe-exec.js';

describe('safeExec', () => {
  it('runs an allowed binary with argv', () => {
    const result = safeExec('git', ['--version']);
    expect(result.stdout).toMatch(/git version/);
  });

  it('throws DisallowedBinaryError on a binary not in the allowlist', () => {
    expect(() => safeExec('rm', ['-rf', '/tmp/nope'])).toThrow(DisallowedBinaryError);
  });

  it('passes argv literally — no shell interpretation', () => {
    // If the wrapper interpreted "; ls" as a shell command, this would
    // succeed (or list /). With execFileSync(argv), the whole string is a
    // single argument to git, which it rejects.
    expect(() => safeExec('git', ['; ls'])).toThrow();
  });

  it('exposes the allowlist for inspection', () => {
    const list = _allowedBinaries();
    expect(list.has('git')).toBe(true);
    expect(list.has('rm')).toBe(false);
    expect(list.has('sh')).toBe(false);
    expect(list.has('bash')).toBe(false);
  });
});
