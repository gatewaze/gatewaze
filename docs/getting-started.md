# Getting Started

This guide walks you through setting up Gatewaze from scratch and creating your first event.

---

## Prerequisites

Before you begin, make sure you have the following installed:

| Tool             | Minimum Version | Installation                                                |
|------------------|-----------------|-------------------------------------------------------------|
| Docker           | 24.0.0          | [docker.com](https://www.docker.com/products/docker-desktop)|
| Docker Compose   | 2.20.0          | Included with Docker Desktop                                |

For development from source, you also need:

| Tool             | Minimum Version | Installation                                                |
|------------------|-----------------|-------------------------------------------------------------|
| Node.js          | 20.0.0          | [nodejs.org](https://nodejs.org/)                           |
| pnpm             | 9.0.0           | [pnpm.io](https://pnpm.io/installation)                    |

Verify your installations:

```bash
docker --version          # 24.x.x or higher
docker compose version    # v2.20.x or higher
# For source development:
node --version            # v20.x.x or higher
pnpm --version            # 9.x.x or higher
```

---

## Option A: Docker Compose (Recommended)

The full stack starts with a single command. Database migrations are applied automatically on first startup -- no manual migration step needed.

### 1. Clone and configure

```bash
git clone https://github.com/gatewaze/gatewaze.git
cd gatewaze

# Copy the Docker environment file
cp docker/.env.example docker/.env
```

Open `docker/.env` in your editor and set the required values:

- **`JWT_SECRET`** -- A secret string of at least 32 characters for signing JWTs. Generate with: `openssl rand -base64 32`
- **`ANON_KEY`** and **`SERVICE_ROLE_KEY`** -- Supabase API keys. For self-hosted, generate these from your `JWT_SECRET` using the [Supabase key generator](https://supabase.com/docs/guides/self-hosting#api-keys). The demo keys in `.env.example` work for local development.
- **`POSTGRES_PASSWORD`** -- A strong password for the PostgreSQL database.

### 2. Start everything

```bash
cd docker
docker compose up -d
```

First startup takes approximately 2 minutes. The database container runs all Supabase init-scripts and Gatewaze migrations automatically. Wait for all containers to report healthy:

```bash
docker compose ps
```

You should see all services with status `Up` or `Up (healthy)`.

### 3. Access the services

Services are accessible via Traefik `.localhost` domains (resolve to 127.0.0.1 automatically per RFC 6761) and via direct ports:

| Service          | Traefik URL                         | Direct Port               |
|------------------|-------------------------------------|---------------------------|
| Admin App        | http://gatewaze-admin.localhost     | http://localhost:5274      |
| Public Portal    | http://gatewaze-app.localhost       | http://localhost:3100      |
| API Server       | http://gatewaze-api.localhost       | http://localhost:3002      |
| Supabase API     | http://gatewaze-supabase.localhost  | http://localhost:54321     |
| Supabase Studio  | http://gatewaze-studio.localhost    | http://localhost:54323     |
| PostgreSQL       | --                                  | localhost:54322            |
| Traefik Dashboard| --                                  | http://localhost:8080      |

### Troubleshooting startup

If services fail to start, check their logs:

```bash
docker compose logs supabase-db    # Database init logs
docker compose logs supabase-auth  # Auth service logs
docker compose logs admin          # Admin app logs
```

**Common issues:**

- **Database not ready yet** -- The database takes up to 2 minutes to initialize on first run. Dependent services (auth, storage, rest) will restart automatically until the database is healthy.
- **Port conflicts** -- If ports 80, 5274, 3100, or 3002 are in use, change them in `docker/.env` (e.g., `ADMIN_PORT=5275`).
- **Volume data from previous runs** -- If you need a clean start, stop everything and remove volumes: `docker compose down -v`, then `docker compose up -d`.

---

## Option B: Pre-Built Images (Quickstart)

Skip the build step entirely by using pre-built Docker images:

```bash
git clone https://github.com/gatewaze/gatewaze.git
cd gatewaze
cp docker/.env.example docker/.env
# Edit docker/.env with your values

cd docker
docker compose -f docker-compose.quickstart.yml up -d
```

Same access URLs as Option A above.

---

## Option C: Development from Source

For contributing or when you want hot-reload during development.

### 1. Clone and install

```bash
git clone https://github.com/gatewaze/gatewaze.git
cd gatewaze
pnpm install
```

### 2. Start infrastructure

Start the Supabase stack and Redis via Docker:

```bash
cd docker
docker compose up -d
cd ..
```

Wait for the database to report healthy:

```bash
docker compose -f docker/docker-compose.yml ps supabase-db
```

### 3. Start development servers

```bash
pnpm dev
```

This starts all three application services with hot-reload:

| Service         | URL                        | Description               |
|-----------------|----------------------------|---------------------------|
| Admin App       | http://localhost:5173       | React + Vite admin UI     |
| Public Portal   | http://localhost:3000       | Next.js public site       |
| API Server      | http://localhost:4000       | Express API backend       |
| Supabase Studio | http://localhost:54323      | Database management UI    |

You can also start individual services:

```bash
pnpm dev:admin    # Admin app only
pnpm dev:portal   # Public portal only
pnpm dev:api      # API server only
```

---

## First Login

### 1. Navigate to the admin app

Open the admin application in your browser:

- **Docker:** http://gatewaze-admin.localhost or http://localhost:5274
- **From source:** http://localhost:5173

### 2. Sign in with the default admin account

Gatewaze uses magic link authentication by default. On first launch, a default admin account is created:

- **Email:** `admin@example.com`

Enter this email on the login page and click "Send Magic Link."

### 3. Retrieve the magic link

When running locally with the default Supabase configuration, emails are captured by Supabase's built-in email testing tool:

1. Open Supabase Studio at http://gatewaze-studio.localhost or http://localhost:54323
2. Navigate to **Authentication** in the sidebar
3. Find the magic link in the email logs
4. Click the magic link to complete sign-in

You will be redirected to the admin dashboard.

---

## Using Supabase Cloud Instead

If you prefer to use [Supabase Cloud](https://supabase.com) rather than self-hosting, you can skip the Docker Compose step for Supabase and point Gatewaze at your cloud project.

### 1. Create a Supabase project

Sign up at [supabase.com](https://supabase.com) and create a new project. Note the following values from your project settings:

- **Project URL** (e.g., `https://xyzcompany.supabase.co`)
- **Anon (public) key**
- **Service role key**

### 2. Run migrations against your cloud database

Use the Supabase CLI to push migrations to your cloud project:

```bash
# Link your local project to the cloud project
npx supabase link --project-ref <your-project-ref>

# Push migrations
npx supabase db push
```

### 3. Update your .env file

Set the following variables in `docker/.env`:

```bash
SUPABASE_URL=https://xyzcompany.supabase.co
ANON_KEY=eyJhbGci...your-anon-key
SERVICE_ROLE_KEY=eyJhbGci...your-service-role-key
```

### 4. Start only the application services

```bash
cd docker
docker compose -f docker-compose.cloud.yml up -d
```

---

## Creating Your First Event

Once you are signed in to the admin app, follow these steps to create your first event:

### 1. Navigate to Events

Click **Events** in the sidebar navigation to open the events management page.

### 2. Create a new event

Click the **Create Event** button in the top-right corner. Fill in the event details:

- **Title** -- Give your event a descriptive name.
- **Description** -- Add a rich-text description of the event.
- **Start Date / End Date** -- Set the event schedule. Select the appropriate timezone.
- **Location** -- Enter a venue name and address, or mark the event as virtual and provide a meeting URL.
- **Status** -- Leave as "Draft" while you are setting up. Change to "Published" when ready to go live.

### 3. Add optional details

After creating the event, you can enhance it with additional information:

- **Speakers** -- Assign speakers from your speaker directory or create new speaker profiles.
- **Categories and Tags** -- Organize events with categories and tags for filtering.
- **Registration** -- Configure registration settings including capacity limits and approval workflows.
- **Images** -- Upload an event banner image and logo.

### 4. Publish the event

When you are satisfied with the event details:

1. Change the **Status** to "Published."
2. Click **Save.**

The event is now live on the public portal. Navigate to the portal URL to see it.

### 5. Add the event to a calendar

To include the event in a public calendar:

1. Go to **Calendars** in the sidebar.
2. Select an existing calendar or create a new one.
3. Add your event to the calendar.

Calendar pages are accessible on the public portal at `/calendars/<slug>`.

---

## Next Steps

Now that you have Gatewaze running and your first event created, explore these guides:

- **[Configuration](./configuration.md)** -- Full reference for all configuration options and environment variables.
- **[Deployment](./deployment.md)** -- Deploy Gatewaze to production with Docker Compose, Kubernetes, or Helm.
- **[Modules](./modules.md)** -- Extend Gatewaze with paid modules or build your own.
- **[Authentication](./auth.md)** -- Configure Supabase Auth, OIDC providers, and the permissions system.
- **[Development](./development.md)** -- Set up a development environment and learn the codebase patterns.
- **[Architecture](./architecture.md)** -- Understand how the system is designed and how data flows through it.
