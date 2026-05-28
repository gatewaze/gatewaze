import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createBrowserMcpServer } from './server.js';

const transport = process.env.MCP_TRANSPORT ?? 'stdio';

if (transport !== 'stdio') {
  console.error('Only stdio transport is supported.');
  process.exit(1);
}

const server = createBrowserMcpServer();

async function main() {
  const stdioTransport = new StdioServerTransport();
  await server.connect(stdioTransport);
  console.error('Gatewaze browser MCP server running on stdio');
}

main().catch((err) => {
  console.error('Fatal error starting browser MCP server:', err);
  process.exit(1);
});

function shutdown() {
  console.error('Shutting down browser MCP server...');
  server.close().then(() => process.exit(0)).catch(() => process.exit(1));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
