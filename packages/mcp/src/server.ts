import { Server, type Tool } from '@modelcontextprotocol/server';
import type { GatewazeApiClient } from './lib/supabase.js';

// ── Tool definitions ─────────────────────────────────────────────────────

const TOOLS: Tool[] = [
  {
    name: 'events_search',
    description:
      "Search PUBLISHED events by date range, city, type, topics, or calendar. Everything returned is already published/live on the portal — there is no draft state on this surface. The response's pagination.total is the COMPLETE count of published events matching the filters: to answer 'how many events…' call with limit=1 and read pagination.total (or use platform_stats).",
    inputSchema: {
      type: 'object' as const,
      properties: {
        q: { type: 'string', description: 'Filter by event title (partial match, case-insensitive)' },
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

  // ── Unified content feed (read-only, spans all enabled modules) ─────────
  {
    name: 'content_list',
    description:
      "Unified read-only feed of PUBLISHED content across ALL enabled modules — events, newsletter editions, resource items, and any module that publishes content — sorted newest first. Filter by type or category; pass full=true for the complete public record per row. pagination.total is the complete published count for the given filters (use limit=1 for count questions).",
    inputSchema: {
      type: 'object' as const,
      properties: {
        type: {
          type: 'string',
          description: "Comma-separated content types to include (e.g. 'event,blog_post,resource'). Omit for all types.",
        },
        content_category: {
          type: 'string',
          description: 'Comma-separated category filter (see content_categories for available values)',
        },
        full: { type: 'boolean', description: 'Include the full public record per row (default false: summary fields only)' },
        limit: { type: 'number', description: 'Max results (default 25, max 100)' },
        offset: { type: 'number', description: 'Skip N results (default 0)' },
      },
    },
  },
  {
    name: 'content_categories',
    description: 'List the content categories configured on this platform (used to filter content_list).',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'content_get',
    description:
      "Get the FULL public record for a single content item found via content_list, including body content where the platform exposes it (newsletter editions include their full block content; events include descriptions; resource items include their public fields). Pass the type and id exactly as returned by content_list.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        type: {
          type: 'string',
          description: "Content type from content_list (e.g. 'event', 'newsletter_edition', 'resource')",
        },
        id: { type: 'string', description: 'Item id from content_list' },
      },
      required: ['type', 'id'],
    },
  },
  {
    name: 'calendars_list',
    description:
      "List the platform's public calendars (name, slug, description, event_count, calendar_id). Use this ONLY to scope event queries to a named sub-calendar via events_search's calendar_id — platform-wide questions need no calendar.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        q: { type: 'string', description: 'Filter by calendar name (partial match)' },
        limit: { type: 'number', description: 'Max results (default 25, max 100)' },
        offset: { type: 'number', description: 'Skip N results (default 0)' },
      },
    },
  },
  {
    name: 'platform_stats',
    description:
      "Counts of PUBLISHED content on this platform: total and upcoming events, newsletter editions, resource items, public calendars, and total content items. Call this FIRST for any 'how many …' question.",
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'content_schema',
    description:
      'Describes the content types available on this platform and the fields each exposes — the summary row shape from content_list and the full public record from content_get / full=true. Call this when unsure what data exists or which fields a type has.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'search',
    description:
      "AI-powered semantic search over the platform's PUBLISHED content (events and blog posts). Interprets natural-language queries by meaning, not keywords — use this when the user is looking for content about a topic ('AI governance talks', 'articles on agent memory') rather than filtering by structured fields. Returns ranked results with match reasons plus a summary.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Natural-language search query' },
        content_types: {
          type: 'array',
          items: { type: 'string' },
          description: "Restrict to content types, e.g. ['events'] or ['blog'] (default: all)",
        },
      },
      required: ['query'],
    },
  },

  // ── Event metrics (requires an API key with events:metrics) ─────────────
  {
    name: 'events_metrics',
    description:
      "Registration metrics for ALL events — published AND unpublished/draft — searchable by title: each matching event's details (title, city, dates, type, publish state) with its registrant count, check-ins, and cancellations. Example: q='MCP Release Party' lists every matching event with its numbers. is_published=false rows are internal-only events invisible on the portal. Requires the events:metrics API-key scope.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        q: { type: 'string', description: 'Filter by event title (partial match, case-insensitive)' },
        calendar_id: { type: 'string', description: 'Restrict to one calendar (see calendars_list)' },
        from: { type: 'string', description: 'Events starting after this date (ISO 8601)' },
        to: { type: 'string', description: 'Events starting before this date (ISO 8601)' },
        limit: { type: 'number', description: 'Max results (default 25, max 50)' },
        offset: { type: 'number', description: 'Skip N results (default 0)' },
      },
    },
  },
  {
    name: 'events_metrics_summary',
    description:
      "Platform-wide registration totals in ONE call: total events, registrations, check-ins, cancellations, and how many events actually log attendance (most don't — always caveat attendance numbers with the included attendance_note). Also returns the top events by registrants, which answers 'what is our most successful event'. Optional q/from/to restrict the totals. Requires the events:metrics scope.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        q: { type: 'string', description: 'Restrict totals to events whose title matches' },
        from: { type: 'string', description: 'Events starting after this date (ISO 8601)' },
        to: { type: 'string', description: 'Events starting before this date (ISO 8601)' },
        limit: { type: 'number', description: 'Size of the top-events list (default 10, max 50)' },
      },
    },
  },
  {
    name: 'events_registrant_breakdown',
    description:
      "AGGREGATED registration-form answers for an event — each question asked at registration with per-answer counts (e.g. company/job-title tables). Never returns registrant-level rows. Forms vary per event: some ask a combined 'company - role' field, so bin the aggregated answers yourself when summarising. Requires the events:metrics scope.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        q: { type: 'string', description: 'Event title filter (partial match)' },
        id: { type: 'string', description: 'Event UUID or short event_id' },
        limit: { type: 'number', description: 'Max matching events to break down (default 3, max 5)' },
      },
    },
  },
  {
    name: 'events_nearby',
    description:
      "Upcoming PUBLISHED events near a location, soonest first with distance_km. Provide lat/lng, or a city name (falls back to a city-filtered search), or NOTHING — with no location the server geolocates the caller's IP address. Answers 'when is the next event in my area?'.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        lat: { type: 'number', description: 'Latitude (with lng)' },
        lng: { type: 'number', description: 'Longitude (with lat)' },
        city: { type: 'string', description: 'City name — used when lat/lng not provided' },
        radius_km: { type: 'number', description: 'Search radius in km (default 150, max 5000)' },
        limit: { type: 'number', description: 'Max results (default 10, max 50)' },
      },
    },
  },
  {
    name: 'my_registrations',
    description:
      "The signed-in user's OWN event registrations: total and upcoming counts, their next event, and the full list with check-in status. Answers 'how many events am I registered for?' and 'when is my next event?'. Requires sign-in (any authenticated tier); only ever returns the caller's own data.",
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
    description:
      "Replace a resource item's full section list with the given ordered sections. DESTRUCTIVE full-replace: sections absent from the payload are deleted. Each section carries either raw `content` HTML or a typed `blocks` array (never both). Read the item first (resources_item_get) and echo its `version` as `if_match` to guard against concurrent edits.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Item UUID' },
        if_match: { type: 'string', description: "Optional concurrency token: the item's `version` from resources_item_get, echoed verbatim. Stale -> conflict; omitted -> last-write-wins." },
        sections: {
          type: 'array',
          description: 'Ordered content sections (replaces all existing sections)',
          items: {
            type: 'object',
            properties: {
              heading: { type: 'string' },
              content: { type: 'string', description: 'Raw HTML content (mutually exclusive with blocks)' },
              template_id: { type: 'string', description: 'Section template UUID (optional)' },
              sort_order: { type: 'number' },
              blocks: {
                type: 'array',
                description: 'Typed content blocks (mutually exclusive with content). Kinds + data schemas: resources_block_kinds.',
                items: {
                  type: 'object',
                  properties: {
                    kind: { type: 'string', description: "'html' | 'talk'" },
                    slug: { type: 'string', description: 'Stable anchor slug (required for talk; generated from title when omitted)' },
                    sort_order: { type: 'number' },
                    data: { type: 'object', description: 'Kind-specific payload, validated server-side' },
                  },
                  required: ['kind', 'data'],
                },
              },
            },
            required: ['heading'],
          },
        },
      },
      required: ['id', 'sections'],
    },
  },
  {
    name: 'resources_section_blocks_set',
    description:
      "Replace ONE section's typed blocks without resending the item's other sections. Never touches the section's legacy content; an empty blocks array reverts the section to legacy content rendering. Block ids regenerate on every write — slugs are the stable identifiers.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        item_id: { type: 'string', description: 'Item UUID' },
        section_id: { type: 'string', description: 'Section UUID' },
        if_match: { type: 'string', description: "Optional concurrency token from resources_item_get `version`, echoed verbatim." },
        blocks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              kind: { type: 'string', description: "'html' | 'talk'" },
              slug: { type: 'string' },
              sort_order: { type: 'number' },
              data: { type: 'object' },
            },
            required: ['kind', 'data'],
          },
        },
      },
      required: ['item_id', 'section_id', 'blocks'],
    },
  },
  {
    name: 'resources_block_kinds',
    description: 'List the registered block kinds with their JSON Schemas, so typed blocks can be authored without guessing the data shape.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'signals_rules_list',
    description: 'List the Signals routing rules (content-to-audience routing engine): name, status, definition, last evaluation.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'signals_rule_create',
    description:
      'Propose a Signals routing rule. Lands PAUSED for human review unless status=active is passed explicitly. definition: { topics: [slugs], min_overlap, content: {types:[sr_item,event], hrefs:[]}, audience: {per_person, max, segment_id}, channel: {type: log|webhook|portal_pin|broadcast_draft, config}, frequency_cap: {per_person_days}, interval_minutes }.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        definition: { type: 'object', description: 'Rule definition (validated server-side)' },
        status: { type: 'string', description: "'paused' (default) or 'active'" },
      },
      required: ['name', 'definition'],
    },
  },
  {
    name: 'signals_rule_update',
    description: 'Update a Signals rule — activate/pause it or edit its definition.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Rule UUID' },
        name: { type: 'string' },
        description: { type: 'string' },
        definition: { type: 'object' },
        status: { type: 'string', description: "'active' | 'paused'" },
      },
      required: ['id'],
    },
  },
  {
    name: 'signals_rule_evaluate',
    description: 'Evaluate one Signals rule now (audit: creates fires and dispatches them). Pass dry_run=true to preview candidate/audience/fire counts without writing anything.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Rule UUID' },
        dry_run: { type: 'boolean' },
      },
      required: ['id'],
    },
  },
  {
    name: 'signals_fires_list',
    description: 'Recent Signals fires (routing decisions): content, person, channel, dispatch status. Filter by rule_id or status.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        rule_id: { type: 'string' },
        status: { type: 'string', description: 'fired | dispatched | failed | suppressed' },
      },
    },
  },
  {
    name: 'signals_stats',
    description: 'Per-rule Signals telemetry: fires, dispatched/failed/suppressed counts, outcomes, clicks.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
];

// ── Handlers ─────────────────────────────────────────────────────────────

/**
 * The API's sparse-fieldset parser silently strips unknown names, and agents
 * habitually ask for `title`/`city`/`start_at` — map the common aliases onto
 * the real event columns so requests don't quietly lose fields.
 */
const EVENT_FIELD_ALIASES: Record<string, string> = {
  title: 'event_title',
  name: 'event_title',
  description: 'event_description',
  city: 'event_city',
  region: 'event_region',
  country: 'event_country_code',
  country_code: 'event_country_code',
  start: 'event_start',
  start_at: 'event_start',
  starts_at: 'event_start',
  end: 'event_end',
  end_at: 'event_end',
  ends_at: 'event_end',
  timezone: 'event_timezone',
  type: 'event_type',
  topics: 'event_topics',
  location: 'event_location',
  link: 'event_link',
  logo: 'event_logo',
  slug: 'event_id',
};

function mapEventFields(fields: unknown): string {
  return String(fields)
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean)
    .map((f) => EVENT_FIELD_ALIASES[f.toLowerCase()] ?? f)
    .join(',');
}

async function handleEventsSearch(
  params: Record<string, unknown>,
  api: GatewazeApiClient,
) {
  const queryParams: Record<string, string | number | undefined> = {};
  if (params.q) queryParams.q = String(params.q);
  if (params.city) queryParams.city = String(params.city);
  if (params.type) queryParams.type = String(params.type);
  if (params.from) queryParams.from = String(params.from);
  if (params.to) queryParams.to = String(params.to);
  if (params.topics) queryParams.topics = String(params.topics);
  if (params.calendar_id) queryParams.calendar_id = String(params.calendar_id);
  if (params.fields) queryParams.fields = mapEventFields(params.fields);
  if (params.limit) queryParams.limit = Number(params.limit);
  if (params.offset) queryParams.offset = Number(params.offset);

  return api.get('/events', queryParams);
}

async function handleEventsGet(
  params: Record<string, unknown>,
  api: GatewazeApiClient,
) {
  const queryParams: Record<string, string | number | undefined> = {};
  if (params.fields) queryParams.fields = mapEventFields(params.fields);

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

async function handleEventsMetrics(
  params: Record<string, unknown>,
  api: GatewazeApiClient,
) {
  const queryParams: Record<string, string | number | undefined> = {};
  if (params.q) queryParams.q = String(params.q);
  if (params.calendar_id) queryParams.calendar_id = String(params.calendar_id);
  if (params.from) queryParams.from = String(params.from);
  if (params.to) queryParams.to = String(params.to);
  if (params.limit) queryParams.limit = Number(params.limit);
  if (params.offset) queryParams.offset = Number(params.offset);
  return api.get('/events/metrics', queryParams);
}

async function handleEventsMetricsSummary(
  params: Record<string, unknown>,
  api: GatewazeApiClient,
) {
  const queryParams: Record<string, string | number | undefined> = {};
  if (params.q) queryParams.q = String(params.q);
  if (params.from) queryParams.from = String(params.from);
  if (params.to) queryParams.to = String(params.to);
  if (params.limit) queryParams.limit = Number(params.limit);
  return api.get('/events/metrics/summary', queryParams);
}

async function handleEventsRegistrantBreakdown(
  params: Record<string, unknown>,
  api: GatewazeApiClient,
) {
  const queryParams: Record<string, string | number | undefined> = {};
  if (params.q) queryParams.q = String(params.q);
  if (params.id) queryParams.id = String(params.id);
  if (params.limit) queryParams.limit = Number(params.limit);
  return api.get('/events/registrant-breakdown', queryParams);
}

/**
 * events_nearby: lat/lng → radius search; city only → city-filtered upcoming
 * search; nothing → geolocate the caller's IP (ip-api.com, 3s bound) and
 * radius-search around it. Private/unresolvable IPs return a clear ask for
 * a location instead of guessing.
 */
async function handleEventsNearby(
  params: Record<string, unknown>,
  api: GatewazeApiClient,
  callerIp?: string,
) {
  let lat = typeof params.lat === 'number' ? params.lat : undefined;
  let lng = typeof params.lng === 'number' ? params.lng : undefined;
  let located_via = 'coordinates';

  if ((lat === undefined || lng === undefined) && params.city) {
    const res = (await api.get('/events', {
      city: String(params.city),
      from: new Date().toISOString(),
      limit: Number(params.limit) || 10,
    })) as Record<string, unknown>;
    return { ...res, located_via: 'city_filter', note: 'city-name match (no coordinates supplied)' };
  }

  if (lat === undefined || lng === undefined) {
    if (!callerIp || callerIp === 'unknown') {
      return { error: 'No location available — provide lat/lng or a city name.' };
    }
    try {
      const geo = await fetch(`http://ip-api.com/json/${encodeURIComponent(callerIp)}?fields=status,lat,lon,city,country`, {
        signal: AbortSignal.timeout(3000),
      });
      const g = (await geo.json()) as { status?: string; lat?: number; lon?: number; city?: string; country?: string };
      if (g.status !== 'success' || typeof g.lat !== 'number' || typeof g.lon !== 'number') {
        return { error: 'Could not geolocate your IP — provide lat/lng or a city name.' };
      }
      lat = g.lat;
      lng = g.lon;
      located_via = `ip_geolocation (${[g.city, g.country].filter(Boolean).join(', ')})`;
    } catch {
      return { error: 'Geolocation lookup failed — provide lat/lng or a city name.' };
    }
  }

  const queryParams: Record<string, string | number | undefined> = { lat, lng };
  if (params.radius_km) queryParams.radius_km = Number(params.radius_km);
  if (params.limit) queryParams.limit = Number(params.limit);
  const res = (await api.get('/events/nearby', queryParams)) as Record<string, unknown>;
  return { ...res, located_via };
}

async function handleContentList(
  params: Record<string, unknown>,
  api: GatewazeApiClient,
) {
  const queryParams: Record<string, string | number | undefined> = {};
  if (params.type) queryParams.type = String(params.type);
  if (params.content_category) queryParams.content_category = String(params.content_category);
  if (params.full === true) queryParams.expand = 'full';
  if (params.limit) queryParams.limit = Number(params.limit);
  if (params.offset) queryParams.offset = Number(params.offset);
  return api.get('/content', queryParams);
}

async function handleContentGet(
  params: Record<string, unknown>,
  api: GatewazeApiClient,
) {
  const type = String(params.type ?? '');
  const id = String(params.id ?? '');
  switch (type) {
    case 'event':
      return api.get(`/events/${id}`);
    case 'newsletter_edition': {
      // The edition record and its full block content are separate public
      // endpoints — merge so agents get metadata + body in one call.
      const [edition, content] = await Promise.all([
        api.get<{ data?: unknown }>(`/newsletters/editions/${id}`),
        api.get<{ data?: unknown }>(`/newsletters/editions/${id}/content`),
      ]);
      return {
        data: {
          ...(edition as { data?: Record<string, unknown> }).data,
          content: (content as { data?: unknown }).data ?? content,
        },
      };
    }
    case 'resource':
      return api.get(`/resources/items/${id}`);
    default:
      throw new Error(
        `Unsupported content type '${type}' — pass a type returned by content_list (event, newsletter_edition, resource)`,
      );
  }
}

async function handleCalendarsList(
  params: Record<string, unknown>,
  api: GatewazeApiClient,
) {
  const queryParams: Record<string, string | number | undefined> = {};
  if (params.q) queryParams.q = String(params.q);
  if (params.limit) queryParams.limit = Number(params.limit);
  if (params.offset) queryParams.offset = Number(params.offset);
  return api.get('/calendars', queryParams);
}

type Paginated = { pagination?: { total?: number } };

async function handlePlatformStats(api: GatewazeApiClient) {
  const today = new Date().toISOString().slice(0, 10);
  const total = async (path: string, params?: Record<string, string | number>) => {
    try {
      const r = await api.get<Paginated>(path, { ...params, limit: 1 });
      return r.pagination?.total ?? null;
    } catch {
      return null; // module disabled / scope missing — omit rather than fail the whole call
    }
  };
  const [events, upcoming, editions, resources, calendars, allContent] = await Promise.all([
    total('/events'),
    total('/events', { from: today }),
    total('/content', { type: 'newsletter_edition' }),
    total('/content', { type: 'resource' }),
    total('/calendars'),
    total('/content'),
  ]);
  return {
    data: {
      published_events: { total: events, upcoming },
      newsletter_editions: editions,
      resource_items: resources,
      public_calendars: calendars,
      all_content_items: allContent,
      note: 'Counts cover PUBLISHED content only — this surface has no drafts.',
    },
  };
}

async function handleContentSchema(api: GatewazeApiClient) {
  try {
    return await api.get('/content/schema');
  } catch {
    // Older API deployments predate /content/schema — fall back to a slimmed
    // OpenAPI index (endpoint summaries + parameter names), which those
    // deployments do serve.
    const spec = await api.get<{
      paths?: Record<string, Record<string, { summary?: string; parameters?: Array<{ name?: string }> }>>;
    }>('/openapi.json');
    const endpoints: Array<Record<string, unknown>> = [];
    for (const [path, methods] of Object.entries(spec.paths ?? {})) {
      for (const [method, op] of Object.entries(methods ?? {})) {
        endpoints.push({
          endpoint: `${method.toUpperCase()} ${path}`,
          summary: op?.summary,
          parameters: (op?.parameters ?? []).map((p) => p?.name).filter(Boolean),
        });
      }
    }
    return {
      note: 'content/schema unavailable on this deployment — OpenAPI endpoint index returned instead',
      endpoints,
    };
  }
}

export interface SearchBackend {
  /** Portal base URL, e.g. http://portal:3100 (internal) */
  portalUrl: string;
  brandId: string;
}

async function handleSearch(
  params: Record<string, unknown>,
  search: SearchBackend,
) {
  const query = String(params.query ?? '').trim();
  if (!query) throw new Error('query is required');
  const body: Record<string, unknown> = { query, brandId: search.brandId };
  if (Array.isArray(params.content_types) && params.content_types.length > 0) {
    body.contentTypes = params.content_types.map(String);
  }
  const res = await fetch(`${search.portalUrl.replace(/\/+$/, '')}/api/ai-search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(payload.error ?? `search failed (${res.status})`);
  return payload;
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

/**
 * Tool visibility per profile.
 *
 * 'full'   — every tool, including the resources_* management surface.
 *            Requires an API key with the matching write scopes; used for
 *            keyed stdio registrations (local agents, .mcp.json).
 * 'public' — read-only subset safe to expose WITHOUT client authentication
 *            (the hosted server holds a read-scoped key internally). Every
 *            tool here reads only published/public content by construction,
 *            so keyless exposure leaks nothing that isn't already public.
 */
export type McpProfile = 'full' | 'public';

const PUBLIC_PROFILE_TOOLS = new Set([
  'events_search',
  'events_get',
  'events_speakers',
  'events_sponsors',
  'platform_health',
  'platform_stats',
  'content_schema',
  'content_list',
  'content_categories',
  'content_get',
  'calendars_list',
  'search',
  'events_nearby',
]);

/**
 * OAuth tool exposure (spec-mcp-lfid-access.md §2): which tools an
 * authenticated (token-bearing) caller may see/call, and the scope each
 * requires. `null` = available to any authenticated caller (same surface
 * the anonymous public profile serves). Tools NOT in this map are never
 * exposed over OAuth — they stay exclusive to keyed full-profile stdio
 * deployments (e.g. the signals_* operator tools).
 */
const OAUTH_TOOL_SCOPES: Record<string, string | null> = {
  events_search: null,
  events_get: null,
  events_speakers: null,
  events_sponsors: null,
  platform_health: null,
  platform_stats: null,
  content_schema: null,
  content_list: null,
  content_categories: null,
  content_get: null,
  calendars_list: null,
  search: null,
  events_nearby: null,
  my_registrations: null,
  events_metrics: 'events:metrics',
  events_metrics_summary: 'events:metrics',
  events_registrant_breakdown: 'events:metrics',
  resources_collections_list: 'resources:write',
  resources_collection_get: 'resources:write',
  resources_collection_create: 'resources:write',
  resources_collection_update: 'resources:write',
  resources_category_create: 'resources:write',
  resources_template_create: 'resources:write',
  resources_items_list: 'resources:write',
  resources_item_get: 'resources:write',
  resources_item_create: 'resources:write',
  resources_item_update: 'resources:write',
  resources_item_sections_set: 'resources:write',
  resources_section_blocks_set: 'resources:write',
  resources_block_kinds: 'resources:write',
};

/**
 * One JSONL line per tool call on stderr (stdout is the stdio protocol
 * channel; stderr reaches docker/kubectl logs in http mode). The point is an
 * improvement loop for the public endpoint: `outcome:"unknown_tool"` shows
 * which tools agents EXPECT to exist, `empty:true` shows queries the current
 * surface can't answer, and `args` shows how agents actually parameterise
 * calls. Disable with MCP_LOG_REQUESTS=0.
 */
const LOG_REQUESTS = process.env.MCP_LOG_REQUESTS !== '0';

function truncate(s: string, max = 600): string {
  return s.length > max ? `${s.slice(0, max)}…(${s.length})` : s;
}

/** Best-effort row count for list-shaped API responses ({data: [...]}) */
function resultRows(result: unknown): number | undefined {
  if (result && typeof result === 'object' && Array.isArray((result as { data?: unknown }).data)) {
    return (result as { data: unknown[] }).data.length;
  }
  return undefined;
}

function logCall(entry: Record<string, unknown>): void {
  if (!LOG_REQUESTS) return;
  console.error(JSON.stringify({ evt: 'mcp_call', ts: new Date().toISOString(), ...entry }));
}

/**
 * Server-level instructions shown to connecting agents at initialize time.
 * Without this, agents know the tools but not WHOSE data they serve — real
 * test sessions showed an agent treating the brand name as a sub-entity
 * (hunting for an "AAIF" calendar/topic) because nothing said "this whole
 * server IS that brand".
 */
export function buildInstructions(brandName?: string, brandDescription?: string): string {
  const brand = brandName?.trim();
  const lines: string[] = [];
  if (brand) {
    lines.push(
      `This MCP server serves the public content of ${brand}.`,
      `Everything these tools return belongs to ${brand}'s platform — when a user mentions "${brand}" (or "the platform" / "the community"), they mean this ENTIRE dataset, not a calendar, topic, or category within it. Platform-wide questions ("how many events does ${brand} have?") are answered by the unfiltered totals.`,
    );
    if (brandDescription?.trim()) lines.push(brandDescription.trim());
  } else {
    lines.push('This MCP server serves the public content of a Gatewaze community platform.');
  }
  lines.push(
    'Use content_list/content_get for cross-module content (newsletter editions, blog posts, resource items, events); events_* for event specifics; calendars_list only to scope queries to a named sub-calendar within the platform.',
  );
  return lines.join('\n\n');
}

export interface CallerIdentity {
  subject: string;
  email: string;
  personId: string;
  tier: string;
  authMode: string;
  clientId: string;
  scopes: Set<string>;
}

export function createGatewazeMcpServer(
  api: GatewazeApiClient,
  opts: {
    profile?: McpProfile;
    logMeta?: Record<string, unknown>;
    instructions?: string;
    /** Portal AI-search backend — the `search` tool is only registered when set. */
    search?: SearchBackend;
    /** OAuth-authenticated caller: tools become the scope-gated OAuth surface. */
    identity?: CallerIdentity;
    /** Optional audit sink — receives every logCall entry (for batch ingest). */
    audit?: (entry: Record<string, unknown>) => void;
  } = {},
): Server {
  const profile = opts.profile ?? 'full';
  const logMeta = opts.logMeta ?? {};
  const identity = opts.identity;
  const tools = TOOLS.filter((t) => {
    if (t.name === 'search' && opts.search === undefined) return false;
    if (identity) {
      const required = OAUTH_TOOL_SCOPES[t.name];
      if (required === undefined) return false; // not on the OAuth surface
      return required === null || identity.scopes.has(required);
    }
    return profile !== 'public' || PUBLIC_PROFILE_TOOLS.has(t.name);
  });
  const allowedNames = new Set(tools.map((t) => t.name));
  const emit = (entry: Record<string, unknown>) => {
    const enriched = identity
      ? {
          ...entry,
          identity_kind: 'oauth',
          subject: identity.subject,
          email: identity.email,
          person_id: identity.personId,
          tier: identity.tier,
        }
      : { ...entry, identity_kind: profile === 'public' ? 'anonymous' : 'api_key' };
    logCall(enriched);
    opts.audit?.(enriched);
  };

  const server = new Server(
    { name: profile === 'public' ? 'gatewaze-mcp-public' : 'gatewaze-mcp', version: '0.3.0' },
    {
      capabilities: { tools: {} },
      ...(opts.instructions ? { instructions: opts.instructions } : {}),
    },
  );

  // List tools. The 2026-07-28 revision requires cache metadata on list
  // results; our tool table is static per profile, so a generous public TTL.
  server.setRequestHandler('tools/list', async () => ({
    tools,
    ttlMs: 300_000,
    cacheScope: 'public' as const,
  }));

  // Call tool
  server.setRequestHandler('tools/call', async (request) => {
    const { name, arguments: args } = request.params;
    const params = (args ?? {}) as Record<string, unknown>;
    const startedAt = Date.now();
    const base = {
      profile,
      tool: name,
      args: truncate(JSON.stringify(params)),
      ...logMeta,
    };

    // Profile gate — a public server must refuse full-profile tool names
    // even though they aren't advertised, not just hide them. Logged
    // distinctly: agents guessing tool names is the strongest signal for
    // what the surface is missing. An OAuth caller whose token lacks the
    // tool's scope gets a distinguishable insufficient_scope refusal naming
    // the scope to request (2026-07-28 challenge semantics, in-band form).
    if (!allowedNames.has(name)) {
      const required = identity ? OAUTH_TOOL_SCOPES[name] : undefined;
      if (identity && required) {
        emit({ ...base, outcome: 'insufficient_scope', ms: Date.now() - startedAt });
        return {
          content: [
            { type: 'text', text: JSON.stringify({ error: `insufficient_scope: '${name}' requires the '${required}' scope — your access does not include it. An administrator can grant it under MCP Access.` }) },
          ],
          isError: true,
        };
      }
      emit({ ...base, outcome: 'unknown_tool', ms: Date.now() - startedAt });
      return {
        content: [
          { type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) },
        ],
        isError: true,
      };
    }

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
        case 'events_metrics':
          result = await handleEventsMetrics(params, api);
          break;
        case 'events_metrics_summary':
          result = await handleEventsMetricsSummary(params, api);
          break;
        case 'events_registrant_breakdown':
          result = await handleEventsRegistrantBreakdown(params, api);
          break;
        case 'events_nearby':
          result = await handleEventsNearby(params, api, (logMeta as { ip?: string } | undefined)?.ip);
          break;
        case 'my_registrations':
          if (!identity) {
            result = { error: 'my_registrations requires a signed-in session.' };
          } else {
            result = await api.get('/events/my-registrations', { person_id: identity.personId });
          }
          break;
        case 'content_list':
          result = await handleContentList(params, api);
          break;
        case 'content_categories':
          result = await api.get('/categories');
          break;
        case 'content_get':
          result = await handleContentGet(params, api);
          break;
        case 'calendars_list':
          result = await handleCalendarsList(params, api);
          break;
        case 'platform_stats':
          result = await handlePlatformStats(api);
          break;
        case 'content_schema':
          result = await handleContentSchema(api);
          break;
        case 'search':
          result = await handleSearch(params, opts.search!);
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
        case 'resources_section_blocks_set':
          result = await api.put(
            `/resources/items/${params.item_id}/sections/${params.section_id}/blocks`,
            bodyWithout(params, 'item_id', 'section_id'),
          );
          break;
        case 'resources_block_kinds':
          result = await api.get('/resources/block-kinds');
          break;
        case 'signals_rules_list':
          result = await api.get('/signals/rules');
          break;
        case 'signals_rule_create':
          result = await api.post('/signals/rules', bodyWithout(params));
          break;
        case 'signals_rule_update':
          result = await api.patch(`/signals/rules/${params.id}`, bodyWithout(params, 'id'));
          break;
        case 'signals_rule_evaluate':
          result = await api.post(
            `/signals/rules/${params.id}/evaluate${params.dry_run ? '?dry_run=1' : ''}`,
            {},
          );
          break;
        case 'signals_fires_list': {
          const qs = new URLSearchParams();
          if (params.rule_id) qs.set('rule_id', String(params.rule_id));
          if (params.status) qs.set('status', String(params.status));
          result = await api.get(`/signals/fires${qs.size ? `?${qs}` : ''}`);
          break;
        }
        case 'signals_stats':
          result = await api.get('/signals/stats');
          break;
        default:
          emit({ ...base, outcome: 'unknown_tool', ms: Date.now() - startedAt });
          return {
            content: [
              { type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) },
            ],
            isError: true,
          };
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      emit({ ...base, outcome: 'error', error: truncate(message, 300), ms: Date.now() - startedAt });
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }

    const text = JSON.stringify(result, null, 2);
    const rows = resultRows(result);
    emit({
      ...base,
      outcome: 'ok',
      ms: Date.now() - startedAt,
      bytes: text.length,
      ...(rows !== undefined ? { rows, empty: rows === 0 } : {}),
    });

    return {
      content: [{ type: 'text', text }],
    };
  });

  return server;
}
