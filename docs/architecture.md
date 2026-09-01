# Architecture

This document describes the architecture of Gatewaze, the modular open-source platform for communities, built as a pnpm monorepo with a Supabase backend.

---

## System Overview

Gatewaze is a pnpm monorepo. Four packages make up the platform itself, and the
rest are small services that can be deployed, scaled, and rolled back on their
own.

| Package | Role |
|---|---|
| `packages/shared` | Types, constants, the module loader, and the module lifecycle code. Every other package depends on it. |
| `packages/admin` | The administrator interface. A React single-page application built with Vite. |
| `packages/portal` | The public website. A Next.js application rendered on the server. |
| `packages/api` | The Express API server, the BullMQ worker, and the scheduler. All three are built from this package. |
| `packages/tracking` | Engagement tracking used by the portal and the admin. |
| `packages/mcp` | The Model Context Protocol server. Runs in a public, keyless read-only profile, or with an API key. |
| `packages/api-mcp` | An MCP server that proxies a whitelisted set of platform API calls. |
| `packages/events-mcp` | An MCP server for the `events_*` tools, including writing changes back to Luma. |
| `packages/browser-mcp` | An MCP server that gives agents a headless browser, either local Chromium or Browserbase. |
| `packages/arcade-serve` | Serves creator-built games from versioned storage snapshots. |
| `packages/connect` | A command-line tool that connects a user's AI clients to a Gatewaze MCP server. |

The last four are deliberately outside the workspace dependency graph. They
have their own Dockerfiles and almost no dependencies, so a change to the
platform does not force them to be rebuilt.

The database, authentication, storage, and edge functions come from
[Supabase](https://supabase.com), either self-hosted or managed. Background
work runs on [Redis](https://redis.io) with [BullMQ](https://bullmq.io).

---

## The full stack

Everything below the proxy is a container. Services drawn with a dashed edge
are optional and off unless you turn them on.

```
                            Browsers, and AI agents
                                      |
                    +-----------------+------------------+
                    |     Traefik (local) or your        |
                    |     ingress controller (k8s)       |
                    +--+-------+--------+-------+--------+
                       |       |        |       |
        +--------------+       |        |       +----------------+
        |                      |        |                        |
 +------v------+      +--------v-----+  |               +--------v-------+
 |   admin     |      |   portal     |  |               |  mcp-public    |
 | React/Vite  |      |  Next.js     |  |               |  read-only     |
 |  via NGINX  |      |    SSR       |  |               |  MCP, keyless  |
 +------+------+      +------+-------+  |               +--------+-------+
        |                    |          |                        |
        |                    |   +------v------+                 |
        +--------------------+---+     api     +<----------------+
        |                    |   |   Express   |
        |                    |   +--+-------+--+
        |                    |      |       |
        |                    |      |       +-------------------+
        |                    |      |                           |
 +------v--------------------v------v-----+          +----------v---------+
 |              Supabase                  |          |       redis        |
 |  Postgres  .  Auth (GoTrue)            |          |   BullMQ queues    |
 |  PostgREST .  Storage  .  Realtime     |          +--+--------------+--+
 |  Edge Functions (Deno) .  Kong .  Studio|            |              |
 +----------------------------------------+     +------v-----+  +-----v------+
        ^          ^            ^                | scheduler  |  |   worker   |
        |          |            |                |   cron     |  |  + Chromium|
        |          |            |                +------------+  +--+------+--+
        |          |            |                                   |      |
        |          |            +-----------------------------------+      |
        |          |                                                       |
        |    +-----+---------------+     +---------------------+           |
        |    |    se-runner        |     | scrapling-fetcher   |<----------+
        |    | software-engineer   |     |  browser pool +     |
        |    | module queue only   |     |  residential proxy  |
        |    +---------------------+     +----------+----------+
        |     - - - optional - - -        - - - optional - - -            |
        |                                                                 |
        |    +---------------------+     +---------------------+          |
        +----+     events-mcp      |     |    browser-mcp      |<---------+
             |  internal MCP over  |     |  internal MCP over  |
             |  streamable HTTP    |     |  streamable HTTP    |
             +---------------------+     +---------------------+
              - - - optional - - -        - - - optional - - -

             +---------------------+     +---------------------+
             |    arcade-serve     |     |       umami         |
             |   games origin      |     |  web analytics      |
             +---------------------+     +---------------------+
              - - - optional - - -        - - - optional - - -
```

Reading it in words:

- Browsers reach the admin, the portal, and the public MCP endpoint through the
  proxy. So do AI agents, which talk to `mcp-public`.
- The admin and the portal both talk to Supabase directly with the anonymous
  key, so row level security decides what they can see. They also call the API
  for the things that need more than that.
- The API holds the service role key, so it can read and write past row level
  security. It puts background work on Redis.
- The scheduler puts jobs on Redis on a schedule and does no work itself. The
  worker takes jobs off Redis and does the work. That split is why the
  scheduler must never run more than one replica.
- The worker carries a Chromium browser for the scrapers, and calls
  `scrapling-fetcher` when a page needs a browser pool or a residential proxy.
- `se-runner` is a second, leaner worker that consumes only the
  software-engineer module's queue. When it is off, nothing consumes that queue
  and those jobs stay queued.
- `events-mcp` and `browser-mcp` are internal only. The API and the worker
  reach them over the private network, and they are never routed publicly.

---

## Package Architecture

### `packages/shared`

The shared package provides the foundation that all other packages depend on.

- TypeScript types for database entities, e.g. events, speakers, and registrations
- Constants such as category lists, status enums, and configuration defaults
- Utility functions for date formatting, slug generation, and data transformation
- The module loader, which resolves module sources and imports each module
- The module lifecycle code, which applies migrations and runs install hooks
- Consumed as a workspace dependency (`workspace:*`) by admin, portal, and api

### `packages/admin`

The admin dashboard is a single-page React application for administrators.

| Concern | Technology |
|---------|------------|
| Build | Vite (dev server on port 5173; Docker: http://admin.gatewaze.localhost via Traefik) |
| UI Components | Radix Themes + Tailwind CSS |
| Routing | React Router v7 |
| Data Tables | TanStack Table |
| State | React Query (TanStack Query) for server state |
| Supabase | Client-side `@supabase/supabase-js` with RLS |

Key responsibilities:
- People and member management
- Email template editing and sending
- Analytics dashboards

### `packages/portal`

The public-facing website where users browse and interact with your organization.

| Concern | Technology |
|---------|------------|
| Framework | Next.js 15 (App Router) |
| Rendering | Server-side rendering (SSR) with `force-dynamic` |
| Styling | Tailwind CSS |
| Supabase | Server client via `@supabase/ssr` |

Key responsibilities:
- Public-facing pages for members and content
- Module-provided routes (events, calendars, registration, etc.)
- SEO-optimized pages with server-rendered metadata

Architecture notes:
- Server components fetch data and pass to client `TimelineContent` component
- `params` are `Promise<{...}>` in Next.js 15 and must be awaited
- Timeline components accept a `basePath` prop for reuse across routes
- Supabase join queries use `.select('related_table!inner(fields)')` syntax

### `packages/api`

A lightweight Express server handling operations that do not fit into client-side or edge function patterns.

| Concern | Technology |
|---------|------------|
| Framework | Express |
| Port | 3002 (Docker: http://api.gatewaze.localhost via Traefik) |
| Auth | Supabase service role key (bypasses RLS) |
| Jobs | BullMQ workers + Redis |

Key responsibilities:
- Import and export, e.g. CSV import of people and events
- The public REST API at `/api/v1`, authenticated with an API key
- Module installation, reconciliation, and migration
- The API routes that each enabled module registers
- Health check endpoints for orchestration

This package also builds two other processes. The **worker** takes jobs off the
Redis queue and runs them, e.g. sending bulk email, processing images, and
running scrapers. The **scheduler** puts jobs on the queue on a schedule and
runs no work itself. Because the scheduler is what enqueues cron jobs, running
more than one copy of it runs every job twice.

### The small services

Four packages are deliberately outside the workspace dependency graph. Each has
its own Dockerfile, almost no dependencies, and can be deployed or rolled back
without touching the platform.

| Package | What it does |
|---|---|
| `packages/mcp` | The Model Context Protocol server. In its public profile it serves read-only tools with no client authentication, so agents can read your events and content. |
| `packages/events-mcp` | An internal MCP service for the `events_*` tools, including writing changes back to Luma. Service role backed and never routed publicly. |
| `packages/browser-mcp` | An internal MCP service that gives agents a headless browser, either Chromium in the container or a hosted browser through Browserbase. |
| `packages/arcade-serve` | The games origin. Serves creator-built single-page games out of versioned storage snapshots, and ships the browser SDK those games use. |

Two more support the rest. `packages/tracking` is the engagement tracking
library the portal and admin share. `packages/connect` is a command-line tool
your users run, which finds the AI clients on their machine and writes the
connector entry for your MCP server into each one.

---

## Data Flow

### Admin (Client-Side Direct Access)

```
Admin SPA  ──►  Supabase PostgREST API  ──►  PostgreSQL
                    (RLS enforced)
```

The admin app uses the Supabase JavaScript client directly. All queries go through PostgREST, which enforces row-level security policies based on the authenticated user's JWT. The admin user's role and permissions determine which rows they can read and write.

### Portal (Server-Side Rendering)

```
Browser  ──►  Next.js Server  ──►  Supabase Server Client  ──►  PostgreSQL
                                        (RLS enforced)
```

The portal uses the `@supabase/ssr` package to create a Supabase client on the server. Data is fetched during SSR, rendered to HTML, and sent to the browser. Public data (events, calendars) uses `anon` key access with permissive RLS policies.

### API Server (Service Role Access)

```
API Server  ──►  Supabase Admin Client  ──►  PostgreSQL
                    (service role, bypasses RLS)
```

The API server uses the Supabase service role key, which bypasses RLS entirely. This is necessary for administrative bulk operations like CSV imports, cross-tenant data access, and background job processing.

### Edge Functions (Serverless)

```
External Event  ──►  Edge Function  ──►  PostgreSQL
                                    ──►  External Services (email, webhooks)
```

Supabase Edge Functions (Deno-based) handle event-driven serverless logic:
- **Registration processing** -- validates and records new registrations
- **Email dispatch** -- renders templates and sends via configured provider
- **Webhook processing** -- receives and processes inbound webhooks from integrations (e.g., Cvent)

### Background Jobs

```
API Server / Edge Function  ──►  Redis (BullMQ queue)
                                       │
                                 BullMQ Worker  ──►  Supabase / External APIs
```

Long-running or deferred tasks are enqueued in Redis via BullMQ:
- **Email sending** -- bulk email campaigns and transactional messages
- **Image processing** -- thumbnail generation and optimization
- **Data sync** -- periodic synchronization with external systems

The BullMQ scheduler runs cron-based repeating jobs for tasks like cleanup and scheduled email sends.

---

## Auth Architecture

### Auth Adapter Pattern

Gatewaze uses an adapter pattern for authentication, allowing different identity providers:

| Adapter | Description |
|---------|-------------|
| **Supabase Auth** (default) | Built-in GoTrue authentication with email/password, magic links, and OAuth providers |
| **OIDC** (optional) | Connect to an external OpenID Connect provider for SSO |

The active adapter is selected via configuration, and all auth operations (sign in, sign up, token refresh, session management) route through the adapter interface.

### Middleware Guards

Three guard types protect routes and enforce access control:

| Guard | Purpose |
|-------|---------|
| `AuthGuard` | Requires a valid authenticated session. Redirects unauthenticated users to sign-in. |
| `AdminGuard` | Requires the authenticated user to have an admin role. Returns 403 for non-admin users. |
| `FeatureGuard` | Checks whether a specific feature or module is enabled before allowing access. |

Guards are composable and can be stacked on routes (e.g., a route may require both `AuthGuard` and `AdminGuard`).

### Row-Level Security (RLS)

All database tables have RLS policies that enforce access control at the PostgreSQL level:

- **Public data** (events, calendars) -- `anon` role can SELECT rows marked as public and active
- **Authenticated data** (registrations, profiles) -- users can only access their own rows
- **Admin data** (email templates, admin settings) -- restricted to users with admin role in their JWT claims
- **Service role** -- the API server bypasses RLS entirely for administrative operations

This ensures that even if application-level checks are bypassed, the database enforces security.

---

## Module System

### Overview

Gatewaze uses a module system to organize features into composable, independently-enableable units. Modules are self-contained packages that live outside the core repository and are loaded at build time and runtime from configurable sources (local paths or git repos).

### GatewazeModule Interface

Each module exports a default object implementing the `GatewazeModule` interface, which declares everything the module contributes to the platform:

```typescript
interface GatewazeModule {
  id: string;
  name: string;
  description: string;
  version: string;
  features: string[];              // Feature flags this module provides
  type?: 'feature' | 'integration' | 'theme';
  dependencies?: string[];         // Other module IDs this module requires

  // UI extension points
  adminRoutes?: AdminRouteDefinition[];
  adminNavItems?: NavigationItem[];
  adminSlots?: SlotRegistration[];   // Inject UI into named extension points
  portalRoutes?: PortalRouteDefinition[];
  portalNav?: { label, path, icon, order };
  portalSlots?: SlotRegistration[];

  // Backend extension points
  apiRoutes?: (app, context?) => void | Promise<void>;
  workers?: WorkerDefinition[];
  schedulers?: SchedulerDefinition[];
  edgeFunctions?: string[];
  migrations?: string[];

  // Configuration and lifecycle
  configSchema?: Record<string, ConfigField>;
  themeOverrides?: ThemeOverrides;   // For theme-type modules
  onInstall?: () => Promise<void>;
  onEnable?: () => Promise<void>;
  onDisable?: () => Promise<void>;
}
```

### Module Loading

Modules are discovered from sources listed in `gatewaze.config.ts`:

- **Client-side (admin):** A Vite plugin resolves modules at build time and generates a virtual module with static imports. Route components are lazy-loaded and code-split.
- **Server-side (API, CLI):** The shared `loadModules()` function resolves source directories, imports each module, and validates it against the interface.

### Core vs. Module Features

| Type | Behavior |
|------|----------|
| **Core features** | Always enabled -- people/members, auth, email, admin dashboard, public portal |
| **Module features** | Gated by feature flags -- each module declares the features it provides, and routes/nav/slots are only rendered when those features are enabled |

This allows self-hosted instances to enable only the features they need, keeping the platform lightweight and focused. See the [Module System Guide](./modules.md) for full documentation.

---

## Database Architecture

### PostgreSQL 17 via Supabase

The database is PostgreSQL 17, managed through Supabase. Schema migrations are applied via the Supabase CLI (`supabase db push` / `supabase migration`).

### Key Tables

| Table | Purpose |
|-------|---------|
| `events` | Core event records (title, dates, location, status, metadata) |
| `speakers` | Speaker profiles linked to events |
| `categories` | Event categories for classification |
| `topics` | Topic/track assignments for sessions |
| `tags` | Freeform tags for flexible event labeling |
| `calendars` | Calendar entities, looked up by `slug` or `calendar_id` (CAL-XXX format) |
| `calendar_events` | Junction table linking `calendars.id` to `events.event_id` |
| `members` | Organization members with roles and permissions |
| `registrations` | Event registration records |
| `email_templates` | Configurable email templates for notifications and campaigns |
| `admin_profiles` | Admin user profiles with role assignments |

### Junction Tables and Relationships

Many-to-many relationships use junction tables:

```
calendars ──► calendar_events ──► events
events    ──► event_speakers  ──► speakers
events    ──► event_topics    ──► topics
events    ──► event_tags      ──► tags
```

Supabase client queries through junction tables use the inner join syntax:
```typescript
const { data } = await supabase
  .from('calendar_events')
  .select('events!inner(id, title, start_date)')
  .eq('calendar_id', calendarId);
```

### RPC Functions

Complex queries that cannot be expressed as simple PostgREST calls are implemented as PostgreSQL functions and invoked via `.rpc()`:

- Aggregation queries (event counts by category, registration stats)
- Full-text search across events and speakers
- Geospatial queries for map views
- Batch operations with transactional guarantees

### RLS Policy Summary

| Role | Access Level |
|------|-------------|
| `anon` | SELECT on public, active events and calendars |
| `authenticated` | SELECT/INSERT/UPDATE on own registrations and profile |
| `admin` (via JWT claim) | Full CRUD on events, speakers, templates, settings |
| `service_role` | Bypasses all RLS (used by API server only) |

---

## Deployment Architecture

### Docker Compose

Two compose stacks, selected by `SUPABASE_MODE` in `docker/.env`. `make up`
picks the right one for you.

**`SUPABASE_MODE=local`** uses `docker/docker-compose.yml`, which runs the
Gatewaze services and a complete self-hosted Supabase: Postgres, GoTrue,
PostgREST, Storage, Realtime, the Deno edge function runtime, the Kong
gateway, postgres-meta, and Studio. Migrations are applied when the database
container starts, and edge functions are served straight from
`supabase/functions/`.

**`SUPABASE_MODE=cloud`** uses `docker/docker-compose.cloud.yml`, which runs
the Gatewaze services and Redis and leaves the database to your Supabase
project. You apply migrations with `make migrate` and deploy edge functions
with `make deploy-functions`.

There are no compose profiles, so both stacks start every service they define.
A fresh `make up` on the local stack brings up around 23 containers and wants
roughly 8 GB of memory available to Docker.

A third file, `docker/docker-compose.quickstart.yml`, pulls pre-built images
from the registry instead of building from source.

### Kubernetes

The Helm chart in `helm/gatewaze` installs the admin, portal, API, worker,
scheduler, and Redis, plus the optional services, each release in its own
namespace. It does not install Supabase. You point it at a Supabase project or
at a Supabase you installed yourself.

Worked example values files are in `helm/examples/`, and
[Running Gatewaze on Kubernetes](./kubernetes.md) covers the install, resource
sizing, secret handling, and upgrades.

### Container Images

Every release publishes these to the GitHub Container Registry, tagged with
both the version and `latest`:

```
ghcr.io/gatewaze/admin
ghcr.io/gatewaze/portal
ghcr.io/gatewaze/api
ghcr.io/gatewaze/worker
ghcr.io/gatewaze/scheduler
ghcr.io/gatewaze/se-runner
ghcr.io/gatewaze/mcp-public
ghcr.io/gatewaze/scrapling-fetcher
```

[Running Gatewaze on Kubernetes](./kubernetes.md#what-each-image-does)
describes what each image does. The Helm chart rejects the tag `latest` on
purpose, so that a rollback lands on the same image every time.

The Helm chart also has templates for `events-mcp`, `browser-mcp`,
`arcade-serve`, and `custom-domain-controller`. The release pipeline does not
publish those images yet, so build and push them yourself before enabling
them.

---

## Technology Stack

| Layer | Technology | Version / Notes |
|-------|-----------|-----------------|
| **Monorepo** | pnpm workspaces | Package management and script orchestration |
| **Language** | TypeScript | Used across all packages |
| **Admin UI** | React | Single-page application |
| **Admin Build** | Vite | Dev server on port 5173; Docker via Traefik |
| **Admin Components** | Radix Themes | Radix UI component library |
| **Admin Routing** | React Router v7 | Client-side routing |
| **Admin Tables** | TanStack Table | Headless data table library |
| **Portal** | Next.js 15 | App Router with SSR |
| **API Server** | Express | REST endpoints and job scheduling |
| **Styling** | Tailwind CSS | Utility-first CSS across all packages |
| **Database** | PostgreSQL 17 | Via Supabase |
| **Auth** | Supabase Auth (GoTrue) | With optional OIDC adapter |
| **Storage** | Supabase Storage | S3-compatible object storage |
| **Realtime** | Supabase Realtime | WebSocket-based live updates |
| **Edge Functions** | Supabase Edge Functions | Deno runtime |
| **Job Queue** | BullMQ | Redis-backed background job processing |
| **Cache / Queue** | Redis | Backend for BullMQ |
| **Server State** | TanStack Query | Client-side data fetching and caching |
| **Containerization** | Docker | Multi-stage builds for production |
| **Reverse Proxy** | Traefik v3 (Apache 2.0) | `.localhost` domain routing for Docker Compose |
| **Orchestration** | Docker Compose / Kubernetes | Deployment and scaling |
| **CI/CD** | GitHub Actions | Build, test, and publish pipeline |
| **Registry** | ghcr.io | Container image hosting |
| **AI** | OpenAI, Anthropic, Gemini | One provider router, with model allow-lists and a per-call cost ledger |
| **Agents** | [Goose](https://github.com/aaif-goose/goose) | Block's agent runtime, run as a server-side command-line tool |
| **Agent protocol** | [MCP](https://modelcontextprotocol.io) | Public, internal, and browser MCP servers |
| **Scraping** | [Scrapling](https://github.com/D4Vinci/Scrapling) | The fetch service behind the scrapers, with residential proxy support |
| **Analytics** | [Umami](https://umami.is) | Self-hosted, installed by the analytics module |
| **Metrics** | Prometheus | Worker and scheduler expose `/metrics`; PodMonitors are optional |
| **Tracing** | OpenTelemetry | Optional, over OTLP and HTTP |
| **Errors** | Sentry | Optional, and can point at a self-hosted GlitchTip |
