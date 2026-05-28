import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createApiMcpServer } from './server.js';
import { parseAllowlist } from './lib/allowlist.js';

const transport = process.env.MCP_TRANSPORT ?? 'stdio';
if (transport !== 'stdio') {
  console.error('Only stdio transport is supported.');
  process.exit(1);
}

const baseUrl = process.env.GATEWAZE_API_BASE;
const jwt = process.env.GATEWAZE_ADMIN_JWT;
if (!baseUrl || !jwt) {
  console.error('GATEWAZE_API_BASE and GATEWAZE_ADMIN_JWT are required');
  process.exit(1);
}

// The endpoint allowlist scopes this registration. It is NOT secret (just
// METHOD + path patterns), so it is supplied per-registration as repeated
// `--allow "METHOD /path"` CLI args — distinct args per ai_mcp_servers row —
// rather than via shared forwarded env. Falls back to GATEWAZE_API_ALLOWED.
function allowlistFromArgv(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--allow' && i + 1 < argv.length) out.push(argv[++i]);
  }
  return out;
}
const argvAllow = allowlistFromArgv(process.argv.slice(2));
const allowRaw = argvAllow.length > 0 ? argvAllow.join('\n') : process.env.GATEWAZE_API_ALLOWED;
if (!allowRaw) {
  console.error('No allowlist: pass --allow "METHOD /path" args or set GATEWAZE_API_ALLOWED');
  process.exit(1);
}

let allow;
try {
  allow = parseAllowlist(allowRaw);
} catch (err) {
  console.error(`Invalid GATEWAZE_API_ALLOWED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
if (allow.length === 0) {
  console.error('GATEWAZE_API_ALLOWED parsed to an empty allowlist — refusing to start with no scope');
  process.exit(1);
}

const server = createApiMcpServer({ baseUrl, jwt, allow });

async function main() {
  await server.connect(new StdioServerTransport());
  console.error(`Gatewaze api-mcp running on stdio (${allow.length} allowed endpoints)`);
}

main().catch((err) => {
  console.error('Fatal error starting api-mcp:', err);
  process.exit(1);
});

function shutdown() {
  server.close().then(() => process.exit(0)).catch(() => process.exit(1));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
