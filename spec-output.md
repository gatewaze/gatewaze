# Technical Specification: Agent-First Portal Architecture

## Overview / Context

Gatewaze is an open-source event and community management platform. The portal (public-facing app) is built with Next.js 15, React 19, TypeScript, and Supabase. It currently supports event browsing, AI-powered semantic search (OpenAI embeddings), registration (Stripe), attendee networking (Claude-powered matching), user profiles, blog, and embeddable calendars.

The portal already integrates OpenAI (`text-embedding-3-small` for embeddings, GPT for NL queries) and has `@anthropic-ai/sdk` as a dependency (currently unused in portal code). Metadata is limited to Open Graph and Twitter Cards — no structured data (JSON-LD/Schema.org) exists.

This spec defines the architecture for making the portal **agent-first**: optimized for both human users and AI agents to discover, understand, and interact with the platform programmatically.

### Architectural Rationale

- **Vercel AI SDK** over raw Anthropic SDK: provides streaming UI primitives, multi-provider abstraction, and tool calling that maps directly to Next.js server components and API routes. Eliminates boilerplate for SSE streaming and tool result rendering.
- **MCP over custom agent API**: MCP is an open standard with growing adoption across Claude, Cursor, and other agent tooling. Building an MCP server provides compatibility with the broadest agent ecosystem without maintaining custom SDKs.
- **JSON-LD over Microdata/RDFa**: JSON-LD is Google's recommended format, doesn't require modifying HTML structure, and is the most widely consumed structured data format by LLM agents browsing via web tools.
- **OpenAPI 3.1 over 3.0**: Native JSON Schema support, better alignment with TypeScript type generation, and broader agent framework compatibility.

## Goals

1. **Agent Discoverability**: AI agents can discover Gatewaze capabilities via `llms.txt`, OpenAPI spec, and MCP server without prior knowledge of the platform.
2. **Structured Data**: All portal pages emit Schema.org JSON-LD markup, enabling search engines and LLM agents to parse event, organization, and person data.
3. **Conversational Interface**: An embedded AI assistant in the portal allows users (human or agent) to search events, register, and get recommendations via natural language.
4. **Programmatic API Access**: A published OpenAPI 3.1 spec at `/.well-known/openapi.json` enables agent frameworks (LangChain, CrewAI, AutoGPT) to auto-generate tool definitions.
5. **MCP Integration**: An MCP server wraps the existing REST API so Claude and other MCP-compatible agents can natively interact with Gatewaze.
6. **HATEOAS-lite API Responses**: API responses include `_links` for agent discoverability of related actions.

## Non-Goals

- Replacing the existing human UI — agent features augment, not replace.
- Building a standalone chatbot product — the assistant is scoped to portal interactions.
- Supporting real-time bidirectional agent communication via WebSocket. Server-to-client streaming (SSE) is used for the chat UI and MCP transport.
- Migrating away from Supabase or the existing Express API.
- Implementing agent authentication beyond standard JWT Bearer tokens via Supabase Auth.

## System Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Portal (Next.js 15)              │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ JSON-LD     │  │ AI Chat      │  │ llms.txt   │ │
│  │ Components  │  │ (Vercel AI)  │  │ Route      │ │
│  └─────────────┘  └──────┬───────┘  └────────────┘ │
│                          │                          │
│  ┌───────────────────────▼──────────────────────┐   │
│  │         /api/chat (streaming endpoint)       │   │
│  │         /api/ai-search (existing)            │   │
│  │    /.well-known/openapi.json                 │   │
│  │         /api/mcp (Streamable HTTP)           │   │
│  └──────────────────────┬───────────────────────┘   │
└─────────────────────────┼───────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
   ┌────────────┐  ┌────────────┐  ┌────────────┐
   │ Express API│  │ Supabase   │  │ Anthropic  │
   │ (existing) │  │ (DB/Auth)  │  │ Claude API │
   │ + HATEOAS  │  │ + RLS      │  │            │
   └────────────┘  └────────────┘  └────────────┘
```

**Key flows**:
- Human users interact via the chat widget (browser) or standard portal pages
- AI agents interact via MCP (`/api/mcp`), OpenAPI-documented REST endpoints, or the chat API
- All write operations (registration) flow through Supabase with RLS enforcement using the caller's JWT

## Component Design

### 1. JSON-LD Structured Data Components

**Location**: `packages/portal/components/structured-data/`

Three React server components that render `<script type="application/ld+json">` tags:

#### `EventJsonLd`
- Renders on event detail pages (`/events/[identifier]`)
- Schema: `https://schema.org/Event`
- Fields mapped from existing event data:
  - `name` ← `event.title`
  - `startDate` / `endDate` ← `event.start_date` / `event.end_date` (ISO 8601)
  - `location` ← `event.venue` (as `Place` with `name` and `address` from `event.venue_address`). If the event has no physical venue (online), use `VirtualLocation` with `event.event_link` as `url`.
  - `description` ← `event.description` (HTML stripped to plain text via `htmlToText()` from `html-to-text` library, truncated to 5000 chars on a word boundary)
  - `image` ← `event.screenshot_url || event.event_logo`
  - `organizer` ← `event.organizer_name` as `Organization` with `event.organizer_url`. Falls back to `brandConfig.organization_name` if event-level organizer is not set.
  - `offers` ← registration pricing (as `Offer` with `price`, `priceCurrency`, `availability` mapped from registration status: `InStock` if open, `SoldOut` if full, `PreOrder` if upcoming)
  - `eventStatus` ← mapped from event status field:
    - `scheduled` / `published` → `EventScheduled`
    - `cancelled` → `EventCancelled`
    - `postponed` → `EventPostponed`
    - `draft` → omit field (draft events should not have JSON-LD at all)
  - `eventAttendanceMode` ← `OnlineEventAttendanceMode` | `OfflineEventAttendanceMode` | `MixedEventAttendanceMode`
- **Graceful handling**: If `name` or `startDate` is missing (required by Schema.org), omit the entire JSON-LD block.

#### `OrganizationJsonLd`
- Renders on the root layout
- Schema: `https://schema.org/Organization`
- Fields from brand config: `name`, `url`, `logo`, `description`, `sameAs` (social links array)

#### `PersonJsonLd`
- Renders on speaker pages (`/events/[identifier]/speakers/[id]`)
- Schema: `https://schema.org/Person`
- Fields: `name`, `jobTitle`, `worksFor` (as `Organization`), `image`, `url`
- **Graceful handling**: If `name` is missing, omit the block.

**Integration**: Import into respective page components. No client-side JS — pure SSR `<script>` tags.

### 2. Vercel AI SDK Chat Interface

**Dependencies**: `ai` (Vercel AI SDK), `@ai-sdk/anthropic`, `@ai-sdk/openai`

**Graceful degradation**: If `ANTHROPIC_API_KEY` is not set, the chat endpoint returns `503 Service Unavailable` and the chat widget is not rendered (checked via `NEXT_PUBLIC_ENABLE_CHAT` env var).

**`brandConfig` loading**: Brand configuration is loaded once at module scope via `unstable_cache` (Next.js) with a 5-minute TTL and `brandConfig` cache tag. This avoids a database round-trip on every chat request while keeping configuration reasonably fresh. The same cached loader is shared with JSON-LD components and `llms.txt`.

#### API Route: `/api/chat`

**Location**: `packages/portal/app/(main)/api/chat/route.ts`

```typescript
import { streamText, tool } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

export async function POST(req: Request) {
  // Extract user JWT from Authorization header or cookie
  // Extract JWT from Authorization header or Supabase session cookie
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : parseCookies(req.headers.get('cookie') ?? '').get('sb-access-token') ?? null;
  // parseCookies: parses "key=val; key2=val2" into Map<string, string>

  // Create Supabase client scoped to the user's session (RLS-enforced)
  // Uses anon key + user JWT, NOT service role key
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const { messages } = await req.json();

  const result = streamText({
    model: anthropic('claude-sonnet-4-20250514'),
    system: `You are the Gatewaze assistant for ${brandConfig.organization_name}.
             Help users discover events, register, find networking opportunities,
             and navigate the platform. Be concise and helpful.
             Today's date: ${new Date().toISOString().split('T')[0]}`,
    messages,
    tools: {
      searchEvents: tool({
        description: 'Search for events by topic, date, or location',
        parameters: z.object({
          query: z.string().describe('Search query text'),
          startDate: z.string().optional().describe('ISO 8601 date filter start'),
          endDate: z.string().optional().describe('ISO 8601 date filter end'),
          location: z.string().optional().describe('City or venue name'),
        }),
        execute: async ({ query, startDate, endDate, location }) => {
          // Reuses existing ai-search embedding logic
          // Returns: Array<{ id, title, date, location, description, url }>
        },
      }),
      getEventDetails: tool({
        description: 'Get full details for a specific event by ID or slug',
        parameters: z.object({
          identifier: z.string().describe('Event ID (UUID) or URL slug'),
        }),
        execute: async ({ identifier }) => {
          // Returns: { id, title, description, startDate, endDate, venue,
          //   registrationStatus, speakerCount, ticketPrice, url }
        },
      }),
      registerForEvent: tool({
        description: 'Register the authenticated user for an event. Requires login.',
        parameters: z.object({
          eventId: z.string().uuid().describe('Event UUID'),
        }),
        execute: async ({ eventId }) => {
          if (!token) {
            return { error: 'Authentication required. Please log in to register.' };
          }
          // Uses the user-scoped Supabase client (RLS enforced)
          // Pulls name/email from the authenticated user's profile
          // Returns: { success: boolean, confirmationId?: string, error?: string }
        },
      }),
      findNetworkingMatches: tool({
        description: 'Find recommended networking connections at an event',
        parameters: z.object({
          eventId: z.string().uuid().describe('Event UUID'),
        }),
        execute: async ({ eventId }) => {
          // Returns: Array<{ name, title, company, matchScore, reason }>
        },
      }),
    },
    maxSteps: 5,
  });

  return result.toDataStreamResponse();
}
```

**Key design decisions**:
- Tools use the **user-scoped Supabase client** (anon key + user JWT), not the service role key. This ensures RLS policies are enforced automatically.
- `registerForEvent` pulls user data from the authenticated profile rather than accepting name/email as parameters. This prevents registration impersonation.
- Tool return types are documented inline so the LLM can format them for the user.

#### Chat UI Component

**Location**: `packages/portal/components/chat/`

- `ChatWidget.tsx` — Floating chat button (bottom-right), expandable panel. Only rendered when `NEXT_PUBLIC_ENABLE_CHAT=true`.
- `ChatMessages.tsx` — Message list with markdown rendering
- `ChatInput.tsx` — Text input with send button
- Uses `useChat()` hook from `ai/react`
- Renders tool results inline (event cards, registration confirmations)
- Respects brand theming (colors, fonts from brand config)
- Lazy-loaded via `next/dynamic` — zero impact on initial page load
- Persists conversation in `sessionStorage` (ephemeral, per-tab)
- Available on all portal pages (rendered in root layout, gated by feature flag)

### 3. OpenAPI 3.1 Specification

**Location**: `packages/portal/app/(main)/.well-known/openapi.json/route.ts`

A Next.js route handler that serves a generated OpenAPI 3.1 spec. The spec is defined as a TypeScript object and serialized to JSON.

**Endpoints documented**:

| Method | Path | Description | Auth | Request Body | Response (200) | Errors |
|--------|------|-------------|------|-------------|----------------|--------|
| GET | /api/health | Health check | None | — | `{ status: "ok" }` | 500 |
| POST | /api/ai-search | Semantic event search | None | `SearchRequest` | `SearchResult[]` | 400, 500 |
| POST | /api/chat | AI chat (streaming) | Optional Bearer | `ChatRequest` | SSE stream | 401, 429, 500, 503 |
| GET | /api/events | List upcoming events | None | — | `EventSummary[]` | 500 |
| GET | /api/events/{identifier} | Event details | None | — | `EventDetail` | 404, 500 |
| GET | /api/calendars/{slug} | Calendar events | None | — | `CalendarEvent[]` | 404, 500 |
| POST | /api/registrations | Register for an event | Bearer | `RegistrationRequest` | `Registration` | 401, 404, 409, 500 |
| POST | /api/mcp | MCP Streamable HTTP | Optional Bearer | MCP JSON-RPC | MCP JSON-RPC | 401, 500 |

**Schema definitions**:

```typescript
// SearchRequest
{ query: string; location?: string; startDate?: string; endDate?: string }

// SearchResult
{ id: string; type: "event" | "blog"; title: string; description: string;
  date?: string; location?: string; score: number; url: string }

// ChatRequest
{ messages: Array<{ role: "user" | "assistant"; content: string }> }

// EventSummary
{ id: string; title: string; slug: string; startDate: string;
  endDate?: string; location?: string; imageUrl?: string }

// EventDetail extends EventSummary
{ description: string; venue?: Place; organizer: Organization;
  registrationStatus: "open" | "closed" | "full" | "upcoming";
  ticketPrice?: { amount: number; currency: string };
  speakerCount: number; attendeeCount: number;
  _links: HATEOASLinks }

// Calendar
{ slug: string; name: string; description?: string; eventCount: number; url: string }

// CalendarEvent
{ id: string; title: string; startDate: string; endDate?: string; url: string }

// Place
{ name: string; address?: string; latitude?: number; longitude?: number }

// Organization
{ name: string; url?: string }

// HATEOASLinks
{ self: Link; register?: Link; speakers?: Link; calendar?: Link }

// Link
{ href: string; method?: string }

// RegistrationRequest
{ eventId: string }
// (User identity is derived from JWT, not passed in body)

// Registration
{ id: string; eventId: string; userId: string; status: "confirmed" | "pending";
  createdAt: string }

// ErrorResponse
{ error: string; code?: string }
```

**Note**: The OpenAPI spec documents the **Express API endpoints** (prefixed with `/api/`), which are the programmatic interface for agents. The Next.js portal pages (`/events/[slug]`, `/calendars/[slug]`) are SSR-rendered HTML pages for human users and are not part of the OpenAPI spec. JSON-LD on those pages serves as the structured data layer for agents browsing via web tools.

**Served with**: `Content-Type: application/json`, `Access-Control-Allow-Origin: *`, `Cache-Control: public, max-age=3600`.

**Security schemes**: Bearer token (JWT) defined as optional `securitySchemes` entry.

### 4. `llms.txt` Route

**Location**: `packages/portal/app/(main)/llms.txt/route.ts`

Returns a plain text file following the `llms.txt` standard:

```
# {organization_name} - Powered by Gatewaze

> Event and community management platform

## About
{organization_name} uses Gatewaze, an open-source platform for managing events,
communities, and member engagement.

## Capabilities
- Browse and search upcoming events (semantic search supported)
- Register for events (requires authentication)
- View event calendars and schedules
- AI-powered event discovery and networking recommendations

## API
- OpenAPI spec: /.well-known/openapi.json
- Semantic search: POST /api/ai-search (no auth required)
- AI chat: POST /api/chat (streaming, optional auth)
- MCP server: POST /api/mcp (Streamable HTTP, optional auth)

## Authentication
- Public endpoints: event listing, search, calendars, event details
- Authenticated endpoints: registration, profile management, networking matches
- Auth method: Supabase Auth — obtain JWT via POST /auth/callback
- Pass JWT as: Authorization: Bearer <token>

## Data Formats
- All API responses are JSON
- Structured data: Schema.org JSON-LD on event and profile pages
- Event dates: ISO 8601
```

Dynamic — pulls organization name and enabled features from brand config.

### 5. MCP Server

**Location**: `packages/portal/app/(main)/api/mcp/route.ts`

Uses `@modelcontextprotocol/sdk` with **Streamable HTTP transport** (the current recommended MCP transport, replacing deprecated SSE transport) over the Next.js API route.

**Resources exposed**:

| URI | Description | Returns |
|-----|-------------|---------|
| `events://upcoming` | List of upcoming events | `EventSummary[]` |
| `events://{id}` | Single event details | `EventDetail` |
| `calendars://list` | Available calendars | `Calendar[]` |
| `calendars://{slug}` | Calendar events | `CalendarEvent[]` |

**Tools exposed**:

| Tool | Parameters | Returns | Auth Required |
|------|-----------|---------|---------------|
| `search_events` | `query: string, location?: string, startDate?: string, endDate?: string` | `SearchResult[]` | No |
| `get_event` | `identifier: string` | `EventDetail` | No |
| `register` | `eventId: string` | `{ success, confirmationId?, error? }` | Yes |
| `list_calendars` | — | `Calendar[]` | No |

**Prompts exposed**:
- `discover_events` — "What events are coming up that match my interests?"
- `plan_attendance` — "Help me plan which events to attend this month"

**Authentication**: Agents pass JWT Bearer token in the initial HTTP request. The MCP server creates a user-scoped Supabase client (same pattern as `/api/chat`). Unauthenticated agents can use read-only tools and resources.

### 6. HATEOAS-lite API Responses

Modify Express API responses to include `_links` objects.

**Implementation**: Express middleware (`hateoasMiddleware`) that intercepts `res.json()` calls, inspects the response body for known resource types, and injects `_links`.

**Resource type identification**:
- **Event**: response has `id` + `title` + `start_date` fields
- **Registration**: response has `id` + `event_id` + `registrant_id` fields
- **Calendar**: response has `slug` + `name` + `events` (array) fields
- **Person**: response has `id` + `first_name` + `last_name` fields

**Conditional link logic**:
- `register` link: only included when `registrationStatus === "open"`
- `speakers` link: only included when the event has speakers (speaker count > 0)
- `calendar` link: only included when the event belongs to a calendar

**Affected routes**: `/api/events`, `/api/events/:id`, `/api/registrations`, `/api/calendars`

**Event response example**:
```json
{
  "id": "evt_123",
  "title": "Tech Meetup",
  "start_date": "2026-04-15T18:00:00Z",
  "registration_status": "open",
  "_links": {
    "self": { "href": "/api/events/evt_123" },
    "register": { "href": "/api/registrations", "method": "POST" },
    "speakers": { "href": "/api/events/evt_123/speakers" },
    "calendar": { "href": "/api/calendars/tech-meetup" }
  }
}
```

### 7. Semantic HTML Improvements

Audit and update portal components to use:
- `<article>` for event cards and blog posts
- `<nav>` for navigation (already likely in place)
- `<main>` for primary content area
- `<time datetime="...">` for all date displays
- `<address>` for venue information
- `aria-label` on interactive elements lacking visible text
- `role="search"` on search forms

No new components — modifications to existing ones.

## API Design

### POST `/api/chat`

**Request**:
```json
{
  "messages": [
    { "role": "user", "content": "Find me AI events in London next month" }
  ]
}
```

**Headers**:
- `Content-Type: application/json` (required)
- `Authorization: Bearer <jwt>` (optional — enables registration and personalized results)

**Response**: `Content-Type: text/event-stream`. Uses the Vercel AI SDK Data Stream Protocol. Each SSE message is prefixed with a type code:

| Code | Type | Data Format | Description |
|------|------|-------------|-------------|
| `0:` | Text | `"string"` | Incremental text content from the LLM |
| `9:` | Tool Call | `{ toolCallId, toolName, args }` | LLM invokes a tool (e.g., `searchEvents`) |
| `a:` | Tool Result | `{ toolCallId, result }` | Tool execution result returned to LLM |
| `e:` | Error | `{ error: string }` | Tool execution error (user-friendly message) |
| `d:` | Finish | `{ finishReason, usage: { promptTokens, completionTokens } }` | Stream complete |

Tool execution errors surface as `e:` events in the stream with user-friendly messages (e.g., `"Authentication required to register"`), never stack traces. The `useChat()` hook on the client handles all parsing automatically.

For agents consuming this API directly (not via `useChat()`), see the [Vercel AI SDK Data Stream Protocol documentation](https://sdk.vercel.ai/docs/ai-sdk-ui/stream-protocol#data-stream-protocol).

**Error responses**:
- `401 Unauthorized` — invalid JWT token
- `429 Too Many Requests` — rate limit exceeded, includes `Retry-After` header
- `500 Internal Server Error` — `{ error: "Internal server error" }` (no stack traces)
- `503 Service Unavailable` — chat feature disabled (no `ANTHROPIC_API_KEY`)

**Rate limiting**: 20 requests/minute per IP (unauthenticated), 60/minute per user ID (authenticated). Returns `429` with `Retry-After` header. Implemented via Next.js middleware using an in-memory sliding window counter for single-instance deployments. For horizontally scaled deployments, swap to a Redis-backed counter (e.g., `@upstash/ratelimit`) — the middleware interface remains the same.

### GET `/.well-known/openapi.json`

**Response**: OpenAPI 3.1 JSON document

**Cache**: `Cache-Control: public, max-age=3600`

**CORS**: `Access-Control-Allow-Origin: *`

### GET `/llms.txt`

**Response**: `text/plain; charset=utf-8`

**Cache**: `Cache-Control: public, max-age=3600`

**CORS**: `Access-Control-Allow-Origin: *`

### POST `/api/mcp`

**Transport**: Streamable HTTP (MCP specification 2025-03-26)

**Request**: MCP JSON-RPC messages

**Response**: MCP JSON-RPC responses (may include SSE streaming for long-running operations)

**Authentication**: Optional `Authorization: Bearer <jwt>` header

**CORS**: Restricted to configured domains via `ALLOWED_MCP_ORIGINS` env var.

## Data Models

No new database tables required. All features build on existing Supabase schema:
- `events` — event data for JSON-LD, search, chat tools
- `registrations` — registration for chat tools
- `people` — profiles for JSON-LD, matching
- `brand_config` — organization data for JSON-LD, llms.txt

Chat conversations are ephemeral (stored in browser `sessionStorage`). No `chat_sessions` database table is needed for the initial implementation. If persistent chat history is needed in the future, it can be added as a follow-up.

## Infrastructure Requirements

**New dependencies** (portal `package.json`):
- `ai` (Vercel AI SDK) — ~50KB
- `@ai-sdk/anthropic` — Anthropic provider
- `@ai-sdk/openai` — OpenAI provider (for embeddings in chat tools)
- `@modelcontextprotocol/sdk` — MCP server
- `zod` — already in use for validation

**Environment variables** (new):
- `ANTHROPIC_API_KEY` — for chat endpoint (Claude). If unset, chat endpoint returns 503 and widget is hidden.
- `NEXT_PUBLIC_ENABLE_CHAT` — feature flag for chat widget rendering (`true`/`false`)
- `ALLOWED_MCP_ORIGINS` — comma-separated list of allowed origins for MCP CORS (defaults to same-origin)
- `ALLOWED_CHAT_ORIGINS` — comma-separated list of allowed origins for chat CORS (defaults to same-origin)

**No new infrastructure** — runs within existing Next.js deployment.

## Security Considerations

1. **Chat endpoint abuse**: Rate limiting via in-memory sliding window (20/min unauthenticated, 60/min authenticated). All tool parameters validated via Zod schemas before execution.
2. **Tool execution context**: Tools use a Supabase client initialized with the **anon key + user's JWT** (not service role key). RLS policies are enforced automatically. If no JWT is present, the client operates as anonymous — write operations will be denied by RLS.
3. **Registration impersonation prevention**: The `registerForEvent` tool does not accept name/email as parameters. It pulls user identity from the authenticated JWT, preventing one user from registering as another.
4. **MCP server**: Read-only resources and tools are available without authentication. Write tools (`register`) require a valid JWT Bearer token. The MCP server validates the JWT with Supabase before executing write operations.
5. **Prompt injection**: System prompt is server-side only, not exposed to the client. User messages are passed to the LLM but never interpolated into database queries, API calls, or system instructions. Tool parameters are type-validated via Zod before use.
6. **Data exposure**: JSON-LD only includes publicly visible event data. Draft events, internal notes, and private profile fields are excluded at the query level (Supabase views/RLS).
7. **CORS**:
   - `*` origin: `/.well-known/openapi.json`, `/llms.txt` (public, read-only, no sensitive data)
   - `ALLOWED_CHAT_ORIGINS`: `/api/chat` (configurable per deployment, defaults to same-origin)
   - `ALLOWED_MCP_ORIGINS`: `/api/mcp` (configurable per deployment)

## Error Handling Strategy

| Component | Error Type | Handling |
|-----------|-----------|----------|
| Chat | Tool execution failure | Return user-friendly message in stream (e.g., "I couldn't find that event"). Log error server-side. |
| Chat | Anthropic API down | Return 503 with `{ error: "AI service temporarily unavailable" }` |
| Chat | Rate limit exceeded | Return 429 with `Retry-After` header |
| Chat | Invalid JWT | Return 401; tools requiring auth return inline error message |
| MCP | Invalid JSON-RPC | Standard MCP error response with code `-32600` |
| MCP | Tool execution failure | MCP error response with descriptive message |
| MCP | Auth required for write | MCP error response with code `-32001` (custom: auth required) |
| JSON-LD | Incomplete data | Omit JSON-LD block entirely (no invalid markup) |
| OpenAPI | Server error | Route handler catches errors and returns last successfully generated response from module-level cache. CDN/browser caches via `Cache-Control: public, max-age=3600`. |
| llms.txt | Server error | Same caching strategy as OpenAPI |
| HATEOAS | Middleware error | Pass through original response without `_links` (fail open, log error) |

## Performance Requirements

- **JSON-LD**: Zero client-side cost (SSR `<script>` tags). No measurable impact on page load.
- **Chat**: Time to first token < 1s (p95). Full response < 10s for single-tool queries, < 30s for multi-tool chains (p95). Measured via server-side logging.
- **OpenAPI/llms.txt**: < 50ms response time (served from ISR cache after first request).
- **MCP**: Connection establishment < 500ms. Tool execution < 5s for read operations, < 10s for write operations (p95). Bounded by Supabase query performance.
- **HATEOAS middleware**: < 2ms overhead per response (measured via middleware timing).
- **Rate limiter**: < 1ms per check (in-memory, no external calls).

## Observability

- **Chat**:
  - Log: tool name, parameters (redacted PII), execution duration, success/failure per invocation
  - Log: total token usage (prompt + completion) per request
  - Metric: requests per minute, error rate, average response time
  - Alert: error rate > 10% over 5-minute window, or Anthropic API latency > 5s
- **MCP**:
  - Log: tool/resource access with client identifier (IP or agent name from User-Agent)
  - Metric: requests per minute by tool/resource
- **Rate limiting**:
  - Log: rate limit hits with IP/user ID
  - Metric: rate limit trigger frequency
- Existing Supabase analytics cover database query performance and auth events.

## Testing Strategy

1. **JSON-LD**: Unit tests validating output against Schema.org Event/Organization/Person specs. Test graceful omission when required fields are missing. Validate with Google Rich Results Test (manual, pre-release).
2. **Chat**: Integration tests for each tool with mocked Supabase client. Test: successful execution, auth-required rejection, invalid parameters, Supabase query errors. Test rate limiting behavior.
3. **MCP**: Protocol compliance tests using MCP SDK test client. Test: resource listing, tool execution, auth enforcement, error responses.
4. **OpenAPI**: Validate spec with `@apidevtools/swagger-parser`. Contract tests: verify actual API responses match declared schemas.
5. **llms.txt**: Snapshot test for content format. Verify dynamic brand config substitution.
6. **HATEOAS**: Unit tests for middleware: verify `_links` injection per resource type, conditional link inclusion (registration open/closed), and pass-through on unknown response shapes.
7. **E2E**: Playwright tests simulating: user opens chat → searches events → views details → registers. Verify the full flow works with real (or mock) AI responses.

## Deployment Strategy

All changes deploy within the existing Next.js portal deployment pipeline:

1. **Phase 1 deploy**: Add dependencies, implement JSON-LD components, `llms.txt` route, OpenAPI route, semantic HTML changes. No feature flag needed — all read-only, zero risk.
2. **Phase 2 deploy**: Chat endpoint + UI widget behind `NEXT_PUBLIC_ENABLE_CHAT=false`. Set `ANTHROPIC_API_KEY` in environment. Test internally, then flip flag to `true`.
3. **Phase 3 deploy**: MCP server endpoint. Set `ALLOWED_MCP_ORIGINS`. HATEOAS middleware on Express API.

**Rollback**: Each phase is independently reversible:
- Phase 1: Remove components from page files (JSON-LD has no side effects)
- Phase 2: Set `NEXT_PUBLIC_ENABLE_CHAT=false` (instant, no redeploy needed for widget; endpoint still exists but returns 503)
- Phase 3: Remove MCP route handler; disable HATEOAS middleware

No database migration required.

## Migration Plan

1. **Phase 1 — Passive Agent Support** (no user-facing changes):
   - JSON-LD structured data on all event pages
   - `llms.txt` route
   - OpenAPI spec at `/.well-known/openapi.json`
   - Semantic HTML audit and updates

2. **Phase 2 — Active Agent Interfaces**:
   - Vercel AI SDK chat endpoint + UI widget
   - HATEOAS `_links` in Express API responses
   - Rate limiting middleware

3. **Phase 3 — Native Agent Protocol**:
   - MCP server deployment (Streamable HTTP transport)
   - Agent-specific documentation and examples
   - Update `llms.txt` with MCP connection instructions

## Decisions (Resolved)

1. **Chat availability**: Available on all portal pages via root layout, lazy-loaded. Controlled by `NEXT_PUBLIC_ENABLE_CHAT` feature flag.
2. **MCP transport**: Streamable HTTP only (current MCP recommended transport). No stdio — the MCP server runs as a web endpoint, not a local process.
3. **Chat persistence**: Ephemeral (`sessionStorage`). No database table. Can be revisited based on user feedback.
4. **Cost management**: Token usage logging per request enables cost monitoring. Cost budget is an operational concern — set spend alerts in the Anthropic dashboard, not enforced in code.
