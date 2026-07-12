# ---- Stage 1: Build ----
FROM node:22-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.31.0 --activate

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

# Install all dependencies (cache pnpm store between builds).
# Native build scripts governed by pnpm.onlyBuiltDependencies in the
# root package.json (the removed dangerously-allow-all-builds flag
# conflicts with it on pnpm 10).
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
FROM node:22-slim

# openssh-client is required by the sites module's graduate-to-external
# flow (Source tab → "Move to my own git repo"): it spawns `ssh-keygen`
# to generate the ed25519 deploy keypair, and `ssh`/`git push` use the
# generated key to push to the external repo.
#
# curl + bzip2 + libgomp1/libxcb1/libdbus-1-3 + python3 + pipx are the
# install + runtime deps for the Goose CLI binary (added below). The
# AI module's recipe handler (registered in this api container via
# the platform's module-host bridge) spawns `goose run` for every
# ai:run-recipe job — without these the binary won't load.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git \
      ca-certificates \
      openssh-client \
      curl \
      bzip2 \
      python3 \
      python3-pip \
      pipx \
      libgomp1 \
      libxcb1 \
      libdbus-1-3 \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.31.0 --activate

# Install Goose CLI. Version pin tracked via Renovate (.github/
# renovate.json5 watches block/goose releases and bumps both this
# Dockerfile AND docker/worker/Dockerfile together — both images
# spawn the same binary on the same recipes so they must stay in
# sync). Detect arch from `uname -m` so the same Dockerfile builds
# clean on both ARM64 (dev Mac) and AMD64 (Linux K8s).
ARG GOOSE_VERSION=v1.34.1
RUN PIPX_HOME=/opt/pipx PIPX_BIN_DIR=/usr/local/bin pipx install uv
RUN set -eux; \
    arch="$(uname -m)"; \
    case "$arch" in \
      x86_64|amd64) goose_target=x86_64-unknown-linux-gnu ;; \
      aarch64|arm64) goose_target=aarch64-unknown-linux-gnu ;; \
      *) echo "unsupported uname -m=$arch"; exit 1 ;; \
    esac; \
    cd /tmp; \
    curl -fSL --retry 3 \
      "https://github.com/block/goose/releases/download/${GOOSE_VERSION}/goose-${goose_target}.tar.bz2" \
      -o goose.tar.bz2; \
    tar -xjf goose.tar.bz2; \
    mv goose /usr/local/bin/goose; \
    chmod +x /usr/local/bin/goose; \
    rm -f goose.tar.bz2; \
    /usr/local/bin/goose --version

WORKDIR /app

ENV NODE_ENV=production

# Copy workspace root files
COPY package.json ./

# Use a workspace config that only includes local packages
RUN printf 'packages:\n  - "packages/*"\n' > pnpm-workspace.yaml

# Copy package manifests
COPY packages/api/package.json packages/api/
COPY packages/shared/package.json packages/shared/

# Install production dependencies only (cache pnpm store between builds).
# Native build scripts governed by pnpm.onlyBuiltDependencies in the
# root package.json (the removed dangerously-allow-all-builds flag
# conflicts with it on pnpm 10).
RUN --mount=type=cache,id=pnpm-api,target=/root/.local/share/pnpm/store \
    pnpm install --no-frozen-lockfile --prod

# Copy built output
COPY --from=builder /app/packages/api/dist/packages/api/src packages/api/dist
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/packages/api/dist/gatewaze.config.js ./

# Link shared package to root node_modules so Node ESM resolver can find it
RUN mkdir -p node_modules/@gatewaze && ln -s ../../packages/shared node_modules/@gatewaze/shared

# Mirror the worker's `/node_modules -> /app/node_modules` symlink so
# modules loaded from /tmp/module-repos/<repo>/modules/<id>/...  can
# resolve their npm deps via Node's standard walk-up lookup. Without
# this the AI module's register-routes.ts (and every other module
# that requires `express` / `bullmq` / `ws` from a /tmp clone) fails
# with MODULE_NOT_FOUND on first import, taking down the module's
# entire route surface. Same pattern as docker/worker/Dockerfile.
RUN ln -sfn /app/node_modules /node_modules

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
COPY docker/shared/aggregate-module-deps.mjs /docker/shared/aggregate-module-deps.mjs
RUN chmod +x /docker-entrypoint.sh

# Bake module npm deps at image-build time.
#
# Modules can declare server-side npm deps (e.g. `openai` in
# @gatewaze-modules/ai, `ws` in editor-ai-copilot) that are NOT in
# the api's own package.json. Without these on disk, the api's
# registerModuleRoutes() throws MODULE_NOT_FOUND on the first
# unresolvable require() and the outer catch takes down ALL module
# routes — not just the offending one.
#
# Doing a runtime `pnpm install` per-module from the entrypoint is
# too slow: the chart's liveness probe (delay 10s, period 15s,
# failureThreshold 3 → ~55s) kills the pod long before the install
# finishes, restart-looping the api (v1.2.31 incident, 2026-05-20).
#
# Instead, run the entrypoint with PREBUILD=1 here so it clones each
# MODULE_SOURCES repo into /app/.gatewaze-modules/<slug> (the path
# loader.ts uses at runtime) and pnpm-installs per module. The
# resulting node_modules trees get baked into the image; runtime
# entrypoint sees them and skips the install (fast path).
#
# Brands using a MODULE_SOURCES superset of the bake-time set get a
# no-op runtime install. Brands that override with a module repo we
# didn't bake fall back to a runtime install for that repo only
# (slow path — but at least localised, and we have a clear log line
# pointing at the cause).
#
# Wrap in `|| (...)` so a private-repo clone failure during build
# doesn't abort the image — same defence as docker/admin/Dockerfile.
ARG BUILD_TIME_MODULE_SOURCES="https://github.com/gatewaze/gatewaze-modules.git#branch=main&path=modules,https://github.com/gatewaze/lf-gatewaze-modules.git#branch=main&path=modules"
ARG BUILD_TIME_GITHUB_TOKEN=""
ENV BUILD_TIME_MODULE_SOURCES=$BUILD_TIME_MODULE_SOURCES
RUN MODULE_SOURCES="$BUILD_TIME_MODULE_SOURCES" \
    GITHUB_TOKEN="$BUILD_TIME_GITHUB_TOKEN" \
    PREBUILD=1 \
    /docker-entrypoint.sh \
  || echo "[api] PREBUILD failed — runtime entrypoint will fall through to slow install path"

# Runs as root: the entrypoint creates symlinks under / for cloned module
# repos and writes .gitconfig. Restrict via the chart's api.securityContext
# if your threat model requires it (will need companion app changes).

EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "const http = require('http'); http.get('http://localhost:3002/api/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));" || exit 1

# Use entrypoint to clone modules, then start with tsx
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["npx", "tsx", "packages/api/dist/server.js"]
