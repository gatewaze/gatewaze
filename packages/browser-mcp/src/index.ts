import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createBrowserMcpServer } from './server.js';
import { resolveBackend, type BrowserBackend } from './lib/backend/index.js';

const transport = process.env.MCP_TRANSPORT ?? 'stdio';

if (transport !== 'stdio') {
  console.error('Only stdio transport is supported.');
  process.exit(1);
}

let backend: BrowserBackend;
try {
  backend = resolveBackend(process.env);
} catch (err) {
  console.error(`Invalid browser-mcp backend config: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

const server = createBrowserMcpServer(backend);

async function main() {
  const stdioTransport = new StdioServerTransport();
  await server.connect(stdioTransport);
  console.error(`Gatewaze browser MCP server running on stdio (backend=${backend.name})`);
}

main().catch((err) => {
  console.error('Fatal error starting browser MCP server:', err);
  process.exit(1);
});

// Close the backend BEFORE the process exits so a Browserbase session is
// released and stops billing. SIGKILL can't run this — Browserbase's own
// session timeout is the backstop for that case.
function shutdown() {
  console.error('Shutting down browser MCP server...');
  Promise.allSettled([backend.close(), server.close()])
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
