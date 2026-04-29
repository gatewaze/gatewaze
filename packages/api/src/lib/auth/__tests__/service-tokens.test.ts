import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateBootstrapSecret } from '../service-tokens.js';

describe('validateBootstrapSecret', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.SERVICE_BOOTSTRAP_SECRETS;
  });
  afterEach(() => {
    if (saved !== undefined) {
      process.env.SERVICE_BOOTSTRAP_SECRETS = saved;
    } else {
      delete process.env.SERVICE_BOOTSTRAP_SECRETS;
    }
  });

  it('rejects unknown secrets', () => {
    process.env.SERVICE_BOOTSTRAP_SECRETS = 'real-secret:worker';
    const r = validateBootstrapSecret('attacker-secret', 'worker');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('unknown');
  });

  it('rejects services not in the secret allowlist', () => {
    process.env.SERVICE_BOOTSTRAP_SECRETS = 'worker-only:worker';
    const r = validateBootstrapSecret('worker-only', 'scheduler');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('forbidden');
  });

  it('accepts a service the secret is authorised for', () => {
    process.env.SERVICE_BOOTSTRAP_SECRETS = 'multi:worker,scheduler';
    const w = validateBootstrapSecret('multi', 'worker');
    expect(w.ok).toBe(true);
    const s = validateBootstrapSecret('multi', 'scheduler');
    expect(s.ok).toBe(true);
  });

  it('parses multiple secrets separated by `;`', () => {
    process.env.SERVICE_BOOTSTRAP_SECRETS =
      'first-secret:worker;second-secret:scheduler;third-secret:module-runner';
    expect(validateBootstrapSecret('first-secret', 'worker').ok).toBe(true);
    expect(validateBootstrapSecret('second-secret', 'scheduler').ok).toBe(true);
    expect(validateBootstrapSecret('third-secret', 'module-runner').ok).toBe(true);
    // Cross-mappings rejected.
    expect(validateBootstrapSecret('first-secret', 'scheduler').ok).toBe(false);
  });

  it('returns a bootstrap_id derived from the secret prefix', () => {
    process.env.SERVICE_BOOTSTRAP_SECRETS = 'longerthan8chars:worker';
    const r = validateBootstrapSecret('longerthan8chars', 'worker');
    expect(r.ok).toBe(true);
    if (r.ok) {
      // First 8 chars + horizontal ellipsis suffix.
      expect(r.bootstrapId).toBe('longerth…');
    }
  });
});
