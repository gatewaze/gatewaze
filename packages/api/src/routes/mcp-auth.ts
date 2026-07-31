/**
 * MCP authorization server (spec-mcp-lfid-access.md §3) — OAuth 2.1 + PKCE.
 *
 * The MCP endpoint (mcp.<brand>) is the resource server; THIS is the
 * authorization server it advertises. The login step is pluggable at
 * request time (§3): if the lfid-auth module is installed+enabled the user
 * signs in via the LF Auth0 tenant; otherwise via Gatewaze's standard
 * magic-link (Supabase email OTP). Either way we provision the platform
 * identity (§3.1), resolve group/grant scopes (§2/§4), and complete the
 * client's PKCE flow with our own tokens.
 *
 * Client registration: Client ID Metadata Documents (client_id is an HTTPS
 * URL serving its own metadata — the 2026-07-28 direction) with Dynamic
 * Client Registration kept as fallback (stored in Redis).
 *
 * Transient state (authorization requests, codes, DCR clients) lives in
 * Redis; durable sessions (refresh tokens) in mcp_sessions.
 */
import { randomBytes, createHash } from 'crypto';
import { Router, type Request, type Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { labeledRouter } from '../lib/router-registry.js';
import { getSupabase } from '../lib/supabase.js';
import { getRedisConnection } from '../lib/queue/index.js';
import { logger } from '../lib/logger.js';
import { ensureAuthAndPerson } from '../lib/mcp-auth/provision.js';
import { resolveAccess } from '../lib/mcp-auth/scopes.js';
import { mintAccessToken, newRefreshToken, sha256, mcpAudience } from '../lib/mcp-auth/tokens.js';

export const mcpAuthRouter: Router = labeledRouter('public');

const CODE_TTL_S = 300;
const AUTHREQ_TTL_S = 900;
const REFRESH_TTL_S = 30 * 24 * 3600;

const apiBase = (): string => (process.env.API_URL ?? 'http://localhost:3002').replace(/\/+$/, '');

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function redis() {
  const conn = getRedisConnection('client');
  if (!conn) throw new Error('Redis unavailable');
  return conn;
}

// ── Login-mode resolution (pluggable per spec §3) ─────────────────────────

interface LfidConfig { startUrl: string }

/**
 * LFID mode rides the lfid-auth module's EXISTING sign-in flow (the
 * integrations-lfid-callback edge function): its callback URL is already
 * registered in the LF Auth0 application, so no Auth0 tenant changes are
 * needed. The function validates our return_url origin against the
 * module's AUTH0_ALLOWED_RETURN_ORIGINS (self-service in admin
 * Integrations settings) and hands the Supabase session back in the URL
 * fragment; provisioning (auth user + canonical person reconciliation)
 * happens inside that function — the platform's single LFID path.
 */
async function lfidConfig(): Promise<LfidConfig | null> {
  const { data } = await getSupabase()
    .from('installed_modules')
    .select('status, config')
    .eq('id', 'lfid-auth')
    .maybeSingle();
  if (!data || data.status !== 'enabled') return null;
  const cfg = (data.config ?? {}) as Record<string, string>;
  if (!cfg.AUTH0_DOMAIN || !cfg.AUTH0_CLIENT_ID) return null;
  const supabasePublic = (process.env.SUPABASE_PUBLIC_URL ?? '').replace(/\/+$/, '');
  if (!supabasePublic) return null;
  return { startUrl: `${supabasePublic}/functions/v1/integrations-lfid-callback` };
}

// ── Client resolution: CIMD primary, DCR fallback ─────────────────────────

interface ClientMeta { clientId: string; clientName: string; redirectUris: string[] }

async function resolveClient(clientId: string): Promise<ClientMeta | null> {
  if (/^https:\/\//.test(clientId)) {
    // Client ID Metadata Document: the client_id IS a URL to its metadata.
    try {
      const res = await fetch(clientId, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      const doc = (await res.json()) as { client_id?: string; client_name?: string; redirect_uris?: string[] };
      if (doc.client_id !== clientId || !Array.isArray(doc.redirect_uris) || doc.redirect_uris.length === 0) return null;
      return { clientId, clientName: doc.client_name ?? new URL(clientId).hostname, redirectUris: doc.redirect_uris };
    } catch {
      return null;
    }
  }
  const raw = await (await redis()).get(`mcp:client:${clientId}`);
  if (!raw) return null;
  const doc = JSON.parse(raw) as { client_name?: string; redirect_uris: string[] };
  return { clientId, clientName: doc.client_name ?? clientId, redirectUris: doc.redirect_uris };
}

// ── Discovery metadata ────────────────────────────────────────────────────

mcpAuthRouter.get('/.well-known/oauth-authorization-server', (_req, res) => {
  const base = apiBase();
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({
    issuer: base,
    authorization_endpoint: `${base}/api/mcp-auth/authorize`,
    token_endpoint: `${base}/api/mcp-auth/token`,
    registration_endpoint: `${base}/api/mcp-auth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [],
  });
});

// ── DCR fallback ──────────────────────────────────────────────────────────

mcpAuthRouter.post('/api/mcp-auth/register', async (req, res) => {
  try {
    const body = (req.body ?? {}) as { client_name?: string; redirect_uris?: unknown; application_type?: string };
    if (!Array.isArray(body.redirect_uris) || body.redirect_uris.length === 0 ||
        !body.redirect_uris.every((u) => typeof u === 'string' && /^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)/.test(u))) {
      return res.status(400).json({ error: 'invalid_redirect_uri' });
    }
    const clientId = `dcr_${b64url(randomBytes(18))}`;
    await (await redis()).set(
      `mcp:client:${clientId}`,
      JSON.stringify({ client_name: body.client_name ?? 'MCP client', redirect_uris: body.redirect_uris }),
      'EX', 180 * 24 * 3600,
    );
    res.status(201).json({
      client_id: clientId,
      client_name: body.client_name,
      redirect_uris: body.redirect_uris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    });
  } catch (err) {
    logger.error({ err }, '[mcp-auth] register failed');
    res.status(500).json({ error: 'server_error' });
  }
});

// ── /authorize — validate, then branch to the brand's login mode ──────────

mcpAuthRouter.get('/api/mcp-auth/authorize', async (req, res) => {
  try {
    const q = req.query as Record<string, string>;
    if (q.response_type !== 'code') return res.status(400).send('unsupported response_type');
    if (!q.code_challenge || q.code_challenge_method !== 'S256') {
      return res.status(400).send('PKCE S256 code_challenge is required');
    }
    const client = q.client_id ? await resolveClient(q.client_id) : null;
    if (!client) return res.status(400).send('unknown client_id');
    if (!q.redirect_uri || !client.redirectUris.includes(q.redirect_uri)) {
      return res.status(400).send('redirect_uri not registered for this client');
    }

    const reqId = b64url(randomBytes(24));
    await (await redis()).set(`mcp:authreq:${reqId}`, JSON.stringify({
      clientId: client.clientId,
      clientName: client.clientName,
      redirectUri: q.redirect_uri,
      state: q.state ?? null,
      codeChallenge: q.code_challenge,
    }), 'EX', AUTHREQ_TTL_S);

    const lfid = await lfidConfig();
    if (lfid) {
      const url = new URL(lfid.startUrl);
      url.searchParams.set('action', 'start');
      url.searchParams.set('return_url', `${apiBase()}/api/mcp-auth/lfid-return?req_id=${encodeURIComponent(reqId)}`);
      return res.redirect(url.toString());
    }

    // Magic-link mode: minimal email form. POSTs to /magic/start.
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.send(magicEmailPage(reqId, client.clientName, null));
  } catch (err) {
    logger.error({ err }, '[mcp-auth] authorize failed');
    res.status(500).send('authorization error');
  }
});

// ── LFID return (rides the lfid-auth module's sign-in flow) ───────────────
//
// The module's edge function 302s here with the Supabase session in the URL
// FRAGMENT (never sent to servers), so this route serves a minimal bridge
// page whose script forwards the access token to /lfid-complete and then
// navigates to the client's redirect URI.

mcpAuthRouter.get('/api/mcp-auth/lfid-return', (req, res) => {
  const reqId = String(req.query.req_id ?? '');
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(reqId)) return res.status(400).send('bad request');
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.send(pageShell('Completing sign-in', `
<h1>Completing sign-in…</h1>
<p>One moment.</p>
<script>
(async () => {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get('access_token');
  history.replaceState(null, '', window.location.pathname); // scrub the fragment
  if (!token) { document.querySelector('p').textContent = 'Sign-in failed: no session returned.'; return; }
  try {
    const r = await fetch('/api/mcp-auth/lfid-complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ req_id: ${JSON.stringify(reqId)}, access_token: token }),
    });
    const body = await r.json();
    if (r.ok && body.redirect) { window.location.replace(body.redirect); return; }
    document.querySelector('p').textContent = 'Sign-in failed: ' + (body.error_description || body.error || r.status);
  } catch (e) {
    document.querySelector('p').textContent = 'Sign-in failed: ' + e;
  }
})();
</script>`));
});

mcpAuthRouter.post('/api/mcp-auth/lfid-complete', async (req, res) => {
  try {
    const { req_id: reqId, access_token: accessToken } = (req.body ?? {}) as { req_id?: string; access_token?: string };
    if (!reqId || !accessToken) return res.status(400).json({ error: 'invalid_request' });
    const rawReq = await (await redis()).get(`mcp:authreq:${reqId}`);
    if (!rawReq) return res.status(400).json({ error: 'expired', error_description: 'authorization request expired — retry from your client' });
    const authreq = JSON.parse(rawReq) as { clientId: string; clientName: string; redirectUri: string; state: string | null; codeChallenge: string };

    // Validate the Supabase session the module minted. This is a REAL
    // verified session (the module already verified the Auth0 id_token and
    // provisioned auth user + person), so getUser() is the trust anchor.
    const supabase = getSupabase();
    const who = await supabase.auth.getUser(accessToken);
    const user = who.data.user;
    if (who.error || !user?.email) {
      return res.status(401).json({ error: 'invalid_token', error_description: 'session not accepted' });
    }
    const lfidSub = (user.user_metadata as Record<string, unknown> | null)?.lfid_sub as string | undefined;

    const redirect = await completeLoginRedirect(authreq, reqId, {
      email: user.email,
      subject: lfidSub ?? user.id,
      authMode: 'lfid',
      lfidSub,
      authUserId: user.id,
      displayName: (user.user_metadata as Record<string, unknown> | null)?.full_name as string | undefined,
    });
    res.json({ redirect });
  } catch (err) {
    logger.error({ err }, '[mcp-auth] lfid-complete failed');
    res.status(500).json({ error: 'server_error' });
  }
});

// ── Magic-link mode ───────────────────────────────────────────────────────

mcpAuthRouter.post('/api/mcp-auth/magic/start', async (req, res) => {
  try {
    const { req_id: reqId, email } = (req.body ?? {}) as { req_id?: string; email?: string };
    if (!reqId || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).send('valid email required');
    }
    const r = await redis();
    const rawReq = await r.get(`mcp:authreq:${reqId}`);
    if (!rawReq) return res.status(400).send('authorization request expired — retry from your client');
    const authreq = JSON.parse(rawReq) as { clientName: string };

    const anon = createClient(
      process.env.SUPABASE_URL ?? '',
      process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const sent = await anon.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (sent.error) {
      logger.error({ err: sent.error.message }, '[mcp-auth] otp send failed');
      return res.status(502).send('could not send sign-in code');
    }
    await r.set(`mcp:magicreq:${reqId}`, JSON.stringify({ email: email.toLowerCase() }), 'EX', AUTHREQ_TTL_S);
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.send(magicCodePage(reqId, authreq.clientName, email, null));
  } catch (err) {
    logger.error({ err }, '[mcp-auth] magic/start failed');
    res.status(500).send('authorization error');
  }
});

mcpAuthRouter.post('/api/mcp-auth/magic/verify', async (req, res) => {
  try {
    const { req_id: reqId, code: otp } = (req.body ?? {}) as { req_id?: string; code?: string };
    if (!reqId || !otp) return res.status(400).send('code required');
    const r = await redis();
    const [rawReq, rawMagic] = await Promise.all([r.get(`mcp:authreq:${reqId}`), r.get(`mcp:magicreq:${reqId}`)]);
    if (!rawReq || !rawMagic) return res.status(400).send('authorization request expired — retry from your client');
    const authreq = JSON.parse(rawReq) as { clientId: string; clientName: string; redirectUri: string; state: string | null; codeChallenge: string };
    const { email } = JSON.parse(rawMagic) as { email: string };

    const anon = createClient(
      process.env.SUPABASE_URL ?? '',
      process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const verified = await anon.auth.verifyOtp({ email, token: otp.trim(), type: 'email' });
    if (verified.error || !verified.data.user) {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      return res.status(401).send(magicCodePage(reqId, authreq.clientName, email, 'That code was not accepted — check it and try again.'));
    }

    await completeLogin(res, authreq, reqId, {
      email,
      subject: verified.data.user.id,
      authMode: 'magic_link',
      authUserId: verified.data.user.id,
    });
  } catch (err) {
    logger.error({ err }, '[mcp-auth] magic/verify failed');
    res.status(500).send('authorization error');
  }
});

// ── Shared completion: provision → resolve scopes → issue code ────────────

async function completeLogin(
  res: Response,
  authreq: { clientId: string; clientName: string; redirectUri: string; state: string | null; codeChallenge: string },
  reqId: string,
  identity: { email: string; subject: string; authMode: 'lfid' | 'magic_link'; lfidSub?: string; authUserId?: string; displayName?: string },
): Promise<void> {
  res.redirect(await completeLoginRedirect(authreq, reqId, identity));
}

async function completeLoginRedirect(
  authreq: { clientId: string; clientName: string; redirectUri: string; state: string | null; codeChallenge: string },
  reqId: string,
  identity: { email: string; subject: string; authMode: 'lfid' | 'magic_link'; lfidSub?: string; authUserId?: string; displayName?: string },
): Promise<string> {
  const supabase = getSupabase();
  const provisioned = await ensureAuthAndPerson(supabase, {
    email: identity.email,
    authUserId: identity.authUserId,
    lfidSub: identity.lfidSub,
    displayName: identity.displayName,
  });
  const access = await resolveAccess(supabase, provisioned.personId, identity.email);

  const grantCode = `mac_${b64url(randomBytes(24))}`;
  const r = await redis();
  await r.set(`mcp:code:${grantCode}`, JSON.stringify({
    clientId: authreq.clientId,
    clientName: authreq.clientName,
    redirectUri: authreq.redirectUri,
    codeChallenge: authreq.codeChallenge,
    personId: provisioned.personId,
    subject: identity.subject,
    email: identity.email.toLowerCase(),
    authMode: identity.authMode,
    scopes: access.scopes,
    tier: access.groups.map((g) => g.name).join(','),
  }), 'EX', CODE_TTL_S);
  await r.del(`mcp:authreq:${reqId}`, `mcp:magicreq:${reqId}`);

  const target = new URL(authreq.redirectUri);
  target.searchParams.set('code', grantCode);
  if (authreq.state) target.searchParams.set('state', authreq.state);
  target.searchParams.set('iss', apiBase());
  return target.toString();
}

// ── /token — authorization_code + refresh_token grants ────────────────────

mcpAuthRouter.post('/api/mcp-auth/token', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const body = (req.body ?? {}) as Record<string, string>;
    const r = await redis();
    const supabase = getSupabase();

    if (body.grant_type === 'authorization_code') {
      if (!body.code || !body.code_verifier) return res.status(400).json({ error: 'invalid_request' });
      const raw = await r.get(`mcp:code:${body.code}`);
      if (!raw) return res.status(400).json({ error: 'invalid_grant' });
      await r.del(`mcp:code:${body.code}`); // single use
      const grant = JSON.parse(raw) as {
        clientId: string; clientName: string; redirectUri: string; codeChallenge: string;
        personId: string; subject: string; email: string; authMode: 'lfid' | 'magic_link';
        scopes: string[]; tier: string;
      };
      if (body.client_id && body.client_id !== grant.clientId) return res.status(400).json({ error: 'invalid_grant' });
      if (body.redirect_uri && body.redirect_uri !== grant.redirectUri) return res.status(400).json({ error: 'invalid_grant' });
      const challenge = b64url(createHash('sha256').update(body.code_verifier).digest());
      if (challenge !== grant.codeChallenge) return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });

      const refresh = newRefreshToken();
      const session = await supabase.from('mcp_sessions').insert({
        person_id: grant.personId,
        subject: grant.subject,
        email: grant.email,
        auth_mode: grant.authMode,
        client_id: grant.clientId,
        client_name: grant.clientName,
        refresh_token_hash: refresh.hash,
        scopes: grant.scopes,
        expires_at: new Date(Date.now() + REFRESH_TTL_S * 1000).toISOString(),
      }).select('id').single();
      if (session.error) throw new Error(session.error.message);

      const access = mintAccessToken({
        sub: grant.subject,
        email: grant.email,
        person_id: grant.personId,
        tier: grant.tier,
        auth_mode: grant.authMode,
        scope: grant.scopes.join(' '),
        client_id: grant.clientId,
      });
      return res.json({
        access_token: access.token,
        token_type: 'Bearer',
        expires_in: access.expiresIn,
        refresh_token: refresh.raw,
        scope: grant.scopes.join(' '),
      });
    }

    if (body.grant_type === 'refresh_token') {
      if (!body.refresh_token) return res.status(400).json({ error: 'invalid_request' });
      const found = await supabase
        .from('mcp_sessions')
        .select('*')
        .eq('refresh_token_hash', sha256(body.refresh_token))
        .maybeSingle();
      const s = found.data as Record<string, unknown> | null;
      if (!s || s.revoked_at || new Date(s.expires_at as string) < new Date()) {
        return res.status(400).json({ error: 'invalid_grant' });
      }
      // Re-resolve scopes so policy edits converge on refresh, not just expiry.
      const access = await resolveAccess(supabase, s.person_id as string, s.email as string);
      await supabase.from('mcp_sessions').update({
        last_refreshed_at: new Date().toISOString(),
        scopes: access.scopes,
      }).eq('id', s.id as string);
      const minted = mintAccessToken({
        sub: s.subject as string,
        email: s.email as string,
        person_id: s.person_id as string,
        tier: access.groups.map((g) => g.name).join(','),
        auth_mode: s.auth_mode as 'lfid' | 'magic_link',
        scope: access.scopes.join(' '),
        client_id: s.client_id as string,
      });
      return res.json({
        access_token: minted.token,
        token_type: 'Bearer',
        expires_in: minted.expiresIn,
        scope: access.scopes.join(' '),
      });
    }

    res.status(400).json({ error: 'unsupported_grant_type' });
  } catch (err) {
    logger.error({ err }, '[mcp-auth] token failed');
    res.status(500).json({ error: 'server_error' });
  }
});

// ── Minimal login pages (magic-link mode) ─────────────────────────────────

function pageShell(title: string, inner: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>
body{font-family:-apple-system,system-ui,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f6f6f7;color:#1a1a1a}
.card{background:#fff;border:1px solid #e3e3e6;border-radius:12px;padding:32px;max-width:380px;width:100%;box-shadow:0 4px 16px rgba(0,0,0,.06)}
h1{font-size:18px;margin:0 0 4px}p{font-size:14px;color:#555;margin:0 0 20px}
input{width:100%;padding:10px 12px;font-size:15px;border:1px solid #ccc;border-radius:8px;box-sizing:border-box;margin-bottom:12px}
button{width:100%;padding:10px;font-size:15px;border:0;border-radius:8px;background:#1a1a1a;color:#fff;cursor:pointer}
.err{color:#b3261e;font-size:13px;margin-bottom:12px}
</style></head><body><div class="card">${inner}</div></body></html>`;
}

function magicEmailPage(reqId: string, clientName: string, error: string | null): string {
  return pageShell('Sign in', `
<h1>Sign in to connect</h1>
<p><strong>${clientName}</strong> is requesting access. Enter your email and we'll send a one-time code.</p>
${error ? `<div class="err">${error}</div>` : ''}
<form method="POST" action="/api/mcp-auth/magic/start">
<input type="hidden" name="req_id" value="${reqId}">
<input type="email" name="email" placeholder="you@example.com" required autofocus>
<button type="submit">Send code</button>
</form>`);
}

function magicCodePage(reqId: string, clientName: string, email: string, error: string | null): string {
  return pageShell('Enter code', `
<h1>Check your email</h1>
<p>We sent a sign-in code to <strong>${email}</strong>. Enter it below to finish connecting <strong>${clientName}</strong>.</p>
${error ? `<div class="err">${error}</div>` : ''}
<form method="POST" action="/api/mcp-auth/magic/verify">
<input type="hidden" name="req_id" value="${reqId}">
<input inputmode="numeric" name="code" placeholder="123456" required autofocus autocomplete="one-time-code">
<button type="submit">Verify</button>
</form>`);
}

// Protected-resource metadata is served by the MCP pod itself; the audience
// helper is exported for tests to assert alignment.
export { mcpAudience as _mcpAudienceForTests };
