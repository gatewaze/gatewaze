# Module System

Gatewaze uses a module architecture that allows you to extend the platform with additional functionality without modifying core code. Modules are self-contained packages that register routes, UI components, background jobs, database migrations, and more.

---

## Table of Contents

- [Overview](#overview)
- [Core Features](#core-features)
- [Module Sources](#module-sources)
- [Module Resolution](#module-resolution)
- [Build Pipeline](#build-pipeline)
- [Route & Navigation Integration](#route--navigation-integration)
- [Module Lifecycle & Reconciliation](#module-lifecycle--reconciliation)
- [Installing a Paid Module](#installing-a-paid-module)
- [Available Paid Modules](#available-paid-modules)
- [Creating a Custom Module](#creating-a-custom-module)
- [GatewazeModule Interface](#gatewazemodule-interface)
- [Example Custom Module](#example-custom-module)
- [Module Lifecycle Hooks](#module-lifecycle-hooks)
- [Key Files Reference](#key-files-reference)

---

## Overview

The module system is designed around several principles:

1. **Self-contained** -- Each module is a standalone npm package that bundles everything it needs: UI components, API routes, database migrations, and background jobs.
2. **Declarative registration** -- Modules export a `GatewazeModule` object that declares their capabilities. The core platform discovers and integrates them automatically.
3. **Feature-gated** -- Each module capability is tied to a feature flag. Admin permissions can be scoped to individual module features.
4. **Hot-pluggable** -- Modules can be added or removed by updating `gatewaze.config.ts` without changes to core code.

### How modules are loaded

```
gatewaze.config.ts
    |
    |  lists module package names
    v
Module Loader
    |
    |  imports each package, reads GatewazeModule export
    v
Registration
    |
    +-- Admin Routes    --> React Router (lazy-loaded)
    +-- Admin Nav Items --> Sidebar navigation
    +-- Portal Routes   --> Next.js dynamic routes
    +-- API Routes      --> Express router middleware
    +-- Workers         --> BullMQ job handlers
    +-- Schedulers      --> Cron-based job schedulers
    +-- Edge Functions  --> Supabase Edge Functions
    +-- Migrations      --> Database schema changes
```

---

## Core Features

The following features are always available and do not require any modules:

| Feature              | Description                                                  |
|----------------------|--------------------------------------------------------------|
| Event Management     | Create, edit, and organize events with metadata and scheduling |
| Calendar Publishing  | Publish curated event calendars with public URLs             |
| Speaker Management   | Manage speaker profiles and assign speakers to events        |
| Member Management    | Track member profiles, organizations, and tiers              |
| Registration         | Handle event registrations with forms and approval workflows |
| Email                | Send transactional and bulk email via SendGrid or SMTP       |
| Categories & Tags    | Organize events with categories, topics, and tags            |
| File Storage         | Upload and manage images and documents via Supabase Storage  |
| Public Portal        | SEO-friendly public site for browsing and registering        |
| Admin Dashboard      | Full-featured admin interface for platform management        |
| Permissions          | Role-based and feature-based access control                  |

---

## Module Sources

Modules live outside the main Gatewaze repository. The `moduleSources` field in `gatewaze.config.ts` tells the system where to find module packages:

```typescript
const config: GatewazeConfig = {
  // ...

  moduleSources: [
    // Local path (relative to project root)
    '../gatewaze-modules/modules',

    // Git repository (cloned automatically at build time)
    'https://github.com/org/paid-modules.git',

    // Git repo with subdirectory and branch (fragment syntax)
    'https://github.com/org/repo.git#path=modules&branch=v2',

    // Object syntax for full control
    {
      url: 'https://github.com/org/repo.git',
      path: 'modules',
      branch: 'main',
    },
  ],

  modules: [
    '@gatewaze-modules/blog',
    '@gatewaze-modules/redirects',
    // ...
  ],
};
```

### Supported source types

| Source Type | Example | Notes |
|------------|---------|-------|
| Local path (relative) | `'../gatewaze-modules/modules'` | Resolved relative to project root |
| Local path (absolute) | `'/opt/modules'` | Used as-is |
| Git HTTPS | `'https://github.com/org/modules.git'` | Shallow-cloned to `.gatewaze-modules/` |
| Git SSH | `'git@github.com:org/modules.git'` | Requires SSH keys |
| Git + subdirectory | `'https://...#path=modules'` | Only use a subdirectory of the repo |
| Git + branch/tag | `'https://...#branch=v2'` | Pin to a specific branch or tag |
| Object syntax | `{ url, path, branch }` | Combines all options |

Git repos are shallow-cloned (`--depth 1`) to `.gatewaze-modules/<repo-slug>/` in the project root. On subsequent builds, existing clones are updated with `git pull --ff-only`. The `.gatewaze-modules/` directory is git-ignored.

If no `moduleSources` are specified, the default is `['../gatewaze-modules/modules']`.

---

## Module Resolution

When loading a module (e.g., `@gatewaze-modules/blog`), the system strips the `@gatewaze-modules/` prefix to get the slug (`blog`) and checks these locations in order:

1. **Module sources** -- each directory listed in `moduleSources`, looking for `<slug>/index.ts`
2. **node_modules** -- pnpm workspace link at `node_modules/@gatewaze-modules/<slug>`
3. **Legacy fallback** -- `../gatewaze-modules/modules/<slug>/index.ts` (sibling directory)

The first match wins. This allows you to overlay modules from multiple sources, with earlier sources taking priority.

---

## Build Pipeline

Modules are integrated differently on the client side (admin app) and server side (API, CLI).

### Admin app (Vite)

A custom Vite plugin (`packages/admin/vite-plugin-gatewaze-modules.ts`) handles client-side module loading:

1. At build time, reads `gatewaze.config.ts` to get `modules` and `moduleSources`
2. Resolves each module to its absolute file path using the resolution order above
3. Generates a virtual module (`virtual:gatewaze-modules`) containing static imports:

```typescript
// Generated by vite-plugin-gatewaze-modules
import mod0 from '/path/to/blog/index.ts';
import mod1 from '/path/to/redirects/index.ts';
import mod2 from '/path/to/slack-integration/index.ts';
export default [mod0, mod1, mod2];
```

4. Vite bundles the module code with tree-shaking, lazy-loading route components via dynamic `import()`

Module admin pages can import shared UI components from the host app using `@/` path aliases (e.g., `import { Button } from '@/components/ui/Button'`). These are resolved by Vite's alias config.

### API server & CLI (Node.js)

The shared `loadModules()` function (`packages/shared/src/modules/loader.ts`) handles server-side loading:

1. Resolves `moduleSources` to absolute directories (cloning git repos if needed)
2. For each module, checks source directories for `<slug>/index.ts`
3. Falls back to `import(packageName)` for pnpm workspace packages
4. Validates each module against the `GatewazeModule` interface

```typescript
import { loadModules } from '@gatewaze/shared/modules';
import config from './gatewaze.config';

const modules = await loadModules(config, projectRoot);
// modules: LoadedModule[] — validated, ready to use
```

---

## Route & Navigation Integration

### Admin routes

Module `adminRoutes` are converted to React Router route objects in `packages/admin/src/app/router/moduleRoutes.tsx`:

- Each route's `component` is lazy-loaded via React Router's `lazy` API
- Components are wrapped in `FeatureGuard` which checks the `requiredFeature` against the instance's enabled features
- Routes are grouped by their top-level path segment (e.g., all `/redirects/*` routes are nested under a `redirects` parent)

### Sidebar navigation

Module `adminNavItems` are converted to sidebar entries in `packages/admin/src/app/navigation/segments/modules.ts`:

- Items are sorted by `order` (lower numbers appear first)
- The `parentGroup` field determines which sidebar section the item appears in (`dashboards` or `admin`)
- Items are only visible when their `requiredFeature` is enabled
- The `icon` field maps to a Lucide icon name

---

## Module Lifecycle & Reconciliation

Reconciliation syncs the database state (`installed_modules` table) with the modules declared in `gatewaze.config.ts`. It handles installing new modules, applying migrations, and running lifecycle hooks.

### When reconciliation runs

| Trigger | How |
|---------|-----|
| Admin UI | Modules page &rarr; enable toggle &rarr; `POST /api/modules/reconcile` |
| Onboarding | Module setup step &rarr; `POST /api/modules/reconcile` |
| CLI | `pnpm modules:migrate` |

### What reconciliation does

For each module in the config:

1. **New module** (not in `installed_modules`):
   - Apply SQL migrations in order
   - Track each migration in `module_migrations` table (filename + SHA256 checksum)
   - Run `onInstall()` hook
   - Run `onEnable()` hook
   - Insert row into `installed_modules`

2. **Existing module** (already installed):
   - If version changed: apply any new migrations, update version
   - If disabled: run `onEnable()`, set status to `enabled`

3. **Removed module** (in DB but not in config):
   - Run `onDisable()` hook
   - Set status to `disabled`
   - Data is preserved (migrations are never rolled back automatically)

### Database tables

| Table | Purpose |
|-------|---------|
| `installed_modules` | Tracks each module's status, version, features, and config |
| `module_migrations` | Tracks applied SQL migrations (filename + checksum) to prevent re-execution |

### API endpoint

`POST /api/modules/reconcile` (defined in `packages/api/src/routes/modules.ts`) loads all modules, runs reconciliation, and returns the current state of all installed modules. It requires a service role key (only the API server has this).

### Frontend service

`ModuleService` (`packages/admin/src/utils/moduleService.ts`) provides the client-side API:

```typescript
// Enable/disable a module in the database
await ModuleService.enableModule('redirects');
await ModuleService.disableModule('redirects');

// Trigger server-side reconciliation (migrations + hooks)
const result = await ModuleService.reconcileModules();
// result.modules: [{ id, name, status }]
```

---

## Installing a Paid Module

### Step 1: Install the package

```bash
pnpm add @gatewaze-modules/stripe-payments
```

### Step 2: Register in gatewaze.config.ts

Add the module package name to the `modules` array in your configuration:

```typescript
import type { GatewazeConfig } from './packages/shared/src/types/modules';

const config: GatewazeConfig = {
  name: 'My Events Platform',

  auth: {
    provider: 'supabase',
  },

  email: {
    provider: 'sendgrid',
  },

  modules: [
    '@gatewaze-modules/stripe-payments',
  ],

  // Module-specific configuration
  moduleConfig: {
    'stripe-payments': {
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
      secretKey: process.env.STRIPE_SECRET_KEY,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
      currency: 'usd',
    },
  },
};

export default config;
```

### Step 3: Run module migrations

If the module includes database migrations, apply them:

```bash
pnpm db:migrate
```

### Step 4: Restart the application

```bash
pnpm dev
# or, for Docker:
docker compose up -d --build
```

The module's admin pages, API routes, and background jobs are automatically registered on startup.

---

## Available Paid Modules

| Module                                  | Description                                           | Key Features                                                       |
|-----------------------------------------|-------------------------------------------------------|--------------------------------------------------------------------|
| `@gatewaze-modules/stripe-payments`     | Stripe payment processing for paid events             | Checkout integration, refunds, payment history, revenue reporting  |
| `@gatewaze-modules/analytics`           | Advanced event analytics and reporting                | Attendance tracking, engagement metrics, export to CSV/PDF         |
| `@gatewaze-modules/crm-sync`            | CRM integration (Salesforce, HubSpot)                 | Bi-directional contact sync, event activity tracking               |
| `@gatewaze-modules/video-hosting`       | Integrated video hosting for virtual events           | Live streaming, on-demand replay, viewer analytics                 |
| `@gatewaze-modules/white-label`         | White-label branding for the public portal            | Custom domains, theme editor, branded emails                       |
| `@gatewaze-modules/cvent-integration`   | Cvent integration for enterprise event management     | Event sync, registration import, attendee matching                 |
| `@gatewaze-modules/marketing-automation`| Marketing automation and drip campaigns               | Email sequences, audience segmentation, A/B testing                |

Contact [sales@gatewaze.com](mailto:sales@gatewaze.com) for pricing and access to paid modules.

---

## Creating a Custom Module

You can build your own modules to extend Gatewaze with custom functionality.

### GatewazeModule Interface

Every module must export a default object that implements the `GatewazeModule` interface:

```typescript
export interface GatewazeModule {
  /** Unique identifier for this module */
  id: string;

  /** Human-readable name */
  name: string;

  /** Short description of what this module does */
  description: string;

  /** Semantic version */
  version: string;

  /** List of feature flags this module provides */
  features: string[];

  /** Admin panel routes (lazy-loaded React components) */
  adminRoutes?: AdminRouteDefinition[];

  /** Sidebar navigation items for the admin panel */
  adminNavItems?: NavigationItem[];

  /** Public portal routes */
  portalRoutes?: PortalRouteDefinition[];

  /** Express middleware function that registers API routes */
  apiRoutes?: (app: unknown) => void;

  /** BullMQ worker definitions */
  workers?: WorkerDefinition[];

  /** Cron-based scheduler definitions */
  schedulers?: SchedulerDefinition[];

  /** Supabase Edge Function directory names */
  edgeFunctions?: string[];

  /** SQL migration file paths (applied in order) */
  migrations?: string[];

  /** Configuration schema for module-specific settings */
  configSchema?: Record<string, ConfigField>;

  /** Called once when the module is first installed */
  onInstall?: () => Promise<void>;

  /** Called each time the module is enabled */
  onEnable?: () => Promise<void>;

  /** Called when the module is disabled */
  onDisable?: () => Promise<void>;
}
```

### Adding Admin Routes and Navigation

Admin routes are lazy-loaded React components that integrate into the admin application's router.

```typescript
import type { GatewazeModule } from '@gatewaze/shared';

const myModule: GatewazeModule = {
  id: 'my-custom-module',
  name: 'My Custom Module',
  description: 'Adds custom functionality to Gatewaze',
  version: '1.0.0',
  features: ['custom-dashboard', 'custom-reports'],

  adminRoutes: [
    {
      path: '/custom-dashboard',
      component: () => import('./admin/CustomDashboard'),
      requiredFeature: 'custom-dashboard',
      guard: 'admin',  // 'auth' | 'admin' | 'super_admin'
    },
    {
      path: '/custom-reports',
      component: () => import('./admin/CustomReports'),
      requiredFeature: 'custom-reports',
      guard: 'admin',
    },
    {
      path: '/custom-reports/:reportId',
      component: () => import('./admin/ReportDetail'),
      requiredFeature: 'custom-reports',
      parentPath: '/custom-reports',
      guard: 'admin',
    },
  ],

  adminNavItems: [
    {
      path: '/custom-dashboard',
      label: 'Custom Dashboard',
      icon: 'LayoutDashboard',   // Lucide icon name
      requiredFeature: 'custom-dashboard',
      parentGroup: 'analytics',
      order: 10,
    },
    {
      path: '/custom-reports',
      label: 'Custom Reports',
      icon: 'FileBarChart',
      requiredFeature: 'custom-reports',
      parentGroup: 'analytics',
      order: 20,
    },
  ],
};
```

The `guard` property controls access:

| Guard          | Access Level                                        |
|----------------|-----------------------------------------------------|
| `auth`         | Any authenticated user                              |
| `admin`        | Users with `admin` or `super_admin` role            |
| `super_admin`  | Users with `super_admin` role only                  |

### Adding Edge Functions

To include Supabase Edge Functions, place them in your module's `functions/` directory and reference the directory names:

```
my-custom-module/
  src/
  functions/
    my-edge-function/
      index.ts
    another-function/
      index.ts
```

```typescript
const myModule: GatewazeModule = {
  // ...
  edgeFunctions: ['my-edge-function', 'another-function'],
};
```

During module installation, these functions are copied to the Supabase `functions/` directory and deployed.

### Adding Database Migrations

Include SQL migration files that are applied in alphabetical order:

```
my-custom-module/
  migrations/
    001_create_custom_tables.sql
    002_add_indexes.sql
```

```typescript
const myModule: GatewazeModule = {
  // ...
  migrations: [
    './migrations/001_create_custom_tables.sql',
    './migrations/002_add_indexes.sql',
  ],
};
```

Migrations are run once during installation and tracked to prevent duplicate execution.

### Adding API Routes

Register Express routes by providing a function that receives the Express app:

```typescript
const myModule: GatewazeModule = {
  // ...
  apiRoutes: (app: any) => {
    const router = require('express').Router();

    router.get('/custom/data', async (req, res) => {
      // Your handler logic
      res.json({ data: [] });
    });

    router.post('/custom/webhook', async (req, res) => {
      // Webhook handler
      res.status(200).send('ok');
    });

    app.use('/api/modules', router);
  },
};
```

### Adding Background Jobs

Define BullMQ workers and cron-based schedulers:

```typescript
const myModule: GatewazeModule = {
  // ...
  workers: [
    {
      name: 'custom-sync',
      handler: './workers/custom-sync-worker.js',
      concurrency: 3,
    },
    {
      name: 'custom-export',
      handler: './workers/custom-export-worker.js',
      concurrency: 1,
    },
  ],

  schedulers: [
    {
      name: 'daily-custom-report',
      cron: '0 8 * * *',           // Every day at 8:00 AM
      handler: './schedulers/daily-report.js',
    },
    {
      name: 'hourly-custom-sync',
      cron: '0 * * * *',           // Every hour
      handler: './schedulers/hourly-sync.js',
    },
  ],
};
```

Workers process jobs from BullMQ queues. Schedulers enqueue jobs on a cron schedule.

### Adding Configuration Schema

Define the configuration fields your module requires:

```typescript
const myModule: GatewazeModule = {
  // ...
  configSchema: {
    apiKey: {
      key: 'apiKey',
      type: 'secret',
      required: true,
      description: 'API key for the external service',
    },
    syncInterval: {
      key: 'syncInterval',
      type: 'number',
      required: false,
      default: '3600',
      description: 'Sync interval in seconds',
    },
    enableNotifications: {
      key: 'enableNotifications',
      type: 'boolean',
      required: false,
      default: 'true',
      description: 'Enable notification emails for sync events',
    },
  },
};
```

Configuration values are provided in `moduleConfig` in `gatewaze.config.ts`:

```typescript
moduleConfig: {
  'my-custom-module': {
    apiKey: process.env.CUSTOM_API_KEY,
    syncInterval: 1800,
    enableNotifications: true,
  },
},
```

---

## Example Custom Module

Here is a complete example of a custom module that adds a sponsor management feature to Gatewaze.

### Package structure

```
@my-org/gatewaze-sponsors/
  package.json
  src/
    index.ts                    # Module entry point
    admin/
      SponsorList.tsx           # Admin page: list sponsors
      SponsorForm.tsx           # Admin page: create/edit sponsor
      SponsorDetail.tsx         # Admin page: sponsor detail
    workers/
      sponsor-sync-worker.ts   # Background sync worker
    schedulers/
      daily-sponsor-report.ts  # Daily report scheduler
  functions/
    sponsor-webhook/
      index.ts                 # Edge function for webhook
  migrations/
    001_create_sponsors.sql    # Database migration
```

### src/index.ts

```typescript
import type { GatewazeModule } from '@gatewaze/shared';

const sponsorsModule: GatewazeModule = {
  id: 'sponsors',
  name: 'Sponsor Management',
  description: 'Manage event sponsors, sponsorship tiers, and sponsor-event assignments',
  version: '1.0.0',
  features: ['sponsors.manage', 'sponsors.reports'],

  adminRoutes: [
    {
      path: '/sponsors',
      component: () => import('./admin/SponsorList'),
      requiredFeature: 'sponsors.manage',
      guard: 'admin',
    },
    {
      path: '/sponsors/new',
      component: () => import('./admin/SponsorForm'),
      requiredFeature: 'sponsors.manage',
      parentPath: '/sponsors',
      guard: 'admin',
    },
    {
      path: '/sponsors/:id',
      component: () => import('./admin/SponsorDetail'),
      requiredFeature: 'sponsors.manage',
      parentPath: '/sponsors',
      guard: 'admin',
    },
    {
      path: '/sponsors/:id/edit',
      component: () => import('./admin/SponsorForm'),
      requiredFeature: 'sponsors.manage',
      parentPath: '/sponsors',
      guard: 'admin',
    },
  ],

  adminNavItems: [
    {
      path: '/sponsors',
      label: 'Sponsors',
      icon: 'Handshake',
      requiredFeature: 'sponsors.manage',
      parentGroup: 'events',
      order: 50,
    },
  ],

  apiRoutes: (app: any) => {
    const express = require('express');
    const router = express.Router();

    router.get('/sponsors', async (req: any, res: any) => {
      // List sponsors
      res.json({ sponsors: [] });
    });

    router.post('/sponsors', async (req: any, res: any) => {
      // Create sponsor
      res.status(201).json({ sponsor: req.body });
    });

    app.use('/api/modules', router);
  },

  workers: [
    {
      name: 'sponsor-sync',
      handler: './workers/sponsor-sync-worker.js',
      concurrency: 2,
    },
  ],

  schedulers: [
    {
      name: 'daily-sponsor-report',
      cron: '0 9 * * 1',  // Every Monday at 9:00 AM
      handler: './schedulers/daily-sponsor-report.js',
    },
  ],

  edgeFunctions: ['sponsor-webhook'],

  migrations: [
    './migrations/001_create_sponsors.sql',
  ],

  configSchema: {
    defaultTier: {
      key: 'defaultTier',
      type: 'string',
      required: false,
      default: 'bronze',
      description: 'Default sponsorship tier for new sponsors',
    },
  },

  onInstall: async () => {
    console.log('Sponsors module installed. Running initial setup...');
    // Seed default sponsorship tiers, etc.
  },

  onEnable: async () => {
    console.log('Sponsors module enabled.');
  },

  onDisable: async () => {
    console.log('Sponsors module disabled.');
  },
};

export default sponsorsModule;
```

### migrations/001_create_sponsors.sql

```sql
CREATE TABLE IF NOT EXISTS public.sponsors (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  logo_url    text,
  website     text,
  tier        text NOT NULL DEFAULT 'bronze'
                CHECK (tier IN ('bronze', 'silver', 'gold', 'platinum')),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.event_sponsors (
  event_id    uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  sponsor_id  uuid NOT NULL REFERENCES public.sponsors(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, sponsor_id)
);
```

---

## Module Lifecycle Hooks

Modules can define three lifecycle hooks:

### onInstall

Called once when the module is first installed (i.e., the first time the application starts with the module in the `modules` array). Use this for one-time setup like seeding default data.

```typescript
onInstall: async () => {
  // Seed default sponsorship tiers
  // Create storage buckets
  // Set up default configuration
},
```

### onEnable

Called each time the module is enabled (including the first install). Use this for runtime initialization like registering event listeners or starting background processes.

```typescript
onEnable: async () => {
  // Register event listeners
  // Start background sync
  // Verify external service connectivity
},
```

### onDisable

Called when the module is removed from the `modules` array. Use this for cleanup like deregistering event listeners. Database migrations are **not** rolled back automatically -- handle data cleanup here if needed.

```typescript
onDisable: async () => {
  // Deregister event listeners
  // Stop background processes
  // Clean up temporary data (but preserve user data)
},
```

### Lifecycle execution order

```
First install:
  1. migrations (applied)
  2. onInstall()
  3. onEnable()

Subsequent starts:
  1. onEnable()

Module removed:
  1. onDisable()
```

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `gatewaze.config.ts` | Instance configuration: module list, sources, auth, email |
| `packages/shared/src/types/modules.ts` | Type definitions: `GatewazeModule`, `ModuleSource`, `GatewazeConfig` |
| `packages/shared/src/modules/loader.ts` | Server-side module resolution and loading (`loadModules()`) |
| `packages/shared/src/modules/lifecycle.ts` | Reconciliation logic: install, enable, disable (`reconcileModules()`) |
| `packages/shared/src/modules/migrations.ts` | SQL migration execution (`applyModuleMigrations()`) |
| `packages/admin/vite-plugin-gatewaze-modules.ts` | Vite plugin for build-time module bundling |
| `packages/admin/src/app/router/moduleRoutes.tsx` | Dynamic React Router route generation from modules |
| `packages/admin/src/app/navigation/segments/modules.ts` | Sidebar navigation generation from modules |
| `packages/admin/src/utils/moduleService.ts` | Frontend API client for module operations |
| `packages/api/src/routes/modules.ts` | `POST /api/modules/reconcile` endpoint |
| `scripts/modules/run-migrations.ts` | CLI migration runner (`pnpm modules:migrate`) |
| `scripts/modules/deploy-functions.ts` | Edge function deployment (`pnpm modules:deploy-functions`) |
