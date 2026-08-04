// Configuration is env-only and validated at boot: a misconfigured origin or a
// missing preview secret must fail the container, never silently serve a weaker
// policy. PLAY_ORIGIN / PORTAL_ORIGIN are explicit values — never inferred from
// the Host header (spec §Terminology).

export interface ServeConfig {
  port: number;
  playOrigin: string;
  portalOrigin: string;
  previewSecrets: string[];
  storageBucket: string;
  supabaseUrl: string;
  supabaseKey: string;
  /** slug/version lookup cache TTL. Hard-capped at 5 s (spec §3). */
  cacheTtlMs: number;
  /** When true, /g/* and /sdk/* require a Host matching playOrigin. */
  strictHost: boolean;
}

const MAX_CACHE_TTL_MS = 5000;

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = (env[name] ?? '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

/** Absolute https (or http for local dev) origin with no path, query or fragment. */
function parseOrigin(name: string, raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be an absolute URL (got '${raw}')`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${name} must be http(s) (got '${raw}')`);
  }
  if (url.username || url.password) throw new Error(`${name} must not contain credentials`);
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${name} must be a bare origin with no path or query (got '${raw}')`);
  }
  return url.origin;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServeConfig {
  const playOrigin = parseOrigin('ARCADE_PLAY_ORIGIN', requireEnv(env, 'ARCADE_PLAY_ORIGIN'));
  const portalOrigin = parseOrigin('ARCADE_PORTAL_ORIGIN', requireEnv(env, 'ARCADE_PORTAL_ORIGIN'));

  const previewSecrets = [
    (env.ARCADE_PREVIEW_HMAC_SECRET ?? '').trim(),
    (env.ARCADE_PREVIEW_HMAC_SECRET_PREVIOUS ?? '').trim(),
  ].filter((s) => s.length > 0);
  if (previewSecrets.length === 0) throw new Error('ARCADE_PREVIEW_HMAC_SECRET is required');

  // Prefer the dedicated read-only credential; SUPABASE_SERVICE_ROLE_KEY is the
  // documented fallback (spec §13 compensating controls).
  const supabaseKey = (env.ARCADE_SUPABASE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (!supabaseKey) throw new Error('ARCADE_SUPABASE_KEY (or SUPABASE_SERVICE_ROLE_KEY) is required');

  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`PORT is invalid: '${env.PORT}'`);

  const rawTtl = Number(env.ARCADE_CACHE_TTL_MS ?? MAX_CACHE_TTL_MS);
  const cacheTtlMs = Number.isFinite(rawTtl) && rawTtl >= 0 ? Math.min(rawTtl, MAX_CACHE_TTL_MS) : MAX_CACHE_TTL_MS;

  return {
    port,
    playOrigin,
    portalOrigin,
    previewSecrets,
    storageBucket: (env.ARCADE_STORAGE_BUCKET ?? 'arcade').trim() || 'arcade',
    supabaseUrl: requireEnv(env, 'SUPABASE_URL'),
    supabaseKey,
    cacheTtlMs,
    strictHost: env.ARCADE_STRICT_HOST === '1' || env.ARCADE_STRICT_HOST === 'true',
  };
}
