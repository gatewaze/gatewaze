# Development Guide

This guide covers setting up a development environment, understanding the codebase structure, and following the patterns used throughout Gatewaze.

---

## Table of Contents

- [Project Structure](#project-structure)
- [Local Development Setup](#local-development-setup)
- [Running Individual Packages](#running-individual-packages)
- [Working with Supabase Locally](#working-with-supabase-locally)
- [Adding a New Page to the Admin App](#adding-a-new-page-to-the-admin-app)
- [Adding a New API Endpoint](#adding-a-new-api-endpoint)
- [Adding a New Edge Function](#adding-a-new-edge-function)
- [Testing](#testing)
- [Code Style and Conventions](#code-style-and-conventions)
- [Common Patterns](#common-patterns)

---

## Project Structure

Gatewaze is a monorepo managed by pnpm workspaces. All application code lives under `packages/`.

```
gatewaze/
  packages/
    admin/              # React + Vite admin application
      src/
        app/            # Page components and route layouts
        components/     # Reusable UI components (Radix Themes based)
        config/         # App configuration and constants
        hooks/          # Custom React hooks
        lib/            # Utility functions and Supabase client
        middleware/     # Route guards and auth middleware
        App.tsx         # Root component with router
        main.tsx        # Entry point
      index.html
      vite.config.ts
      tailwind.config.ts

    portal/             # Next.js public event portal
      app/              # Next.js App Router pages
      src/              # Source code (components, lib, etc.)
      next.config.ts
      tailwind.config.ts

    api/                # Express API server
      src/
        routes/         # Express route handlers
        lib/            # Shared utilities, Supabase client, email
        workers/        # BullMQ job worker definitions
        scheduler/      # Cron-based job schedulers
        server.ts       # Express app entry point

    shared/             # Shared types, utilities, and constants
      src/
        types/          # TypeScript type definitions
        index.ts        # Package entry point

  supabase/
    config.toml         # Supabase CLI configuration
    functions/          # Supabase Edge Functions (Deno)
    migrations/         # SQL migration files

  docker/
    admin/              # Admin app Dockerfile and nginx config
    portal/             # Portal Dockerfile
    api/                # API server Dockerfile
    worker/             # Worker Dockerfile
    docker-compose.yml  # Full-stack Docker Compose

  helm/
    gatewaze/           # Helm chart for Kubernetes deployment
      templates/        # Kubernetes manifest templates

  gatewaze.config.ts    # Application configuration
  pnpm-workspace.yaml   # Workspace definition
  package.json          # Root package with workspace scripts
  tsconfig.json         # Root TypeScript configuration
```

### Package Responsibilities

| Package          | Technology       | Purpose                                                        |
|------------------|------------------|----------------------------------------------------------------|
| `@gatewaze/admin`  | React + Vite     | Admin dashboard for managing events, speakers, members, calendars, registrations, and settings |
| `@gatewaze/portal` | Next.js 15       | Public-facing site for browsing events, viewing calendars, and registering |
| `@gatewaze/api`    | Express          | Backend API server handling business logic, email, file uploads, and job scheduling |
| `@gatewaze/shared` | TypeScript       | Shared type definitions, constants, and utilities used across all packages |

---

## Local Development Setup

### Prerequisites

- Node.js >= 20
- pnpm >= 9
- Docker and Docker Compose
- Git

### Step-by-step setup

```bash
# Clone the repository
git clone https://github.com/gatewaze/gatewaze.git
cd gatewaze

# Install all dependencies
pnpm install

# Copy environment configuration
cp .env.example .env

# Start infrastructure (Supabase + Redis)
docker compose up -d

# Wait for services to be healthy
docker compose ps

# Run database migrations
pnpm db:migrate

# Start all development servers
pnpm dev
```

### Development URLs

When running via `pnpm dev` (without Docker), services use their native ports:

| Service         | URL                       |
|-----------------|---------------------------|
| Admin App       | http://localhost:5173      |
| Public Portal   | http://localhost:3000      |
| API Server      | http://localhost:4000      |
| Inbucket (Email)| http://localhost:54324     |

When running via Docker Compose (with Traefik), services are available at `.localhost` domains:

| Service          | URL                                  |
|------------------|--------------------------------------|
| Admin App        | http://gatewaze-admin.localhost      |
| Public Portal    | http://gatewaze-app.localhost        |
| API Server       | http://gatewaze-api.localhost        |
| Supabase API     | http://gatewaze-supabase.localhost   |
| Supabase Studio  | http://gatewaze-studio.localhost     |
| Traefik Dashboard| http://localhost:8080                |

`.localhost` domains resolve automatically per RFC 6761 -- no `/etc/hosts` edits are required.

---

## Running Individual Packages

You do not always need to run the entire stack. Use filtered commands to start individual packages:

```bash
# Admin app only (React + Vite)
pnpm dev:admin

# Public portal only (Next.js)
pnpm dev:portal

# API server only (Express)
pnpm dev:api
```

### Building individual packages

```bash
pnpm build:admin    # Build admin app
pnpm build:portal   # Build portal
pnpm build:api      # Build API server
```

### Linting and type checking

```bash
# All packages
pnpm lint
pnpm typecheck

# Specific package
pnpm --filter @gatewaze/admin lint
pnpm --filter @gatewaze/api typecheck
```

---

## Working with Supabase Locally

### Supabase CLI

Install the Supabase CLI for managing migrations, edge functions, and local development:

```bash
# Install via npm
npm install -g supabase

# Or via Homebrew (macOS)
brew install supabase/tap/supabase
```

### Migrations

Database migrations live in `supabase/migrations/` as numbered SQL files:

```
supabase/migrations/
  00001_initial_schema.sql
  00002_auth_and_admin.sql
  00003_events.sql
  00004_speakers.sql
  00005_categories_topics_tags.sql
  00006_calendars.sql
  00007_members.sql
  00008_registrations.sql
  00009_email.sql
  00010_storage.sql
  00011_permissions.sql
```

#### Creating a new migration

```bash
# Create a new migration file
supabase migration new my_migration_name
```

This creates a new file like `supabase/migrations/00012_my_migration_name.sql`. Write your SQL in this file.

#### Applying migrations locally

Migrations are applied automatically when the Docker Compose stack starts. To apply new migrations to a running database:

```bash
pnpm db:migrate
```

#### Pushing migrations to Supabase Cloud

```bash
# Link to your cloud project
supabase link --project-ref <your-project-ref>

# Push migrations
supabase db push
```

#### Diffing schema changes

To generate a migration from changes made in Supabase Studio:

```bash
supabase db diff --use-migra -f my_changes
```

### Edge Functions

Edge functions are Deno-based serverless functions that run inside the Supabase infrastructure. They live in `supabase/functions/`:

```
supabase/functions/
  _shared/                  # Shared code across functions
  batch-send-email/
  calendar/
  discover-calendars/
  event-registration/
  events/
  events-search/
  generate-download-token/
  process-single-image/
  profile-update/
  send-email/
  send-reminder-emails/
  sendgrid-webhook/
  speaker-submission/
  speaker-update/
  user-signup/
```

#### Creating a new edge function

```bash
supabase functions new my-function
```

This creates `supabase/functions/my-function/index.ts`.

#### Testing an edge function locally

Edge functions are served automatically when the Docker Compose stack is running. Call them through the Supabase API gateway:

```bash
curl -X POST http://gatewaze-supabase.localhost/functions/v1/my-function \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"key": "value"}'
```

#### Deploying edge functions to Supabase Cloud

```bash
supabase functions deploy my-function
```

---

## Adding a New Page to the Admin App

The admin app uses React Router for navigation. To add a new page:

### 1. Create the page component

Create a new file in `packages/admin/src/app/`:

```tsx
// packages/admin/src/app/my-new-page.tsx
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export default function MyNewPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      const { data, error } = await supabase
        .from('my_table')
        .select('*')
        .order('created_at', { ascending: false });

      if (!error) setData(data || []);
      setLoading(false);
    }
    fetchData();
  }, []);

  if (loading) return <div>Loading...</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">My New Page</h1>
      {/* Page content */}
    </div>
  );
}
```

### 2. Add the route

Register the route in the router configuration:

```tsx
// In the router configuration
{
  path: '/my-new-page',
  element: <MyNewPage />,
}
```

### 3. Add navigation

Add a sidebar navigation item so users can find the page:

```tsx
{
  path: '/my-new-page',
  label: 'My New Page',
  icon: <SomeIcon />,
}
```

---

## Adding a New API Endpoint

API routes are Express route handlers in `packages/api/src/routes/`.

### 1. Create the route handler

```typescript
// packages/api/src/routes/my-resource.ts
import { Router, Request, Response } from 'express';
import { supabase } from '../lib/supabase';

const router = Router();

// GET /api/my-resource
router.get('/', async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('my_table')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json({ data });
});

// GET /api/my-resource/:id
router.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  const { data, error } = await supabase
    .from('my_table')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    return res.status(404).json({ error: 'Not found' });
  }

  res.json({ data });
});

// POST /api/my-resource
router.post('/', async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('my_table')
    .insert(req.body)
    .select()
    .single();

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.status(201).json({ data });
});

export default router;
```

### 2. Register the route

Mount the router in the Express app:

```typescript
// In packages/api/src/server.ts
import myResourceRoutes from './routes/my-resource';

app.use('/api/my-resource', myResourceRoutes);
```

---

## Adding a New Edge Function

### 1. Create the function

```bash
# From the project root
supabase functions new my-function
```

### 2. Implement the handler

```typescript
// supabase/functions/my-function/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req) => {
  try {
    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Parse request body
    const body = await req.json();

    // Your logic here
    const { data, error } = await supabaseClient
      .from('events')
      .select('*')
      .limit(10);

    if (error) throw error;

    return new Response(
      JSON.stringify({ data }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
```

### 3. Use shared code

Place shared utilities in `supabase/functions/_shared/`:

```typescript
// supabase/functions/_shared/cors.ts
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
```

Import shared code in your function:

```typescript
import { corsHeaders } from '../_shared/cors.ts';
```

---

## Testing

### Running tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests for a specific package
pnpm --filter @gatewaze/admin test
pnpm --filter @gatewaze/portal test
pnpm --filter @gatewaze/api test

# Run end-to-end tests
pnpm test:e2e
```

### Writing tests

Tests are colocated with source files using the `.test.ts` or `.test.tsx` extension:

```
src/
  lib/
    format-date.ts
    format-date.test.ts
  components/
    EventCard.tsx
    EventCard.test.tsx
```

### Test file example

```typescript
// packages/api/src/lib/format-date.test.ts
import { describe, it, expect } from 'vitest';
import { formatEventDate } from './format-date';

describe('formatEventDate', () => {
  it('formats a date with timezone', () => {
    const date = new Date('2026-03-15T10:00:00Z');
    const result = formatEventDate(date, 'America/New_York');
    expect(result).toBe('March 15, 2026 at 6:00 AM EST');
  });

  it('handles null end dates', () => {
    const result = formatEventDate(new Date('2026-03-15T10:00:00Z'), 'UTC', null);
    expect(result).not.toContain('–');
  });
});
```

---

## Code Style and Conventions

### TypeScript

- All code is written in TypeScript. Avoid `any` types.
- Use interfaces for object shapes. Use type aliases for unions and intersections.
- Export types from dedicated `types.ts` files.
- Prefer `const` over `let`. Never use `var`.

### File naming

- **kebab-case** for files and directories: `event-list.tsx`, `use-auth.ts`
- **PascalCase** for React component files that export a single component: `EventCard.tsx`
- Tests are colocated: `event-list.test.ts`

### React

- Use functional components with hooks.
- Use Radix Themes as the foundation for all UI components.
- Keep components small and focused. Extract logic into custom hooks.

### Formatting

The project uses Prettier with the following configuration:

- Print width: 100
- Single quotes
- Trailing commas
- 2-space indentation

```bash
# Format all code
pnpm format

# Check formatting without fixing
pnpm format:check
```

### Linting

ESLint enforces code quality rules:

```bash
# Lint all packages
pnpm lint

# Fix auto-fixable issues
pnpm lint:fix
```

### Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(admin): add event duplication action
fix(portal): resolve calendar timezone offset issue
docs: update getting started guide
refactor(api): extract registration validation into middleware
```

---

## Common Patterns

### Data Fetching (Admin App)

The admin app fetches data directly from Supabase using the client library:

```typescript
import { supabase } from '@/lib/supabase';

// Simple query
const { data, error } = await supabase
  .from('events')
  .select('*')
  .order('start_date', { ascending: true });

// Query with joins through junction tables
const { data, error } = await supabase
  .from('calendar_events')
  .select('events!inner(id, title, start_date, status)')
  .eq('calendar_id', calendarId);

const events = data?.map(row => row.events);

// Filtered query with pagination
const { data, error, count } = await supabase
  .from('events')
  .select('*', { count: 'exact' })
  .eq('status', 'published')
  .order('start_date', { ascending: true })
  .range(offset, offset + limit - 1);
```

### Form Handling

Forms use React Hook Form with Zod validation:

```tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const eventSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  start_date: z.string().min(1, 'Start date is required'),
  end_date: z.string().optional(),
  status: z.enum(['draft', 'published', 'cancelled', 'completed']),
});

type EventFormValues = z.infer<typeof eventSchema>;

function EventForm({ defaultValues }: { defaultValues?: EventFormValues }) {
  const form = useForm<EventFormValues>({
    resolver: zodResolver(eventSchema),
    defaultValues: defaultValues || {
      title: '',
      status: 'draft',
    },
  });

  const onSubmit = async (values: EventFormValues) => {
    const { error } = await supabase
      .from('events')
      .upsert(values);

    if (error) {
      toast.error('Failed to save event');
    } else {
      toast.success('Event saved');
    }
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      {/* Form fields */}
    </form>
  );
}
```

### Table Components

Tables use TanStack Table for sorting, filtering, and pagination:

```tsx
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  ColumnDef,
} from '@tanstack/react-table';

const columns: ColumnDef<Event>[] = [
  {
    accessorKey: 'title',
    header: 'Title',
  },
  {
    accessorKey: 'start_date',
    header: 'Date',
    cell: ({ row }) => formatDate(row.getValue('start_date')),
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => <StatusBadge status={row.getValue('status')} />,
  },
];

function EventTable({ data }: { data: Event[] }) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  // Render table using Radix Themes Table components
}
```

### Supabase Client Initialization

The admin app initializes the Supabase client with environment variables:

```typescript
// packages/admin/src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);
```

The API server uses both the anon client and the admin client:

```typescript
// packages/api/src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js';

// Public client (respects RLS)
export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

// Admin client (bypasses RLS)
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
```

### Background Jobs

Jobs are enqueued from the API server and processed by the worker:

```typescript
// Enqueue a job (API server)
import { Queue } from 'bullmq';
import { redis } from '../lib/redis';

const emailQueue = new Queue('email', { connection: redis });

await emailQueue.add('send-registration-confirmation', {
  to: 'user@example.com',
  eventId: 'evt-123',
  templateId: 'registration-confirmation',
});

// Process the job (worker)
import { Worker } from 'bullmq';
import { redis } from '../lib/redis';

const emailWorker = new Worker('email', async (job) => {
  const { to, eventId, templateId } = job.data;
  // Send the email
}, { connection: redis, concurrency: 5 });
```
