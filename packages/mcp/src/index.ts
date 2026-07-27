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
