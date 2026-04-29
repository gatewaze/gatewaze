# Sentry Configuration Runbook

**Spec ref:** [§5.6](../../../gatewaze-environments/specs/spec-production-readiness-hardening.md)
**Status:** opt-in, off by default

## Three SDKs, two configuration paths

| Service | SDK | Config path |
|---|---|---|
| API | `@sentry/node` | runtime env (`SENTRY_DSN`) |
| Worker | `@sentry/node` | runtime env (`SENTRY_DSN`) |
| Scheduler | `@sentry/node` | runtime env (`SENTRY_DSN`) |
| Admin | `@sentry/react` | **build-time env** (`VITE_SENTRY_DSN`) |
| Portal | `@sentry/nextjs` | **build-time env** (`NEXT_PUBLIC_SENTRY_DSN`) |

The first three read DSN from the running container's env. The last
two embed the DSN into the JS bundle at **build time** — they cannot
read it from a Helm-injected runtime env, because the bundle is
already compiled and served as static assets.

## API / Worker / Scheduler — runtime config

Set in `values.yaml`:

```yaml
monitoring:
  sentry:
    dsn: "https://abc@oXXXXXX.ingest.us.sentry.io/YYYYYY"
    environment: "production"
    release: "v1.4.0"
    tracesSampleRate: "0.1"
```

Helm renders these into the ConfigMap as `SENTRY_DSN`,
`SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`, `SENTRY_TRACES_SAMPLE_RATE`.
Each pod picks them up via `envFrom: configMapRef`.

## Admin (Vite) — build-time config

The `VITE_*` envs are baked into the bundle by `vite build`. Pass
them as build args to your image build pipeline:

```bash
docker build \
  --build-arg VITE_SENTRY_DSN="https://abc@oXX.ingest.us.sentry.io/YY" \
  --build-arg VITE_SENTRY_ENVIRONMENT="production" \
  --build-arg VITE_SENTRY_RELEASE="$(git rev-parse --short HEAD)" \
  -t ghcr.io/gatewaze/admin:v1.4.0 \
  -f packages/admin/Dockerfile .
```

The Dockerfile must `ARG VITE_SENTRY_DSN` and forward it as
`ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN` before `RUN pnpm build`.
Once built, the DSN is in `dist/assets/*.js` — rotating it requires
a new image build.

## Portal (Next.js) — build-time config

Same pattern as admin but with `NEXT_PUBLIC_*` prefix:

```bash
docker build \
  --build-arg NEXT_PUBLIC_SENTRY_DSN="https://abc@oXX.ingest.us.sentry.io/YY" \
  --build-arg NEXT_PUBLIC_SENTRY_ENVIRONMENT="production" \
  --build-arg NEXT_PUBLIC_SENTRY_RELEASE="$(git rev-parse --short HEAD)" \
  -t ghcr.io/gatewaze/portal:v1.4.0 \
  -f packages/portal/Dockerfile .
```

For the **server-side** portal runtime (RSC, route handlers,
middleware), use the runtime `SENTRY_DSN` env from the
ConfigMap (same as API). Both are honoured by the
`sentry.{client,server,edge}.config.ts` files.

## Brand isolation

Each brand should have its own Sentry project (or use a single
project with `tags: { brand: <id> }` filtering). The `monitoring.
sentry` Helm values are per-release, so a multi-brand cluster gets
multiple Helm releases each with their own DSN.

## Self-hosted (GlitchTip)

Set `monitoring.sentry.dsn` to your GlitchTip endpoint. The
Sentry SDKs accept any compatible API. For full setup, see the
optional `glitchtip` Helm dependency in the `monitoring` module
(spec §7.2).
