import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createMcpHandler, type McpRequestContext } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createApiClient } from './lib/supabase.js';
import { authenticate, protectedResourceMetadata, wwwAuthenticateChallenge } from './lib/auth.js';
import { buildInstructions, createGatewazeMcpServer, type McpProfile, type SearchBackend } from './server.js';

const transport = process.env.MCP_TRANSPORT ?? 'stdio';

// 'public' = read-only tool subset, intended for a hosted keyless endpoint.
// The server STILL needs GATEWAZE_MCP_API_KEY — it authenticates to the
// platform API itself with a read-scoped key; connecting clients send nothing.
const profile: McpProfile = process.env.MCP_PROFILE === 'public' ? 'public' : 'full';

// Brand identity surfaced to agents via MCP `instructions` (initialize result
// on legacy-era connections, server/discover on 2026-07-28 connections — the
// SDK delivers it on both). Set GATEWAZE_BRAND_NAME so agents treat
// brand-name questions as platform-wide, not as a sub-entity lookup.
const instructions = buildInstructions(
  process.env.GATEWAZE_BRAND_NAME,
  process.env.GATEWAZE_BRAND_DESCRIPTION,
);

// Semantic search backend — the portal's /api/ai-search (embeddings-based,
// published-only). The `search` tool is only registered when both are set.
const search: SearchBackend | undefined =
  process.env.GATEWAZE_PORTAL_URL && process.env.GATEWAZE_BRAND_ID
    ? { portalUrl: process.env.GATEWAZE_PORTAL_URL, brandId: process.env.GATEWAZE_BRAND_ID }
    : undefined;
if (!search) {
  console.error('GATEWAZE_PORTAL_URL / GATEWAZE_BRAND_ID not set — `search` tool disabled');
}

const api = createApiClient();

// ── Audit batching (spec §5) — ship request events to the platform API ────
// Buffered, flushed every 5s / 100 events to /api/internal/mcp-events,
// authenticated with the shared MCP_EVENTS_TOKEN. stderr JSONL remains as
// belt-and-braces; loss here is tolerable (fire-and-forget analytics).
const auditQueue: Array<Record<string, unknown>> = [];
function auditSink(entry: Record<string, unknown>): void {
  if (!process.env.MCP_EVENTS_TOKEN) return;
  auditQueue.push(entry);
  if (auditQueue.length >= 100) void flushAudit();
}
async function flushAudit(): Promise<void> {
  if (auditQueue.length === 0) return;
  const batch = auditQueue.splice(0, 500);
  try {
    await fetch(`${(process.env.GATEWAZE_API_URL ?? '').replace(/\/+$/, '')}/api/internal/mcp-events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-token': process.env.MCP_EVENTS_TOKEN ?? '' },
      body: JSON.stringify({ events: batch }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    console.error('[audit] flush failed:', err instanceof Error ? err.message : err);
  }
}
setInterval(() => void flushAudit(), 5000).unref();

// ── Per-IP rate limiting (HTTP transport only) ────────────────────────────
// The public endpoint has no client credential to meter on, so meter on IP.
// Sliding one-minute window, in-memory: fine for a single instance, which is
// how this ships. Behind traefik the client IP is the first entry of
// x-forwarded-for.

const RATE_LIMIT_RPM = Number(process.env.MCP_RATE_LIMIT_RPM ?? 120);
const WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

function clientIp(req: IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
  return first || req.socket.remoteAddress || 'unknown';
}

function rateLimited(ip: string): boolean {
  const now = Date.now();
  // Bound memory under address-spoofing floods: reset rather than track
  // unbounded IPs. Legitimate clients just get a fresh window.
  if (hits.size > 10_000) hits.clear();
  const windowHits = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (windowHits.length >= RATE_LIMIT_RPM) {
    hits.set(ip, windowHits);
    return true;
  }
  windowHits.push(now);
  hits.set(ip, windowHits);
  return false;
}

function setCors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  // Mcp-Method / Mcp-Name are REQUIRED request headers under 2026-07-28;
  // the legacy-era headers stay allowed for 2025 clients.
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Last-Event-ID',
  );
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
}

/**
 * The human onboarding page. Everything a non-technical user needs is
 * copy-paste (no npx required): the connector URL for Claude/ChatGPT
 * settings, a one-click deep link for Goose, and the CLI one-liner for
 * technical users. Self-contained HTML, no external assets.
 */
function landingPage(): string {
  const brand = process.env.GATEWAZE_BRAND_NAME ?? 'Gatewaze';
  const connectorName = process.env.GATEWAZE_CONNECTOR_NAME || process.env.GATEWAZE_BRAND_ID || 'gatewaze';
  const resource = (process.env.PUBLIC_MCP_URL ?? 'https://mcp.example.com').replace(/\/+$/, '');
  const authUrl = `${resource}/auth`;
  const gooseLink = `goose://extension?url=${encodeURIComponent(authUrl)}&name=${encodeURIComponent(connectorName)}`;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect your AI to ${esc(brand)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.55 -apple-system, "Segoe UI", Roboto, sans-serif; max-width: 42rem; margin: 2.5rem auto; padding: 0 1.25rem; }
  h1 { font-size: 1.6rem; } h2 { font-size: 1.15rem; margin-top: 2rem; }
  code, .url { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: .92em; }
  .url { display: flex; gap: .5rem; align-items: center; padding: .6rem .8rem; border: 1px solid #8884; border-radius: .5rem; margin: .6rem 0; }
  .url span { overflow-wrap: anywhere; flex: 1; }
  button { font: inherit; padding: .35rem .8rem; border-radius: .4rem; border: 1px solid #8886; background: transparent; cursor: pointer; }
  ol { padding-left: 1.3rem; } li { margin: .3rem 0; }
  .muted { opacity: .75; font-size: .92em; }
  a.big { display: inline-block; padding: .5rem 1rem; border: 1px solid #8886; border-radius: .5rem; text-decoration: none; }
</style></head><body>
<h1>Connect your AI assistant to ${esc(brand)}</h1>
<p>This gives Claude, ChatGPT, or Goose live access to ${esc(brand)}'s events, newsletters, and content. You'll sign in with your usual account the first time — no password is stored by the assistant.</p>

<p>Your connector URL (works in every assistant):</p>
<div class="url"><span id="u">${esc(authUrl)}</span><button onclick="navigator.clipboard.writeText(document.getElementById('u').textContent)">Copy</button></div>

<h2>Claude (claude.ai or Claude Desktop)</h2>
<ol><li>Open <b>Settings &rarr; Connectors</b></li><li>Click <b>Add custom connector</b></li><li>Name it <b>${esc(connectorName)}</b> and paste the URL above</li><li>Save, then sign in when the browser window opens</li></ol>

<h2>ChatGPT</h2>
<ol><li>Open <b>Settings &rarr; Connectors</b></li><li>Click <b>Add</b> (custom connector), paste the URL above</li><li>Save and sign in</li></ol>

<h2>Goose</h2>
<p><a class="big" href="${gooseLink}">Add to Goose (one click)</a></p>

<h2>Command line (technical users)</h2>
<p><code>npx @gatewaze/connect@latest</code> &mdash; detects your installed clients and configures them (requires Node.js).</p>

<p class="muted">Prefer anonymous browsing? Use <code>${esc(resource)}/</code> as the URL instead — public content only, no sign-in, fewer capabilities.</p>
</body></html>`;
}

async function main() {
  if (transport === 'stdio') {
    // serveStdio pins one factory instance per connection; the opening
    // exchange selects the era (2025 initialize handshake or 2026-07-28
    // envelope), so keyed local clients keep working across both.
    serveStdio(() => createGatewazeMcpServer(api, { profile, instructions, search }));
    console.error(`Gatewaze MCP server running on stdio (profile: ${profile}, dual-era)`);
    return;
  }

  if (transport === 'http') {
    // Hosted service: createMcpHandler serves 2026-07-28 per request AND
    // (legacy: 'stateless', the default) 2025-era traffic through the same
    // stateless idiom our v1 hosting used — one factory, one endpoint, both
    // eras. With profile=public this is safe to route publicly: the tool
    // surface is read-only and the platform API key never leaves the server.
    const port = Number(process.env.PORT ?? 8080);

    const handler = createMcpHandler(
      (ctx: McpRequestContext) => {
        const fwd = ctx.requestInfo?.headers.get('x-forwarded-for');
        const ip = fwd?.split(',')[0]?.trim() || 'unknown';
        // Bearer token (if any) selects the OAuth scope-gated surface;
        // keyless requests keep the anonymous public profile.
        const auth = authenticate(ctx.requestInfo?.headers.get('authorization'));
        return createGatewazeMcpServer(api, {
          profile,
          instructions,
          search,
          identity: auth.identity ?? undefined,
          audit: auditSink,
          logMeta: { ip, era: ctx.era, client_name: auth.identity?.clientId },
        });
      },
      {
        onerror: (err: Error) => console.error('MCP handler error:', err.message),
      },
    );
    const nodeHandler = toNodeHandler(handler);

    const httpServer = createServer((req, res) => {
      setCors(res);

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.method === 'GET' && req.url === '/healthz') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
        return;
      }
      // Browsers get a human onboarding page instead of a protocol error —
      // "open mcp.<brand> in your browser" is the whole non-technical
      // install story (MCP clients send Accept: application/json /
      // text/event-stream, never text/html, so the protocol is unaffected).
      if (
        req.method === 'GET' &&
        (req.url === '/' || req.url === '/connect') &&
        (req.headers.accept ?? '').includes('text/html')
      ) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(landingPage());
        return;
      }
      // Brand identity for installers: @gatewaze/connect names the
      // connector from here (GATEWAZE_CONNECTOR_NAME, e.g. "AAIF")
      // instead of deriving it from the hostname.
      if (req.method === 'GET' && (req.url === '/brand.json' || req.url === '/brand')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            brand_id: process.env.GATEWAZE_BRAND_ID ?? null,
            brand_name: process.env.GATEWAZE_BRAND_NAME ?? null,
            connector_name:
              process.env.GATEWAZE_CONNECTOR_NAME ||
              process.env.GATEWAZE_BRAND_ID ||
              'gatewaze',
            portal_url: process.env.GATEWAZE_PORTAL_URL ?? null,
          }),
        );
        return;
      }
      // RFC 9728 Protected Resource Metadata — how clients discover the
      // authorization server for this endpoint (spec-mcp-lfid-access.md §3).
      // Served for both resources: the optional-auth root and the
      // auth-REQUIRED /auth alias (RFC 9728 path-suffix form).
      if (req.method === 'GET' && req.url?.startsWith('/.well-known/oauth-protected-resource')) {
        const meta = protectedResourceMetadata();
        if (req.url.startsWith('/.well-known/oauth-protected-resource/auth')) {
          meta.resource = `${meta.resource}/auth`;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(meta));
        return;
      }
      // /auth alias: identical server, but authentication is REQUIRED.
      // Rationale: on the optional-auth root, clients connect anonymously
      // and never launch their OAuth flow (they only do so on a 401
      // challenge). Users who want to sign in add the /auth URL instead.
      const isAuthPath = req.url === '/auth' || req.url?.startsWith('/auth?') || req.url?.startsWith('/auth/');
      if (isAuthPath) {
        if (!req.headers.authorization) {
          res.writeHead(401, {
            'content-type': 'application/json',
            'WWW-Authenticate': wwwAuthenticateChallenge(),
          });
          res.end(JSON.stringify({ error: 'unauthorized', error_description: 'authentication required on this endpoint — complete the OAuth flow' }));
          return;
        }
        // Strip the alias prefix so the transport sees its normal paths.
        req.url = (req.url ?? '').slice('/auth'.length) || '/';
      }
      // A PRESENT-but-invalid token must 401 with a challenge rather than
      // silently downgrade to anonymous (token expiry → client refreshes).
      const authOutcome = authenticate(req.headers.authorization);
      if (authOutcome.invalid) {
        res.writeHead(401, {
          'content-type': 'application/json',
          'WWW-Authenticate': wwwAuthenticateChallenge('invalid_token'),
        });
        res.end(JSON.stringify({ error: 'invalid_token', error_description: authOutcome.invalid }));
        return;
      }
      if (rateLimited(clientIp(req))) {
        res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '60' });
        res.end(JSON.stringify({ error: { code: 'RATE_LIMITED', message: `Limit is ${RATE_LIMIT_RPM} requests/minute per IP.` } }));
        return;
      }

      void nodeHandler(req, res);
    });
    httpServer.listen(port, () => {
      console.error(`Gatewaze MCP server (http) on :${port} (profile: ${profile}, ${RATE_LIMIT_RPM} rpm/IP, dual-era)`);
    });

    const shutdown = () => {
      console.error('Shutting down MCP server...');
      void handler.close?.();
      httpServer.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 5000).unref();
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    return;
  }

  console.error(`Unsupported MCP_TRANSPORT '${transport}' (expected 'stdio' or 'http')`);
  process.exit(1);
}

main().catch((err) => {
  console.error('Fatal error starting MCP server:', err);
  process.exit(1);
});
