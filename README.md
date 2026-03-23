# Gatewaze

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

**Open-source people management platform.**

Gatewaze is a modular platform for managing people, events, and communities. Out of the box it gives you member management, event scheduling, registrations, and a public portal — then you extend it with modules to fit your exact workflow. Whether you're running a developer community, a professional association, or a conference series, Gatewaze adapts to how you work.

---

## Features

- **People & Member Management** -- Manage profiles, organizations, membership tiers, and track engagement across your community.
- **Event Management** -- Create, edit, and organize events with rich metadata, speaker assignments, venue details, and scheduling.
- **Calendar Publishing** -- Publish curated event calendars that can be embedded or shared publicly.
- **Registration** -- Handle event registrations with configurable forms, approval workflows, and attendee tracking.
- **Public Portal** -- A fast, SEO-friendly public site for browsing events, viewing calendars, and registering.
- **Configurable Authentication** -- Supports Supabase Auth and OIDC providers for flexible identity management.
- **Email** -- Transactional and bulk email via SendGrid or any SMTP provider, with template management.
- **Module System** -- Extend the platform through self-contained modules that add UI, API routes, background jobs, and database migrations.

## Modules

Gatewaze's module system lets you pick the capabilities you need. Modules are selected during onboarding and can be enabled or disabled at any time. Example modules:

| Module | Description |
|--------|-------------|
| **Event Speakers** | Speaker submissions, confirmations, and profile management |
| **Event Sponsors** | Sponsor tiers, logos, and placement across events |
| **Event Agenda** | Session scheduling with tracks, rooms, and time slots |
| **Calendars** | Curated, embeddable event calendars |
| **Cohorts** | Group members into cohorts for programs or courses |
| **Competitions** | Run hackathons, pitch contests, and judging workflows |
| **Bulk Emailing** | Campaign-style email sends with template management |
| **Newsletters** | Newsletter creation and subscriber management |
| **Stripe Payments** | Paid registrations, memberships, and invoicing |
| **Slack Integration** | Post event updates and notifications to Slack channels |
| **Badge Scanning** | QR code check-in and badge scanning at events |
| **Blog** | Publish articles and news on your public portal |
| **Offers** | Discount codes and promotional offers for events |
| **Event Media** | Photo and video galleries, YouTube integration |
| **Compliance** | GDPR and data handling workflows |

Modules live in a separate [gatewaze-modules](https://github.com/gatewaze/gatewaze-modules) repository. You can also build your own — see [Module Development](./docs/modules.md).

## Tech Stack

| Layer          | Technology                          |
|----------------|-------------------------------------|
| Admin App      | React + Vite                        |
| Public Portal  | Next.js                             |
| API Server     | Express                             |
| Database       | PostgreSQL (via Supabase)           |
| Auth           | Supabase Auth / OIDC                |
| Storage        | Supabase Storage                    |
| Edge Functions | Supabase Edge Functions (Deno)      |
| Job Queue      | Redis + BullMQ                      |
| UI Components  | shadcn/ui + Tailwind CSS            |
| Package Manager| pnpm (monorepo workspaces)          |

## Architecture

```
                    +------------------+
                    |     Traefik      |
                    |  Reverse Proxy   |
                    +--------+---------+
                             |
              +--------------+--------------+
              |                             |
    +---------v---------+       +-----------v-----------+
    |   Public Portal   |       |      Admin App        |
    |   (Next.js)       |       |   (React + Vite)      |
    +---------+---------+       +-----------+-----------+
              |                             |
              +--------------+--------------+
                             |
                   +---------v---------+
                   |    API Server     |
                   |    (Express)      |
                   +---------+---------+
                             |
              +--------------+--------------+
              |              |              |
    +---------v---+   +------v------+  +----v--------+
    |  Supabase   |   |    Redis    |  |  Supabase   |
    | (PostgreSQL |   |  + BullMQ   |  |  Storage    |
    |  + Auth)    |   |  (Jobs)     |  |  (Files)    |
    +-------------+   +-------------+  +-------------+
```

## Quick Start

### Prerequisites

- [Docker](https://www.docker.com/) and Docker Compose (v2.20+)
- [GNU Make](https://www.gnu.org/software/make/) (pre-installed on macOS and most Linux distributions)

That's it for running with Docker. For development from source, you also need:
- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) >= 9

### Get Your First Environment Running

```bash
# Clone the repository
git clone https://github.com/gatewaze/gatewaze.git
cd gatewaze

# Create your environment config from the example
make init

# Start everything
make up
```

That's it. The first startup takes ~2 minutes while the database initializes. Check status with:

```bash
make ps
```

### Everyday Commands

| Command        | Description                                          |
|----------------|------------------------------------------------------|
| `make up`      | Start all services (dev mode with hot reload)        |
| `make down`    | Stop all services                                    |
| `make reset`   | Stop, remove all volumes, and restart fresh          |
| `make logs`    | Tail service logs (Ctrl-C to stop)                   |
| `make ps`      | Show running containers                              |
| `make help`    | Show all available commands                          |

### Multi-Brand Setup

If you manage multiple brands, place brand configs in a sibling `gatewaze-environments` repo:

```
parent-directory/
  gatewaze/               # This repo
  gatewaze-environments/  # Brand-specific .env files
    aaif.local.env
    mlops.local.env
```

Then pass the brand name before the command:

```bash
make aaif up        # Start the "aaif" brand
make aaif down      # Stop the "aaif" brand
make aaif reset     # Reset the "aaif" brand
make mlops up       # Start a different brand
```

### Access the Services

Services are accessible via Traefik `.localhost` domains (resolve automatically per RFC 6761) and via direct ports:

| Service          | Traefik URL                         | Direct Port               |
|------------------|-------------------------------------|---------------------------|
| Admin App        | http://gatewaze-admin.localhost     | http://localhost:5274      |
| Public Portal    | http://gatewaze-app.localhost       | http://localhost:3100      |
| API Server       | http://gatewaze-api.localhost       | http://localhost:3002      |
| Supabase API     | http://gatewaze-supabase.localhost  | http://localhost:54321     |
| Supabase Studio  | http://gatewaze-studio.localhost    | http://localhost:54323     |
| PostgreSQL       | --                                  | localhost:54322            |
| Traefik Dashboard| --                                  | http://localhost:8080      |

### First Login

1. Open the admin app at http://gatewaze-admin.localhost (or http://localhost:5274)
2. Enter the default admin email: `admin@example.com`
3. Click "Send Magic Link"
4. Open Supabase Studio at http://gatewaze-studio.localhost (or http://localhost:54323)
5. Navigate to **Authentication** to find the magic link in email logs
6. Click the magic link to complete sign-in

### Supabase Cloud

To use [Supabase Cloud](https://supabase.com) instead of self-hosted:

```bash
make init
# Edit docker/.env — set SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY to your cloud project values

cd docker
docker compose -f docker-compose.cloud.yml up -d
```

See [docs/deployment.md](./docs/deployment.md) for full deployment options including Kubernetes/Helm.

---

## Development from Source

For contributing or local development without Docker for the app services:

```bash
# Install dependencies
pnpm install

# Start infrastructure (Supabase + Redis) via Docker
cd docker
docker compose up -d supabase-db supabase-auth supabase-rest supabase-kong supabase-storage supabase-realtime supabase-edge-functions redis
cd ..

# Start all dev servers
pnpm dev
```

| Service         | URL                        |
|-----------------|----------------------------|
| Admin App       | http://localhost:5173       |
| Public Portal   | http://localhost:3000       |
| API Server      | http://localhost:4000       |

See [docs/development.md](./docs/development.md) for the full development setup guide.

---

## Project Structure

```
gatewaze/
  Makefile            # Development commands (make up, make down, etc.)
  packages/
    admin/            # React + Vite admin application
    portal/           # Next.js public event portal
    api/              # Express API server + BullMQ worker + scheduler
    shared/           # Shared types, utilities, and constants
  supabase/
    migrations/       # Database migrations (auto-applied on first startup)
    functions/        # Supabase Edge Functions (Deno)
  docker/
    docker-compose.yml            # Full stack (self-hosted Supabase)
    docker-compose.cloud.yml      # App services only (Supabase Cloud)
    docker-compose.quickstart.yml # Pre-built images (no build step)
    .env.example                  # Docker environment configuration
  helm/               # Kubernetes Helm chart
  docs/               # Project documentation
```

## Documentation

Detailed documentation is available in the [`docs/`](./docs) directory:

- [Getting Started](./docs/getting-started.md)
- [Architecture Overview](./docs/architecture.md)
- [Configuration Guide](./docs/configuration.md)
- [Deployment Guide](./docs/deployment.md)
- [Module Development](./docs/modules.md)
- [Authentication](./docs/auth.md)
- [Development](./docs/development.md)

## Contributing

We welcome contributions from the community! Please read our [Contributing Guide](./CONTRIBUTING.md) before getting started.

Key points:

- You must sign the [Contributor License Agreement](./CLA.md) before your first PR is merged.
- Follow [Conventional Commits](https://www.conventionalcommits.org/) for commit messages.
- All code must be written in TypeScript and pass linting, type checking, and tests.

## License

Gatewaze is licensed under the [Apache License 2.0](./LICENSE).

```
Copyright 2026 Gatewaze Contributors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

See [NOTICE](./NOTICE) for third-party attributions and [TRADEMARK.md](./TRADEMARK.md) for trademark usage policy.

## Built With

Gatewaze is made possible by these outstanding open-source projects:

- [Supabase](https://supabase.com) -- The open-source Firebase alternative powering our database, auth, storage, and edge functions.
- [React](https://react.dev) -- The library behind the admin interface.
- [Next.js](https://nextjs.org) -- The framework powering the public event portal.
- [Vite](https://vitejs.dev) -- Fast build tooling for the admin app.
- [Express](https://expressjs.com) -- The API server framework.
- [BullMQ](https://bullmq.io) -- Reliable job queue for background processing.
- [shadcn/ui](https://ui.shadcn.com) -- Beautiful, accessible UI components.
- [Tailwind CSS](https://tailwindcss.com) -- Utility-first CSS framework.
