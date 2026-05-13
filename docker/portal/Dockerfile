# Single stage: clone modules at startup, build Next.js, serve
#
# Unlike the previous multi-stage build that baked a Next.js standalone
# bundle into the image, this container keeps the full source and dev deps
# so the entrypoint can clone MODULE_SOURCES at pod start, regenerate the
# module registry, and run `next build` — mirroring how the admin image
# works, so premium-module event pages make it into the bundle.
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3100 \
    HOSTNAME=0.0.0.0

# Workspace root
COPY package.json tsconfig.json gatewaze.config.ts ./
RUN printf 'packages:\n  - "packages/*"\n' > pnpm-workspace.yaml

# Package manifests for dependency resolution
COPY packages/portal/package.json packages/portal/
COPY packages/shared/package.json packages/shared/

# Install all deps — dev deps are needed for `next build` at runtime.
# `--config.dangerously-allow-all-builds=true` is required on pnpm 10+:
# without it `pnpm install` exits non-zero on ERR_PNPM_IGNORED_BUILDS
# for sharp / esbuild / @sentry/cli native build scripts. CI trusts the
# lockfile, so allow build scripts to run.
RUN --mount=type=cache,id=pnpm-portal,target=/root/.local/share/pnpm/store \
    pnpm install --no-frozen-lockfile --config.dangerously-allow-all-builds=true

# Source
COPY packages/shared/ packages/shared/
COPY packages/portal/ packages/portal/

# Shared lib is a compiled TS package that the portal imports
RUN pnpm --filter shared build

# Writable dirs for runtime clones + build artifacts
RUN mkdir -p /tmp/module-repos /app/packages/portal/.next

COPY docker/portal/entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 3100

# Build takes 2-5 min depending on modules; give probes plenty of room.
HEALTHCHECK --interval=30s --timeout=5s --start-period=600s --retries=3 \
    CMD curl -f http://localhost:3100/api/health || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
