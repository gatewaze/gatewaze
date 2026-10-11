import { describe, it, expect } from 'vitest';
import { resolveCdnBaseUrl } from '../cdnBaseUrl';

const ZONE = 'https://aaif.b-cdn.net';

describe('resolveCdnBaseUrl', () => {
  it('returns the zone origin when enabled', () => {
    expect(resolveCdnBaseUrl({ BUNNY_CDN_ENABLED: 'true', BUNNY_PULLZONE_URL: ZONE })).toBe(ZONE);
  });

  // The flag is the kill switch: an operator can leave the URL in place and
  // turn the CDN off without deleting the setting.
  it.each([
    [undefined, 'unset'],
    ['false', 'false'],
    ['1', 'a truthy-looking non-"true" value'],
    ['TRUE', 'the wrong case'],
    ['', 'empty'],
  ])('returns empty when the flag is %s (%s)', (flag, _label) => {
    expect(resolveCdnBaseUrl({ BUNNY_CDN_ENABLED: flag, BUNNY_PULLZONE_URL: ZONE })).toBe('');
  });

  it('returns empty when enabled but no URL is set', () => {
    expect(resolveCdnBaseUrl({ BUNNY_CDN_ENABLED: 'true' })).toBe('');
    expect(resolveCdnBaseUrl({ BUNNY_CDN_ENABLED: 'true', BUNNY_PULLZONE_URL: '' })).toBe('');
  });

  it('strips a trailing path, query or fragment down to the origin', () => {
    const env = {
      BUNNY_CDN_ENABLED: 'true',
      BUNNY_PULLZONE_URL: 'https://aaif.b-cdn.net/storage/?token=abc#x',
    };
    expect(resolveCdnBaseUrl(env)).toBe(ZONE);
  });

  it('normalises a trailing slash away', () => {
    expect(
      resolveCdnBaseUrl({ BUNNY_CDN_ENABLED: 'true', BUNNY_PULLZONE_URL: `${ZONE}/` }),
    ).toBe(ZONE);
  });

  // Credentials in the zone URL would end up in every <img src> on the page.
  it('refuses a URL with embedded credentials', () => {
    const env = {
      BUNNY_CDN_ENABLED: 'true',
      BUNNY_PULLZONE_URL: 'https://user:secret@aaif.b-cdn.net',
    };
    expect(resolveCdnBaseUrl(env)).toBe('');
  });

  it.each(['ftp://aaif.b-cdn.net', 'javascript:alert(1)', 'data:text/plain,x', 'not a url', '//aaif.b-cdn.net'])(
    'refuses the unusable value %s',
    (raw) => {
      expect(resolveCdnBaseUrl({ BUNNY_CDN_ENABLED: 'true', BUNNY_PULLZONE_URL: raw })).toBe('');
    },
  );

  it('accepts http for a local or self-hosted zone', () => {
    expect(
      resolveCdnBaseUrl({ BUNNY_CDN_ENABLED: 'true', BUNNY_PULLZONE_URL: 'http://localhost:8080' }),
    ).toBe('http://localhost:8080');
  });

  // values-example.yaml documents both spellings, so the NEXT_PUBLIC_ pair is
  // accepted as a fallback. BUNNY_* wins when both are present.
  it('falls back to the NEXT_PUBLIC_ spellings', () => {
    const env = {
      NEXT_PUBLIC_BUNNY_CDN_ENABLED: 'true',
      NEXT_PUBLIC_BUNNY_PULLZONE_URL: ZONE,
    };
    expect(resolveCdnBaseUrl(env)).toBe(ZONE);
  });

  it('prefers the unprefixed names when both are set', () => {
    const env = {
      BUNNY_CDN_ENABLED: 'true',
      BUNNY_PULLZONE_URL: ZONE,
      NEXT_PUBLIC_BUNNY_CDN_ENABLED: 'true',
      NEXT_PUBLIC_BUNNY_PULLZONE_URL: 'https://wrong.b-cdn.net',
    };
    expect(resolveCdnBaseUrl(env)).toBe(ZONE);
  });

  it('lets an unprefixed "false" override a NEXT_PUBLIC_ "true"', () => {
    const env = {
      BUNNY_CDN_ENABLED: 'false',
      NEXT_PUBLIC_BUNNY_CDN_ENABLED: 'true',
      BUNNY_PULLZONE_URL: ZONE,
    };
    expect(resolveCdnBaseUrl(env)).toBe('');
  });

  it('returns empty for a completely empty environment', () => {
    expect(resolveCdnBaseUrl({})).toBe('');
  });
});
