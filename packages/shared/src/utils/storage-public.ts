/**
 * Public addresses for files in a brand's storage, with no dependencies, so
 * server code, admin pages and portal pages can all use the same rules.
 *
 * A brand that has moved off Supabase Storage sets STORAGE_PUBLIC_URL (the
 * public origin of its R2 bucket) and STORAGE_LEGACY_HOSTS (the hosts its
 * old Supabase addresses used). Every Supabase bucket was copied into that
 * one bucket: `media` at the root, every other bucket under `<bucket>/`.
 * A brand without STORAGE_PUBLIC_URL keeps its Supabase addresses.
 *
 * A copy of gatewaze-modules modules/storage/lib/public-url.ts. Keep the two
 * in step: server code, module code and these pages must agree on every address.
 */

export interface StoragePublicConfig {
  /** e.g. https://media.example.com, no trailing slash. Empty when the brand is on Supabase. */
  publicUrl: string;
  /** Lowercase hostnames whose Supabase storage addresses belong to this brand. */
  legacyHosts: string[];
}

export interface PublicSize {
  width: number;
  height?: number;
  fit?: 'contain' | 'cover';
  quality?: number;
}

const ORIGIN = /^https:\/\/[A-Za-z0-9.-]+$/;

function trimEnd(s: string): string {
  let e = s.length;
  while (e > 0 && s[e - 1] === '/') e--;
  return s.slice(0, e);
}

function trimStart(s: string): string {
  let i = 0;
  while (i < s.length && s[i] === '/') i++;
  return s.slice(i);
}
const HOST = /^[a-z0-9.-]+$/;

/** Reads the two settings, ignoring anything that is not a plain https origin or hostname. */
export function storagePublicConfig(env: Record<string, string | undefined>, prefix = ''): StoragePublicConfig {
  const raw = String(env[`${prefix}STORAGE_PUBLIC_URL`] ?? '').trim();
  const trimmed = trimEnd(raw);
  const publicUrl = ORIGIN.test(trimmed) ? trimmed : '';
  const legacyHosts = String(env[`${prefix}STORAGE_LEGACY_HOSTS`] ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => HOST.test(h));
  return { publicUrl, legacyHosts };
}

/** Where a Supabase bucket's file is kept in the brand's one bucket. */
export function storageKey(bucket: string, path: string): string {
  return bucket === 'media' ? path : `${bucket}/${path}`;
}

/** Encodes each segment and keeps the slashes. */
export function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

function decodeSegments(path: string): string {
  return path
    .split('/')
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    })
    .join('/');
}

/** The public address of a file, or null when the brand is still on Supabase (callers keep their own address). */
export function storagePublicUrl(cfg: StoragePublicConfig, bucket: string, path: string): string | null {
  if (!cfg.publicUrl) return null;
  return `${cfg.publicUrl}/${encodeKey(storageKey(bucket, trimStart(path)))}`;
}

/** A resized copy through Cloudflare, or null when the brand is still on Supabase. */
export function storageSizedUrl(cfg: StoragePublicConfig, bucket: string, path: string, size: PublicSize): string | null {
  if (!cfg.publicUrl) return null;
  const opts = [`width=${Math.round(size.width)}`];
  if (size.height) opts.push(`height=${Math.round(size.height)}`);
  opts.push(`fit=${size.fit === 'cover' ? 'cover' : 'scale-down'}`, `quality=${size.quality ?? 80}`, 'format=auto');
  return `${cfg.publicUrl}/cdn-cgi/image/${opts.join(',')}/${encodeKey(storageKey(bucket, trimStart(path)))}`;
}

const STORAGE_PATH = /^\/storage\/v1\/(object|render\/image)\/public\/([^/]+)\/(.+)$/;

/**
 * Turns one of this brand's old Supabase (or Bunny) storage addresses into
 * its R2 address. Anything else comes back unchanged: other brands'
 * addresses, external images, signed URLs, and every address on a brand
 * without STORAGE_PUBLIC_URL.
 */
export function rewriteStorageUrl(url: string, cfg: StoragePublicConfig): string {
  if (!cfg.publicUrl || !url || typeof url !== 'string') return url;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (!cfg.legacyHosts.includes(u.hostname.toLowerCase())) return url;
  const m = STORAGE_PATH.exec(u.pathname);
  if (!m) return url;
  const [, kind, bucket, rest] = m;
  const path = decodeSegments(rest!);
  if (kind === 'render/image') {
    const width = Number(u.searchParams.get('width'));
    if (width > 0) {
      const height = Number(u.searchParams.get('height')) || undefined;
      const quality = Number(u.searchParams.get('quality')) || undefined;
      const fit = u.searchParams.get('resize') === 'cover' ? 'cover' : 'contain';
      return storageSizedUrl(cfg, bucket!, path, { width, height, fit, quality }) ?? url;
    }
  }
  // Bunny resize parameters on an object address.
  const bw = Number(u.searchParams.get('width'));
  if (kind === 'object' && bw > 0) {
    const bh = Number(u.searchParams.get('height')) || undefined;
    const quality = Number(u.searchParams.get('quality')) || undefined;
    return storageSizedUrl(cfg, bucket!, path, { width: bw, height: bh, quality, fit: u.searchParams.get('aspect_ratio') ? 'cover' : 'contain' }) ?? url;
  }
  return storagePublicUrl(cfg, bucket!, path) ?? url;
}

/** Rewrites every one of this brand's storage addresses inside a block of text (HTML, JSON). */
export function rewriteStorageUrlsInText(text: string, cfg: StoragePublicConfig): string {
  if (!cfg.publicUrl || !text) return text;
  return text.replace(/https?:\/\/[A-Za-z0-9.-]+\/storage\/v1\/(?:object|render\/image)\/public\/[^\s"'<>)\\]+/g, (m) => rewriteStorageUrl(m, cfg));
}
