import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { type AllowEntry, isAllowed } from './lib/allowlist.js';

export interface ApiMcpConfig {
  baseUrl: string;
  jwt: string;
  allow: AllowEntry[];
}

const TOOLS = [
  {
    name: 'gatewaze_api_endpoints',
    description:
      'List the Gatewaze admin API endpoints this server is allowed to call (METHOD + path pattern). Call this first to discover what you can do.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'gatewaze_api_call',
    description:
      'Call a Gatewaze admin API endpoint. Only METHOD+path combinations returned by gatewaze_api_endpoints are permitted; anything else is refused. Auth is handled by the server (admin JWT).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        method: { type: 'string', description: 'GET | POST | PATCH | PUT | DELETE' },
        path: { type: 'string', description: "Path only, e.g. /api/events/abc123 (no query string)" },
        query: { type: 'object', description: 'Optional query parameters as key/value pairs' },
        body: { type: 'object', description: 'Optional JSON body for POST/PATCH/PUT' },
      },
      required: ['method', 'path'],
    },
  },
];

function buildUrl(baseUrl: string, path: string, query?: Record<string, unknown>): string {
  const url = new URL(`${baseUrl}${path}`);
  if (query && typeof query === 'object') {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function handleApiCall(cfg: ApiMcpConfig, p: Record<string, unknown>) {
  const method = String(p.method ?? '').toUpperCase();
  const path = String(p.path ?? '');
  const verdict = isAllowed(cfg.allow, method, path);
  if (!verdict.ok) {
    throw new Error(
      `Refused: ${verdict.reason}. Allowed: ${cfg.allow.map((e) => e.raw).join('; ')}`,
    );
  }

  const url = buildUrl(cfg.baseUrl, path, p.query as Record<string, unknown> | undefined);
  const init: RequestInit = {
    method,
    headers: { Authorization: `Bearer ${cfg.jwt}`, 'Content-Type': 'application/json' },
  };
  if (method !== 'GET' && p.body !== undefined) init.body = JSON.stringify(p.body);

  const res = await fetch(url, init);
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text.length ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body — return as text */
  }
  return { status: res.status, ok: res.ok, body: parsed };
}

export function createApiMcpServer(cfg: ApiMcpConfig): Server {
  const server = new Server(
    { name: 'gatewaze-api-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const p = (args ?? {}) as Record<string, unknown>;
    try {
      let result: unknown;
      if (name === 'gatewaze_api_endpoints') {
        result = { allowed: cfg.allow.map((e) => e.raw) };
      } else if (name === 'gatewaze_api_call') {
        result = await handleApiCall(cfg, p);
      } else {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
          isError: true,
        };
      }
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };
    }
  });

  return server;
}
