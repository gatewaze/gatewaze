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
      startUrl: 'https://host.example.org/auth/start',
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
    it('rejects a non-absolute startUrl', () => {
      const result = validateGwHostContext(
        validCtx({ signIn: { startUrl: '/relative', returnUrl: 'https://x.example.org/gw' } }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.field).toBe('signIn.startUrl');
    });

    it('rejects a non-absolute returnUrl', () => {
      const result = validateGwHostContext(
        validCtx({ signIn: { startUrl: 'https://x.example.org/start', returnUrl: '/relative' } }),
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

  describe('host-session mode (session set)', () => {
    const ORIGIN = window.location.origin;

    function hostCtx(overrides: Partial<GwHostContext> = {}): GwHostContext {
      const { signIn: _signIn, ...rest } = validCtx();
      return {
        ...rest,
        supabase: { url: `${ORIGIN}/api/gatewaze/supabase`, anonKey: 'anon-key', publicUrl: 'https://project.supabase.co' },
        session: { mode: 'host', meUrl: '/api/gatewaze/session/me', logoutUrl: '/api/gatewaze/session/logout' },
        ...overrides,
      };
    }

    it('accepts a host context without signIn', () => {
      expect(validateGwHostContext(hostCtx()).ok).toBe(true);
    });

    it('still checks signIn when a host context provides it', () => {
      const result = validateGwHostContext(
        hostCtx({ signIn: { startUrl: 'not-a-url', returnUrl: 'https://host.example.org/x' } }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.field).toBe('signIn.startUrl');
    });

    it('still requires signIn without a session (local mode unchanged)', () => {
      const { signIn: _signIn, ...rest } = validCtx();
      const result = validateGwHostContext(rest);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.field).toBe('signIn');
    });

    it.each([
      ['another origin', 'https://project.supabase.co'],
      ['a relative path', '/api/gatewaze/supabase'],
      ['a protocol-relative URL', '//evil.example/api'],
    ])('rejects supabase.url on %s', (_label, url) => {
      const result = validateGwHostContext(hostCtx({ supabase: { url, anonKey: 'anon-key', publicUrl: 'https://project.supabase.co' } }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.field).toBe('supabase.url');
    });

    it.each([
      ['meUrl', { meUrl: 'https://evil.example/me', logoutUrl: '/logout' }],
      ['meUrl', { meUrl: '//evil.example/me', logoutUrl: '/logout' }],
      ['logoutUrl', { meUrl: '/me', logoutUrl: 'https://evil.example/logout' }],
      ['logoutUrl', { meUrl: '/me', logoutUrl: '' }],
    ])('rejects a cross-origin or empty session.%s', (field, routes) => {
      const result = validateGwHostContext(hostCtx({ session: { mode: 'host', ...routes } }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.field).toBe(`session.${field}`);
    });

    it('accepts same-origin absolute session URLs', () => {
      const result = validateGwHostContext(
        hostCtx({ session: { mode: 'host', meUrl: `${ORIGIN}/s/me`, logoutUrl: `${ORIGIN}/s/logout` } }),
      );
      expect(result.ok).toBe(true);
    });

    it('rejects a javascript: signIn.startUrl, which a lost session would navigate to', () => {
      const result = validateGwHostContext(
        hostCtx({ signIn: { startUrl: 'javascript:alert(1)', returnUrl: 'https://host.example.org/x' } }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.field).toBe('signIn.startUrl');
    });

    it.each([
      ['meUrl', { meUrl: '/\\evil.example', logoutUrl: '/logout' }],
      ['logoutUrl', { meUrl: '/me', logoutUrl: '/a b' }],
    ])('rejects a backslash or whitespace session.%s', (field, routes) => {
      const result = validateGwHostContext(hostCtx({ session: { mode: 'host', ...routes } }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.field).toBe(`session.${field}`);
    });

    it.each([
      ['null', null],
      ['false', false],
    ])('treats session: %s as host mode and rejects it (same rule as the loader)', (_label, session) => {
      const result = validateGwHostContext(hostCtx({ session: session as unknown as GwHostContext['session'] }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.field).toBe('session');
    });

    it('requires supabase.publicUrl in host-session mode', () => {
      const result = validateGwHostContext(hostCtx({ supabase: { url: `${ORIGIN}/api/gatewaze/supabase`, anonKey: 'anon-key' } }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.field).toBe('supabase.publicUrl');
    });

    it('rejects a session with any other mode', () => {
      const result = validateGwHostContext(
        hostCtx({ session: { mode: 'cookie', meUrl: '/me', logoutUrl: '/logout' } as unknown as GwHostContext['session'] }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.field).toBe('session');
    });
  });

  describe('supabase.publicUrl', () => {
    it.each([
      ['https', 'https://project.supabase.co'],
      ['http localhost', 'http://localhost:54321'],
      ['http 127.0.0.1', 'http://127.0.0.1:54321'],
      ['http *.localhost', 'http://supabase.gatewaze.localhost'],
    ])('accepts %s', (_label, publicUrl) => {
      expect(validateGwHostContext(validCtx({ supabase: { url: 'https://project.supabase.co', anonKey: 'k', publicUrl } })).ok).toBe(true);
    });

    it.each([
      ['plain http', 'http://project.supabase.co'],
      ['http evil.example', 'http://evil.example'],
      ['http with localhost only as a prefix', 'http://localhost.evil.example'],
      ['a relative path', '/supabase'],
      ['javascript:', 'javascript:alert(1)'],
      ['empty', ''],
    ])('rejects %s', (_label, publicUrl) => {
      const result = validateGwHostContext(validCtx({ supabase: { url: 'https://project.supabase.co', anonKey: 'k', publicUrl } }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.field).toBe('supabase.publicUrl');
    });
  });

  it('local mode is unchanged: a cross-origin supabase.url, no publicUrl and no session are fine', () => {
    const result = validateGwHostContext(validCtx({ supabase: { url: 'https://elsewhere.supabase.co', anonKey: 'k' } }));
    expect(result.ok).toBe(true);
  });
});
