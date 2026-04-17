import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { GatewazeApiClient } from './lib/supabase.js';

// ── Tool definitions ─────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'events_search',
    description:
      'Search events by title, date range, city, type, or topics. Returns paginated results.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        city: { type: 'string', description: 'Filter by city (partial match)' },
        type: { type: 'string', description: 'Filter by event type' },
        from: { type: 'string', description: 'Events starting after this date (ISO 8601)' },
        to: { type: 'string', description: 'Events starting before this date (ISO 8601)' },
        topics: { type: 'string', description: 'Comma-separated topic filter' },
        calendar_id: { type: 'string', description: 'Filter by calendar UUID' },
        fields: { type: 'string', description: 'Comma-separated field list (sparse fieldset)' },
        limit: { type: 'number', description: 'Max results (default 25, max 100)' },
        offset: { type: 'number', description: 'Skip N results (default 0)' },
      },
    },
  },
  {
    name: 'events_get',
    description: 'Get full details of a single event by UUID or short event_id.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Event UUID or short event_id' },
        fields: { type: 'string', description: 'Comma-separated field list' },
      },
      required: ['id'],
    },
  },
  {
    name: 'events_speakers',
    description: 'Get speakers for a specific event.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Event UUID or short event_id' },
      },
      required: ['id'],
    },
  },
  {
    name: 'events_sponsors',
    description: 'Get sponsors for a specific event.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Event UUID or short event_id' },
      },
      required: ['id'],
    },
  },
  {
    name: 'platform_health',
    description: 'Check the Gatewaze platform health and see how many modules are active.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
];

// ── Handlers ─────────────────────────────────────────────────────────────

async function handleEventsSearch(
  params: Record<string, unknown>,
  api: GatewazeApiClient,
) {
  const queryParams: Record<string, string | number | undefined> = {};
  if (params.city) queryParams.city = String(params.city);
  if (params.type) queryParams.type = String(params.type);
  if (params.from) queryParams.from = String(params.from);
  if (params.to) queryParams.to = String(params.to);
  if (params.topics) queryParams.topics = String(params.topics);
  if (params.calendar_id) queryParams.calendar_id = String(params.calendar_id);
  if (params.fields) queryParams.fields = String(params.fields);
  if (params.limit) queryParams.limit = Number(params.limit);
  if (params.offset) queryParams.offset = Number(params.offset);

  return api.get('/events', queryParams);
}

async function handleEventsGet(
  params: Record<string, unknown>,
  api: GatewazeApiClient,
) {
  const queryParams: Record<string, string | number | undefined> = {};
  if (params.fields) queryParams.fields = String(params.fields);

  return api.get(`/events/${params.id}`, queryParams);
}

async function handleEventsSpeakers(
  params: Record<string, unknown>,
  api: GatewazeApiClient,
) {
  return api.get(`/events/${params.id}/speakers`);
}

async function handleEventsSponsors(
  params: Record<string, unknown>,
  api: GatewazeApiClient,
) {
  return api.get(`/events/${params.id}/sponsors`);
}

async function handlePlatformHealth(api: GatewazeApiClient) {
  return api.get('/health');
}

// ── Server factory ───────────────────────────────────────────────────────

export function createGatewazeMcpServer(api: GatewazeApiClient): Server {
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

    try {
      switch (name) {
        case 'events_search':
          result = await handleEventsSearch(params, api);
          break;
        case 'events_get':
          result = await handleEventsGet(params, api);
          break;
        case 'events_speakers':
          result = await handleEventsSpeakers(params, api);
          break;
        case 'events_sponsors':
          result = await handleEventsSponsors(params, api);
          break;
        case 'platform_health':
          result = await handlePlatformHealth(api);
          break;
        default:
          return {
            content: [
              { type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) },
            ],
            isError: true,
          };
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  });

  return server;
}
