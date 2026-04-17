import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createSupabaseClient } from './lib/supabase.js';
import { createGatewazeMcpServer } from './server.js';

const transport = process.env.MCP_TRANSPORT ?? 'stdio';

if (transport === 'http') {
  console.error('HTTP transport is not yet implemented in v1. Use stdio.');
  process.exit(1);
}

const supabase = createSupabaseClient();
const server = createGatewazeMcpServer(supabase);

async function main() {
  const stdioTransport = new StdioServerTransport();
  await server.connect(stdioTransport);
  console.error('Gatewaze MCP server running on stdio');
}

main().catch((err) => {
  console.error('Fatal error starting MCP server:', err);
  process.exit(1);
});

function shutdown() {
  console.error('Shutting down MCP server...');
  server.close().then(() => process.exit(0)).catch(() => process.exit(1));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
