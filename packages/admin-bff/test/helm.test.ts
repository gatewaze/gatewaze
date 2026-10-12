// helm template checks for the adminBff values, in both flag states.
// Skipped when the helm binary is not installed.
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const chart = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../helm/gatewaze');
const hasHelm = spawnSync('helm', ['version'], { stdio: 'ignore' }).status === 0;
const SECRET = 'ab'.repeat(32);
const base = ['--set', 'redis.password=pw', '--set', 'supabase.url=https://sb.example.test', '--set', 'supabase.anonKey=anon'];
const ingress = ['--set', 'ingress.enabled=true', '--set', 'ingress.hosts.admin=admin.example.test'];

// Escapes every regex metacharacter, including backslash, for building patterns from literals.
const escapeRe = (v: string): string => v.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

function render(args: string[]): string {
  return execFileSync('helm', ['template', 'gw', chart, ...base, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function renderError(args: string[]): string {
  const r = spawnSync('helm', ['template', 'gw', chart, ...base, ...args], { encoding: 'utf8' });
  expect(r.status).not.toBe(0);
  return r.stderr;
}

// Splits a multi-document render and returns the document with this kind and name.
// (Several chart templates have CRLF line endings, so they are normalised.)
function doc(out: string, kind: string, name: string): string {
  const found = out
    .replace(/\r\n/g, '\n')
    .split(/^---$/m)
    .find((d) => d.includes(`kind: ${kind}\n`) && d.includes(`  name: ${name}\n`));
  if (!found) throw new Error(`no ${kind} ${name} in the render`);
  return found;
}

describe.skipIf(!hasHelm)('helm: adminBff', () => {
  it('renders nothing for the BFF with both flags false', () => {
    const out = render(ingress);
    expect(out).not.toContain('admin-bff');
    expect(out).not.toContain('VITE_AUTH_MODE');
    expect(out).not.toContain('ADMIN_BFF_SESSION_SECRET');
  });

  it('enabled alone deploys the BFF but leaves the admin and ingress unchanged', () => {
    const off = render(ingress);
    const on = render([...ingress, '--set', 'adminBff.enabled=true', '--set', `adminBff.sessionSecret=${SECRET}`]);
    expect(doc(on, 'Deployment', 'gatewaze-admin-bff')).toContain('admin-bff');
    expect(() => doc(off, 'Deployment', 'gatewaze-admin-bff')).toThrow();
    expect(doc(on, 'Ingress', 'gatewaze')).toBe(doc(off, 'Ingress', 'gatewaze'));
    expect(doc(on, 'Deployment', 'gatewaze-admin')).toBe(doc(off, 'Deployment', 'gatewaze-admin'));
  });

  it('mounts exactly three secret keys, one each, and never the whole Secret', () => {
    const on = render([...ingress, '--set', 'adminBff.enabled=true', '--set', `adminBff.sessionSecret=${SECRET}`]);
    const d = doc(on, 'Deployment', 'gatewaze-admin-bff');
    expect(d).not.toContain('envFrom');
    const keys = [...d.matchAll(/secretKeyRef:\s+name: \S+\s+key: (\S+)/g)].map((m) => m[1]);
    expect(keys).toEqual(['SUPABASE_ANON_KEY', 'REDIS_URL', 'ADMIN_BFF_SESSION_SECRET']);
    expect(d).toContain('runAsNonRoot: true');
    expect(d).toContain('readOnlyRootFilesystem: true');
    expect(d).toContain('value: "https://admin.example.test"');
    expect(d).toContain('value: "custom:lfid"');
    expect(doc(on, 'Secret', 'gatewaze-secret')).toContain(`ADMIN_BFF_SESSION_SECRET: "${Buffer.from(SECRET).toString('base64')}"`);
  });

  it('switchAdmin sets host-session env on the admin and routes the prefixes to the BFF', () => {
    const on = render([...ingress, '--set', 'adminBff.enabled=true', '--set', 'adminBff.switchAdmin=true', '--set', `adminBff.sessionSecret=${SECRET}`]);
    const admin = doc(on, 'Deployment', 'gatewaze-admin');
    expect(admin).toMatch(/name: VITE_AUTH_MODE\s+value: "host-session"/);
    expect(admin).toMatch(/name: VITE_SUPABASE_URL\s+value: "https:\/\/admin\.example\.test"/);
    expect(admin).toMatch(/name: VITE_SUPABASE_PUBLIC_URL\s+value: "https:\/\/sb\.example\.test"/);
    expect(admin).toMatch(/name: VITE_API_URL\s+value: "https:\/\/admin\.example\.test"/);
    const ing = doc(on, 'Ingress', 'gatewaze');
    for (const p of ['/bff', '/rest/v1', '/storage/v1', '/functions/v1', '/realtime/v1', '/api']) {
      expect(ing).toMatch(new RegExp(`path: ${escapeRe(p)}\\s+pathType: Prefix\\s+backend:\\s+service:\\s+name: gatewaze-admin-bff`));
    }
    // "/" stays on the admin nginx.
    expect(ing).toMatch(/path: \/\s+pathType: Prefix\s+backend:\s+service:\s+name: gatewaze-admin\s/);
  });

  it('fails without a session secret when enabled', () => {
    expect(renderError(['--set', 'adminBff.enabled=true'])).toContain('adminBff.sessionSecret is required');
  });

  it('fails on a malformed session secret', () => {
    expect(renderError(['--set', 'adminBff.enabled=true', '--set', 'adminBff.sessionSecret=short'])).toContain('64 hex');
    expect(renderError(['--set', 'adminBff.enabled=true', '--set', `adminBff.sessionSecret=${SECRET}zz`])).toContain('64 hex');
  });

  it('accepts a comma-separated key list for rotation', () => {
    const list = `${SECRET}\\,${'cd'.repeat(32)}`;
    const out = render(['--set', 'adminBff.enabled=true', '--set', `adminBff.sessionSecret=${list}`]);
    expect(doc(out, 'Secret', 'gatewaze-secret')).toContain(Buffer.from(`${SECRET},${'cd'.repeat(32)}`).toString('base64'));
  });

  it('renders the PodDisruptionBudget only when podDisruptionBudget.enabled', () => {
    const on = ['--set', 'adminBff.enabled=true', '--set', `adminBff.sessionSecret=${SECRET}`];
    expect(doc(render(on), 'PodDisruptionBudget', 'gatewaze-admin-bff')).toContain('minAvailable: 1');
    expect(() => doc(render([...on, '--set', 'podDisruptionBudget.enabled=false']), 'PodDisruptionBudget', 'gatewaze-admin-bff')).toThrow();
  });

  it('defaults SUPABASE_INTERNAL_URL to supabase.url, rolls with maxUnavailable 0 and passes the TTL', () => {
    const on = ['--set', 'adminBff.enabled=true', '--set', `adminBff.sessionSecret=${SECRET}`];
    const d = doc(render(on), 'Deployment', 'gatewaze-admin-bff');
    expect(d).toMatch(/name: SUPABASE_INTERNAL_URL\s+value: "https:\/\/sb\.example\.test"/);
    expect(d).toContain('maxUnavailable: 0');
    expect(d).toMatch(/name: ADMIN_BFF_SESSION_TTL_SECONDS\s+value: "604800"/);
    const custom = doc(render([...on, '--set', 'adminBff.supabaseInternalUrl=http://kong:8000', '--set', 'adminBff.sessionTtlSeconds=120']), 'Deployment', 'gatewaze-admin-bff');
    expect(custom).toMatch(/name: SUPABASE_INTERNAL_URL\s+value: "http:\/\/kong:8000"/);
    expect(custom).toMatch(/name: ADMIN_BFF_SESSION_TTL_SECONDS\s+value: "120"/);
  });

  it('accepts a missing chart secret when existingSecret is set', () => {
    const out = render(['--set', 'existingSecret=mine', '--set', 'adminBff.enabled=true']);
    expect(doc(out, 'Deployment', 'gatewaze-admin-bff')).toContain('name: "mine"');
  });

  it('refuses switchAdmin without enabled, and without ingress', () => {
    expect(renderError([...ingress, '--set', 'adminBff.switchAdmin=true'])).toContain('needs adminBff.enabled=true');
    expect(
      renderError(['--set', 'adminBff.enabled=true', '--set', 'adminBff.switchAdmin=true', '--set', `adminBff.sessionSecret=${SECRET}`]),
    ).toContain('needs ingress.enabled=true');
  });

  it('hardens the pod and wires the Service to it on the ingress port', () => {
    const on = render([...ingress, '--set', 'adminBff.enabled=true', '--set', 'adminBff.switchAdmin=true', '--set', `adminBff.sessionSecret=${SECRET}`]);
    const d = doc(on, 'Deployment', 'gatewaze-admin-bff');
    expect(d).toContain('automountServiceAccountToken: false');
    expect(d).toContain('allowPrivilegeEscalation: false');
    expect(d).toMatch(/capabilities:\s+drop: \["ALL"\]/);
    const svc = doc(on, 'Service', 'gatewaze-admin-bff');
    expect(svc).toMatch(/selector:[\s\S]*app\.kubernetes\.io\/component: admin-bff/);
    const svcPort = svc.match(/- port: (\d+)/)![1];
    const ingPorts = [...doc(on, 'Ingress', 'gatewaze').matchAll(/name: gatewaze-admin-bff\s+port:\s+number: (\d+)/g)].map((m) => m[1]);
    expect(ingPorts).toHaveLength(6);
    expect(new Set(ingPorts)).toEqual(new Set([svcPort]));
  });

  it('renders the provider override', () => {
    const d = doc(render(['--set', 'adminBff.enabled=true', '--set', `adminBff.sessionSecret=${SECRET}`, '--set', 'adminBff.provider=custom:other']), 'Deployment', 'gatewaze-admin-bff');
    expect(d).toMatch(/name: OIDC_IDENTIFIER\s+value: "custom:other"/);
  });

  it('renders trustProxy, signInRateLimit and upstreamTimeoutMs only when set', () => {
    const on = ['--set', 'adminBff.enabled=true', '--set', `adminBff.sessionSecret=${SECRET}`];
    const unset = doc(render(on), 'Deployment', 'gatewaze-admin-bff');
    for (const n of ['ADMIN_BFF_TRUST_PROXY', 'ADMIN_BFF_SIGNIN_RATE_LIMIT', 'ADMIN_BFF_UPSTREAM_TIMEOUT_MS']) expect(unset).not.toContain(n);
    const set = doc(
      render([...on, '--set', 'adminBff.trustProxy=10.244.0.0/16', '--set', 'adminBff.signInRateLimit=12', '--set', 'adminBff.upstreamTimeoutMs=9000']),
      'Deployment',
      'gatewaze-admin-bff',
    );
    expect(set).toMatch(/name: ADMIN_BFF_TRUST_PROXY\s+value: "10.244.0.0\/16"/);
    expect(set).toMatch(/name: ADMIN_BFF_SIGNIN_RATE_LIMIT\s+value: "12"/);
    expect(set).toMatch(/name: ADMIN_BFF_UPSTREAM_TIMEOUT_MS\s+value: "9000"/);
  });
});
