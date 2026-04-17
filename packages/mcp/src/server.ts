import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { SupabaseClient } from '@supabase/supabase-js';

// ── Tool definitions ─────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'people_search',
    description:
      'Search people by name, email, or status. Returns paginated results.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search term to match against name or email',
        },
        status: {
          type: 'string',
          description: 'Filter by status (e.g. active, invited)',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default 25, max 100)',
        },
        offset: {
          type: 'number',
          description: 'Number of results to skip for pagination',
        },
      },
    },
  },
  {
    name: 'people_get',
    description: 'Get a single person by their ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'The person UUID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'people_count',
    description: 'Count people, optionally filtered by status.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        status: {
          type: 'string',
          description: 'Filter by status before counting',
        },
      },
    },
  },
  {
    name: 'platform_settings_get',
    description:
      'Get platform settings. Optionally filter to specific keys.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        keys: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Specific setting keys to retrieve. Omit for all settings.',
        },
      },
    },
  },
  {
    name: 'modules_list',
    description: 'List all installed modules with their status.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'modules_get',
    description: 'Get details for a specific module by its ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'The module ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'query_read',
    description:
      'Execute a read-only SQL query. Not yet implemented in v1 — use the individual data tools instead.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sql: { type: 'string', description: 'A SELECT query to execute' },
      },
      required: ['sql'],
    },
  },
];

// ── Handlers ─────────────────────────────────────────────────────────────

async function handlePeopleSearch(
  params: Record<string, unknown>,
  supabase: SupabaseClient,
) {
  const limit = Math.min(Number(params.limit) || 25, 100);
  const offset = Number(params.offset) || 0;
  const query = (params.query as string) ?? '';
  const status = params.status as string | undefined;

  let q = supabase.from('people').select('*', { count: 'exact' });

  if (query) {
    q = q.or(`full_name.ilike.%${query}%,email.ilike.%${query}%`);
  }
  if (status) {
    q = q.eq('status', status);
  }

  const { data, count, error } = await q
    .range(offset, offset + limit - 1)
    .order('created_at', { ascending: false });

  if (error) return { error: error.message };
  return { data, total: count, limit, offset };
}

async function handlePeopleGet(
  params: Record<string, unknown>,
  supabase: SupabaseClient,
) {
  const { data, error } = await supabase
    .from('people')
    .select('*')
    .eq('id', params.id as string)
    .single();

  if (error) return { error: error.message };
  return data;
}

async function handlePeopleCount(
  params: Record<string, unknown>,
  supabase: SupabaseClient,
) {
  let q = supabase.from('people').select('*', { count: 'exact', head: true });

  if (params.status) {
    q = q.eq('status', params.status as string);
  }

  const { count, error } = await q;
  if (error) return { error: error.message };
  return { count };
}

async function handlePlatformSettingsGet(
  params: Record<string, unknown>,
  supabase: SupabaseClient,
) {
  let q = supabase.from('platform_settings').select('*');

  const keys = params.keys as string[] | undefined;
  if (keys && keys.length > 0) {
    q = q.in('key', keys);
  }

  const { data, error } = await q;
  if (error) return { error: error.message };
  return data;
}

async function handleModulesList(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from('modules')
    .select('*')
    .order('name');

  if (error) return { error: error.message };
  return data;
}

async function handleModulesGet(
  params: Record<string, unknown>,
  supabase: SupabaseClient,
) {
  const { data, error } = await supabase
    .from('modules')
    .select('*')
    .eq('id', params.id as string)
    .single();

  if (error) return { error: error.message };
  return data;
}

// ── Server factory ───────────────────────────────────────────────────────

export function createGatewazeMcpServer(supabase: SupabaseClient): Server {
  const server = new Server(
    { name: 'gatewaze-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  // List tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  // Call tool
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const params = (args ?? {}) as Record<string, unknown>;

    let result: unknown;

    switch (name) {
      case 'people_search':
        result = await handlePeopleSearch(params, supabase);
        break;
      case 'people_get':
        result = await handlePeopleGet(params, supabase);
        break;
      case 'people_count':
        result = await handlePeopleCount(params, supabase);
        break;
      case 'platform_settings_get':
        result = await handlePlatformSettingsGet(params, supabase);
        break;
      case 'modules_list':
        result = await handleModulesList(supabase);
        break;
      case 'modules_get':
        result = await handleModulesGet(params, supabase);
        break;
      case 'query_read':
        result = {
          error:
            'query_read is not yet implemented in v1. Use the individual data tools (people_search, people_get, modules_list, etc.) instead.',
        };
        break;
      default:
        return {
          content: [
            { type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) },
          ],
          isError: true,
        };
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  });

  return server;
}
