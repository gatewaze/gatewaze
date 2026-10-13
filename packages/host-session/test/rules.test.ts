// Unit tests for the framework-free rules: CSRF, query token stripping,
// path containment and return_to.
import { describe, expect, it } from 'vitest';
import { carriesPlaceholder, csrfDecision, isPublicRead, redactUrl, safeReturnTo, stripQueryTokens } from '../src/host-session.js';
import { UpstreamPathError, forwardedFor, realtimeUpstreamUrl, upstreamUrl } from '../src/proxy.js';

const SITE = 'https://admin.example.test';
const ANON = 'anon';

describe('csrfDecision', () => {
  const d = (method: string, h: { origin?: string; apikey?: string; site?: string; auth?: string }) =>
    csrfDecision({ method, origin: h.origin, apikey: h.apikey, authorization: h.auth, secFetchSite: h.site, siteOrigin: SITE, anonKey: ANON });

  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    describe(method, () => {
      it('takes the session with the anon key and the same origin', () => {
        expect(d(method, { origin: SITE, apikey: ANON })).toBe('session');
      });
      it('takes the session with the anon key and no origin', () => {
        expect(d(method, { apikey: ANON })).toBe('session');
      });
      it('rejects without apikey, even when Sec-Fetch-Site says same-origin', () => {
        expect(d(method, { origin: SITE, site: 'same-origin' })).toBe('reject');
      });
      it('takes the session with an Authorization header instead of apikey (amendment)', () => {
        expect(d(method, { origin: SITE, auth: 'Bearer host-session' })).toBe('session');
        expect(d(method, { auth: 'Bearer host-session' })).toBe('session');
      });
      it('rejects an Authorization header from another origin', () => {
        expect(d(method, { origin: 'https://evil.example', auth: 'Bearer host-session' })).toBe('reject');
      });
      it('rejects a wrong apikey', () => {
        expect(d(method, { origin: SITE, apikey: 'service-role' })).toBe('reject');
      });
      it('rejects another origin even with the anon key', () => {
        expect(d(method, { origin: 'https://evil.example', apikey: ANON })).toBe('reject');
      });
    });
  }

  for (const method of ['GET', 'HEAD']) {
    describe(method, () => {
      it('takes the session with the anon key', () => {
        expect(d(method, { apikey: ANON })).toBe('session');
      });
      it('takes the session on Sec-Fetch-Site: same-origin without apikey', () => {
        expect(d(method, { site: 'same-origin' })).toBe('session');
      });
      it('is anonymous, not rejected, for a cross-site request', () => {
        expect(d(method, { site: 'cross-site' })).toBe('anon');
        expect(d(method, { site: 'same-site' })).toBe('anon');
        expect(d(method, {})).toBe('anon');
      });
      it('is anonymous for another origin even with apikey', () => {
        expect(d(method, { origin: 'https://evil.example', apikey: ANON })).toBe('anon');
      });
      it('is anonymous when Sec-Fetch-Site and Origin disagree', () => {
        expect(d(method, { origin: 'https://evil.example', site: 'same-origin' })).toBe('anon');
      });
    });
  }

  it('treats OPTIONS as unsafe', () => {
    expect(d('OPTIONS', { site: 'same-origin' })).toBe('reject');
  });
});

describe('stripQueryTokens', () => {
  it('removes access_token whatever its value', () => {
    expect(stripQueryTokens('/api/x?access_token=host-session&a=1')).toBe('/api/x?a=1');
    expect(stripQueryTokens('/api/x?a=1&access_token=eyJreal')).toBe('/api/x?a=1');
    expect(stripQueryTokens('/api/x?access%5Ftoken=host-session')).toBe('/api/x');
  });
  it('removes token only when it is the placeholder', () => {
    expect(stripQueryTokens('/functions/v1/f?token=host-session')).toBe('/functions/v1/f');
    expect(stripQueryTokens('/storage/v1/object/sign/b/p.png?token=signed.jwt')).toBe('/storage/v1/object/sign/b/p.png?token=signed.jwt');
  });
  it('leaves other pairs byte-for-byte', () => {
    const q = '/rest/v1/t?select=*,a(b)&or=(x.eq.1,y.eq.2)&name=a%20b+c';
    expect(stripQueryTokens(q)).toBe(q);
    expect(stripQueryTokens(`${q}&access_token=x`)).toBe(q);
  });
  it('leaves paths without a query alone', () => {
    expect(stripQueryTokens('/rest/v1/t')).toBe('/rest/v1/t');
  });
});

describe('upstreamUrl', () => {
  const up = { url: 'http://kong:8000', prefix: '/rest/v1', supabase: true };
  it('keeps the path and query', () => {
    expect(upstreamUrl(up, '/rest/v1/t?select=*').toString()).toBe('http://kong:8000/rest/v1/t?select=*');
  });
  for (const p of ['/rest/v1/../../auth/v1/admin/users', '/rest/v1/%2e%2e/%2e%2e/auth/v1/user', '/rest/v1/..\\..\\auth/v1/user']) {
    it(`refuses to leave the prefix: ${p}`, () => {
      expect(() => upstreamUrl(up, p)).toThrow(UpstreamPathError);
    });
  }
  it('requires the prefix followed by a slash, not just the prefix text', () => {
    const api = { url: 'http://api:3002', prefix: '/api', supabase: false };
    expect(() => upstreamUrl(api, '/api%2e%2e/rest/v1/notes')).toThrow(UpstreamPathError);
    expect(() => upstreamUrl(api, '/apix/y')).toThrow(UpstreamPathError);
    expect(upstreamUrl(api, '/api/x').pathname).toBe('/api/x');
  });
  it('refuses a protocol-relative path', () => {
    expect(() => upstreamUrl(up, '//evil.example/rest/v1/t')).toThrow(UpstreamPathError);
  });
  it('builds the Realtime URL with the anon key and without access_token', () => {
    const u = new URL(realtimeUpstreamUrl('https://x.supabase.co', '/realtime/v1/websocket?apikey=a&vsn=2.0.0&access_token=host-session', 'ANON'));
    expect(u.protocol).toBe('wss:');
    expect(u.searchParams.get('apikey')).toBe('ANON');
    expect(u.searchParams.has('access_token')).toBe(false);
    expect(u.searchParams.get('vsn')).toBe('2.0.0');
  });
});

describe('forwardedFor', () => {
  it('appends the peer to an existing chain', () => {
    expect(forwardedFor('203.0.113.9', '10.0.0.5')).toBe('203.0.113.9, 10.0.0.5');
    expect(forwardedFor(undefined, '10.0.0.5')).toBe('10.0.0.5');
  });
});

describe('safeReturnTo', () => {
  it('accepts same-origin paths', () => {
    expect(safeReturnTo('/events/1?tab=a')).toBe('/events/1?tab=a');
  });
  for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example', '/\t/evil.example', 'events', undefined, 42]) {
    it(`rejects ${JSON.stringify(bad)}`, () => {
      expect(safeReturnTo(bad)).toBe('/');
    });
  }
});

describe('redactUrl', () => {
  it('hides token-bearing query values', () => {
    expect(redactUrl('/api/x?access_token=abc&a=1&code=xyz')).toBe('/api/x?access_token=[redacted]&a=1&code=[redacted]');
    expect(redactUrl('/s?token=signed&refresh_token=rt')).toBe('/s?token=[redacted]&refresh_token=[redacted]');
  });
});

describe('carriesPlaceholder', () => {
  it('sees the placeholder in Authorization, access_token or token', () => {
    expect(carriesPlaceholder('Bearer host-session', '/x')).toBe(true);
    expect(carriesPlaceholder('bearer  host-session ', '/x')).toBe(true);
    expect(carriesPlaceholder(undefined, '/x?a=1&access_token=host-session')).toBe(true);
    expect(carriesPlaceholder(undefined, '/x?token=host%2Dsession')).toBe(true);
  });
  it('does not see it anywhere else', () => {
    expect(carriesPlaceholder('Bearer anon', '/x')).toBe(false);
    expect(carriesPlaceholder('Bearer host-sessionX', '/x')).toBe(false);
    expect(carriesPlaceholder(undefined, '/x?token=signed')).toBe(false);
    expect(carriesPlaceholder(undefined, '/host-session?q=host-session')).toBe(false);
  });
});

describe('isPublicRead', () => {
  it('allows the sign-in page reads', () => {
    expect(isPublicRead('GET', '/storage/v1/object/public/b/logo.png')).toBe(true);
    expect(isPublicRead('HEAD', '/rest/v1/platform_settings')).toBe(true);
    expect(isPublicRead('POST', '/rest/v1/rpc/public_enabled_modules')).toBe(true);
  });
  it('refuses writes and other paths', () => {
    expect(isPublicRead('POST', '/rest/v1/platform_settings')).toBe(false);
    expect(isPublicRead('DELETE', '/storage/v1/object/public/b/logo.png')).toBe(false);
    expect(isPublicRead('GET', '/storage/v1/object/publicx/b')).toBe(false);
    expect(isPublicRead('GET', '/rest/v1/platform_settings/x')).toBe(false);
  });
});
