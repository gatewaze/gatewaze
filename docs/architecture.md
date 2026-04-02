# Architecture

This document describes the architecture of Gatewaze, an open-source event management platform built as a pnpm monorepo with a Supabase backend.

---

## System Overview

Gatewaze is structured as a **pnpm monorepo** containing four packages:

| Package | Role |
|---------|------|
| `packages/shared` | Types, constants, and utilities shared across all packages |
| `packages/admin` | React SPA for event organizers and administrators |
| `packages/portal` | Next.js public-facing site for attendees |
| `packages/api` | Express server for data import/export and background jobs |

The backend is powered by **Supabase** (PostgreSQL, Auth, Storage, Edge Functions, Realtime) with **Redis** and **BullMQ** handling background job processing.

---

## Architecture Diagram

```
                          ┌─────────────────────────────────────┐
                          │             Browsers                │
                          └──────────────────┬──────────────────┘
                                             │
                          ┌──────────────────▼──────────────────┐
                          │     Traefik Reverse Proxy           │
                          │          (Apache 2.0)               │
                          │  gatewaze-admin.localhost    → admin │
                          │  gatewaze-app.localhost      → portal│
                          │  gatewaze-api.localhost      → api   │
                          │  gatewaze-supabase.localhost → kong  │
                          │  gatewaze-studio.localhost   → studio│
                          │  Dashboard: http://localhost:8080    │
                          └──────┬──────────────┬───────────────┘
                                 │              │
                        ┌────────▼───────┐ ┌────▼──────────────┐
                        │  Admin (React) │ │  Portal (Next.js) │
                        │  (Vite build)  │ │  (SSR)             │
                        └────────┬───────┘ └────┬──────────────┘
                                 │              │
                  ┌──────────────▼──────────────▼──────────────┐
                  │              Supabase                       │
                  │  ┌────────────────────────────────────┐    │
                  │  │  PostgREST API (RLS-enforced)      │    │
                  │  ├────────────────────────────────────┤    │
                  │  │  PostgreSQL 17                      │    │
                  │  ├────────────────────────────────────┤    │
                  │  │  Auth (GoTrue)                      │    │
                  │  ├────────────────────────────────────┤    │
                  │  │  Storage (S3-compatible)            │    │
                  │  ├────────────────────────────────────┤    │
                  │  │  Realtime (WebSocket)               │    │
                  │  ├────────────────────────────────────┤    │
                  │  │  Edge Functions (Deno)              │    │
                  │  │  - Registration handling            │    │
                  │  │  - Email dispatch                   │    │
                  │  │  - Webhook processing               │    │
                  │  └────────────────────────────────────┘    │
                  └──────────────────▲─────────────────────────┘
                                     │
                          ┌──────────┴──────────┐
                          │  API Server (Express)│
                          │  - CSV import/export │
                          │  - Health checks     │
                          │  - Job scheduling    │
                          └──────────┬──────────┘
                                     │
                          ┌──────────▼──────────┐
                          │       Redis          │
                          └───┬─────────────┬───┘
                              │             │
                    ┌─────────▼───┐   ┌─────▼─────────┐
                    │  BullMQ     │   │  Scheduler     │
                    │  Workers    │   │  (cron jobs)   │
                    │  - Email    │   │                │
                    │  - Images   │   │                │
                    └─────────────┘   └───────────────┘
```

---

## Package Architecture

### `packages/shared`

The shared package provides the foundation that all other packages depend on.

- **TypeScript types** for database entities (events, speakers, registrations, etc.)
- **Constants** such as category lists, status enums, and configuration defaults
- **Utility functions** for date formatting, slug generation, and data transformation
- Published as a workspace dependency (`workspace:*`) consumed by admin, portal, and api

### `packages/admin`

The admin dashboard is a single-page React application for administrators.

| Concern | Technology |
|---------|------------|
| Build | Vite (dev server on port 5173; Docker: http://gatewaze-admin.localhost via Traefik) |
| UI Components | shadcn/ui + Tailwind CSS |
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
| Port | 3002 (Docker: http://gatewaze-api.localhost via Traefik) |
| Auth | Supabase service role key (bypasses RLS) |
| Jobs | BullMQ workers + Redis |

Key responsibilities:
- CSV import and export of events, speakers, and registrations
- Background job processing (email sending, image optimization)
- Health check endpoints for orchestration
- Scheduled tasks via BullMQ scheduler (cron-based)

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

Two Docker Compose profiles are available:

#### Self-Hosted (Full Stack)

Runs the complete Supabase stack alongside the Gatewaze services:

```yaml
services:
  admin:        # React SPA served by Nginx
  portal:       # Next.js with SSR
  api:          # Express server + BullMQ workers
  redis:        # Job queue backend
  # Full Supabase stack:
  postgres:     # PostgreSQL 17
  supabase-auth:     # GoTrue
  supabase-rest:     # PostgREST
  supabase-storage:  # Storage API
  supabase-realtime: # Realtime server
  supabase-edge:     # Edge Functions runtime
```

#### Cloud (External Supabase)

Connects to a hosted Supabase instance (supabase.com or self-managed):

```yaml
services:
  admin:   # React SPA served by Nginx
  portal:  # Next.js with SSR
  api:     # Express server + BullMQ workers
  redis:   # Job queue backend
  # Supabase is external -- configured via environment variables
```

### Kubernetes

A Helm chart supports namespaced releases for multi-instance deployments:

- Each release gets its own namespace
- ConfigMaps and Secrets manage per-instance configuration
- Horizontal pod autoscaling for portal and API services
- Persistent volume claims for Redis (if not using managed Redis)
- Ingress configuration for routing traffic to admin and portal services

### Container Images

Pre-built images are published to GitHub Container Registry:

```
ghcr.io/gatewaze/admin:latest
ghcr.io/gatewaze/portal:latest
ghcr.io/gatewaze/api:latest
```

Images are built on every release and tagged with both `latest` and the semantic version.

---

## Technology Stack

| Layer | Technology | Version / Notes |
|-------|-----------|-----------------|
| **Monorepo** | pnpm workspaces | Package management and script orchestration |
| **Language** | TypeScript | Used across all packages |
| **Admin UI** | React | Single-page application |
| **Admin Build** | Vite | Dev server on port 5173; Docker via Traefik |
| **Admin Components** | shadcn/ui | Built on Radix UI primitives |
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
