import { describe, expect, it } from 'vitest';
import { buildCsp, sanitiseCspExceptions, securityHeaders } from '../headers.js';
import { PORTAL_ORIGIN } from './fixtures.js';

const EXPECTED_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${PORTAL_ORIGIN}`,
  "frame-src 'none'",
  `frame-ancestors ${PORTAL_ORIGIN}`,
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join('; ');

describe('buildCsp', () => {
  it('produces the §6 policy verbatim', () => {
    expect(buildCsp(PORTAL_ORIGIN)).toBe(EXPECTED_CSP);
  });

  it('appends validated per-game exceptions to the allowlisted directives only', () => {
    const csp = buildCsp(PORTAL_ORIGIN, sanitiseCspExceptions({ connect_src: ['https://api.example.com'] }));
    expect(csp).toContain(`connect-src 'self' ${PORTAL_ORIGIN} https://api.example.com`);
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
  });
});

describe('sanitiseCspExceptions', () => {
  it('keeps only the four configurable directives', () => {
    const out = sanitiseCspExceptions({
      connect_src: ['https://api.example.com'],
      img_src: ['https://cdn.example.com'],
      media_src: ['https://media.example.com'],
      font_src: ['https://fonts.example.com'],
      script_src: ['https://evil.example.com'],
      'default-src': ['https://evil.example.com'],
      frame_ancestors: ['https://evil.example.com'],
    });
    expect(Object.keys(out).sort()).toEqual(['connect-src', 'font-src', 'img-src', 'media-src']);
  });

  it.each([
    ['http origin', 'http://insecure.example.com'],
    ['wildcard host', 'https://*.example.com'],
    ['bare wildcard', '*'],
    ['data scheme', 'data:'],
    ['unsafe-inline', "'unsafe-inline'"],
    ['origin with a path', 'https://example.com/api'],
    ['origin with a query', 'https://example.com/?x=1'],
    ['credentials', 'https://user:pw@example.com'],
    ['not a url', 'example.com'],
  ])('drops %s', (_label, value) => {
    expect(sanitiseCspExceptions({ connect_src: [value] })).toEqual({});
  });

  it('ignores malformed rows entirely', () => {
    expect(sanitiseCspExceptions(null)).toEqual({});
    expect(sanitiseCspExceptions('nope')).toEqual({});
    expect(sanitiseCspExceptions(['https://example.com'])).toEqual({});
    expect(sanitiseCspExceptions({ connect_src: 'https://example.com' })).toEqual({});
    expect(sanitiseCspExceptions({ connect_src: [123, null] })).toEqual({});
  });

  it('caps the number of origins per directive', () => {
    const many = Array.from({ length: 40 }, (_, i) => `https://h${i}.example.com`);
    expect(sanitiseCspExceptions({ img_src: many })['img-src']).toHaveLength(8);
  });
});

describe('securityHeaders', () => {
  it('emits the exact §6 set and no cookie or COEP/CORP header', () => {
    const headers = securityHeaders({ portalOrigin: PORTAL_ORIGIN });
    expect(headers).toEqual({
      'Content-Security-Policy': EXPECTED_CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    });
  });
});
