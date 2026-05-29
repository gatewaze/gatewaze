import { createServer } from 'node:http';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createEventsMcpServer } from './server.js';
import { EventsStore } from './lib/events-store.js';

const transport = process.env.MCP_TRANSPORT ?? 'stdio';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('events-mcp requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const store = new EventsStore(url, serviceKey);
const server = createEventsMcpServer(store);

async function main() {
  if (transport === 'stdio') {
    // Local Goose / Claude Code: one process per client over stdio.
    await server.connect(new StdioServerTransport());
    console.error('Gatewaze events MCP server running on stdio');
    return;
  }

  if (transport === 'http') {
    // Dedicated service: streamable HTTP for in-Gatewaze use (registered as a
    // type=streamable_http MCP server). Single long-lived stateless transport.
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
      console.error(`Gatewaze events MCP server (http) on :${port}`);
    });
    return;
  }

  console.error(`Unsupported MCP_TRANSPORT '${transport}' (expected 'stdio' or 'http')`);
  process.exit(1);
}

main().catch((err) => {
  console.error('Fatal error starting events MCP server:', err);
  process.exit(1);
});

function shutdown() {
  console.error('Shutting down events MCP server...');
  server
    .close()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
