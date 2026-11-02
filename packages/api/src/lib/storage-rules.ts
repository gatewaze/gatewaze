/**
 * Who may write what through POST /api/storage/sign-upload and
 * POST /api/storage/delete.
 *
 * These are the rules Supabase Storage's RLS policies enforced before a brand
 * moved its buckets to R2, made stricter where the old policies were loose
 * (tech.tickets let anyone write and delete in event-images; here only admins
 * write the legacy buckets).
 *
 *   bucket            key                                  insert   overwrite / delete
 *   media             profiles/...                         auth     admin
 *   media             speaker-submissions/..., talks/...   anon     admin   (server picks the key)
 *   media             anything else                        admin    admin
 *     (incl. winner-images/: R2 keeps the winner-images bucket in the same
 *      folder, so a looser media rule would let users overwrite that bucket)
 *   invite-templates  anything                             auth     auth
 *   any other bucket  anything                             admin    admin
 *   private buckets   never signed here
 */

import { randomUUID } from 'node:crypto';

export type Role = 'anon' | 'authenticated' | 'admin';
export type Operation = 'insert' | 'overwrite' | 'delete';

/** Buckets whose objects are never public. Their readers use signed reads. */
export const PRIVATE_BUCKETS: ReadonlySet<string> = new Set([
  'video-masters',
  'fetch-screenshots',
  'fetch-artifacts',
]);

/** media prefixes anyone may upload to; the server picks the final key. */
export const SERVER_KEYED_PREFIXES = ['speaker-submissions/', 'talks/'] as const;

const RANK: Record<Role, number> = { anon: 0, authenticated: 1, admin: 2 };

/** A bucket name as S3 and the storage module accept it. */
export function isValidBucketName(bucket: unknown): bucket is string {
  return typeof bucket === 'string' && /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket);
}

/**
 * The path when it is a safe object key, else null. The storage module's
 * assertSafeKey rules (no leading slash, no `..`, no backslash, `?`, `#` or
 * control characters, at most 1024 characters) plus: no empty or `.`
 * segments, no trailing slash.
 */
export function safeObjectPath(path: unknown): string | null {
  if (typeof path !== 'string') return null;
  if (!path || path.length > 1024 || path.startsWith('/') || path.endsWith('/') || path.includes('..')) return null;
  if (/[\\?#\x00-\x1f\x7f]/.test(path)) return null;
  if (path.split('/').some((seg) => seg === '' || seg === '.')) return null;
  return path;
}

/** The server-keyed prefix this media path is under, or null. */
export function serverKeyedPrefix(bucket: string, path: string): string | null {
  if (bucket !== 'media') return null;
  return SERVER_KEYED_PREFIXES.find((p) => path.startsWith(p)) ?? null;
}

/** The least role allowed to do `op` at bucket/path, or 'never'. */
export function requiredRole(bucket: string, path: string, op: Operation): Role | 'never' {
  if (PRIVATE_BUCKETS.has(bucket)) return 'never';
  if (bucket === 'media') {
    // media sits at the root of the provider bucket and every other bucket
    // under `<bucket>/`, so a media path starting with a private bucket's
    // name is that private bucket's object.
    if (PRIVATE_BUCKETS.has(path.split('/')[0] ?? '')) return 'never';
    if (path.startsWith('profiles/')) return op === 'insert' ? 'authenticated' : 'admin';
    if (serverKeyedPrefix(bucket, path)) return op === 'insert' ? 'anon' : 'admin';
    return 'admin';
  }
  if (bucket === 'invite-templates') return 'authenticated';
  return 'admin';
}

export function roleSatisfies(have: Role, need: Role): boolean {
  return RANK[have] >= RANK[need];
}

const MB = 1024 * 1024;
export const MAX_BYTES_VIDEO = 500 * MB;
export const MAX_BYTES_OTHER = 50 * MB;

/** Slide decks: speakers upload these to talks/ (ConfirmedSpeakerTasks). */
const PRESENTATION_TYPES: ReadonlySet<string> = new Set([
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.apple.keynote',
]);

/** Other non-media types the admin uploaders need (downloads). */
const ADMIN_DOCUMENT_TYPES: ReadonlySet<string> = new Set([
  'application/zip',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
]);

/**
 * The byte cap for a content type the caller may upload, or null when the
 * type is not allowed. SVG can carry script and is served from the brand's
 * public media domain, so only admins may upload it. Only the admin
 * uploaders need video, so the 500 MB cap is theirs alone.
 */
export function maxBytesFor(contentType: string, role: Role): number | null {
  if (!/^[a-z0-9][a-z0-9.+-]{0,126}\/[a-z0-9][a-z0-9.+-]{0,126}$/.test(contentType)) return null;
  if (contentType === 'image/svg+xml') return role === 'admin' ? MAX_BYTES_OTHER : null;
  if (contentType.startsWith('video/')) return role === 'admin' ? MAX_BYTES_VIDEO : null;
  if (contentType.startsWith('image/') || contentType.startsWith('font/') || contentType === 'application/pdf') {
    return MAX_BYTES_OTHER;
  }
  if (PRESENTATION_TYPES.has(contentType)) return MAX_BYTES_OTHER;
  if (role === 'admin' && ADMIN_DOCUMENT_TYPES.has(contentType)) return MAX_BYTES_OTHER;
  return null;
}

/** A filename reduced to `[a-z0-9._-]`, at most 100 characters, extension kept. */
export function safeFileName(name: string): string {
  const base = name.split('/').pop() ?? '';
  let s = base
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/-{2,}/g, '-');
  // A loop rather than /[.-]+$/, which backtracks on long runs.
  let start = 0;
  let end = s.length;
  while (start < end && (s[start] === '.' || s[start] === '-')) start += 1;
  while (end > start && (s[end - 1] === '.' || s[end - 1] === '-')) end -= 1;
  s = s.slice(start, end);
  if (s.length > 100) {
    const dot = s.lastIndexOf('.');
    const ext = dot > 0 && s.length - dot <= 10 ? s.slice(dot) : '';
    s = s.slice(0, 100 - ext.length) + ext;
  }
  return s || 'file';
}

/** `<prefix><uuid>-<safe name>`: the key the server picks for a server-keyed upload. */
export function serverChosenPath(prefix: string, requestedPath: string): string {
  return `${prefix}${randomUUID()}-${safeFileName(requestedPath.slice(prefix.length))}`;
}
