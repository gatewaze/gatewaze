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

A full Gatewaze deployment consists of the following components:

```
                          +---------------------+
                          |       Traefik        |
                          |   Reverse Proxy      |
                          |  (Apache 2.0)        |
                          |  Dashboard: :8080    |
                          +----------+----------+
                                     |
           admin.gatewaze.localhost  |  app.gatewaze.localhost
           api.gatewaze.localhost    |  supabase.gatewaze.localhost
           studio.gatewaze.localhost |
                                     |
                  +------------------+------------------+
                  |                  |                  |
           +------v------+   +------v------+   +------v------+
           | Admin App   |   |   Portal    |   | API Server  |
           | (React/Vite)|   | (Next.js)   |   | (Express)   |
           +------+------+   +------+------+   +--+-------+--+
                  |                  |             |       |
                  +------------------+-------------+       |
                                     |                     |
                           +---------v---------+   +-------v-------+
                           |     Supabase      |   |     Redis     |
                           |  (PostgreSQL +    |   |   + BullMQ    |
                           |   Auth + Storage  |   |   (Jobs)      |
                           |   + Edge Funcs)   |   +-------+-------+
                           +---------+---------+           |
                                     |               +-----v-----+
                                     |               |  Worker   |
                                     |               | (BullMQ)  |
                                     |               +-----------+
                                     |
                                     |               +-----------+
                                     +---------------+ Scheduler |
                                                     | (Cron)    |
                                                     +-----------+
```

**Services:**

| Service     | Image / Build              | URL / Port                           | Description                                    |
|-------------|----------------------------|--------------------------------------|------------------------------------------------|
| Traefik     | `traefik:v3`               | Dashboard: http://localhost:8080     | Reverse proxy (Apache 2.0 licensed)            |
| Admin       | `docker/admin/Dockerfile`  | http://admin.gatewaze.localhost      | React admin UI served by NGINX                 |
| Portal      | `docker/portal/Dockerfile` | http://app.gatewaze.localhost        | Next.js public event portal                    |
| API         | `docker/api/Dockerfile`    | http://api.gatewaze.localhost        | Express API server                             |
| Worker      | `docker/worker/Dockerfile` | --                                   | BullMQ job worker (no exposed port)            |
| Scheduler   | `docker/api/Dockerfile`    | --                                   | Cron-based job scheduler (no exposed port)     |
| Supabase    | Multiple official images   | http://supabase.gatewaze.localhost   | Full Supabase stack (Kong gateway)             |
| Supabase UI | Official studio image      | http://studio.gatewaze.localhost     | Supabase Studio database management UI         |
| Redis       | `redis:7-alpine`           | 6379 (internal)                      | Job queue backend                              |

---

## Docker Compose -- Development

The default `docker/docker-compose.yml` is designed for development and includes the full self-hosted Supabase stack. Traefik (Apache 2.0 licensed) is included as the reverse proxy, routing `.localhost` subdomains to each service automatically. No changes to `/etc/hosts` are needed -- `.localhost` domains resolve per RFC 6761.

### Prerequisites

- Docker and Docker Compose installed
- `.env` file configured (copy from `.env.example`)

### Starting the stack

```bash
cd docker
docker compose up -d
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

- [ ] Set strong, unique values for `POSTGRES_PASSWORD`, `JWT_SECRET`, `REDIS_PASSWORD`, and `SECRET_KEY_BASE`
- [ ] Set `NODE_ENV=production` for all application services
- [ ] Configure TLS termination with valid certificates
- [ ] Set `SITE_URL` and `API_EXTERNAL_URL` to your public URLs
- [ ] Restrict `DISABLE_SIGNUP=true` if you do not want public sign-ups
- [ ] Set `VERIFY_JWT=true` for edge functions
- [ ] Configure email delivery (SendGrid or SMTP) for magic links and transactional email
- [ ] Set up log aggregation and monitoring
- [ ] Enable Redis persistence (AOF is enabled by default in the compose file)
- [ ] Set up database backups for the PostgreSQL volume

---

## Docker Compose with Supabase Cloud

If you are using [Supabase Cloud](https://supabase.com) instead of self-hosting, use a simplified Docker Compose that omits the Supabase containers.

### docker-compose.cloud.yml

```yaml
services:
  traefik:
    image: traefik:v3
    restart: unless-stopped
    command:
      - "--api.insecure=true"
      - "--providers.docker=true"
      - "--providers.docker.exposedbydefault=false"
      - "--entrypoints.web.address=:80"
    ports:
      - "80:80"
      - "8080:8080"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro

  admin:
    build:
      context: ..
      dockerfile: docker/admin/Dockerfile
    restart: unless-stopped
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.admin.rule=Host(`${ADMIN_HOST:-admin.gatewaze.localhost}`)"
      - "traefik.http.routers.admin.entrypoints=web"
      - "traefik.http.services.admin.loadbalancer.server.port=80"
    environment:
      VITE_SUPABASE_URL: ${SUPABASE_URL}
      VITE_SUPABASE_ANON_KEY: ${ANON_KEY}
      VITE_API_URL: ${API_URL:-http://api.gatewaze.localhost}

  portal:
    build:
      context: ..
      dockerfile: docker/portal/Dockerfile
    restart: unless-stopped
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.portal.rule=Host(`${PORTAL_HOST:-app.gatewaze.localhost}`)"
      - "traefik.http.routers.portal.entrypoints=web"
      - "traefik.http.services.portal.loadbalancer.server.port=3100"
    environment:
      NEXT_PUBLIC_SUPABASE_URL: ${SUPABASE_URL}
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ${ANON_KEY}
      SUPABASE_SERVICE_ROLE_KEY: ${SERVICE_ROLE_KEY}
      NODE_ENV: production

  api:
    build:
      context: ..
      dockerfile: docker/api/Dockerfile
    restart: unless-stopped
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.api.rule=Host(`${API_HOST:-api.gatewaze.localhost}`)"
      - "traefik.http.routers.api.entrypoints=web"
      - "traefik.http.services.api.loadbalancer.server.port=3002"
    environment:
      PORT: "3002"
      NODE_ENV: production
      SUPABASE_URL: ${SUPABASE_URL}
      SUPABASE_ANON_KEY: ${ANON_KEY}
      SUPABASE_SERVICE_ROLE_KEY: ${SERVICE_ROLE_KEY}
      REDIS_URL: redis://:${REDIS_PASSWORD:-gatewaze}@redis:6379
      DATABASE_URL: ${DATABASE_URL}
      JWT_SECRET: ${JWT_SECRET}
      SENDGRID_API_KEY: ${SENDGRID_API_KEY:-}
      EMAIL_FROM: ${EMAIL_FROM:-noreply@localhost}
    depends_on:
      redis:
        condition: service_healthy

  worker:
    build:
      context: ..
      dockerfile: docker/worker/Dockerfile
    restart: unless-stopped
    environment:
      NODE_ENV: production
      SUPABASE_URL: ${SUPABASE_URL}
      SUPABASE_ANON_KEY: ${ANON_KEY}
      SUPABASE_SERVICE_ROLE_KEY: ${SERVICE_ROLE_KEY}
      REDIS_URL: redis://:${REDIS_PASSWORD:-gatewaze}@redis:6379
      DATABASE_URL: ${DATABASE_URL}
      JWT_SECRET: ${JWT_SECRET}
      SENDGRID_API_KEY: ${SENDGRID_API_KEY:-}
      EMAIL_FROM: ${EMAIL_FROM:-noreply@localhost}
    depends_on:
      redis:
        condition: service_healthy

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD:-gatewaze}
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD:-gatewaze}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  redis-data:
    driver: local
```

### Usage

```bash
# Set Supabase Cloud credentials in .env
SUPABASE_URL=https://xyzcompany.supabase.co
ANON_KEY=eyJhbGci...
SERVICE_ROLE_KEY=eyJhbGci...
DATABASE_URL=postgresql://postgres:password@db.xyzcompany.supabase.co:5432/postgres

# Start
docker compose -f docker/docker-compose.cloud.yml up -d
```

---

## Pre-Built Docker Images

For the fastest deployment without building from source, use the quickstart compose file that pulls pre-built images from the container registry.

```bash
git clone https://github.com/gatewaze/gatewaze.git
cd gatewaze
cp .env.example .env
docker compose -f docker/docker-compose.quickstart.yml up -d
```

This uses images published to the GitHub Container Registry:

| Service   | Image                               |
|-----------|-------------------------------------|
| Admin     | `ghcr.io/gatewaze/admin:latest`     |
| Portal    | `ghcr.io/gatewaze/portal:latest`    |
| API       | `ghcr.io/gatewaze/api:latest`       |
| Worker    | `ghcr.io/gatewaze/worker:latest`    |

Pin specific versions for production:

```yaml
admin:
  image: ghcr.io/gatewaze/admin:1.2.0
```

---

## Kubernetes with Helm

For production deployments at scale, Gatewaze provides a Helm chart for Kubernetes.

### Prerequisites

- A Kubernetes cluster (1.27+)
- [Helm](https://helm.sh/) 3.x installed
- [NGINX Ingress Controller](https://kubernetes.github.io/ingress-nginx/) deployed
- [cert-manager](https://cert-manager.io/) deployed (for automatic TLS certificates)
- A PostgreSQL database (Supabase Cloud or self-managed)
- A Redis instance (managed or self-hosted)

### Installing the Helm Chart

#### 1. Add the Gatewaze Helm repository

```bash
helm repo add gatewaze https://charts.gatewaze.io
helm repo update
```

Or install directly from the local chart in the repository:

```bash
cd helm/gatewaze
```

#### 2. Create a values file

Create a `values.yaml` file with your configuration:

```yaml
# values.yaml
global:
  domain: yourdomain.com

admin:
  replicaCount: 1
  image:
    repository: ghcr.io/gatewaze/admin
    tag: "1.0.0"
  ingress:
    enabled: true
    host: admin.yourdomain.com
    tls:
      enabled: true
      secretName: admin-tls
  env:
    VITE_SUPABASE_URL: "https://xyzcompany.supabase.co"
    VITE_SUPABASE_ANON_KEY: "your-anon-key"
    VITE_API_URL: "https://api.yourdomain.com"

portal:
  replicaCount: 2
  image:
    repository: ghcr.io/gatewaze/portal
    tag: "1.0.0"
  ingress:
    enabled: true
    host: events.yourdomain.com
    tls:
      enabled: true
      secretName: portal-tls
  env:
    NEXT_PUBLIC_SUPABASE_URL: "https://xyzcompany.supabase.co"
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "your-anon-key"
  secretEnv:
    SUPABASE_SERVICE_ROLE_KEY: "your-service-role-key"

api:
  replicaCount: 2
  image:
    repository: ghcr.io/gatewaze/api
    tag: "1.0.0"
  ingress:
    enabled: true
    host: api.yourdomain.com
    tls:
      enabled: true
      secretName: api-tls
  env:
    NODE_ENV: production
    SUPABASE_URL: "https://xyzcompany.supabase.co"
  secretEnv:
    SUPABASE_SERVICE_ROLE_KEY: "your-service-role-key"
    DATABASE_URL: "postgresql://postgres:password@db-host:5432/postgres"
    REDIS_URL: "redis://:password@redis-host:6379"
    JWT_SECRET: "your-jwt-secret"
    SENDGRID_API_KEY: "SG.your-key"

worker:
  replicaCount: 2
  image:
    repository: ghcr.io/gatewaze/worker
    tag: "1.0.0"
  env:
    NODE_ENV: production
  secretEnv:
    SUPABASE_SERVICE_ROLE_KEY: "your-service-role-key"
    DATABASE_URL: "postgresql://postgres:password@db-host:5432/postgres"
    REDIS_URL: "redis://:password@redis-host:6379"
    JWT_SECRET: "your-jwt-secret"

scheduler:
  replicaCount: 1
  image:
    repository: ghcr.io/gatewaze/api
    tag: "1.0.0"
```

#### 3. Install the chart

```bash
helm install gatewaze helm/gatewaze/ \
  --namespace gatewaze \
  --create-namespace \
  -f values.yaml
```

#### 4. Verify the deployment

```bash
kubectl get pods -n gatewaze
kubectl get ingress -n gatewaze
```

### Running Multiple Instances

Gatewaze supports multi-brand deployments where each brand runs as a separate instance in its own Kubernetes namespace.

#### Example: Deploying a second brand

Create a brand-specific values file:

```yaml
# values-brand2.yaml
global:
  domain: brand2.example.com

admin:
  ingress:
    host: admin.brand2.example.com
  env:
    VITE_SUPABASE_URL: "https://brand2-project.supabase.co"
    VITE_SUPABASE_ANON_KEY: "brand2-anon-key"
    VITE_API_URL: "https://api.brand2.example.com"

portal:
  ingress:
    host: brand2.example.com
  env:
    NEXT_PUBLIC_SUPABASE_URL: "https://brand2-project.supabase.co"
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "brand2-anon-key"

api:
  ingress:
    host: api.brand2.example.com
  secretEnv:
    DATABASE_URL: "postgresql://postgres:password@brand2-db:5432/postgres"
    REDIS_URL: "redis://:password@brand2-redis:6379"
    # ... other secrets
```

Install into a separate namespace:

```bash
helm install brand2 helm/gatewaze/ \
  --namespace brand2 \
  --create-namespace \
  -f values-brand2.yaml
```

Each namespace is fully isolated with its own database, Redis instance, and configuration.

### Scaling and Resource Tuning

#### Horizontal scaling

Adjust `replicaCount` for each service based on load:

```yaml
portal:
  replicaCount: 4    # Scale portal for high traffic

api:
  replicaCount: 3    # Scale API for heavy backend load

worker:
  replicaCount: 4    # Scale workers for large job queues
```

The scheduler should always run with exactly 1 replica to avoid duplicate cron executions.

#### Resource limits

Set CPU and memory limits to prevent resource contention:

```yaml
api:
  resources:
    requests:
      cpu: "250m"
      memory: "256Mi"
    limits:
      cpu: "1000m"
      memory: "512Mi"

worker:
  resources:
    requests:
      cpu: "250m"
      memory: "256Mi"
    limits:
      cpu: "1000m"
      memory: "512Mi"

portal:
  resources:
    requests:
      cpu: "250m"
      memory: "256Mi"
    limits:
      cpu: "500m"
      memory: "512Mi"

admin:
  resources:
    requests:
      cpu: "100m"
      memory: "64Mi"
    limits:
      cpu: "250m"
      memory: "128Mi"
```

#### Autoscaling

Enable Horizontal Pod Autoscaler (HPA) for traffic-facing services:

```yaml
portal:
  autoscaling:
    enabled: true
    minReplicas: 2
    maxReplicas: 10
    targetCPUUtilizationPercentage: 70

api:
  autoscaling:
    enabled: true
    minReplicas: 2
    maxReplicas: 8
    targetCPUUtilizationPercentage: 70
```

### Monitoring and Health Checks

#### Liveness and readiness probes

The Helm chart configures health check endpoints for each service:

| Service   | Liveness Probe          | Readiness Probe         |
|-----------|-------------------------|-------------------------|
| Admin     | `GET /` (HTTP 200)      | `GET /` (HTTP 200)      |
| Portal    | `GET /api/health`       | `GET /api/health`       |
| API       | `GET /health`           | `GET /health`           |
| Worker    | Process check           | Process check           |

#### Prometheus metrics

The API server exposes a `/metrics` endpoint compatible with Prometheus. Add a ServiceMonitor if you are using the Prometheus Operator:

```yaml
api:
  serviceMonitor:
    enabled: true
    interval: 30s
    path: /metrics
```

#### Logging

All services output structured JSON logs to stdout. Use your cluster's log aggregation solution (e.g., Loki, Elasticsearch, CloudWatch) to collect and search logs.

### Upgrading

To upgrade an existing Helm deployment:

```bash
helm upgrade gatewaze helm/gatewaze/ \
  --namespace gatewaze \
  -f values.yaml
```

For zero-downtime upgrades, the chart uses rolling update strategy by default. The portal and API services maintain at least one ready pod during the rollout.

### Uninstalling

```bash
helm uninstall gatewaze --namespace gatewaze
kubectl delete namespace gatewaze
```

This removes all Kubernetes resources but does not delete persistent data in external databases or Redis.
