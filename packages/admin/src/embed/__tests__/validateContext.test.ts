import { describe, expect, it } from 'vitest';
import { validateGwHostContext } from '../validateContext';
import type { GwHostContext } from '../types';

function validCtx(overrides: Partial<GwHostContext> = {}): GwHostContext {
  return {
    basename: '/apps/gw',
    supabase: { url: 'https://project.supabase.co', anonKey: 'anon-key' },
    apiBaseUrl: '',
    enabled: { moduleIds: ['newsletters'], features: ['newsletters.editions'] },
    signIn: {
      lfidStartUrl: 'https://host.example.org/auth/lfid/start',
      returnUrl: 'https://host.example.org/apps/gw/newsletters',
    },
    ...overrides,
  };
}

describe('validateGwHostContext', () => {
  it('accepts a well-formed context', () => {
    const result = validateGwHostContext(validCtx());
    expect(result.ok).toBe(true);
  });

  it('rejects a non-object context', () => {
    const result = validateGwHostContext(null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('gw_ctx_root_invalid');
  });

  describe('basename', () => {
    it.each([
      ['missing leading slash', 'apps/gw'],
      ['trailing slash', '/apps/gw/'],
      ['empty segment', '/foundation//gw'],
      ['empty string', ''],
      ['disallowed characters', '/apps/gw?x=1'],
    ])('rejects %s (%s)', (_label, basename) => {
      const result = validateGwHostContext(validCtx({ basename }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('basename');
        expect(result.error.error_type).toBe('config_invalid');
        expect(result.error.recoverable).toBe(false);
      }
    });

    it('accepts a single-segment basename', () => {
      const result = validateGwHostContext(validCtx({ basename: '/gw' }));
      expect(result.ok).toBe(true);
    });
  });

  describe('apiBaseUrl', () => {
    it("accepts '' (defaults to /api/gw downstream)", () => {
      expect(validateGwHostContext(validCtx({ apiBaseUrl: '' })).ok).toBe(true);
    });

    it('accepts a same-origin absolute path', () => {
      expect(validateGwHostContext(validCtx({ apiBaseUrl: '/api/gw' })).ok).toBe(true);
    });

    it.each([
      ['protocol-relative (cross-origin escape)', '//evil.example.com/api'],
      ['absolute URL with scheme', 'https://evil.example.com/api'],
      ['trailing slash', '/api/gw/'],
      ['missing leading slash', 'api/gw'],
      ['embedded whitespace', '/api/ gw'],
    ])('rejects %s: %s', (_label, apiBaseUrl) => {
      const result = validateGwHostContext(validCtx({ apiBaseUrl }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.field).toBe('apiBaseUrl');
    });
  });

  describe('supabase', () => {
    it('rejects a missing supabase.url', () => {
      const result = validateGwHostContext(
        validCtx({ supabase: { url: '', anonKey: 'anon-key' } }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.field).toBe('supabase.url');
    });

    it('rejects a non-URL supabase.url', () => {
      const result = validateGwHostContext(
        validCtx({ supabase: { url: 'not-a-url', anonKey: 'anon-key' } }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.field).toBe('supabase.url');
    });

    it('rejects a missing anonKey', () => {
      const result = validateGwHostContext(
        validCtx({ supabase: { url: 'https://project.supabase.co', anonKey: '' } }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.field).toBe('supabase.anonKey');
    });
  });

  describe('signIn', () => {
    it('rejects a non-absolute lfidStartUrl', () => {
      const result = validateGwHostContext(
        validCtx({ signIn: { lfidStartUrl: '/relative', returnUrl: 'https://x.example.org/gw' } }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.field).toBe('signIn.lfidStartUrl');
    });

    it('rejects a non-absolute returnUrl', () => {
      const result = validateGwHostContext(
        validCtx({ signIn: { lfidStartUrl: 'https://x.example.org/start', returnUrl: '/relative' } }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.field).toBe('signIn.returnUrl');
    });
  });

  describe('enabled', () => {
    it('rejects non-array moduleIds', () => {
      const result = validateGwHostContext(
        validCtx({ enabled: { moduleIds: 'newsletters' as unknown as string[], features: [] } }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.field).toBe('enabled.moduleIds');
    });

    it('rejects a features array with non-string entries', () => {
      const result = validateGwHostContext(
        validCtx({ enabled: { moduleIds: [], features: [1 as unknown as string] } }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.field).toBe('enabled.features');
    });

    it('accepts empty enablement arrays (everything gated off)', () => {
      const result = validateGwHostContext(validCtx({ enabled: { moduleIds: [], features: [] } }));
      expect(result.ok).toBe(true);
    });
  });

  it('rejects an empty-string storageKeySuffix when explicitly provided', () => {
    const result = validateGwHostContext(validCtx({ storageKeySuffix: '' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe('storageKeySuffix');
  });

  it('accepts an omitted storageKeySuffix', () => {
    const result = validateGwHostContext(validCtx({ storageKeySuffix: undefined }));
    expect(result.ok).toBe(true);
  });
});
