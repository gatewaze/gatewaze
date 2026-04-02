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
- [Installing a Module](#installing-a-module)
- [Creating a Custom Module](#creating-a-custom-module)
- [GatewazeModule Interface](#gatewazemodule-interface)
- [Module Types and Visibility](#module-types-and-visibility)
- [Dependencies](#dependencies)
- [UI Slots](#ui-slots)
- [Portal Routes and Navigation](#portal-routes-and-navigation)
- [Theme Modules](#theme-modules)
- [Example Custom Module](#example-custom-module)
- [Module Lifecycle Hooks](#module-lifecycle-hooks)
- [Managing Module Sources](#managing-module-sources)
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

## Installing a Module

### Step 1: Add the module source

Modules live outside the main repository. Add the source to your `gatewaze.config.ts`:

```typescript
import type { GatewazeConfig } from './packages/shared/src/types/modules';

const config: GatewazeConfig = {
  name: 'My Events Platform',
  platformVersion: '1.0.0',

  auth: {
    provider: 'supabase',
  },

  email: {
    provider: 'sendgrid',
  },

  // Where to find modules (local path or git repo)
  moduleSources: [
    '../gatewaze-modules/modules',
  ],

  // Which modules to enable
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

### Step 2: Run module migrations

If the module includes database migrations, apply them:

```bash
pnpm modules:migrate
```

### Step 3: Restart the application

```bash
pnpm dev
# or, for Docker:
docker compose up -d --build
```

The module's admin pages, API routes, and background jobs are automatically registered on startup. Modules can also be enabled and disabled at runtime through the admin UI without editing config files.

---

## Creating a Custom Module

You can build your own modules to extend Gatewaze with custom functionality.

### GatewazeModule Interface

Every module must export a default object that implements the `GatewazeModule` interface:

```typescript
export interface GatewazeModule {
  /** Unique identifier for this module (e.g., 'calendars', 'event-speakers') */
  id: string;

  /** Human-readable name */
  name: string;

  /** Short description of what this module does */
  description: string;

  /** Semantic version */
  version: string;

  /** Minimum platform version required (semver). If set, the module cannot be enabled
      unless the core platform meets this version. Example: '1.2.0' */
  minPlatformVersion?: string;

  /** Module classification */
  type?: 'feature' | 'integration' | 'theme';

  /** Controls visibility in the module marketplace UI */
  visibility?: 'public' | 'hidden' | 'premium';

  /** Category grouping for organizing modules in the UI */
  group?: string;

  /** List of feature flags this module provides */
  features: string[];

  /** Other module IDs that must be installed before this one */
  dependencies?: string[];

  /** Admin panel routes (lazy-loaded React components) */
  adminRoutes?: AdminRouteDefinition[];

  /** Sidebar navigation items for the admin panel */
  adminNavItems?: NavigationItem[];

  /** UI slot registrations for injecting components into admin extension points */
  adminSlots?: SlotRegistration[];

  /** Public portal routes */
  portalRoutes?: PortalRouteDefinition[];

  /** Portal header navigation entry — persisted in installed_modules on enable */
  portalNav?: { label: string; path: string; icon: string; order: number };

  /** UI slot registrations for injecting components into portal extension points */
  portalSlots?: SlotRegistration[];

  /** Express middleware function that registers API routes */
  apiRoutes?: (app: unknown, context?: ModuleContext) => void | Promise<void>;

  /** BullMQ worker definitions */
  workers?: WorkerDefinition[];

  /** Cron-based scheduler definitions */
  schedulers?: SchedulerDefinition[];

  /** Supabase Edge Function directory names (from the module's functions/ dir) */
  edgeFunctions?: string[];

  /** SQL migration file paths (applied in order) */
  migrations?: string[];

  /** Configuration schema for module-specific settings */
  configSchema?: Record<string, ConfigField>;

  /** Theme overrides — only meaningful when type is 'theme' */
  themeOverrides?: ThemeOverrides;

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

Register Express routes by providing a function that receives the Express app and an optional `ModuleContext` with the project root and module directory paths:

```typescript
const myModule: GatewazeModule = {
  // ...
  apiRoutes: (app: any, context?: ModuleContext) => {
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

The `ModuleContext` provides:

```typescript
interface ModuleContext {
  projectRoot: string;  // Absolute path to the Gatewaze project root
  moduleDir: string;    // Absolute path to this module's directory on disk
}
```
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

## Module Types and Visibility

Modules can declare a `type` and `visibility` to control how they appear in the admin UI:

### Types

| Type | Description |
|------|-------------|
| `feature` | Adds new functionality to the platform (default) |
| `integration` | Connects to an external service (e.g., Stripe, Slack) |
| `theme` | Overrides platform styling. Only one theme module can be active at a time |

### Visibility

| Visibility | Description |
|------------|-------------|
| `public` | Shown on the Modules page and available for all users to enable (default) |
| `hidden` | Not shown in the UI but can be auto-included as a dependency of another module |
| `premium` | Shown in the UI but requires a license or payment to enable |

```typescript
const myModule: GatewazeModule = {
  id: 'slack-integration',
  name: 'Slack Integration',
  type: 'integration',
  visibility: 'public',
  group: 'integrations',
  // ...
};
```

---

## Dependencies

Modules can declare dependencies on other modules. Dependencies are automatically resolved in topological order — dependent modules are installed and migrated first.

```typescript
const eventSpeakersModule: GatewazeModule = {
  id: 'event-speakers',
  name: 'Event Speakers',
  dependencies: ['events', 'event-sponsors'],
  // ...
};
```

When a module is enabled:
- All of its dependencies are automatically enabled first (even if they are `hidden`)
- Migrations are applied in dependency order
- Circular dependencies are detected and rejected

When a module is disabled:
- Modules that depend on it are **not** automatically disabled — the admin is warned

---

## UI Slots

Slots allow modules to inject UI components into named extension points defined by the host application, without adding new routes.

### How slots work

1. The host application renders a `<ModuleSlot name="event-detail:tabs" />` component at the extension point
2. All enabled modules that registered components for that slot name have their components rendered (lazy-loaded, sorted by `order`)

### Registering a slot

```typescript
const myModule: GatewazeModule = {
  id: 'event-speakers',
  // ...
  adminSlots: [
    {
      slotName: 'event-detail:tabs',
      component: () => import('./admin/EventSpeakersTab'),
      order: 20,                          // Lower numbers render first (default: 100)
      requiredFeature: 'event-speakers',  // Only render when this feature is enabled
      meta: {                             // Lightweight metadata — available without loading the component
        tabId: 'speakers',
        label: 'Speakers',
        icon: 'MicrophoneIcon',
      },
    },
  ],
};
```

### SlotRegistration interface

```typescript
interface SlotRegistration {
  slotName: string;                           // Dot-delimited, e.g. 'event-detail:tabs'
  component: () => Promise<{ default: unknown }>;  // Lazy-loaded component
  order?: number;                             // Sort weight (default: 100)
  requiredFeature?: string;                   // Feature flag gate
  meta?: Record<string, unknown>;             // Metadata for the host (no component load needed)
}
```

The `meta` field is useful when the host needs information about the slot entry (like tab labels or icons) without lazy-loading the full component.

Slots work identically in both the admin app (`adminSlots`) and the public portal (`portalSlots`).

---

## Portal Routes and Navigation

Modules can add pages to the public portal (Next.js app) and register navigation entries in the portal header.

### Portal routes

```typescript
const myModule: GatewazeModule = {
  // ...
  portalRoutes: [
    {
      path: '/blog',
      component: () => import('./portal/BlogIndex'),
    },
    {
      path: '/blog/:slug',
      component: () => import('./portal/BlogPost'),
    },
  ],
};
```

### Portal navigation

The `portalNav` field adds an entry to the portal's header navigation. This value is persisted to the `installed_modules.portal_nav` column when the module is enabled:

```typescript
const myModule: GatewazeModule = {
  // ...
  portalNav: {
    label: 'Blog',
    path: '/blog',
    icon: 'FileText',   // Lucide icon name
    order: 50,           // Lower numbers appear first
  },
};
```

---

## Theme Modules

Modules with `type: 'theme'` can override the platform's visual styling for both the admin app and the public portal.

Only one theme module can be active at a time (enforced by a database constraint).

### Theme overrides

```typescript
const myTheme: GatewazeModule = {
  id: 'dark-corporate-theme',
  name: 'Dark Corporate',
  type: 'theme',
  version: '1.0.0',
  features: ['dark-corporate-theme'],

  themeOverrides: {
    admin: {
      themeMode: 'dark',
      primaryColor: 'blue',
      cardSkin: 'bordered',
      customCss: './theme.css',   // Bundled by Vite at build time
    },
    portal: {
      portalTheme: 'gradient_wave',
      themeColors: {
        gradient_wave: {
          primary: '#1e40af',
          secondary: '#7c3aed',
        },
      },
      cornerStyle: 'rounded',
      htmlClassName: 'dark-corporate',
    },
    // Settings UI shows these as read-only when the theme is active
    lockedSettings: ['primary_color', 'font_heading'],
  },
};
```

### Admin theme options

| Field | Type | Description |
|-------|------|-------------|
| `themeMode` | `'light' \| 'dark' \| 'system'` | Force a theme mode |
| `primaryColor` | `string` | Radix color name for the primary accent |
| `lightColor` | `string` | Force light color scheme |
| `darkColor` | `string` | Force dark color scheme |
| `cardSkin` | `'shadow' \| 'bordered'` | Card styling |
| `themeLayout` | `'main-layout' \| 'sideblock'` | Layout style |
| `customCss` | `string` | Path to a CSS file relative to the module directory |
| `radixThemeProps` | `Record<string, unknown>` | Additional Radix `<Theme>` props |

### Portal theme options

| Field | Type | Description |
|-------|------|-------------|
| `brandingDefaults` | `Record<string, string>` | Override platform_settings branding keys |
| `portalTheme` | `'blobs' \| 'gradient_wave' \| 'basic'` | Force a portal theme |
| `themeColors` | `Record<string, Record<string, string>>` | Override theme colors per portal theme type |
| `cornerStyle` | `'square' \| 'rounded' \| 'pill'` | Override corner style |
| `htmlClassName` | `string` | CSS class added to the portal `<html>` element |
| `customCssUrl` | `string` | URL to a custom CSS file |

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

## Managing Module Sources

Beyond the `moduleSources` in `gatewaze.config.ts`, module sources can be managed at runtime through the admin UI and API.

### API endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/modules/available` | List all modules found across all sources |
| `POST` | `/api/modules/reconcile` | Sync database state with config (apply migrations, run hooks) |
| `POST` | `/api/modules/select` | Batch enable/disable modules (used during onboarding) |
| `POST` | `/api/modules/:moduleId/enable` | Enable a specific module |
| `POST` | `/api/modules/:moduleId/disable` | Disable a specific module |
| `PUT` | `/api/modules/:moduleId/config` | Update module configuration |
| `GET` | `/api/modules/check-updates` | Compare installed vs available versions |
| `POST` | `/api/modules/:moduleId/update` | Update a module to a new version |
| `GET` | `/api/modules/sources` | List user-added module sources |
| `POST` | `/api/modules/sources` | Add a new module source (git URL or local path) |
| `DELETE` | `/api/modules/sources/:id` | Remove a user-added source |
| `POST` | `/api/modules/upload` | Upload a module as a .zip file |

### User-added sources

Admins can add module sources through the admin UI. These are stored in the `module_sources` database table and merged with the config-defined sources at load time:

```sql
-- module_sources table
id uuid PRIMARY KEY,
url text,              -- Git URL or local path
path text,             -- Subdirectory within the repo
branch text,           -- Git branch (default: main)
label text,            -- Display name
origin text,           -- 'config', 'user', or 'upload'
created_at timestamptz
```

### Uploading modules

Modules can be uploaded as `.zip` files via `POST /api/modules/upload`. Uploaded modules are extracted to `data/uploaded-modules/` and automatically added as a module source.

### Database tables

| Table | Purpose |
|-------|---------|
| `installed_modules` | Tracks each module's status, version, features, config, and portal nav |
| `module_migrations` | Tracks applied SQL migrations (filename + SHA256 checksum) to prevent re-execution |
| `module_sources` | Stores user-added module sources (git repos, uploaded modules) |

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
| `packages/api/src/routes/modules.ts` | Module management API endpoints (`/api/modules/*`) |
| `packages/shared/src/modules/deploy-edge-functions.ts` | Edge function deployment logic |
| `scripts/modules/run-migrations.ts` | CLI migration runner (`pnpm modules:migrate`) |
| `scripts/modules/deploy-functions.ts` | Edge function deployment (`pnpm modules:deploy-functions`) |
