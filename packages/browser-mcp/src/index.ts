import { createServer } from 'node:http';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createBrowserMcpServer } from './server.js';
import { resolveBackend, type BrowserBackend } from './lib/backend/index.js';

const transport = process.env.MCP_TRANSPORT ?? 'stdio';

let backend: BrowserBackend;
try {
  backend = resolveBackend(process.env);
} catch (err) {
  console.error(`Invalid browser-mcp backend config: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

const server = createBrowserMcpServer(backend);

async function main() {
  if (transport === 'stdio') {
    // Local Goose / Claude Code: one process per client over stdio.
    await server.connect(new StdioServerTransport());
    console.error(`Gatewaze browser MCP server running on stdio (backend=${backend.name})`);
    return;
  }

  if (transport === 'http') {
    // Dedicated service: streamable HTTP for in-Gatewaze use (registered as a
    // type=streamable_http MCP server). Single long-lived stateless transport;
    // the backend (one browser) persists across the run's tool calls. v1 is
    // single-tenant / low-concurrency — concurrent clients share the browser.
    const port = Number(process.env.PORT ?? 8080);
    const httpTransport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(httpTransport);

    const httpServer = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/healthz') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
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
        void httpTransport.handleRequest(req, res, body);
      });
    });
    httpServer.listen(port, () => {
      console.error(`Gatewaze browser MCP server (http) on :${port} (backend=${backend.name})`);
    });
    return;
  }

  console.error(`Unsupported MCP_TRANSPORT '${transport}' (expected 'stdio' or 'http')`);
  process.exit(1);
}

main().catch((err) => {
  console.error('Fatal error starting browser MCP server:', err);
  process.exit(1);
});

// Close the backend BEFORE exit so a Browserbase session is released (stops
// billing). SIGKILL can't run this — Browserbase's session timeout is the backstop.
function shutdown() {
  console.error('Shutting down browser MCP server...');
  Promise.allSettled([backend.close(), server.close()])
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
