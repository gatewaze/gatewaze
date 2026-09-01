# Deployment

This guide covers deploying Gatewaze in various environments, from local Docker Compose setups to production Kubernetes clusters.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Docker Compose -- Development](#docker-compose--development)
- [Docker Compose -- Production](#docker-compose--production)
- [Docker Compose with Supabase Cloud](#docker-compose-with-supabase-cloud)
- [Pre-Built Docker Images](#pre-built-docker-images)
- [Kubernetes with Helm](#kubernetes-with-helm)

---

## Architecture Overview

The full local stack is drawn in
[Architecture](./architecture.md#the-full-stack), which also explains what each
service is for. This is the summary.

`docker compose up` starts every service in the table below. There are no
compose profiles, so a fresh `make up` brings up around 23 containers and wants
roughly 8 GB of memory available to Docker. If your machine is smaller than
that, stop the services you do not need after the first start.

**Application services:**

| Service | Image or build | Where you reach it | What it is |
|---|---|---|---|
| Traefik | `traefik:v3` | Dashboard on http://localhost:8080 | Reverse proxy that routes the `.localhost` names. Shared across brands. |
| admin | `docker/admin/Dockerfile` | http://admin.gatewaze.localhost | The administrator interface, React built with Vite and served by NGINX. |
| portal | `docker/portal/Dockerfile` | http://app.gatewaze.localhost | The public website, Next.js rendered on the server. |
| api | `docker/api/Dockerfile` | http://api.gatewaze.localhost | The Express API server. Holds the service role key. |
| worker | `docker/worker/Dockerfile` | no port | Runs background jobs from the Redis queue. Carries Chromium for the scrapers. |
| scheduler | `docker/scheduler/Dockerfile` | no port | Puts jobs on the queue on a schedule. Runs no work itself. |
| se-runner | `docker/se-runner/Dockerfile` | no port | A leaner worker that runs only the software-engineer module's queue. |
| redis | `redis:7-alpine` | 6379 internally | Backs the BullMQ job queue. |

**Supporting services:**

| Service | Image or build | Where you reach it | What it is |
|---|---|---|---|
| scrapling-fetcher | `packages/../scrapling-fetcher` | http://fetch.gatewaze.localhost | Python fetching service the scrapers call. Manages a browser pool and optional residential proxies. |
| mcp-public | `packages/mcp` | routed at `MCP_HOST` | Public, keyless MCP endpoint with read-only tools, for AI agents. |
| events-mcp | `packages/events-mcp` | internal only | MCP service for the `events_*` tools, including Luma writeback. |
| browser-mcp | `packages/browser-mcp` | internal only | MCP service that gives agents a headless browser. |
| arcade-serve | `packages/arcade-serve` | `ARCADE_SERVE_PORT`, 8090 | Serves creator-built games from storage snapshots. |
| umami | `umamisoftware/umami:3.1.0` | via the analytics module | Self-hosted web analytics. |
| autoheal | `willfarrell/autoheal:1.2.0` | no port | Restarts any container that reports itself unhealthy. |

**Supabase, when self-hosted:**

| Service | Image | Where you reach it |
|---|---|---|
| supabase-kong | `kong:2.8.1` | http://supabase.gatewaze.localhost |
| supabase-db | `supabase/postgres` | localhost:54322 |
| supabase-auth | `supabase/gotrue` | through Kong |
| supabase-rest | `postgrest/postgrest` | through Kong |
| supabase-storage | `supabase/storage-api` | through Kong |
| supabase-realtime | `supabase/realtime` | through Kong |
| supabase-edge-functions | `supabase/edge-runtime` | through Kong |
| supabase-meta | `supabase/postgres-meta` | internal only |
| supabase-studio | `supabase/studio` | http://studio.gatewaze.localhost |

---

## Docker Compose -- Development

The default `docker/docker-compose.yml` is designed for development and includes the full self-hosted Supabase stack. Traefik (Apache 2.0 licensed) is included as the reverse proxy, routing `.localhost` subdomains to each service automatically. No changes to `/etc/hosts` are needed -- `.localhost` domains resolve per RFC 6761.

### Prerequisites

- Docker and Docker Compose installed
- `docker/.env` configured. Run `make init` to create it from
  `docker/.env.example`.

### Starting the stack

```bash
make up
```

`make up` starts the shared Traefik proxy, picks the right compose files for
your `SUPABASE_MODE`, and adds the development overrides that give you hot
reload. To drive compose directly instead:

```bash
cd docker
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

This builds all application services from source and starts the full infrastructure. On first run, database migrations are applied automatically.

### Viewing logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f api
docker compose logs -f worker
```

### Stopping the stack

```bash
docker compose down
```

To also remove volumes (database data, Redis data, uploaded files):

```bash
docker compose down -v
```

### Rebuilding after code changes

```bash
docker compose up -d --build
```

---

## Docker Compose -- Production

For production deployments with Docker Compose, you should harden the configuration with TLS, resource limits, and proper secrets management.

### Production docker-compose.override.yml

Create a `docker-compose.override.yml` alongside your `docker-compose.yml`:

```yaml
services:
  admin:
    restart: always
    deploy:
      resources:
        limits:
          cpus: "0.5"
          memory: 256M

  portal:
    restart: always
    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 512M
    environment:
      NODE_ENV: production

  api:
    restart: always
    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 512M
      replicas: 2

  worker:
    restart: always
    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 512M
      replicas: 2

  scheduler:
    restart: always
    deploy:
      resources:
        limits:
          cpus: "0.25"
          memory: 128M

  redis:
    restart: always
    deploy:
      resources:
        limits:
          cpus: "0.5"
          memory: 256M
```

### TLS Termination

Traefik (already included in the Docker Compose stack) handles TLS termination in production. Configure Traefik with a Let's Encrypt certificate resolver for automatic TLS certificate management.

**Traefik example (traefik.yml) for production:**

```yaml
entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
  websecure:
    address: ":443"

certificatesResolvers:
  letsencrypt:
    acme:
      email: admin@yourdomain.com
      storage: /letsencrypt/acme.json
      httpChallenge:
        entryPoint: web
```

Then label each service in `docker-compose.override.yml`:

```yaml
services:
  admin:
    labels:
      - "traefik.http.routers.admin.rule=Host(`admin.yourdomain.com`)"
      - "traefik.http.routers.admin.tls.certresolver=letsencrypt"

  portal:
    labels:
      - "traefik.http.routers.portal.rule=Host(`events.yourdomain.com`)"
      - "traefik.http.routers.portal.tls.certresolver=letsencrypt"

  api:
    labels:
      - "traefik.http.routers.api.rule=Host(`api.yourdomain.com`)"
      - "traefik.http.routers.api.tls.certresolver=letsencrypt"
```

Alternatively, place NGINX or another TLS-terminating proxy in front of Traefik.

**NGINX example (nginx.conf):**

```nginx
server {
    listen 443 ssl http2;
    server_name admin.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://admin:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 443 ssl http2;
    server_name events.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://portal:3100;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://api:3002;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Production checklist

- [ ] Set strong, unique values for `POSTGRES_PASSWORD`, `JWT_SECRET`, `REDIS_PASSWORD`, and `SECRET_KEY_BASE`. The values in `.env.example` are Supabase's published demo keys and are safe only on a laptop.
- [ ] Generate `API_KEY_PEPPER` and `UNSUBSCRIBE_HMAC_SECRET`, and never rotate them afterwards. Rotating the first invalidates every API key you have issued. Rotating the second breaks the unsubscribe link in every email you have already sent.
- [ ] Set `NODE_ENV=production` for all application services
- [ ] Configure TLS termination with valid certificates
- [ ] Set `SITE_URL` and `API_EXTERNAL_URL` to your public URLs
- [ ] Set `DISABLE_SIGNUP=true` if you do not want public sign-ups
- [ ] Complete the first-time setup wizard. The edge functions behind it are unauthenticated by necessity, and they stop accepting requests once an administrator exists, so finishing the wizard is what closes that window.
- [ ] Configure email delivery, SendGrid or SMTP, before you run the setup wizard. The wizard emails you the sign-in link.
- [ ] Set up log aggregation and monitoring
- [ ] Enable Redis persistence (AOF is enabled by default in the compose file)
- [ ] Set up database backups for the PostgreSQL volume

A note on `VERIFY_JWT`. The compose file defaults it to `true`, but
`docker/.env.example` sets it to `false`, so a stack started with `make init`
and `make up` runs with it off. Gatewaze edge functions authenticate
internally, using the service role key, an HMAC signature, or an admin check,
and several of them serve anonymous public forms. Turning platform-wide JWT
verification on will break those public forms. Deploy edge functions to
Supabase Cloud with `--no-verify-jwt`, which is what `make deploy-functions`
does.

---

## Docker Compose with Supabase Cloud

If you are using [Supabase Cloud](https://supabase.com) instead of self-hosting, use a simplified Docker Compose that omits the Supabase containers.

### Using the bundled cloud compose file

`docker/docker-compose.cloud.yml` is already in the repository. It starts the
application services and Redis, and leaves the database to your Supabase
project. Set `SUPABASE_MODE=cloud` in `docker/.env` and `make up` selects it
for you.

Set these in `docker/.env`:

```bash
SUPABASE_MODE=cloud
SUPABASE_PROJECT_REF=xyzcompany
SUPABASE_URL=https://xyzcompany.supabase.co
SUPABASE_INTERNAL_URL=https://xyzcompany.supabase.co
ANON_KEY=eyJhbGci...
SERVICE_ROLE_KEY=eyJhbGci...
DATABASE_URL=postgresql://postgres:password@db.xyzcompany.supabase.co:5432/postgres
```

Then:

```bash
make up                  # starts the application services only
make migrate             # pushes migrations to the linked project
make deploy-functions    # deploys edge functions and syncs their secrets
```

`make migrate` and `make deploy-functions` work only in cloud mode. In
self-hosted mode migrations run automatically when the database container
starts, and edge functions are served straight from `supabase/functions/`.

---

## Pre-Built Docker Images

For the fastest deployment without building from source, use the quickstart compose file that pulls pre-built images from the container registry.

```bash
git clone https://github.com/gatewaze/gatewaze.git
cd gatewaze
cp docker/.env.example docker/.env
# edit docker/.env

docker compose -f docker/docker-compose.quickstart.yml up -d
```

Every release publishes these images to the GitHub Container Registry, tagged
with both the version and `latest`.

| Image | What it is |
|---|---|
| `ghcr.io/gatewaze/admin` | The administrator interface, React served by NGINX. |
| `ghcr.io/gatewaze/portal` | The public website, Next.js rendered on the server. |
| `ghcr.io/gatewaze/api` | The Express API server. |
| `ghcr.io/gatewaze/worker` | The background job runner. Carries Chromium for the scrapers, so it is the largest image. |
| `ghcr.io/gatewaze/scheduler` | The cron process that puts jobs on the queue. |
| `ghcr.io/gatewaze/se-runner` | A leaner worker for the software-engineer module only. |
| `ghcr.io/gatewaze/mcp-public` | The public, keyless MCP endpoint for AI agents. |
| `ghcr.io/gatewaze/scrapling-fetcher` | The Python fetching service the scrapers call. |

[Running Gatewaze on Kubernetes](./kubernetes.md#what-each-image-does)
describes what each one does in more detail, including the four services that
have deployment templates but no published image yet.

Pin a version for anything you intend to keep, so that a rollback lands on the
same image every time:

```yaml
admin:
  image: ghcr.io/gatewaze/admin:1.3.129
```

---

## Kubernetes with Helm

Kubernetes has its own guide, because there is more to say about it than fits
here: [Running Gatewaze on Kubernetes](./kubernetes.md).

That guide covers what the chart installs and what it deliberately leaves to
you, three worked example values files in
[`helm/examples/`](../helm/examples/), resource sizing for Supabase Cloud
against a self-hosted Supabase, what every published image does, secret
handling, upgrades, and the problems people hit on a first install.

The short version:

```bash
helm repo add gatewaze https://gatewaze.github.io/gatewaze
helm repo update

cp helm/examples/values-supabase-cloud.yaml my-values.yaml
# edit my-values.yaml and replace every CHANGE ME

helm install gatewaze gatewaze/gatewaze \
  --namespace gatewaze --create-namespace \
  -f my-values.yaml
```
