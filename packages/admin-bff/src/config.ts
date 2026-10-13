// Reads and validates the BFF's environment. Every problem is reported at
// start-up rather than on the first request.
import type { BffConfig } from './core/session.js';
import { DEFAULT_SESSION_TTL_SECONDS } from './core/store.js';

export interface BffEnv {
  cfg: BffConfig;
  // Gatewaze API origin for /api/* (GATEWAZE_API_URL).
  apiUrl: string;
  redisUrl: string;
  // 32-byte master keys (ADMIN_BFF_SESSION_SECRET). Separate keys derived
  // from them encrypt the session cookie, the flow cookie and the session
  // records in Redis. The first encrypts, all decrypt, so a new key can be
  // rolled out ahead of removing the old one.
  sessionKeys: Buffer[];
  sessionTtlSeconds: number;
  upstreamTimeoutMs: number;
  trustProxy: string | undefined;
  signInRateLimit: number;
  host: string;
  port: number;
  logLevel: string;
}

export class ConfigError extends Error {}

type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const v = env[name]?.trim();
  if (!v) throw new ConfigError(`${name} is required`);
  return v;
}

// An http(s) URL reduced to its origin (no path, no trailing slash).
function origin(env: Env, name: string, fallback?: string): string {
  const raw = env[name]?.trim() || fallback;
  if (!raw) throw new ConfigError(`${name} is required`);
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    // Reported as a configuration error with the variable's name.
    throw new ConfigError(`${name} is not a URL`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new ConfigError(`${name} must be http or https`);
  if (u.pathname !== '/' || u.search || u.hash) throw new ConfigError(`${name} must be an origin with no path`);
  return u.origin;
}

function positiveInt(env: Env, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new ConfigError(`${name} must be a positive integer`);
  return n;
}

export function parseSessionKeys(raw: string): Buffer[] {
  const keys = raw.split(',').map((k) => k.trim()).filter(Boolean);
  if (!keys.length) throw new ConfigError('ADMIN_BFF_SESSION_SECRET is required');
  return keys.map((k) => {
    if (!/^[0-9a-fA-F]{64}$/.test(k)) {
      throw new ConfigError('ADMIN_BFF_SESSION_SECRET must be 64 hex characters (openssl rand -hex 32)');
    }
    return Buffer.from(k, 'hex');
  });
}

export function loadConfig(env: Env = process.env): BffEnv {
  const cfg: BffConfig = {
    supabaseUrl: origin(env, 'SUPABASE_INTERNAL_URL'),
    publicSupabaseUrl: origin(env, 'SUPABASE_PUBLIC_URL'),
    anonKey: required(env, 'SUPABASE_ANON_KEY'),
    siteUrl: origin(env, 'ADMIN_URL'),
    provider: env.OIDC_IDENTIFIER?.trim() || 'custom:lfid',
  };
  return {
    cfg,
    apiUrl: origin(env, 'GATEWAZE_API_URL'),
    redisUrl: required(env, 'REDIS_URL'),
    sessionKeys: parseSessionKeys(required(env, 'ADMIN_BFF_SESSION_SECRET')),
    sessionTtlSeconds: positiveInt(env, 'ADMIN_BFF_SESSION_TTL_SECONDS', DEFAULT_SESSION_TTL_SECONDS),
    upstreamTimeoutMs: positiveInt(env, 'ADMIN_BFF_UPSTREAM_TIMEOUT_MS', 300_000),
    trustProxy: env.ADMIN_BFF_TRUST_PROXY?.trim() || undefined,
    signInRateLimit: positiveInt(env, 'ADMIN_BFF_SIGNIN_RATE_LIMIT', 30),
    host: env.HOST?.trim() || '0.0.0.0',
    port: positiveInt(env, 'PORT', 3001),
    logLevel: env.LOG_LEVEL?.trim() || 'info',
  };
}
