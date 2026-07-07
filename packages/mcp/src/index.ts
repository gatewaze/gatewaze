import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createApiClient } from './lib/supabase.js';
import { createGatewazeMcpServer, type McpProfile } from './server.js';

const transport = process.env.MCP_TRANSPORT ?? 'stdio';

// 'public' = read-only tool subset, intended for a hosted keyless endpoint.
// The server STILL needs GATEWAZE_MCP_API_KEY — it authenticates to the
// platform API itself with a read-scoped key; connecting clients send nothing.
const profile: McpProfile = process.env.MCP_PROFILE === 'public' ? 'public' : 'full';

const api = createApiClient();

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
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
  );
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
}

async function handleMcpHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  body: unknown,
): Promise<void> {
  const ip = clientIp(req);

  // Log initialize handshakes: clientInfo names the connecting MCP client
  // (Claude Desktop, mcp-remote, custom agents) — pairs with the per-call
  // mcp_call lines (same ip field) when analysing what consumers ask for.
  const init = body as { method?: string; params?: { clientInfo?: unknown } } | undefined;
  if (init?.method === 'initialize' && process.env.MCP_LOG_REQUESTS !== '0') {
    console.error(JSON.stringify({
      evt: 'mcp_initialize',
      ts: new Date().toISOString(),
      ip,
      client: init.params?.clientInfo ?? null,
    }));
  }

  // Stateless mode: the SDK (≥1.13) requires a fresh transport + server pair
  // per request — a long-lived stateless transport only survives its first
  // request. Construction is cheap (tool tables in memory, no I/O).
  const requestServer = createGatewazeMcpServer(api, { profile, logMeta: { ip } });
  const requestTransport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    void requestTransport.close();
    void requestServer.close();
  });
  await requestServer.connect(requestTransport);
  await requestTransport.handleRequest(req, res, body);
}

async function main() {
  if (transport === 'stdio') {
    const server = createGatewazeMcpServer(api, { profile });
    const shutdown = () => {
      console.error('Shutting down MCP server...');
      server.close().then(() => process.exit(0)).catch(() => process.exit(1));
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    await server.connect(new StdioServerTransport());
    console.error(`Gatewaze MCP server running on stdio (profile: ${profile})`);
    return;
  }

  if (transport === 'http') {
    // Hosted service: streamable HTTP, stateless. With profile=public this is
    // safe to route publicly — the tool surface is read-only and the platform
    // API key never leaves the server.
    const port = Number(process.env.PORT ?? 8080);

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
      if (rateLimited(clientIp(req))) {
        res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '60' });
        res.end(JSON.stringify({ error: { code: 'RATE_LIMITED', message: `Limit is ${RATE_LIMIT_RPM} requests/minute per IP.` } }));
        return;
      }

      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        let body: unknown;
        try {
          body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
        } catch {
          body = undefined;
        }
        handleMcpHttpRequest(req, res, body).catch((err) => {
          console.error('MCP request failed:', err);
          if (!res.headersSent) {
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32603, message: 'Internal server error' },
              id: null,
            }));
          }
        });
      });
    });
    httpServer.listen(port, () => {
      console.error(`Gatewaze MCP server (http) on :${port} (profile: ${profile}, ${RATE_LIMIT_RPM} rpm/IP)`);
    });

    const shutdown = () => {
      console.error('Shutting down MCP server...');
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
