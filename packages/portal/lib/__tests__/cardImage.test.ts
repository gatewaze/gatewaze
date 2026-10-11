import { describe, it, expect } from 'vitest';
import { cardImage, CARD_IMAGE_WIDTH, CARD_IMAGE_HEIGHT } from '../cardImage';

const PREVIEW = 'https://qjzldkohlokymerlobfc.supabase.co/storage/v1/object/public/media/event-previews/gc5043.jpg';

describe('cardImage', () => {
  it('rewrites a normalised preview to the render endpoint and declares the box', () => {
    const img = cardImage(PREVIEW);
    expect(img.width).toBe(CARD_IMAGE_WIDTH);
    expect(img.height).toBe(CARD_IMAGE_HEIGHT);
    expect(img.src).toContain('/storage/v1/render/image/public/media/event-previews/gc5043.jpg');
    expect(img.src).toContain('width=640');
    expect(img.src).toContain('height=336');
    expect(img.src).toContain('resize=cover');
    expect(img.sizes).toBeTruthy();
  });

  it('keeps the origin of the incoming URL', () => {
    const img = cardImage(PREVIEW);
    expect(new URL(img.src).origin).toBe('https://qjzldkohlokymerlobfc.supabase.co');
  });

  it('offers a phone-sized candidate whose height keeps the 640x336 ratio', () => {
    const img = cardImage(PREVIEW);
    expect(img.srcSet).toBeTruthy();
    const first = img.srcSet!.split(', ')[0];
    expect(first).toMatch(/ 360w$/);
    const u = new URL(first.split(' ')[0]);
    expect(u.searchParams.get('width')).toBe('360');
    // 360 * 336 / 640 = 189
    expect(u.searchParams.get('height')).toBe('189');
  });

  it('declares every srcSet width exactly once, ascending', () => {
    const img = cardImage(PREVIEW);
    const widths = img.srcSet!.split(', ').map((c) => Number(c.match(/ (\d+)w$/)![1]));
    expect(widths).toEqual([...widths].sort((a, b) => a - b));
    expect(new Set(widths).size).toBe(widths.length);
  });

  // Supabase will not upscale past the stored 640px source: a width=960 request
  // returns a 640x336 body. Advertising a candidate wider than the source would
  // misdescribe its width to the browser, so none may exceed the card width.
  it('never advertises a candidate wider than the stored source', () => {
    const img = cardImage(PREVIEW);
    const widths = img.srcSet!.split(', ').map((c) => Number(c.match(/ (\d+)w$/)![1]));
    expect(Math.max(...widths)).toBe(CARD_IMAGE_WIDTH);
    for (const w of widths) expect(w).toBeLessThanOrEqual(CARD_IMAGE_WIDTH);
  });

  it('asks for a height that preserves the ratio at every candidate width', () => {
    const img = cardImage(PREVIEW);
    for (const candidate of img.srcSet!.split(', ')) {
      const u = new URL(candidate.split(' ')[0]);
      const w = Number(u.searchParams.get('width'));
      const h = Number(u.searchParams.get('height'));
      expect(h).toBe(Math.round((w * CARD_IMAGE_HEIGHT) / CARD_IMAGE_WIDTH));
    }
  });

  // Anything that is not a known-normalised preview must come back untouched,
  // because an event_logo can be any aspect ratio and claiming 640x336 would
  // crop or distort it.
  it('passes through an event_logo in the same bucket but a different folder', () => {
    const logo = 'https://qjzldkohlokymerlobfc.supabase.co/storage/v1/object/public/media/branding/logo.png';
    expect(cardImage(logo)).toEqual({ src: logo });
  });

  // The folder marker must be a whole path segment. A substring test would also
  // match these siblings, whose contents carry no promise of being 640x336.
  it.each([
    'media/not-event-previews/x.jpg',
    'media/legacy-event-previews/x.jpg',
    'media/event-previews-old/x.jpg',
    'media/event-previews',
    'media/event-previews/',
  ])('passes through the near-miss path %s', (path) => {
    const url = `https://qjzldkohlokymerlobfc.supabase.co/storage/v1/object/public/${path}`;
    expect(cardImage(url)).toEqual({ src: url });
  });

  it('still matches the folder when it is nested deeper in the bucket', () => {
    const nested = 'https://qjzldkohlokymerlobfc.supabase.co/storage/v1/object/public/media/brands/event-previews/x.jpg';
    expect(cardImage(nested).width).toBe(CARD_IMAGE_WIDTH);
  });

  it('passes through an externally hosted image', () => {
    const ext = 'https://cdn.example.com/images/poster.jpg';
    expect(cardImage(ext)).toEqual({ src: ext });
  });

  it('passes through a URL that already has a query string', () => {
    const q = `${PREVIEW}?v=2`;
    expect(cardImage(q)).toEqual({ src: q });
  });

  it('passes through a URL with a fragment', () => {
    const f = `${PREVIEW}#frag`;
    expect(cardImage(f)).toEqual({ src: f });
  });

  it.each([
    'data:image/png;base64,iVBORw0KGgo=',
    'javascript:alert(1)',
    'blob:https://example.com/abc',
  ])('passes through the non-http scheme %s without rewriting', (raw) => {
    expect(cardImage(raw)).toEqual({ src: raw });
  });

  it('passes through a relative path', () => {
    expect(cardImage('/local/image.jpg')).toEqual({ src: '/local/image.jpg' });
  });

  it('passes through an empty object path', () => {
    const bare = 'https://qjzldkohlokymerlobfc.supabase.co/storage/v1/object/public/';
    expect(cardImage(bare)).toEqual({ src: bare });
  });

  it('does not let a traversal segment escape the render prefix', () => {
    const nasty = 'https://qjzldkohlokymerlobfc.supabase.co/storage/v1/object/public/media/event-previews/../../../etc/passwd';
    const img = cardImage(nasty);
    // URL parsing normalises the traversal away before we ever see it, so the
    // path no longer contains the normalised folder and it is passed through.
    expect(img.width).toBeUndefined();
    expect(img.src).toBe(nasty);
  });

  it('keeps a percent-encoded filename encoded', () => {
    const enc = 'https://qjzldkohlokymerlobfc.supabase.co/storage/v1/object/public/media/event-previews/a%20b.jpg';
    const img = cardImage(enc);
    expect(img.src).toContain('a%20b.jpg');
  });

  it('works over http for a local Supabase', () => {
    const local = 'http://127.0.0.1:54321/storage/v1/object/public/media/event-previews/x.jpg';
    const img = cardImage(local);
    expect(img.width).toBe(CARD_IMAGE_WIDTH);
    expect(new URL(img.src).origin).toBe('http://127.0.0.1:54321');
  });
});

const CDN = 'https://techtickets.b-cdn.net';

describe('cardImage through a Bunny pull zone', () => {
  it('serves from the pull zone and keeps the object path', () => {
    const img = cardImage(PREVIEW, CDN);
    const u = new URL(img.src);
    expect(u.origin).toBe(CDN);
    // The zone's own origin is the brand's storage domain, so the path that
    // worked against Supabase works against the zone unchanged.
    expect(u.pathname).toBe('/storage/v1/object/public/media/event-previews/gc5043.jpg');
  });

  it('uses the object path, not the Supabase render path', () => {
    const img = cardImage(PREVIEW, CDN);
    expect(img.src).not.toContain('/render/image/');
    expect(img.src).toContain('/object/public/');
  });

  it('asks the Optimizer for the card box with a crop', () => {
    const u = new URL(cardImage(PREVIEW, CDN).src);
    expect(u.searchParams.get('width')).toBe('640');
    expect(u.searchParams.get('height')).toBe('336');
    expect(u.searchParams.get('aspect_ratio')).toBe('crop');
    expect(u.searchParams.get('quality')).toBe('85');
  });

  it('builds every srcSet candidate on the pull zone at the right ratio', () => {
    const img = cardImage(PREVIEW, CDN);
    const candidates = img.srcSet!.split(', ');
    expect(candidates).toHaveLength(3);
    for (const candidate of candidates) {
      const [href, descriptor] = candidate.split(' ');
      const u = new URL(href);
      expect(u.origin).toBe(CDN);
      const w = Number(u.searchParams.get('width'));
      expect(`${w}w`).toBe(descriptor);
      expect(Number(u.searchParams.get('height'))).toBe(
        Math.round((w * CARD_IMAGE_HEIGHT) / CARD_IMAGE_WIDTH),
      );
      expect(w).toBeLessThanOrEqual(CARD_IMAGE_WIDTH);
    }
  });

  it('still declares the same intrinsic box as the Supabase path', () => {
    const viaCdn = cardImage(PREVIEW, CDN);
    const viaSupabase = cardImage(PREVIEW);
    expect(viaCdn.width).toBe(viaSupabase.width);
    expect(viaCdn.height).toBe(viaSupabase.height);
    expect(viaCdn.sizes).toBe(viaSupabase.sizes);
  });

  // An unusable zone value must not break images. Falling back to the Supabase
  // render endpoint keeps right-sized output; the brand just pays the quota.
  it.each([
    ['', 'empty'],
    [undefined, 'absent'],
    ['not a url', 'unparseable'],
    ['ftp://techtickets.b-cdn.net', 'non-http scheme'],
    ['https://user:pw@techtickets.b-cdn.net', 'embedded credentials'],
  ])('falls back to the Supabase render endpoint when the zone is %s (%s)', (value, _label) => {
    const img = cardImage(PREVIEW, value as string | undefined);
    expect(img.src).toContain('/storage/v1/render/image/public/');
    expect(new URL(img.src).origin).toBe('https://qjzldkohlokymerlobfc.supabase.co');
    expect(img.width).toBe(CARD_IMAGE_WIDTH);
  });

  it('keeps only the origin when the zone value carries a path or query', () => {
    const img = cardImage(PREVIEW, 'https://techtickets.b-cdn.net/some/path?token=abc');
    const u = new URL(img.src);
    expect(u.origin).toBe(CDN);
    expect(u.pathname).toBe('/storage/v1/object/public/media/event-previews/gc5043.jpg');
    expect(u.searchParams.get('token')).toBeNull();
  });

  it('does not route a non-preview image through the zone', () => {
    const logo = 'https://qjzldkohlokymerlobfc.supabase.co/storage/v1/object/public/media/branding/logo.png';
    expect(cardImage(logo, CDN)).toEqual({ src: logo });
  });

  it('does not route a non-http source through the zone', () => {
    const raw = 'javascript:alert(1)';
    expect(cardImage(raw, CDN)).toEqual({ src: raw });
  });
});
