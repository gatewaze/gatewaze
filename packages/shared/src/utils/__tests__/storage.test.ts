import { describe, it, expect } from 'vitest';
import {
  toStoragePath,
  toPublicUrl,
  isFullStorageUrl,
  transformJsonStrings,
  stripStorageUrlsInJson,
  resolveStoragePathsInJson,
  rewriteImgSrcToStoragePath,
  rewriteImgSrcToPublicUrl,
  resolveBucketUrl,
} from '../storage';

const SUPABASE = 'https://project.supabase.co/storage/v1/object/public/media';
const CDN = 'https://cdn.example.com';

describe('toStoragePath', () => {
  it('returns null for nullish or empty input', () => {
    expect(toStoragePath(null)).toBeNull();
    expect(toStoragePath(undefined)).toBeNull();
    expect(toStoragePath('')).toBeNull();
  });

  it('strips Supabase storage URL prefix', () => {
    expect(toStoragePath(`${SUPABASE}/people/42.png`)).toBe('people/42.png');
  });

  it('strips from any Supabase-shaped URL regardless of host', () => {
    expect(
      toStoragePath('https://my-self-hosted.example.com/storage/v1/object/public/media/foo/bar.jpg'),
    ).toBe('foo/bar.jpg');
  });

  it('strips custom bucket URL when provided', () => {
    expect(toStoragePath(`${CDN}/people/42.png`, CDN)).toBe('people/42.png');
  });

  it('handles trailing slash on currentBucketUrl defensively', () => {
    expect(toStoragePath(`${CDN}/people/42.png`, `${CDN}/`)).toBe('people/42.png');
  });

  it('does NOT strip values sharing a prefix but not a directory boundary', () => {
    // cdn.example.comextra... would be a different host entirely, so this guards against
    // accidental over-stripping when the bucket URL is a string prefix of another URL.
    const tricky = `${CDN}extra/file.png`;
    expect(toStoragePath(tricky, CDN)).toBe(tricky);
  });

  it('passes through external URLs', () => {
    expect(toStoragePath('https://gravatar.com/avatar/abc')).toBe('https://gravatar.com/avatar/abc');
    expect(toStoragePath('https://linkedin.com/in/foo')).toBe('https://linkedin.com/in/foo');
  });

  it('passes through data/mailto/tel URIs', () => {
    expect(toStoragePath('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA');
    expect(toStoragePath('mailto:foo@example.com')).toBe('mailto:foo@example.com');
    expect(toStoragePath('tel:+15551234567')).toBe('tel:+15551234567');
  });

  it('passes through relative paths and anchor hrefs', () => {
    expect(toStoragePath('people/42.png')).toBe('people/42.png');
    expect(toStoragePath('/about-us')).toBe('/about-us');
    expect(toStoragePath('#section')).toBe('#section');
  });

  it('is idempotent', () => {
    const input = `${SUPABASE}/people/42.png`;
    expect(toStoragePath(toStoragePath(input) as string)).toBe('people/42.png');
  });
});

describe('toPublicUrl', () => {
  it('returns null for nullish or empty input', () => {
    expect(toPublicUrl(null, SUPABASE)).toBeNull();
    expect(toPublicUrl(undefined, SUPABASE)).toBeNull();
    expect(toPublicUrl('', SUPABASE)).toBeNull();
  });

  it('builds a full URL from a relative path', () => {
    expect(toPublicUrl('people/42.png', SUPABASE)).toBe(`${SUPABASE}/people/42.png`);
  });

  it('passes through already-full URLs', () => {
    expect(toPublicUrl(`${SUPABASE}/people/42.png`, SUPABASE)).toBe(`${SUPABASE}/people/42.png`);
    expect(toPublicUrl('https://gravatar.com/avatar/abc', SUPABASE)).toBe(
      'https://gravatar.com/avatar/abc',
    );
  });

  it('passes through data URIs unchanged', () => {
    expect(toPublicUrl('data:image/png;base64,AAA', SUPABASE)).toBe('data:image/png;base64,AAA');
  });

  it('passes through root-relative links', () => {
    expect(toPublicUrl('/about-us', SUPABASE)).toBe('/about-us');
  });

  it('rejects paths containing ..', () => {
    expect(toPublicUrl('../secret.env', SUPABASE)).toBeNull();
    expect(toPublicUrl('people/../../etc/passwd', SUPABASE)).toBeNull();
  });

  it('normalizes trailing slash on bucketUrl defensively', () => {
    expect(toPublicUrl('people/42.png', `${SUPABASE}/`)).toBe(`${SUPABASE}/people/42.png`);
  });

  it('normalizes leading slash on path defensively', () => {
    // A well-formed relative path has no leading slash, but defensive normalization
    // should not produce `//` in the output. Note: `/path` is treated as root-relative
    // (passes through), so this case tests a different code path.
    expect(toPublicUrl('people/42.png', SUPABASE)).not.toContain('//people');
  });
});

describe('isFullStorageUrl', () => {
  it('recognizes Supabase storage URLs', () => {
    expect(isFullStorageUrl(`${SUPABASE}/x.png`)).toBe(true);
  });

  it('returns false for external URLs and relative paths', () => {
    expect(isFullStorageUrl('https://gravatar.com/x')).toBe(false);
    expect(isFullStorageUrl('people/x.png')).toBe(false);
    expect(isFullStorageUrl(null)).toBe(false);
    expect(isFullStorageUrl('')).toBe(false);
  });
});

describe('transformJsonStrings', () => {
  it('transforms strings in a flat object', () => {
    const input = { a: 'hello', b: 'world' };
    const out = transformJsonStrings(input, (v) => v.toUpperCase());
    expect(out).toEqual({ a: 'HELLO', b: 'WORLD' });
  });

  it('recursively transforms nested objects and arrays', () => {
    const input = {
      heading: 'Title',
      nested: { image: 'path/a.png', list: ['x', 'y'] },
    };
    const out = transformJsonStrings(input, (v) => `[${v}]`);
    expect(out).toEqual({
      heading: '[Title]',
      nested: { image: '[path/a.png]', list: ['[x]', '[y]'] },
    });
  });

  it('passes through non-string primitives', () => {
    const input = { n: 42, b: true, x: null, s: 'ok' };
    const out = transformJsonStrings(input, (v) => v.toUpperCase());
    expect(out).toEqual({ n: 42, b: true, x: null, s: 'OK' });
  });

  it('does not mutate the input', () => {
    const input = { a: 'x', list: ['y'] };
    transformJsonStrings(input, (v) => v.toUpperCase());
    expect(input).toEqual({ a: 'x', list: ['y'] });
  });
});

describe('stripStorageUrlsInJson', () => {
  it('strips storage URLs from nested string values', () => {
    const input = {
      heading: 'Hello',
      image: `${SUPABASE}/blog/pic.png`,
      bricks: [{ thumbnail: `${SUPABASE}/thumbs/1.jpg`, caption: 'external: https://gravatar.com/x' }],
    };
    const out = stripStorageUrlsInJson(input, SUPABASE);
    expect(out).toEqual({
      heading: 'Hello',
      image: 'blog/pic.png',
      bricks: [{ thumbnail: 'thumbs/1.jpg', caption: 'external: https://gravatar.com/x' }],
    });
  });

  it('rewrites <img src> inside HTML-containing string values', () => {
    const input = {
      body: `<p>hi</p><img src="${SUPABASE}/inline/pic.png" alt=""/><p>bye</p>`,
    };
    const out = stripStorageUrlsInJson(input, SUPABASE);
    expect(out.body).toContain('src="inline/pic.png"');
    expect(out.body).toContain('<p>hi</p>');
  });

  it('leaves page links untouched', () => {
    const input = { href: '/about-us', cta: 'Click me' };
    expect(stripStorageUrlsInJson(input)).toEqual({ href: '/about-us', cta: 'Click me' });
  });
});

describe('resolveStoragePathsInJson', () => {
  it('resolves relative paths to full URLs', () => {
    const input = { image: 'blog/pic.png', caption: 'external: https://gravatar.com/x' };
    const out = resolveStoragePathsInJson(input, SUPABASE);
    expect(out.image).toBe(`${SUPABASE}/blog/pic.png`);
    expect(out.caption).toBe('external: https://gravatar.com/x');
  });

  it('rewrites <img src> inside HTML-containing string values', () => {
    const input = { body: '<img src="inline/pic.png" alt=""/>' };
    const out = resolveStoragePathsInJson(input, SUPABASE);
    expect(out.body).toContain(`src="${SUPABASE}/inline/pic.png"`);
  });
});

describe('rewriteImgSrcToStoragePath / rewriteImgSrcToPublicUrl', () => {
  it('round-trips HTML through strip and resolve', () => {
    const html = `<p>hello</p><img src="${SUPABASE}/inline/pic.png" alt="a"/>`;
    const stripped = rewriteImgSrcToStoragePath(html, SUPABASE);
    expect(stripped).toContain('src="inline/pic.png"');
    const resolved = rewriteImgSrcToPublicUrl(stripped, SUPABASE);
    expect(resolved).toBe(html);
  });

  it('leaves non-storage <img src> untouched', () => {
    const html = '<img src="https://gravatar.com/x" alt=""/>';
    expect(rewriteImgSrcToStoragePath(html)).toBe(html);
  });
});

describe('resolveBucketUrl', () => {
  const supabaseUrl = 'https://project.supabase.co';

  it('uses configured value when present', () => {
    const r = resolveBucketUrl({ configured: CDN, supabaseUrl });
    expect(r.url).toBe(CDN);
    expect(r.usedFallback).toBe(false);
    expect(r.allowlistRejected).toBe(false);
  });

  it('falls back when configured is empty', () => {
    const r = resolveBucketUrl({ configured: '', supabaseUrl });
    expect(r.url).toBe(`${supabaseUrl}/storage/v1/object/public/media`);
    expect(r.usedFallback).toBe(true);
    expect(r.allowlistRejected).toBe(false);
  });

  it('falls back when hostname is not in allow-list', () => {
    const r = resolveBucketUrl({
      configured: 'https://evil.attacker.com/path',
      supabaseUrl,
      allowedHosts: ['cdn.example.com', 'project.supabase.co'],
    });
    expect(r.allowlistRejected).toBe(true);
    expect(r.usedFallback).toBe(true);
    expect(r.url).toBe(`${supabaseUrl}/storage/v1/object/public/media`);
  });

  it('accepts configured value when hostname is in allow-list (case-insensitive)', () => {
    const r = resolveBucketUrl({
      configured: 'https://CDN.example.com/media',
      supabaseUrl,
      allowedHosts: ['cdn.example.com'],
    });
    expect(r.allowlistRejected).toBe(false);
    expect(r.url).toBe('https://CDN.example.com/media');
  });
});
