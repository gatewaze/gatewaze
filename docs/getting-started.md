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

make init
```

`make init` copies `docker/.env.example` to `docker/.env`. The defaults work as
they are on a laptop, so you can go straight to step 2 if you only want to look
around.

Before you put this anywhere other people can reach, change these:

- `JWT_SECRET`, at least 32 characters. Generate one with `openssl rand -base64 32`.
- `ANON_KEY` and `SERVICE_ROLE_KEY`. The values in `.env.example` are Supabase's
  published demo keys, which everyone has. Generate your own from your
  `JWT_SECRET` with the
  [Supabase key generator](https://supabase.com/docs/guides/self-hosting#api-keys).
- `POSTGRES_PASSWORD`.

### 2. Start everything

```bash
make up
```

`make up` starts the shared Traefik proxy, builds the application images, and
brings up the stack with hot reload. The first run takes several minutes,
because it builds the images and the database container applies every migration
as it starts.

```bash
make ps
```

Wait for the services to report `Up` or `Up (healthy)`.

**What you are starting.** There are no compose profiles, so this brings up
around 23 containers: the Gatewaze services, a complete self-hosted Supabase,
Redis, and the supporting services. Give Docker about 8 GB of memory. On a
smaller machine, start it once and then stop the services you do not need.

**If you run more than one Docker VM.** By default every docker call uses
whichever context your Docker CLI already targets, which is what you want on a
normal machine. If you have several and Gatewaze belongs to a specific one, pin
it, either for one command or for good:

```bash
DOCKER_CONTEXT=desktop-linux make up            # one-off
echo 'DOCKER_CONTEXT=desktop-linux' >> docker/.env   # persistent
```

Run `docker context ls` to see what you have.

### 3. Access the services

Services are accessible via Traefik `.localhost` domains (resolve to 127.0.0.1 automatically per RFC 6761) and via direct ports:

| Service          | Traefik URL                         | Direct Port               |
|------------------|-------------------------------------|---------------------------|
| Admin App        | http://admin.gatewaze.localhost     | http://localhost:5274      |
| Public Portal    | http://app.gatewaze.localhost       | http://localhost:3100      |
| API Server       | http://api.gatewaze.localhost       | http://localhost:3002      |
| Supabase API     | http://supabase.gatewaze.localhost  | http://localhost:54321     |
| Supabase Studio  | http://studio.gatewaze.localhost    | http://localhost:54323     |
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

- **The database is not ready yet.** It takes up to two minutes to initialise on
  the first run. Auth, storage, and rest restart on their own until it is
  healthy.
- **Ports are already in use.** If something else is on 80, 5274, 3100, or 3002,
  change them in `docker/.env`, e.g. `ADMIN_PORT=5275`.
- **The stack came up on the wrong Docker VM.** If you run more than one
  context, set `DOCKER_CONTEXT` in `docker/.env` to the one Gatewaze belongs to.
  Run `docker context ls` to see them.
- **`arcade-serve` restarts over and over.** It requires
  `ARCADE_PREVIEW_HMAC_SECRET`, which is not in `.env.example`, so it refuses to
  start on a fresh install. Nothing else depends on it. Either ignore it, stop
  it with `docker compose stop arcade-serve`, or set the variable in
  `docker/.env` to any value from `openssl rand -hex 32`.
- **Two empty directories appeared next to your clone.** The development compose
  file bind-mounts sibling module checkouts, and Docker creates the directories
  if they are missing. `gatewaze-modules` and `lf-gatewaze-modules` next to your
  clone are harmless and safe to delete.
- **You want a clean start.** `make reset` stops everything, removes the volumes,
  clears the cached modules, and starts again.

---

## Option B: Pre-Built Images (Quickstart)

Skip the build step entirely by using pre-built Docker images:

```bash
git clone https://github.com/gatewaze/gatewaze.git
cd gatewaze
make init
# edit docker/.env if you want to change anything

docker compose -f docker/docker-compose.quickstart.yml up -d
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

Start Supabase and Redis in Docker, and leave the application services to run
on your machine:

```bash
make init

cd docker
docker compose up -d supabase-db supabase-auth supabase-rest supabase-kong \
  supabase-storage supabase-realtime supabase-edge-functions \
  supabase-meta supabase-studio redis
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

This starts the application services with hot reload:

| Service | URL | What it is |
|---|---|---|
| Admin app | http://localhost:5173 | React and Vite |
| Public portal | http://localhost:3100 | Next.js |
| API server | http://localhost:3002 | Express |
| Supabase Studio | http://localhost:54323 | Database management |

You can also start them one at a time:

```bash
pnpm dev:admin    # admin only
pnpm dev:portal   # portal only
pnpm dev:api      # API only
```

One thing to know about this mode. The API imports `gatewaze.config.js`, a
compiled copy of `gatewaze.config.ts` that is checked into the repository and
can lag behind the TypeScript file. The Docker images regenerate it during the
build, so Docker always reads the current config. If you change
`gatewaze.config.ts` and run from source, expect the API to keep using the old
module sources until that file is regenerated.

---

## First run: setting up your instance

There is no default administrator account. The first time you open the admin,
Gatewaze notices that no administrator exists and walks you through a setup
wizard.

### 1. Open the admin

- Docker: http://admin.gatewaze.localhost or http://localhost:5274
- From source: http://localhost:5173

### 2. Name your platform

The wizard asks for a name. It is shown in the sidebar and the browser title,
and you can change it later in settings. Behind the scenes this creates a
temporary setup account so that the rest of the wizard has something to run as.

### 3. Create your administrator account

Enter your name and your email address. This creates your real administrator
account as a super admin, adds you to the People list, and deletes the
temporary setup account.

What happens next depends on whether email is configured.

- **Email is configured.** A sign-in link is emailed to the address you gave.
  Open it to sign in.
- **Email is not configured.** The wizard tells you so and signs you in
  directly. This is fine on a laptop. It is not fine on a machine other people
  can reach, so configure email first if this instance is going to be public.

### 4. Choose your modules

Modules are how you decide what your Gatewaze does. The wizard lists everything
it found in the module sources, which by default is the 86 open-source modules
in
[gatewaze-modules](https://github.com/gatewaze/gatewaze-modules). Pick the ones
you want.

You are not locked in. Every module can be turned on and off later from the
Modules page in the admin, and turning one off preserves its data.

### 5. Configure the modules you picked

Some modules need a value before they work, e.g. an API key. The wizard asks
for those now, and you can fill them in later instead.

### 6. Pick a theme

Choose how the admin and the public portal look. This is also changeable later.

---

### If email is not set up yet

You can still sign in. The self-hosted Supabase stack captures outgoing email
rather than sending it.

1. Open Supabase Studio at http://studio.gatewaze.localhost or
   http://localhost:54323
2. Go to **Authentication** and find the sign-in link in the email log
3. Open the link

### How the setup wizard is protected

The wizard runs through two Supabase edge functions that have to work before
any account exists, so they run without authentication. Both refuse to do
anything once an administrator exists, which closes the window as soon as you
finish step 3. If you deploy an older build, complete the wizard before you
point a public hostname at the instance.

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

Set `SUPABASE_MODE=cloud` in `docker/.env`, along with
`SUPABASE_PROJECT_REF`. Then `make up` selects the cloud compose file for you
and leaves the Supabase containers out.

```bash
make up
make deploy-functions   # deploys edge functions and syncs their secrets
```

Deploy the edge functions before you use the instance. Gatewaze edge functions
authenticate internally, and several serve anonymous public forms, so
`make deploy-functions` passes `--no-verify-jwt`. Without that flag Supabase
defaults them to rejecting anonymous callers and the public forms stop
working.

---

## Creating Your First Event

This assumes you turned on the `events` module during setup. If you did not,
open the Modules page in the admin and enable it now. Events is the module most
of the other event modules build on, e.g. calendars, speakers, and sponsors.

Once you are signed in to the admin app, follow these steps to create your
first event:

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
- **[Deployment](./deployment.md)** -- Deploy Gatewaze to production with Docker Compose.
- **[Kubernetes](./kubernetes.md)** -- Install on a cluster with the Helm chart, with example values files and resource sizing.
- **[Modules](./modules.md)** -- Extend Gatewaze with paid modules or build your own.
- **[Authentication](./auth.md)** -- Configure Supabase Auth, OIDC providers, and the permissions system.
- **[Development](./development.md)** -- Set up a development environment and learn the codebase patterns.
- **[Architecture](./architecture.md)** -- Understand how the system is designed and how data flows through it.
