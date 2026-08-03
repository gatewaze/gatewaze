// The §6 header contract. Every response leaving this origin carries the full
// set — including 404s and the error pages — so a failure never downgrades the
// policy that constrains an embedded game.
//
// Deliberately absent: Cross-Origin-Embedder-Policy and
// Cross-Origin-Resource-Policy (§6), and any Set-Cookie (this origin never
// sets cookies).

const CSP_BASE_DIRECTIVES = [
  ["default-src", ["'self'"]],
  ["script-src", ["'self'", "'unsafe-inline'"]],
  ["style-src", ["'self'", "'unsafe-inline'"]],
  ["img-src", ["'self'", 'data:', 'blob:']],
  ["media-src", ["'self'", 'blob:']],
  ["font-src", ["'self'", 'data:']],
  ["connect-src", ["'self'"]],
  ["frame-src", ["'none'"]],
  ["frame-ancestors", []],
  ["base-uri", ["'none'"]],
  ["form-action", ["'none'"]],
  ["object-src", ["'none'"]],
] as const;

/** The only directives a game may extend, and the exception key that feeds each. */
const EXCEPTION_KEYS: Record<string, string> = {
  connect_src: 'connect-src',
  img_src: 'img-src',
  media_src: 'media-src',
  font_src: 'font-src',
};

const MAX_EXCEPTION_ORIGINS = 8;

/**
 * Re-validate `arcade_games.csp_exceptions` at serve time. The admin API
 * validates on write; this is the defensive second pass, because a bad row
 * (hand-edited, restored from a backup, written by a future bug) must never
 * be able to widen the policy.
 *
 * Returns a map of CSP directive name → extra source expressions. Anything that
 * is not an exact `https://host[:port]` origin under an allowlisted key is
 * silently dropped.
 */
export function sanitiseCspExceptions(raw: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;

  for (const [key, directive] of Object.entries(EXCEPTION_KEYS)) {
    const value = (raw as Record<string, unknown>)[key];
    if (!Array.isArray(value)) continue;

    const origins: string[] = [];
    for (const candidate of value) {
      if (typeof candidate !== 'string') continue;
      const origin = asHttpsOrigin(candidate);
      if (!origin) continue;
      if (!origins.includes(origin)) origins.push(origin);
      if (origins.length >= MAX_EXCEPTION_ORIGINS) break;
    }
    if (origins.length > 0) out[directive] = origins;
  }
  return out;
}

function asHttpsOrigin(candidate: string): string | null {
  const trimmed = candidate.trim();
  if (trimmed.length === 0 || trimmed.length > 255) return null;
  if (trimmed.includes('*')) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  // Reject anything carrying a path/query/fragment — CSP path expressions are
  // inconsistently implemented and dropped across redirects (§6).
  if (url.pathname !== '/' || url.search || url.hash) return null;
  if (url.origin !== trimmed.replace(/\/$/, '')) return null;
  return url.origin;
}

export function buildCsp(portalOrigin: string, exceptions: Record<string, string[]> = {}): string {
  return CSP_BASE_DIRECTIVES.map(([name, sources]) => {
    const values: string[] = [...sources];
    if (name === 'connect-src' || name === 'frame-ancestors') values.push(portalOrigin);
    const extra = exceptions[name];
    if (extra) values.push(...extra);
    return `${name} ${values.join(' ')}`;
  }).join('; ');
}

export interface SecurityHeaderOptions {
  portalOrigin: string;
  cspExceptions?: unknown;
}

export function securityHeaders(opts: SecurityHeaderOptions): Record<string, string> {
  return {
    'Content-Security-Policy': buildCsp(opts.portalOrigin, sanitiseCspExceptions(opts.cspExceptions)),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  };
}
