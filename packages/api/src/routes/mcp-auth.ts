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
import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import { Router, type Request, type Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { labeledRouter } from '../lib/router-registry.js';
import { getSupabase } from '../lib/supabase.js';
import { getRedisConnection } from '../lib/queue/index.js';
import { logger } from '../lib/logger.js';
import { ensureAuthAndPerson } from '../lib/mcp-auth/provision.js';
import { resolveAccess } from '../lib/mcp-auth/scopes.js';
import { mintAccessToken, newRefreshToken, sha256, mcpAudience } from '../lib/mcp-auth/tokens.js';
import { resolveLfidLogin } from '../lib/mcp-auth/lfid-mode.js';
import {
  finishNativeLfid,
  nativeLfidConfig,
  NativeLfidRefused,
  startNativeLfid,
  type NativeLfidIdentity,
} from '../lib/mcp-auth/lfid-native.js';

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

// ── Authorization requests ────────────────────────────────────────────────
//
// /authorize stores one per sign-in attempt under mcp:authreq:<req_id>, tagged
// with the login mode it chose. Each sign-in route only accepts a request made
// for its own mode, so a request id seen in a log or a URL cannot be finished
// through a different route with someone else's identity.

type LoginMode = 'native' | 'bridge' | 'magic';
const LOGIN_MODES: readonly LoginMode[] = ['native', 'bridge', 'magic'];

interface AuthRequest {
  clientId: string;
  clientName: string;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  /** Absent only on requests stored before this field existed. */
  loginMode?: LoginMode;
}

const REQ_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** Only this server writes these keys; the check catches a corrupt value. */
function parseAuthRequest(raw: string | null): AuthRequest | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const ok =
    typeof o.clientId === 'string' &&
    typeof o.clientName === 'string' &&
    typeof o.redirectUri === 'string' &&
    typeof o.codeChallenge === 'string' &&
    (o.state === null || typeof o.state === 'string') &&
    (o.loginMode === undefined || LOGIN_MODES.includes(o.loginMode as LoginMode));
  return ok ? (o as unknown as AuthRequest) : null;
}

/**
 * The pending request for reqId, if it was made for this route's mode. A
 * request stored before loginMode existed is accepted by the bridge and
 * magic-link routes, which is what they did before; native requests always
 * carry the tag.
 */
async function authRequestFor(reqId: string, mode: LoginMode): Promise<AuthRequest | null> {
  if (!REQ_ID_RE.test(reqId)) return null;
  const authreq = parseAuthRequest(await (await redis()).get(`mcp:authreq:${reqId}`));
  if (!authreq) return null;
  if (authreq.loginMode === mode) return authreq;
  return authreq.loginMode === undefined && mode !== 'native' ? authreq : null;
}

// ── Login-mode resolution (pluggable per spec §3) ─────────────────────────
//
// lfid-auth module enabled → LFID, in the module's bridge or native mode
// (lib/mcp-auth/lfid-mode.ts); otherwise magic link.
//
// Bridge mode rides the module's integrations-lfid-callback edge function:
// its callback URL is already registered in the LF Auth0 application, the
// function validates our return_url origin against the module's
// AUTH0_ALLOWED_RETURN_ORIGINS and hands the Supabase session back in the URL
// fragment, and provisioning happens inside that function.
//
// Native mode runs the GoTrue PKCE flow against custom:lfid from this server
// (lib/mcp-auth/lfid-native.ts). GoTrue redirects back to
// /api/mcp-auth/lfid/callback/<req_id>, which must be on the Supabase Auth
// redirect allow-list.

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

    const lfid = await resolveLfidLogin(getSupabase());
    if (lfid?.mode === 'native' && !nativeLfidConfig()) {
      logger.error('[mcp-auth] native LFID sign-in needs SUPABASE_URL and SUPABASE_ANON_KEY');
      return res.status(503).send('sign-in is not configured on this deployment');
    }
    const loginMode: LoginMode = lfid ? lfid.mode : 'magic';

    const reqId = b64url(randomBytes(24));
    const r = await redis();
    await r.set(`mcp:authreq:${reqId}`, JSON.stringify({
      clientId: client.clientId,
      clientName: client.clientName,
      redirectUri: q.redirect_uri,
      state: q.state ?? null,
      codeChallenge: q.code_challenge,
      loginMode,
    } satisfies AuthRequest), 'EX', AUTHREQ_TTL_S);

    if (lfid?.mode === 'native') {
      // Bind the rest of the flow to this browser, so a /lfid/start or
      // callback URL forwarded to someone else cannot finish it, and ask the
      // user to confirm the client before going to LFID (whose own session
      // may sign them in without a prompt).
      const binding = b64url(randomBytes(24));
      await r.set(`mcp:lfidreq:${reqId}`, JSON.stringify({ binding: sha256(binding) } satisfies LfidRequest), 'EX', AUTHREQ_TTL_S);
      res.cookie(lfidCookieName(reqId), binding, lfidCookieOptions());
      res.setHeader('cache-control', 'no-store');
      res.setHeader('content-type', 'text/html; charset=utf-8');
      return res.send(lfidConsentPage(reqId, client.clientName, new URL(q.redirect_uri).host));
    }
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
  if (!REQ_ID_RE.test(reqId)) return res.status(400).send('bad request');
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
    if (typeof reqId !== 'string' || !accessToken) return res.status(400).json({ error: 'invalid_request' });
    const authreq = await authRequestFor(reqId, 'bridge');
    if (!authreq) return res.status(400).json({ error: 'expired', error_description: 'authorization request expired — retry from your client' });

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

// ── LFID native mode (GoTrue PKCE against custom:lfid) ────────────────────
//
// /authorize shows a confirm page and sets a per-request cookie. Its button
// POSTs to /lfid/start, which starts the GoTrue flow. GoTrue returns to
// /lfid/callback/<req_id> with ?code=. Both steps need the cookie, and every
// way the callback ends uses up the request.

const LFID_COOKIE_PATH = '/api/mcp-auth/lfid';
const RESTART = 'Start again from your client.';
const EXPIRED = `This sign-in has expired or was started in another browser. ${RESTART}`;

interface LfidRequest { binding: string; pkce?: Record<string, string> }

/** Only this server writes these keys; the check catches a corrupt value. */
function parseLfidRequest(raw: string): LfidRequest | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.binding !== 'string') return null;
  if (o.pkce === undefined) return { binding: o.binding };
  if (!o.pkce || typeof o.pkce !== 'object' || Array.isArray(o.pkce)) return null;
  const pkce: Record<string, string> = {};
  for (const [k, val] of Object.entries(o.pkce)) {
    if (typeof val !== 'string') return null;
    pkce[k] = val;
  }
  return { binding: o.binding, pkce };
}

function lfidCookieName(reqId: string): string {
  return `gw_mcp_lfid_${reqId}`;
}

function lfidCookieOptions() {
  return {
    httpOnly: true,
    // Lax: sent on the top-level GET back from GoTrue and on the same-origin
    // POST from the confirm page, never on a cross-site POST.
    sameSite: 'lax' as const,
    secure: apiBase().startsWith('https://'),
    path: LFID_COOKIE_PATH,
    maxAge: AUTHREQ_TTL_S * 1000,
  };
}

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** The pending native request and its stored form, if this browser holds its binding cookie. */
async function boundLfidRequest(req: Request, reqId: string): Promise<{ raw: string; pending: LfidRequest } | null> {
  const cookie = readCookie(req, lfidCookieName(reqId));
  if (!cookie) return null;
  const raw = await (await redis()).get(`mcp:lfidreq:${reqId}`);
  const pending = raw ? parseLfidRequest(raw) : null;
  if (!raw || !pending) return null;
  const want = Buffer.from(pending.binding);
  const got = Buffer.from(sha256(cookie));
  return want.length === got.length && timingSafeEqual(want, got) ? { raw, pending } : null;
}

function sendLfidError(res: Response, status: number, message: string): void {
  res.status(status);
  res.setHeader('cache-control', 'no-store');
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.send(pageShell('Sign-in failed', `<h1>Sign-in failed</h1><p>${escapeHtml(message)}</p>`));
}

mcpAuthRouter.post('/api/mcp-auth/lfid/start', async (req, res) => {
  try {
    const reqId = String((req.body as { req_id?: unknown } | undefined)?.req_id ?? '');
    if (!REQ_ID_RE.test(reqId)) return sendLfidError(res, 400, 'Bad request.');
    const cfg = nativeLfidConfig();
    if (!cfg) return sendLfidError(res, 503, 'Sign-in is not configured on this deployment.');
    const [bound, authreq] = await Promise.all([boundLfidRequest(req, reqId), authRequestFor(reqId, 'native')]);
    if (!bound || !authreq) return sendLfidError(res, 400, EXPIRED);

    let started: Awaited<ReturnType<typeof startNativeLfid>>;
    try {
      started = await startNativeLfid(cfg, `${apiBase()}/api/mcp-auth/lfid/callback/${reqId}`);
    } catch (err) {
      logger.error({ err }, '[mcp-auth] GoTrue could not start native LFID sign-in');
      return sendLfidError(res, 502, `Could not start LFID sign-in. ${RESTART}`);
    }
    const { url, pkce } = started;
    await (await redis()).set(
      `mcp:lfidreq:${reqId}`,
      JSON.stringify({ binding: bound.pending.binding, pkce } satisfies LfidRequest),
      'EX', AUTHREQ_TTL_S,
    );
    res.setHeader('cache-control', 'no-store');
    res.redirect(303, url);
  } catch (err) {
    logger.error({ err }, '[mcp-auth] lfid/start failed');
    sendLfidError(res, 500, `Could not start LFID sign-in. ${RESTART}`);
  }
});

mcpAuthRouter.get('/api/mcp-auth/lfid/callback/:reqId', async (req, res) => {
  const reqId = String(req.params.reqId ?? '');
  if (!REQ_ID_RE.test(reqId)) return sendLfidError(res, 400, 'Bad request.');
  let claimed = false;
  try {
    const r = await redis();
    const bound = await boundLfidRequest(req, reqId);
    // Without this browser's cookie the request is left alone: whoever sent
    // the URL cannot use it up for its owner.
    if (!bound) return sendLfidError(res, 400, EXPIRED);
    // Take the verifier atomically, so two callbacks cannot both use it.
    const taken = await r.getdel(`mcp:lfidreq:${reqId}`);
    if (taken !== bound.raw) return sendLfidError(res, 400, EXPIRED);
    claimed = true;
    res.clearCookie(lfidCookieName(reqId), { ...lfidCookieOptions(), maxAge: undefined });

    // From here on every failure also deletes the MCP request.
    const fail = async (status: number, message: string) => {
      await r.del(`mcp:authreq:${reqId}`);
      sendLfidError(res, status, message);
    };

    const authreq = await authRequestFor(reqId, 'native');
    if (!authreq || !bound.pending.pkce) return fail(400, EXPIRED);

    const q = req.query as Record<string, unknown>;
    if (q.error !== undefined || typeof q.code !== 'string' || !q.code) {
      // GoTrue's error text is not shown: anyone can put it in this URL.
      logger.warn({ error: String(q.error ?? '').slice(0, 100), error_code: String(q.error_code ?? '').slice(0, 100) },
        '[mcp-auth] GoTrue returned no code');
      return fail(400, `LFID sign-in did not complete. ${RESTART}`);
    }

    const cfg = nativeLfidConfig();
    if (!cfg) return fail(503, 'Sign-in is not configured on this deployment.');
    let who: NativeLfidIdentity;
    try {
      who = await finishNativeLfid(cfg, q.code, bound.pending.pkce);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof NativeLfidRefused) {
        logger.warn({ err: message }, '[mcp-auth] native LFID sign-in refused');
        return fail(401, `LFID sign-in was not accepted. ${RESTART}`);
      }
      logger.error({ err: message }, '[mcp-auth] native LFID code exchange failed');
      return fail(502, `LFID sign-in could not be completed. ${RESTART}`);
    }

    const redirect = await completeLoginRedirect(authreq, reqId, {
      email: who.email,
      subject: who.lfidSub ?? who.authUserId,
      authMode: 'lfid',
      lfidSub: who.lfidSub,
      authUserId: who.authUserId,
      displayName: who.displayName,
    });
    res.setHeader('cache-control', 'no-store');
    res.redirect(redirect);
  } catch (err) {
    logger.error({ err }, '[mcp-auth] lfid/callback failed');
    if (claimed) {
      try {
        await (await redis()).del(`mcp:authreq:${reqId}`);
      } catch (delErr) {
        logger.warn({ err: delErr }, '[mcp-auth] could not delete the failed MCP request; it expires on its own');
      }
    }
    sendLfidError(res, 500, `Sign-in could not be completed. ${RESTART}`);
  }
});

// ── Magic-link mode ───────────────────────────────────────────────────────

mcpAuthRouter.post('/api/mcp-auth/magic/start', async (req, res) => {
  try {
    const { req_id: reqId, email } = (req.body ?? {}) as { req_id?: string; email?: string };
    if (typeof reqId !== 'string' || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).send('valid email required');
    }
    const r = await redis();
    const authreq = await authRequestFor(reqId, 'magic');
    if (!authreq) return res.status(400).send('authorization request expired — retry from your client');

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
    if (typeof reqId !== 'string' || !otp) return res.status(400).send('code required');
    const r = await redis();
    const [authreq, rawMagic] = await Promise.all([authRequestFor(reqId, 'magic'), r.get(`mcp:magicreq:${reqId}`)]);
    if (!authreq || !rawMagic) return res.status(400).send('authorization request expired — retry from your client');
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
  authreq: AuthRequest,
  reqId: string,
  identity: { email: string; subject: string; authMode: 'lfid' | 'magic_link'; lfidSub?: string; authUserId?: string; displayName?: string },
): Promise<void> {
  res.redirect(await completeLoginRedirect(authreq, reqId, identity));
}

async function completeLoginRedirect(
  authreq: AuthRequest,
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
  await r.del(`mcp:authreq:${reqId}`, `mcp:magicreq:${reqId}`, `mcp:lfidreq:${reqId}`);

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

// ── Minimal login pages ───────────────────────────────────────────────────

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

function pageShell(title: string, inner: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>
body{font-family:-apple-system,system-ui,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f6f6f7;color:#1a1a1a}
.card{background:#fff;border:1px solid #e3e3e6;border-radius:12px;padding:32px;max-width:380px;width:100%;box-shadow:0 4px 16px rgba(0,0,0,.06)}
h1{font-size:18px;margin:0 0 4px}p{font-size:14px;color:#555;margin:0 0 20px}
input{width:100%;padding:10px 12px;font-size:15px;border:1px solid #ccc;border-radius:8px;box-sizing:border-box;margin-bottom:12px}
button{width:100%;padding:10px;font-size:15px;border:0;border-radius:8px;background:#1a1a1a;color:#fff;cursor:pointer}
.err{color:#b3261e;font-size:13px;margin-bottom:12px}
</style></head><body><div class="card">${inner}</div></body></html>`;
}

function lfidConsentPage(reqId: string, clientName: string, redirectHost: string): string {
  return pageShell('Sign in', `
<h1>Sign in to connect</h1>
<p><strong>${escapeHtml(clientName)}</strong> is requesting access to your account. After you sign in you will be sent to <strong>${escapeHtml(redirectHost)}</strong>. Continue only if you started this from that client.</p>
<form method="POST" action="/api/mcp-auth/lfid/start">
<input type="hidden" name="req_id" value="${escapeHtml(reqId)}">
<button type="submit">Continue with LFID</button>
</form>`);
}

function magicEmailPage(reqId: string, clientName: string, error: string | null): string {
  return pageShell('Sign in', `
<h1>Sign in to connect</h1>
<p><strong>${escapeHtml(clientName)}</strong> is requesting access. Enter your email and we'll send a one-time code.</p>
${error ? `<div class="err">${escapeHtml(error)}</div>` : ''}
<form method="POST" action="/api/mcp-auth/magic/start">
<input type="hidden" name="req_id" value="${escapeHtml(reqId)}">
<input type="email" name="email" placeholder="you@example.com" required autofocus>
<button type="submit">Send code</button>
</form>`);
}

function magicCodePage(reqId: string, clientName: string, email: string, error: string | null): string {
  return pageShell('Enter code', `
<h1>Check your email</h1>
<p>We sent a sign-in code to <strong>${escapeHtml(email)}</strong>. Enter it below to finish connecting <strong>${escapeHtml(clientName)}</strong>.</p>
${error ? `<div class="err">${escapeHtml(error)}</div>` : ''}
<form method="POST" action="/api/mcp-auth/magic/verify">
<input type="hidden" name="req_id" value="${escapeHtml(reqId)}">
<input inputmode="numeric" name="code" placeholder="123456" required autofocus autocomplete="one-time-code">
<button type="submit">Verify</button>
</form>`);
}

// Protected-resource metadata is served by the MCP pod itself; the audience
// helper is exported for tests to assert alignment.
export { mcpAudience as _mcpAudienceForTests };
