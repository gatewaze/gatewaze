// Content-Type comes from the manifest's recorded `content_type` and nowhere
// else — never sniffed from bytes, never derived from the request URL. This
// table is the allowlist that recorded value must land in; anything else is a
// 404 (spec §6).
//
// It mirrors the sync-time extension→MIME map (spec §5 file-type allowlist).

const CANONICAL: Record<string, string> = {
  'text/html': 'text/html; charset=utf-8',
  'text/javascript': 'text/javascript; charset=utf-8',
  'application/javascript': 'text/javascript; charset=utf-8',
  'text/css': 'text/css; charset=utf-8',
  'application/json': 'application/json; charset=utf-8',
  'text/plain': 'text/plain; charset=utf-8',
  'text/markdown': 'text/markdown; charset=utf-8',
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/gif': 'image/gif',
  'image/webp': 'image/webp',
  'image/svg+xml': 'image/svg+xml',
  'image/x-icon': 'image/x-icon',
  'image/vnd.microsoft.icon': 'image/x-icon',
  'audio/mpeg': 'audio/mpeg',
  'audio/ogg': 'audio/ogg',
  'audio/wav': 'audio/wav',
  'audio/x-wav': 'audio/wav',
  'font/woff': 'font/woff',
  'font/woff2': 'font/woff2',
};

/**
 * Validate and canonicalise a manifest-recorded MIME type.
 * Returns null when the value is missing, malformed or not allowlisted.
 */
export function canonicalContentType(recorded: unknown): string | null {
  if (typeof recorded !== 'string') return null;
  const base = recorded.split(';')[0].trim().toLowerCase();
  if (!base) return null;
  return CANONICAL[base] ?? null;
}
