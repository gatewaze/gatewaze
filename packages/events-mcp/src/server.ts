import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { EventsStore, isLumaSyncStatus } from './lib/events-store.js';

// ── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'events_luma_syncable',
    description:
      'List events that should be pushed to Luma: events on calendars with luma_sync_enabled=true that already have a luma_event_id and have changed since their last push (or have never been pushed). Each row includes the event fields plus the owning calendar\'s luma_calendar_id. This is the ownership gate — only sync the events this returns.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'events_get',
    description:
      'Fetch a single event by its UUID (id) or public event_id slug. Returns the full event row, or null if not found.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Event UUID or public event_id slug' },
      },
      required: ['id'],
    },
  },
  {
    name: 'events_set_luma_sync',
    description:
      "Record the outcome of a Luma push for one event. Writes ONLY the luma_sync_* columns. status must be one of 'pending' | 'syncing' | 'synced' | 'failed'. On 'synced', luma_synced_at is stamped to now. Pass pushed_hash to record the content hash that was pushed (for change detection); pass error when status='failed'.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Event UUID (id column)' },
        status: {
          type: 'string',
          description: "Sync status: 'pending' | 'syncing' | 'synced' | 'failed'",
        },
        pushed_hash: {
          type: 'string',
          description: 'Content hash that was pushed to Luma (optional, for change detection)',
        },
        error: {
          type: 'string',
          description: "Error message when status='failed' (optional)",
        },
      },
      required: ['id', 'status'],
    },
  },
];

// ── Server factory ─────────────────────────────────────────────────────────

export function createEventsMcpServer(store: EventsStore): Server {
  const server = new Server(
    { name: 'gatewaze-events-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const p = (args ?? {}) as Record<string, unknown>;

    try {
      let result: unknown;
      switch (name) {
        case 'events_luma_syncable':
          result = await store.lumaSyncable();
          break;
        case 'events_get':
          result = await store.get(String(p.id));
          break;
        case 'events_set_luma_sync': {
          const status = String(p.status);
          if (!isLumaSyncStatus(status)) {
            throw new Error(
              `invalid status '${status}' (expected pending | syncing | synced | failed)`,
            );
          }
          result = await store.setLumaSync(
            String(p.id),
            status,
            p.pushed_hash !== undefined ? String(p.pushed_hash) : undefined,
            p.error !== undefined ? String(p.error) : undefined,
          );
          break;
        }
        default:
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
