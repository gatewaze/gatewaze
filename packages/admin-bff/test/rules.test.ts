// Unit tests for the BFF's own rules: cookie naming and configuration. The
// framework-free rules (CSRF, query tokens, paths, return_to) are tested in
// @gatewaze/host-session.
import { describe, expect, it } from 'vitest';
import { cookieNames } from '../src/app.js';
import { ConfigError, loadConfig, parseSessionKeys } from '../src/config.js';

describe('cookieNames', () => {
  it('uses __Host- names and Secure on https', () => {
    expect(cookieNames('https://admin.example.test')).toEqual({
      session: '__Host-gw-admin-session',
      flow: '__Host-gw-admin-flow',
      secure: true,
    });
  });
  it('uses plain names without Secure on http localhost', () => {
    expect(cookieNames('http://localhost:5274').secure).toBe(false);
    expect(cookieNames('http://admin.gatewaze.localhost').session).toBe('gw-admin-session');
  });
  it('refuses http on any other host', () => {
    expect(() => cookieNames('http://admin.example.test')).toThrow(/https/);
  });
});

describe('loadConfig', () => {
  const env = {
    SUPABASE_INTERNAL_URL: 'http://kong:8000/',
    SUPABASE_PUBLIC_URL: 'https://x.supabase.co',
    SUPABASE_ANON_KEY: 'anon',
    ADMIN_URL: 'https://admin.example.test',
    GATEWAZE_API_URL: 'http://api:3002',
    REDIS_URL: 'redis://:pw@redis:6379',
    ADMIN_BFF_SESSION_SECRET: 'a'.repeat(64),
  };
  it('reads a complete environment', () => {
    const c = loadConfig(env);
    expect(c.cfg.supabaseUrl).toBe('http://kong:8000');
    expect(c.cfg.provider).toBe('custom:lfid');
    expect(c.port).toBe(3001);
    expect(c.sessionKeys[0]).toHaveLength(32);
  });
  for (const name of Object.keys(env)) {
    it(`requires ${name}`, () => {
      expect(() => loadConfig({ ...env, [name]: '' })).toThrow(ConfigError);
    });
  }
  it('rejects PORT=0 and a non-integer or non-numeric TTL, and reads a valid one', () => {
    expect(() => loadConfig({ ...env, PORT: '0' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...env, ADMIN_BFF_SESSION_TTL_SECONDS: 'abc' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...env, ADMIN_BFF_SESSION_TTL_SECONDS: '1.5' })).toThrow(ConfigError);
    expect(loadConfig({ ...env, ADMIN_BFF_SESSION_TTL_SECONDS: '120' }).sessionTtlSeconds).toBe(120);
  });
  it('rejects a non-http URL, a query and a hash', () => {
    expect(() => loadConfig({ ...env, ADMIN_URL: 'ftp://x' })).toThrow(/http or https/);
    expect(() => loadConfig({ ...env, ADMIN_URL: 'https://admin.example.test/?a=1' })).toThrow(/origin/);
    expect(() => loadConfig({ ...env, ADMIN_URL: 'https://admin.example.test/#x' })).toThrow(/origin/);
  });
  it('rejects a secret that is only separators', () => {
    expect(() => loadConfig({ ...env, ADMIN_BFF_SESSION_SECRET: ',' })).toThrow(ConfigError);
  });
  it('rejects a URL with a path', () => {
    expect(() => loadConfig({ ...env, ADMIN_URL: 'https://admin.example.test/app' })).toThrow(/origin/);
  });
  it('rejects a short or non-hex secret', () => {
    expect(() => parseSessionKeys('abc')).toThrow(ConfigError);
    expect(() => parseSessionKeys('z'.repeat(64))).toThrow(ConfigError);
  });
  it('accepts a comma-separated key list for rotation', () => {
    expect(parseSessionKeys(`${'a'.repeat(64)},${'b'.repeat(64)}`)).toHaveLength(2);
  });
});
