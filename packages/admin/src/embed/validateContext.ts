import type { GwEmbedFatalError, GwHostContext } from './types';

export type ValidationResult =
  | { ok: true; ctx: GwHostContext }
  | { ok: false; error: GwEmbedFatalError };

function fail(field: string, message: string): ValidationResult {
  return {
    ok: false,
    error: {
      error_type: 'config_invalid',
      code: `gw_ctx_${field}_invalid`,
      message,
      field,
      recoverable: false,
    },
  };
}

// One segment per '/', each [A-Za-z0-9_-]+, no trailing slash, no empty
// segments — matches a host route prefix like '/apps/gw'.
const BASENAME_RE = /^\/[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isAbsoluteUrl(v: unknown): v is string {
  if (!isNonEmptyString(v)) return false;
  try {
    new URL(v);
    return true;
  } catch {
    return false;
  }
}

/**
 * Same-origin absolute path: leading '/', not '//' (protocol-relative —
 * a cross-origin escape hatch), no scheme/host, no trailing slash
 * (except the bare '/' root), no whitespace. The Supabase-access-token
 * containment guarantee depends on apiBaseUrl always resolving
 * same-origin, so this check has no "trust the caller" fallback.
 */
function isSameOriginApiBaseUrl(v: unknown): v is string {
  if (v === '') return true;
  if (typeof v !== 'string') return false;
  if (v.length === 0) return false;
  if (!v.startsWith('/')) return false;
  if (v.startsWith('//')) return false;
  if (v.includes('://')) return false;
  if (/\s/.test(v)) return false;
  if (v !== '/' && v.endsWith('/')) return false;
  return true;
}

/** Absolute https URL, or http on localhost (the loader's rule for source.baseUrl). */
function isHttpsOrLocalhostUrl(v: unknown): v is string {
  if (!isNonEmptyString(v)) return false;
  try {
    const u = new URL(v);
    if (u.protocol === 'https:') return true;
    // http only for local development: localhost, 127.0.0.1 and *.localhost
    // (e.g. supabase.gatewaze.localhost), which browsers resolve to loopback.
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname.endsWith('.localhost'));
  } catch {
    return false;
  }
}

/** Absolute URL on the page's own origin. */
function isSameOriginAbsoluteUrl(v: unknown): v is string {
  if (!isAbsoluteUrl(v)) return false;
  try {
    return new URL(v).origin === window.location.origin;
  } catch {
    return false;
  }
}

/**
 * A session route: a same-origin absolute path ('/x', never '//x') or an
 * absolute URL on the page's origin. The session cookie only rides
 * same-origin requests, and nothing session-related may leave the origin.
 */
function isSameOriginRoute(v: unknown): v is string {
  if (!isNonEmptyString(v) || /\s/.test(v)) return false;
  if (v.startsWith('/')) return !v.startsWith('//') && !v.startsWith('/\\');
  return isSameOriginAbsoluteUrl(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/**
 * Validate a host-supplied GwHostContext before anything reads it.
 * Synchronous and side-effect free (host-session mode reads
 * window.location.origin for its same-origin rules) — safe to call before
 * touching any config-reading singleton (Supabase client, module registry, etc).
 */
export function validateGwHostContext(ctx: unknown): ValidationResult {
  if (!ctx || typeof ctx !== 'object') {
    return fail('root', 'GwHostContext must be an object');
  }
  const c = ctx as Partial<GwHostContext>;

  if (!isNonEmptyString(c.basename) || !BASENAME_RE.test(c.basename)) {
    return fail(
      'basename',
      "basename must be a leading-slash, no-trailing-slash, URL-path-safe string (e.g. '/apps/gw')",
    );
  }

  if (!isSameOriginApiBaseUrl(c.apiBaseUrl)) {
    return fail(
      'apiBaseUrl',
      "apiBaseUrl must be '' or a same-origin absolute path (leading '/', no scheme/host, no trailing slash)",
    );
  }

  // Host-session mode: checked first because it changes the supabase.url
  // and signIn rules below.
  const hostMode = c.session !== undefined;
  if (hostMode) {
    const s = c.session as Partial<NonNullable<GwHostContext['session']>> | null;
    if (!s || typeof s !== 'object' || s.mode !== 'host') {
      return fail('session', "session must be { mode: 'host', meUrl, logoutUrl } when provided");
    }
    if (!isSameOriginRoute(s.meUrl)) {
      return fail('session.meUrl', "session.meUrl must be a same-origin path or URL");
    }
    if (!isSameOriginRoute(s.logoutUrl)) {
      return fail('session.logoutUrl', "session.logoutUrl must be a same-origin path or URL");
    }
  }

  if (!c.supabase || typeof c.supabase !== 'object') {
    return fail('supabase', 'supabase config is required');
  }
  if (hostMode) {
    // The cookie-holding proxy must be this origin, or the real token would
    // be needed in the page to reach Supabase.
    if (!isSameOriginAbsoluteUrl(c.supabase.url)) {
      return fail('supabase.url', "supabase.url must be an absolute URL on the page's own origin in host-session mode");
    }
  } else if (!isAbsoluteUrl(c.supabase.url)) {
    return fail('supabase.url', 'supabase.url must be an absolute URL');
  }
  if (!isNonEmptyString(c.supabase.anonKey)) {
    return fail('supabase.anonKey', 'supabase.anonKey is required');
  }
  // Required in host-session mode: there supabase.url is the host's proxy,
  // and without the real URL saved image URLs would point at the host.
  if (hostMode && c.supabase.publicUrl === undefined) {
    return fail('supabase.publicUrl', 'supabase.publicUrl is required in host-session mode');
  }
  if (c.supabase.publicUrl !== undefined && !isHttpsOrLocalhostUrl(c.supabase.publicUrl)) {
    return fail('supabase.publicUrl', 'supabase.publicUrl must be an absolute https URL (http only for localhost, 127.0.0.1 or *.localhost)');
  }

  // Optional in host-session mode (the host owns sign-in), but checked when given.
  if (!hostMode || c.signIn !== undefined) {
    if (!c.signIn || typeof c.signIn !== 'object') {
      return fail('signIn', 'signIn config is required');
    }
    if (!isAbsoluteUrl(c.signIn.startUrl)) {
      return fail('signIn.startUrl', 'signIn.startUrl must be an absolute URL');
    }
    if (!isAbsoluteUrl(c.signIn.returnUrl)) {
      return fail('signIn.returnUrl', 'signIn.returnUrl must be an absolute URL');
    }
    // Host-session mode navigates to startUrl when the session is lost, so a
    // javascript: or data: URL would run in the page. Only http(s) is allowed.
    if (hostMode && !/^https?:$/.test(new URL(c.signIn.startUrl).protocol)) {
      return fail('signIn.startUrl', 'signIn.startUrl must be an http(s) URL in host-session mode');
    }
  }

  if (!c.enabled || typeof c.enabled !== 'object') {
    return fail('enabled', 'enabled config is required');
  }
  if (!isStringArray(c.enabled.moduleIds)) {
    return fail('enabled.moduleIds', 'enabled.moduleIds must be a string array');
  }
  if (!isStringArray(c.enabled.features)) {
    return fail('enabled.features', 'enabled.features must be a string array');
  }

  if (c.storageKeySuffix !== undefined && !isNonEmptyString(c.storageKeySuffix)) {
    return fail('storageKeySuffix', 'storageKeySuffix must be a non-empty string when provided');
  }

  if (c.loadingIndicator !== undefined && typeof c.loadingIndicator !== 'function') {
    return fail('loadingIndicator', 'loadingIndicator must be a function returning an HTMLElement when provided');
  }

  return { ok: true, ctx: c as GwHostContext };
}
