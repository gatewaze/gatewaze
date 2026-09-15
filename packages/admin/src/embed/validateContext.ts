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

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/**
 * Validate a host-supplied GwHostContext before anything reads it.
 * Pure and synchronous — safe to call before touching any config-reading
 * singleton (Supabase client, module registry, etc).
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

  if (!c.supabase || typeof c.supabase !== 'object') {
    return fail('supabase', 'supabase config is required');
  }
  if (!isAbsoluteUrl(c.supabase.url)) {
    return fail('supabase.url', 'supabase.url must be an absolute URL');
  }
  if (!isNonEmptyString(c.supabase.anonKey)) {
    return fail('supabase.anonKey', 'supabase.anonKey is required');
  }

  if (!c.signIn || typeof c.signIn !== 'object') {
    return fail('signIn', 'signIn config is required');
  }
  if (!isAbsoluteUrl(c.signIn.lfidStartUrl)) {
    return fail('signIn.lfidStartUrl', 'signIn.lfidStartUrl must be an absolute URL');
  }
  if (!isAbsoluteUrl(c.signIn.returnUrl)) {
    return fail('signIn.returnUrl', 'signIn.returnUrl must be an absolute URL');
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

  return { ok: true, ctx: c as GwHostContext };
}
