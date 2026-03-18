# Module System

Gatewaze uses a module architecture that allows you to extend the platform with additional functionality without modifying core code. Modules are self-contained packages that register routes, UI components, background jobs, database migrations, and more.

---

## Table of Contents

- [Overview](#overview)
- [Core Features](#core-features)
- [Installing a Paid Module](#installing-a-paid-module)
- [Available Paid Modules](#available-paid-modules)
- [Creating a Custom Module](#creating-a-custom-module)
- [GatewazeModule Interface](#gatewazemodule-interface)
- [Example Custom Module](#example-custom-module)
- [Module Lifecycle Hooks](#module-lifecycle-hooks)

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
