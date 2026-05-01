# Configuration

Gatewaze is configured through two mechanisms: the `gatewaze.config.ts` file for application-level settings, and environment variables for infrastructure and secrets.

---

## Table of Contents

- [gatewaze.config.ts](#gatewazeconfists)
- [Environment Variables](#environment-variables)
- [Auth Configuration](#auth-configuration)
- [Email Configuration](#email-configuration)
- [Supabase Configuration](#supabase-configuration)
- [Redis Configuration](#redis-configuration)
- [Module Configuration](#module-configuration)

---

## gatewaze.config.ts

The `gatewaze.config.ts` file in the project root controls high-level application behavior. It exports a `GatewazeConfig` object with the following structure:

```typescript
import type { GatewazeConfig } from './packages/shared/src/types/modules';

const config: GatewazeConfig = {
  name: process.env.INSTANCE_NAME || 'Gatewaze',

  auth: {
    provider: (process.env.AUTH_PROVIDER as 'supabase' | 'oidc') || 'supabase',
    oidc: {
      issuerUrl: process.env.OIDC_ISSUER_URL,
      clientId: process.env.OIDC_CLIENT_ID,
      clientSecret: process.env.OIDC_CLIENT_SECRET,
    },
  },

  email: {
    provider: (process.env.EMAIL_PROVIDER as 'sendgrid' | 'smtp') || 'sendgrid',
  },

  modules: [],
};

export default config;
```

### Config Options Reference

| Option                    | Type                   | Default        | Description                                                    |
|---------------------------|------------------------|----------------|----------------------------------------------------------------|
| `name`                    | `string`               | `'Gatewaze'`   | Display name for this instance. Shown in the admin UI and emails. |
| `auth.provider`           | `'supabase' \| 'oidc'` | `'supabase'`   | Authentication provider to use.                                |
| `auth.oidc.issuerUrl`     | `string`               | --             | OIDC provider issuer URL (required when provider is `oidc`).   |
| `auth.oidc.clientId`      | `string`               | --             | OIDC client ID.                                                |
| `auth.oidc.clientSecret`  | `string`               | --             | OIDC client secret.                                            |
| `auth.oidc.scopes`        | `string[]`             | --             | Additional OIDC scopes to request.                             |
| `auth.oidc.roleMapping`   | `object`               | --             | Maps OIDC claims to Gatewaze admin roles. See [Auth docs](./auth.md). |
| `email.provider`          | `'sendgrid' \| 'smtp'` | `'sendgrid'`   | Email delivery provider.                                       |
| `modules`                 | `string[]`             | `[]`           | Array of installed module package names.                       |
| `moduleConfig`            | `Record<string, Record<string, unknown>>` | -- | Per-module configuration values. Keys are module IDs. |

---

## Environment Variables

All environment variables are defined in the `.env` file. Copy `.env.example` to `.env` to get started.

### Core Application

| Variable            | Description                                        | Required | Default                  |
|---------------------|----------------------------------------------------|----------|--------------------------|
| `INSTANCE_NAME`     | Display name for this Gatewaze instance             | No       | `Gatewaze`               |
| `NODE_ENV`          | Runtime environment (`development` or `production`) | No       | `development`            |
| `AUTH_PROVIDER`     | Auth backend: `supabase` or `oidc`                  | No       | `supabase`               |
| `EMAIL_PROVIDER`    | Email backend: `sendgrid` or `smtp`                 | No       | `sendgrid`               |

### Supabase

| Variable              | Description                                              | Required | Default                              |
|------------------------|----------------------------------------------------------|----------|--------------------------------------|
| `SUPABASE_URL`         | URL of the Supabase API gateway (Kong)                   | Yes      | `http://supabase.gatewaze.localhost` |
| `ANON_KEY`             | Supabase anonymous (public) API key                      | Yes      | --                                   |
| `SERVICE_ROLE_KEY`     | Supabase service role key (server-side only, never expose)| Yes     | --                                   |
| `JWT_SECRET`           | JWT signing secret shared between Supabase services      | Yes      | --                                   |
| `JWT_EXP`              | JWT token expiry in seconds                              | No       | `3600`                               |

### Database

| Variable              | Description                                              | Required | Default                       |
|------------------------|----------------------------------------------------------|----------|-------------------------------|
| `POSTGRES_PASSWORD`    | Password for the PostgreSQL superuser                    | Yes      | --                            |
| `POSTGRES_USER`        | PostgreSQL superuser name                                | No       | `postgres`                    |
| `POSTGRES_DB`          | PostgreSQL database name                                 | No       | `postgres`                    |
| `POSTGRES_PORT`        | Host port mapped to PostgreSQL                           | No       | `54322`                       |
| `DATABASE_URL`         | Full PostgreSQL connection string (used by API and worker)| Yes     | --                            |

### Redis

| Variable              | Description                                              | Required | Default                       |
|------------------------|----------------------------------------------------------|----------|-------------------------------|
| `REDIS_URL`            | Full Redis connection string including password          | Yes      | --                            |
| `REDIS_PASSWORD`       | Redis AUTH password                                      | No       | `gatewaze`                    |
| `REDIS_PORT`           | Host port mapped to Redis                                | No       | `6379`                        |

### Admin App (Vite)

| Variable                  | Description                                          | Required | Default                              |
|----------------------------|------------------------------------------------------|----------|--------------------------------------|
| `VITE_SUPABASE_URL`       | Supabase URL for the admin frontend                  | Yes      | `http://supabase.gatewaze.localhost` |
| `VITE_SUPABASE_ANON_KEY`  | Supabase anon key for the admin frontend             | Yes      | --                                   |
| `VITE_API_URL`            | API server URL for the admin frontend                | Yes      | `http://api.gatewaze.localhost`      |
| `ADMIN_HOST`              | Traefik hostname for the admin app (Docker)          | No       | `admin.gatewaze.localhost`           |

### Public Portal (Next.js)

| Variable                          | Description                                  | Required | Default                              |
|------------------------------------|----------------------------------------------|----------|--------------------------------------|
| `NEXT_PUBLIC_SUPABASE_URL`        | Supabase URL for the portal frontend         | Yes      | `http://supabase.gatewaze.localhost` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`   | Supabase anon key for the portal frontend    | Yes      | --                                   |
| `SUPABASE_SERVICE_ROLE_KEY`       | Service role key for server-side operations  | Yes      | --                                   |
| `PORTAL_HOST`                     | Traefik hostname for the portal (Docker)     | No       | `app.gatewaze.localhost`             |

### API Server

| Variable              | Description                                              | Required | Default                         |
|------------------------|----------------------------------------------------------|---------|---------------------------------|
| `PORT`                 | Port the API server listens on                           | No       | `3002`                          |
| `API_HOST`             | Traefik hostname for the API server (Docker)             | No       | `api.gatewaze.localhost`        |
| `API_URL`              | Public-facing API URL                                    | No       | `http://api.gatewaze.localhost` |

### Email -- SendGrid

| Variable              | Description                                              | Required | Default                       |
|------------------------|----------------------------------------------------------|----------|-------------------------------|
| `SENDGRID_API_KEY`     | SendGrid API key for transactional email                 | Conditional | --                         |
| `EMAIL_FROM`           | Default "from" address for outgoing email                | No       | `noreply@localhost`           |

### Email -- SMTP

| Variable              | Description                                              | Required | Default                       |
|------------------------|----------------------------------------------------------|----------|-------------------------------|
| `SMTP_HOST`            | SMTP server hostname                                     | Conditional | --                         |
| `SMTP_PORT`            | SMTP server port                                         | No       | `587`                         |
| `SMTP_USER`            | SMTP authentication username                             | Conditional | --                         |
| `SMTP_PASS`            | SMTP authentication password                             | Conditional | --                         |
| `SMTP_ADMIN_EMAIL`     | Admin email address for Supabase Auth SMTP               | No       | `admin@localhost`             |
| `EMAIL_FROM`           | Default "from" address for outgoing email                | No       | `noreply@localhost`           |

### OIDC (External Auth)

| Variable              | Description                                              | Required | Default                       |
|------------------------|----------------------------------------------------------|----------|-------------------------------|
| `OIDC_ISSUER_URL`      | OIDC provider issuer URL                                 | Conditional | --                         |
| `OIDC_CLIENT_ID`       | OIDC client ID                                           | Conditional | --                         |
| `OIDC_CLIENT_SECRET`   | OIDC client secret                                       | Conditional | --                         |

### Supabase Self-Hosted Hosts (Traefik)

When running with Docker Compose and Traefik, Supabase services are accessed via `.localhost` hostnames rather than exposed ports.

| Variable              | Description                                              | Required | Default                              |
|------------------------|----------------------------------------------------------|----------|--------------------------------------|
| `SUPABASE_HOST`        | Traefik hostname for the Supabase API gateway            | No       | `supabase.gatewaze.localhost`        |
| `STUDIO_HOST`          | Traefik hostname for Supabase Studio                     | No       | `studio.gatewaze.localhost`          |
| `KONG_HTTPS_PORT`      | Host port for Supabase API gateway (HTTPS)               | No       | `54322`                              |

### Supabase Self-Hosted Misc

| Variable                         | Description                                | Required | Default                              |
|-----------------------------------|--------------------------------------------|----------|--------------------------------------|
| `API_EXTERNAL_URL`               | External URL for Supabase API              | No       | `http://supabase.gatewaze.localhost` |
| `SITE_URL`                       | URL that Supabase Auth redirects to        | No       | `http://admin.gatewaze.localhost`    |
| `ADDITIONAL_REDIRECT_URLS`       | Comma-separated additional redirect URLs   | No       | --                                   |
| `DISABLE_SIGNUP`                 | Disable public sign-up via Supabase Auth   | No       | `false`                              |
| `ENABLE_EMAIL_SIGNUP`            | Enable email-based sign-up                 | No       | `true`                               |
| `ENABLE_EMAIL_AUTOCONFIRM`       | Auto-confirm email addresses               | No       | `false`                              |
| `VERIFY_JWT`                     | Verify JWTs in edge functions              | No       | `true`                               |
| `SECRET_KEY_BASE`                | Secret key for Supabase Realtime           | No       | (generated default)                  |
| `STUDIO_DEFAULT_ORGANIZATION`    | Default org name in Supabase Studio        | No       | `Gatewaze`                           |
| `STUDIO_DEFAULT_PROJECT`         | Default project name in Supabase Studio    | No       | `Gatewaze`                           |

---

## Auth Configuration

Gatewaze supports two authentication providers, configured via the `auth.provider` field in `gatewaze.config.ts` and the `AUTH_PROVIDER` environment variable.

### Supabase Auth (Default)

No additional configuration is needed beyond the standard Supabase environment variables. Supabase Auth provides magic link login by default. See [Auth Documentation](./auth.md) for details on adding password-based login.

### OIDC (External Identity Provider)

Set `AUTH_PROVIDER=oidc` and provide the required OIDC variables:

```bash
AUTH_PROVIDER=oidc
OIDC_ISSUER_URL=https://your-idp.example.com/realms/gatewaze
OIDC_CLIENT_ID=gatewaze-admin
OIDC_CLIENT_SECRET=your-client-secret
```

Optionally configure role mapping in `gatewaze.config.ts`:

```typescript
auth: {
  provider: 'oidc',
  oidc: {
    issuerUrl: process.env.OIDC_ISSUER_URL,
    clientId: process.env.OIDC_CLIENT_ID,
    clientSecret: process.env.OIDC_CLIENT_SECRET,
    scopes: ['openid', 'profile', 'email', 'roles'],
    roleMapping: {
      claimPath: 'realm_access.roles',
      superAdmin: 'gatewaze-super-admin',
      admin: 'gatewaze-admin',
      editor: 'gatewaze-editor',
    },
  },
},
```

See the full [Auth Documentation](./auth.md) for provider-specific setup guides.

---

## Email Configuration

### SendGrid

Set `EMAIL_PROVIDER=sendgrid` (the default) and provide your API key:

```bash
EMAIL_PROVIDER=sendgrid
SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxxxx
EMAIL_FROM=events@yourdomain.com
```

### SMTP

Set `EMAIL_PROVIDER=smtp` and configure the SMTP connection:

```bash
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-smtp-username
SMTP_PASS=your-smtp-password
EMAIL_FROM=events@yourdomain.com
```

The SMTP settings are also used by the self-hosted Supabase Auth service for sending magic link and confirmation emails. If you are using Supabase Cloud, configure email delivery in the Supabase dashboard instead.

---

## Supabase Configuration

### Self-Hosted (Default)

The default `docker-compose.yml` starts a full self-hosted Supabase stack including:

- **PostgreSQL** (supabase/postgres)
- **GoTrue** (authentication)
- **PostgREST** (auto-generated REST API)
- **Realtime** (websocket subscriptions)
- **Storage** (file uploads)
- **Kong** (API gateway)
- **Edge Functions** (Deno runtime)
- **Studio** (database management UI)

All Supabase services communicate over the internal Docker network. Traefik routes external traffic to the Kong gateway via `http://supabase.gatewaze.localhost` and to Supabase Studio via `http://studio.gatewaze.localhost`.

### Supabase Cloud

To use Supabase Cloud, set the following and omit the Supabase containers from your Docker Compose:

```bash
SUPABASE_URL=https://xyzcompany.supabase.co
ANON_KEY=eyJhbGci...
SERVICE_ROLE_KEY=eyJhbGci...
```

Use `docker-compose.cloud.yml` to start only the application services:

```bash
docker compose -f docker/docker-compose.cloud.yml up -d
```

See the [Deployment Guide](./deployment.md) for details.

---

## Redis Configuration

Redis is required for the background job queue (BullMQ). A single Redis instance is sufficient for most deployments.

### Local / Docker

The default Docker Compose starts a Redis 7 Alpine container with append-only persistence:

```bash
REDIS_PASSWORD=gatewaze
REDIS_PORT=6379
REDIS_URL=redis://:gatewaze@localhost:6379
```

### Managed Redis

For production, consider using a managed Redis service (e.g., AWS ElastiCache, Redis Cloud, Upstash). Set the `REDIS_URL` to the full connection string:

```bash
REDIS_URL=rediss://:your-password@your-redis-host:6380
```

Note the `rediss://` scheme for TLS connections.

---

## Module Configuration

Modules are installed as npm packages and registered in `gatewaze.config.ts`.

### Installing a Module

```bash
# Install the module package
pnpm add @gatewaze-modules/stripe-payments

# Register it in gatewaze.config.ts
```

```typescript
const config: GatewazeConfig = {
  // ...
  modules: ['@gatewaze-modules/stripe-payments'],
  moduleConfig: {
    'stripe-payments': {
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
      secretKey: process.env.STRIPE_SECRET_KEY,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    },
  },
};
```

Each module may define its own configuration schema. Refer to the module's documentation for available options. See the [Modules Guide](./modules.md) for a full list of available modules and how to create custom modules.
