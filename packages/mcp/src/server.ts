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

  // ── Structured resources (require an API key with resources:write) ──────
  {
    name: 'resources_collections_list',
    description:
      'List all structured-resource collections, including drafts. Requires the resources:write API-key scope.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Max results (default 25, max 100)' },
        offset: { type: 'number', description: 'Skip N results (default 0)' },
      },
    },
  },
  {
    name: 'resources_collection_get',
    description:
      'Get a resource collection by UUID with its categories and section templates — everything needed to author items into it.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Collection UUID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'resources_collection_create',
    description:
      'Create a structured-resource collection. Slug is generated from the name when omitted. New collections default to status=draft.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Collection name' },
        slug: { type: 'string', description: 'URL slug (auto-generated from name if omitted)' },
        description: { type: 'string', description: 'Collection description' },
        status: { type: 'string', description: "'draft' | 'published' | 'archived' (default 'draft')" },
        access: { type: 'string', description: "'public' | 'authenticated' | 'inherit' (default 'inherit')" },
        sort_order: { type: 'number', description: 'Position in the collections list' },
      },
      required: ['name'],
    },
  },
  {
    name: 'resources_collection_update',
    description:
      "Update a resource collection's fields — set status='published' to publish it.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Collection UUID' },
        name: { type: 'string' },
        slug: { type: 'string' },
        description: { type: 'string' },
        status: { type: 'string', description: "'draft' | 'published' | 'archived'" },
        access: { type: 'string', description: "'public' | 'authenticated' | 'inherit'" },
        sort_order: { type: 'number' },
      },
      required: ['id'],
    },
  },
  {
    name: 'resources_category_create',
    description: 'Create a category inside a resource collection. Items must belong to a category.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        collection_id: { type: 'string', description: 'Parent collection UUID' },
        name: { type: 'string', description: 'Category name' },
        description: { type: 'string' },
        icon: { type: 'string', description: 'Icon name (optional)' },
        sort_order: { type: 'number' },
      },
      required: ['collection_id', 'name'],
    },
  },
  {
    name: 'resources_template_create',
    description:
      'Create a section template in a collection. Templates define the standard section headings items in the collection should have.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        collection_id: { type: 'string', description: 'Parent collection UUID' },
        heading: { type: 'string', description: 'Section heading' },
        description: { type: 'string' },
        is_required: { type: 'boolean', description: 'Whether items must include this section' },
        sort_order: { type: 'number' },
      },
      required: ['collection_id', 'heading'],
    },
  },
  {
    name: 'resources_items_list',
    description: "List a collection's items across all statuses (optionally filtered by status).",
    inputSchema: {
      type: 'object' as const,
      properties: {
        collection_id: { type: 'string', description: 'Collection UUID' },
        status: { type: 'string', description: "Filter: 'draft' | 'published' | 'archived'" },
        limit: { type: 'number', description: 'Max results (default 25, max 100)' },
        offset: { type: 'number', description: 'Skip N results (default 0)' },
      },
      required: ['collection_id'],
    },
  },
  {
    name: 'resources_item_get',
    description: 'Get a full resource item (any status) with its ordered sections.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Item UUID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'resources_item_create',
    description:
      'Create a resource item in a collection, optionally with its ordered content sections in the same call. New items default to status=draft; pass status=published to go live immediately.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        collection_id: { type: 'string', description: 'Parent collection UUID' },
        category_id: { type: 'string', description: 'Category UUID (must belong to the collection)' },
        title: { type: 'string', description: 'Item title' },
        slug: { type: 'string', description: 'URL slug (auto-generated from title if omitted)' },
        subtitle: { type: 'string' },
        external_url: { type: 'string', description: 'Link to the underlying resource' },
        featured_image_url: { type: 'string' },
        status: { type: 'string', description: "'draft' | 'published' | 'archived' (default 'draft')" },
        sort_order: { type: 'number' },
        sections: {
          type: 'array',
          description: 'Ordered content sections',
          items: {
            type: 'object',
            properties: {
              heading: { type: 'string' },
              content: { type: 'string', description: 'Markdown content' },
              template_id: { type: 'string', description: 'Section template UUID (optional)' },
              sort_order: { type: 'number' },
            },
            required: ['heading'],
          },
        },
      },
      required: ['collection_id', 'category_id', 'title'],
    },
  },
  {
    name: 'resources_item_update',
    description:
      "Update a resource item's fields — set status='published' to publish it. Sections are replaced separately via resources_item_sections_set.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Item UUID' },
        title: { type: 'string' },
        slug: { type: 'string' },
        subtitle: { type: 'string' },
        category_id: { type: 'string' },
        external_url: { type: 'string' },
        featured_image_url: { type: 'string' },
        status: { type: 'string', description: "'draft' | 'published' | 'archived'" },
        sort_order: { type: 'number' },
      },
      required: ['id'],
    },
  },
  {
    name: 'resources_item_sections_set',
    description: "Replace a resource item's full section list with the given ordered sections.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Item UUID' },
        sections: {
          type: 'array',
          description: 'Ordered content sections (replaces all existing sections)',
          items: {
            type: 'object',
            properties: {
              heading: { type: 'string' },
              content: { type: 'string', description: 'Markdown content' },
              template_id: { type: 'string', description: 'Section template UUID (optional)' },
              sort_order: { type: 'number' },
            },
            required: ['heading'],
          },
        },
      },
      required: ['id', 'sections'],
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

// ── Structured-resources handlers ────────────────────────────────────────
// Thin wrappers over the resources module's management API
// (/api/v1/resources/*, resources:write scope). Body-building strips the
// routing params (ids) and forwards everything else verbatim — validation
// lives server-side.

function bodyWithout(params: Record<string, unknown>, ...omit: string[]): Record<string, unknown> {
  const body = { ...params };
  for (const key of omit) delete body[key];
  return body;
}

async function handleResourcesCollectionsList(
  params: Record<string, unknown>,
  api: GatewazeApiClient,
) {
  const queryParams: Record<string, string | number | undefined> = {};
  if (params.limit) queryParams.limit = Number(params.limit);
  if (params.offset) queryParams.offset = Number(params.offset);
  return api.get('/resources/collections', queryParams);
}

async function handleResourcesItemsList(
  params: Record<string, unknown>,
  api: GatewazeApiClient,
) {
  const queryParams: Record<string, string | number | undefined> = {};
  if (params.status) queryParams.status = String(params.status);
  if (params.limit) queryParams.limit = Number(params.limit);
  if (params.offset) queryParams.offset = Number(params.offset);
  return api.get(`/resources/collections/${params.collection_id}/items`, queryParams);
}

// ── Server factory ───────────────────────────────────────────────────────

export function createGatewazeMcpServer(api: GatewazeApiClient): Server {
  const server = new Server(
    { name: 'gatewaze-mcp', version: '0.2.0' },
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
        case 'resources_collections_list':
          result = await handleResourcesCollectionsList(params, api);
          break;
        case 'resources_collection_get':
          result = await api.get(`/resources/collections/${params.id}`);
          break;
        case 'resources_collection_create':
          result = await api.post('/resources/collections', params);
          break;
        case 'resources_collection_update':
          result = await api.patch(`/resources/collections/${params.id}`, bodyWithout(params, 'id'));
          break;
        case 'resources_category_create':
          result = await api.post(
            `/resources/collections/${params.collection_id}/categories`,
            bodyWithout(params, 'collection_id'),
          );
          break;
        case 'resources_template_create':
          result = await api.post(
            `/resources/collections/${params.collection_id}/templates`,
            bodyWithout(params, 'collection_id'),
          );
          break;
        case 'resources_items_list':
          result = await handleResourcesItemsList(params, api);
          break;
        case 'resources_item_get':
          result = await api.get(`/resources/items/${params.id}/manage`);
          break;
        case 'resources_item_create':
          result = await api.post(
            `/resources/collections/${params.collection_id}/items`,
            bodyWithout(params, 'collection_id'),
          );
          break;
        case 'resources_item_update':
          result = await api.patch(`/resources/items/${params.id}`, bodyWithout(params, 'id'));
          break;
        case 'resources_item_sections_set':
          result = await api.put(
            `/resources/items/${params.id}/sections`,
            bodyWithout(params, 'id'),
          );
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
