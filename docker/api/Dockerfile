# ---- Stage 1: Build ----
FROM node:20-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Clone default open-source modules at build time so they're available
# immediately (onboarding, reconciliation) without a runtime git clone.
ARG MODULES_REPO_URL=https://github.com/gatewaze/gatewaze-modules.git
ARG MODULES_REPO_BRANCH=main
RUN git clone --depth 1 --branch ${MODULES_REPO_BRANCH} ${MODULES_REPO_URL} /gatewaze-modules

# Copy workspace root files (lockfile excluded – external workspace packages
# from ../gatewaze-modules are not available at build time)
COPY package.json ./
COPY tsconfig.json ./

# Use a workspace config that only includes local packages
RUN printf 'packages:\n  - "packages/*"\n' > pnpm-workspace.yaml

# Copy package manifests for dependency resolution
COPY packages/api/package.json packages/api/
COPY packages/shared/package.json packages/shared/

# Install all dependencies (cache pnpm store between builds)
RUN --mount=type=cache,id=pnpm-api,target=/root/.local/share/pnpm/store \
    pnpm install --no-frozen-lockfile

# Copy source code
COPY gatewaze.config.ts ./
COPY packages/shared/ packages/shared/
COPY packages/api/ packages/api/

# Build shared (CJS output) then api
RUN pnpm --filter shared build
RUN pnpm --filter api build

# ---- Stage 2: Run ----
FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

ENV NODE_ENV=production

# Copy workspace root files
COPY package.json ./

# Use a workspace config that only includes local packages
RUN printf 'packages:\n  - "packages/*"\n' > pnpm-workspace.yaml

# Copy package manifests
COPY packages/api/package.json packages/api/
COPY packages/shared/package.json packages/shared/

# Install production dependencies only (cache pnpm store between builds)
RUN --mount=type=cache,id=pnpm-api,target=/root/.local/share/pnpm/store \
    pnpm install --no-frozen-lockfile --prod

# Copy built output
COPY --from=builder /app/packages/api/dist/packages/api/src packages/api/dist
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/packages/api/dist/gatewaze.config.js ./

# Link shared package to root node_modules so Node ESM resolver can find it
RUN mkdir -p node_modules/@gatewaze && ln -s ../../packages/shared node_modules/@gatewaze/shared

# Copy default modules (cloned at build time) and config
COPY --from=builder /gatewaze-modules/modules /gatewaze-modules/modules
COPY --from=builder /app/gatewaze.config.ts ./gatewaze.config.ts

# Ship core SQL migrations so /api/modules/bootstrap can apply them at
# runtime against a fresh Supabase project. applyCoreMigrations() reads
# from <projectRoot>/supabase/migrations/, and projectRoot is /app, so
# this needs to land at /app/supabase/migrations.
COPY supabase/migrations/ supabase/migrations/

# Ship core edge-function shared sources so the cloud-api deploy strategy
# can resolve cross-module `_shared/...` imports (e.g. newsletters'
# email-inbound-parse imports `../_shared/email.ts`). resolveSourceFiles
# walks <projectRoot>/supabase/functions/_shared as a fallback shared dir.
COPY supabase/functions/_shared/ supabase/functions/_shared/

# Create writable directories for runtime git clones and uploaded modules
RUN mkdir -p /app/.gatewaze-modules /app/data /tmp/module-repos /var/lib/gatewaze

# Copy entrypoint script (clones additional module repos at startup)
COPY docker/api/entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Runs as root: the entrypoint creates symlinks under / for cloned module
# repos and writes .gitconfig. Restrict via the chart's api.securityContext
# if your threat model requires it (will need companion app changes).

EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "const http = require('http'); http.get('http://localhost:3002/api/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));" || exit 1

# Use entrypoint to clone modules, then start with tsx
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["npx", "tsx", "packages/api/dist/server.js"]
