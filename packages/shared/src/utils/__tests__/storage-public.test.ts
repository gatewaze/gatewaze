// Mirrors gatewaze-modules modules/storage/lib/__tests__/public-url.test.ts; the two copies must keep the same semantics.
import { describe, expect, it } from 'vitest';
import { rewriteStorageUrl, rewriteStorageUrlsInText, storageKey, storagePublicConfig, storagePublicUrl, storageSizedUrl } from '../storage-public';

const cfg = storagePublicConfig({
  STORAGE_PUBLIC_URL: 'https://media.tech.tickets/',
  STORAGE_LEGACY_HOSTS: 'data.tech.tickets, QJZ.supabase.co,techtickets.b-cdn.net,bad host',
});

describe('storagePublicConfig', () => {
  it('keeps only an https origin and plain hostnames', () => {
    expect(cfg).toEqual({ publicUrl: 'https://media.tech.tickets', legacyHosts: ['data.tech.tickets', 'qjz.supabase.co', 'techtickets.b-cdn.net'] });
    expect(storagePublicConfig({ STORAGE_PUBLIC_URL: 'http://x.example' }).publicUrl).toBe('');
    expect(storagePublicConfig({ STORAGE_PUBLIC_URL: 'https://x.example/path' }).publicUrl).toBe('');
    expect(storagePublicConfig({ VITE_STORAGE_PUBLIC_URL: 'https://m.example' }, 'VITE_').publicUrl).toBe('https://m.example');
  });
});

describe('storagePublicUrl and storageSizedUrl', () => {
  it('put media at the root and other buckets under their name', () => {
    expect(storagePublicUrl(cfg, 'media', 'event-previews/a b.jpg')).toBe('https://media.tech.tickets/event-previews/a%20b.jpg');
    expect(storagePublicUrl(cfg, 'event-images', '/x.png')).toBe('https://media.tech.tickets/event-images/x.png');
    expect(storageSizedUrl(cfg, 'media', 'p.jpg', { width: 640, height: 336, fit: 'cover', quality: 85 })).toBe(
      'https://media.tech.tickets/cdn-cgi/image/width=640,height=336,fit=cover,quality=85,format=auto/p.jpg',
    );
  });

  it('give null on a brand still on Supabase', () => {
    const none = storagePublicConfig({});
    expect(storagePublicUrl(none, 'media', 'a')).toBeNull();
    expect(storageSizedUrl(none, 'media', 'a', { width: 1 })).toBeNull();
  });
});

describe('rewriteStorageUrl', () => {
  it("rewrites this brand's object, render and Bunny addresses", () => {
    expect(rewriteStorageUrl('https://data.tech.tickets/storage/v1/object/public/event-images/event-logos/a%20b.png', cfg)).toBe(
      'https://media.tech.tickets/event-images/event-logos/a%20b.png',
    );
    expect(rewriteStorageUrl('https://qjz.supabase.co/storage/v1/object/public/media/event-previews/x.jpg', cfg)).toBe(
      'https://media.tech.tickets/event-previews/x.jpg',
    );
    expect(rewriteStorageUrl('https://qjz.supabase.co/storage/v1/render/image/public/media/x.jpg?width=350&resize=contain&quality=80', cfg)).toBe(
      'https://media.tech.tickets/cdn-cgi/image/width=350,fit=scale-down,quality=80,format=auto/x.jpg',
    );
    expect(rewriteStorageUrl('https://techtickets.b-cdn.net/storage/v1/object/public/media/x.jpg?width=640&aspect_ratio=crop', cfg)).toBe(
      'https://media.tech.tickets/cdn-cgi/image/width=640,fit=cover,quality=80,format=auto/x.jpg',
    );
  });

  it("leaves other brands', external and signed addresses alone", () => {
    for (const u of [
      'https://data.aaif.live/storage/v1/object/public/media/x.jpg',
      'https://example.com/x.jpg',
      'https://data.tech.tickets/storage/v1/object/sign/media/x.jpg?token=t',
      'not a url',
      '',
    ]) {
      expect(rewriteStorageUrl(u, cfg)).toBe(u);
    }
    expect(rewriteStorageUrl('https://data.tech.tickets/storage/v1/object/public/media/x.jpg', storagePublicConfig({}))).toBe(
      'https://data.tech.tickets/storage/v1/object/public/media/x.jpg',
    );
  });

  it('rewrites every address in a block of HTML or JSON', () => {
    const html = '<img src="https://data.tech.tickets/storage/v1/object/public/event-content-images/e/1.png"> <img src="https://data.aaif.live/storage/v1/object/public/event-content-images/e/2.png">';
    expect(rewriteStorageUrlsInText(html, cfg)).toBe(
      '<img src="https://media.tech.tickets/event-content-images/e/1.png"> <img src="https://data.aaif.live/storage/v1/object/public/event-content-images/e/2.png">',
    );
  });
});

describe('platform copy extras', () => {
  it('keeps the bucket prefix rule and does not double-encode', () => {
    expect(storageKey('media', 'a/b.png')).toBe('a/b.png');
    expect(storageKey('speaker-logos', 'a/b.png')).toBe('speaker-logos/a/b.png');
    expect(rewriteStorageUrl('https://qjz.supabase.co/storage/v1/object/public/media/a%20b/c%2Bd.png', cfg)).toBe(
      'https://media.tech.tickets/a%20b/c%2Bd.png',
    );
  });

  it('drops an unknown query on an object address', () => {
    expect(rewriteStorageUrl('https://data.tech.tickets/storage/v1/object/public/media/x.jpg?t=1', cfg)).toBe('https://media.tech.tickets/x.jpg');
  });

  it('does nothing to text on a brand still on Supabase', () => {
    const text = 'see https://data.tech.tickets/storage/v1/object/public/media/x.jpg';
    expect(rewriteStorageUrlsInText(text, storagePublicConfig({}))).toBe(text);
  });
});
describe('private buckets', () => {
  const cfg = { publicUrl: 'https://media.example.com', legacyHosts: ['old.supabase.co'] };
  it('never get a public address, by bucket or as a media folder', () => {
    expect(storagePublicUrl(cfg, 'video-masters', 'v/1.mp4')).toBeNull();
    expect(storagePublicUrl(cfg, 'media', 'video-masters/x.jpg')).toBeNull();
    expect(storagePublicUrl(cfg, 'media', '/Fetch-Artifacts/x')).toBeNull();
    expect(storageSizedUrl(cfg, 'fetch-screenshots', 'a.png', { width: 100 })).toBeNull();
    expect(storagePublicUrl(cfg, 'media', 'video-masters-public/x.jpg')).toBe('https://media.example.com/video-masters-public/x.jpg');
  });
  it('are left alone by the rewrite', () => {
    const old = 'https://old.supabase.co/storage/v1/object/public/video-masters/v/1.mp4';
    expect(rewriteStorageUrl(old, cfg)).toBe(old);
  });
});
