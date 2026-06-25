# Worker Dockerfile
# Processes background jobs from the BullMQ queue
# Includes Puppeteer for scraper jobs and Goose CLI for recipe execution

# ---- Stage 1: Build @gatewaze/shared ----
# Module job handlers transitively import from `@gatewaze/shared/modules`
# (e.g. the AI module's secret-shim.ts). Without shared compiled into the
# worker image the handler chain throws MODULE_NOT_FOUND on first require
# and the dispatcher logs a silent no-op. Mirror the api image's pattern:
# build packages/shared/dist in a builder stage, copy + symlink into the
# runtime image so Node's resolver finds it from cloned module code.
FROM node:22-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY package.json ./
COPY tsconfig.json ./
RUN printf 'packages:\n  - "packages/*"\n' > pnpm-workspace.yaml
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm-worker,target=/root/.local/share/pnpm/store \
    pnpm install --no-frozen-lockfile --config.dangerously-allow-all-builds=true --filter @gatewaze/shared...
COPY packages/shared/ packages/shared/
RUN pnpm --filter @gatewaze/shared build

# ---- Stage 2: Runtime ----
FROM node:22-slim

# Goose CLI version. Pinned for build reproducibility — Renovate watches
# block/goose releases and opens a PR when a new tag lands. Bump
# deliberately (review the release notes; Goose ships breaking
# extension-API changes inside minor versions occasionally).
ARG GOOSE_VERSION=v1.34.1

# Install Chromium, git (entrypoint clones module repos), openssh-client
# (publish-worker mirrors theme git repos to GitHub via ssh deploy keys —
# without ssh present, `git push` to the deploy-keyed remote 127s with
# "ssh: not found" and the mirror stays stale), curl + bzip2 (for the
# Goose tarball below), Python + uv (for stdio MCP extensions that
# Goose recipes load via `uvx <pkg>`), plus dependencies.
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    git \
    openssh-client \
    ca-certificates \
    curl \
    bzip2 \
    python3 \
    python3-pip \
    pipx \
    libgomp1 \
    libxcb1 \
    libdbus-1-3 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/* \
    # Replace crashpad handler with a wrapper that provides the required --database flag
    && mv /usr/lib/chromium/chrome_crashpad_handler /usr/lib/chromium/chrome_crashpad_handler.real \
    && printf '#!/bin/sh\nexec /usr/lib/chromium/chrome_crashpad_handler.real --database=/tmp/crashpad "$@"\n' > /usr/lib/chromium/chrome_crashpad_handler \
    && chmod +x /usr/lib/chromium/chrome_crashpad_handler \
    && mkdir -p /tmp/crashpad

# Install uv (provides `uvx` — Goose recipes load stdio MCP extensions
# like `uvx beads-mcp`). pipx places it at /root/.local/bin which we
# add to PATH below.
RUN PIPX_HOME=/opt/pipx PIPX_BIN_DIR=/usr/local/bin pipx install uv

# Install Goose CLI. Detect the architecture from `uname -m` rather
# than relying on the docker-buildx TARGETARCH build arg — on Apple
# Silicon hosts building an amd64 image without an explicit
# --platform, the build runs under Rosetta translation but the
# upstream Goose x86_64-gnu tarball can't load /lib64/ld-linux-x86-64.so.2
# through Rosetta on slim base images. Reading the *actual* container
# arch sidesteps that: an ARM64-native worker pulls the aarch64 tarball
# and runs natively; an x86_64-native worker (CI, prod x86 nodes)
# pulls the x86_64 tarball as before.
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

# Tell Puppeteer to use the system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production

WORKDIR /app

# Copy package files and install dependencies
COPY scripts/package.json scripts/package-lock.json ./
RUN npm ci

# Copy scraper scripts
COPY scripts/ ./scripts/

# Ensure Chrome cache is accessible
RUN mkdir -p /tmp/crashpad && chmod 777 /tmp/crashpad

# Symlink node_modules to locations where mounted module scripts can find packages.
# ESM resolution walks up from the importing file's directory, so modules mounted
# at e.g. /gatewaze-modules or /lf-gatewaze-modules need a node_modules somewhere
# in that ancestor chain.
# Using `ln -sfn` so it always creates/replaces the symlink and fails loudly on real errors.
RUN ln -sfn /app/node_modules /node_modules && \
    ls -la /node_modules && \
    ls /node_modules/node-ical/package.json

# Copy the same entrypoint the api image uses: it clones MODULE_SOURCES into
# /tmp/module-repos and symlinks them under / before handing off to CMD.
# Without this the worker crashes on `import '/lf-gatewaze-modules/...'`
# (or any other top-level module-repo path the modules register against).
COPY docker/api/entrypoint.sh /docker-entrypoint.sh
COPY docker/shared/aggregate-module-deps.mjs /docker/shared/aggregate-module-deps.mjs
RUN chmod +x /docker-entrypoint.sh && mkdir -p /tmp/module-repos

# Bake module npm deps at image-build time.
#
# Worker dispatches BullMQ jobs to handlers in modules (AI research,
# scraper runs, content jobs, etc.). Those handlers `require()` their
# declared dependencies (e.g. `openai` for the AI module). scripts/
# package.json only contains the core worker deps — module-side deps
# must also live in /app/node_modules so Node's resolver finds them
# when walking up from `/<reponame>/modules/<id>/...` (the symlinks
# the entrypoint creates point here via the /node_modules symlink
# set above).
#
# At runtime the same entrypoint just clones modules and exec's CMD;
# no install runs (the deps are baked in). If a brand pulls a module
# repo we didn't bake, its handlers will crash on first dispatch —
# matches the api behaviour and is loud rather than silent.
ARG BUILD_TIME_MODULE_SOURCES="https://github.com/gatewaze/gatewaze-modules.git#branch=main&path=modules,https://github.com/gatewaze/lf-gatewaze-modules.git#branch=main&path=modules"
ARG BUILD_TIME_GITHUB_TOKEN=""
ENV BUILD_TIME_MODULE_SOURCES=$BUILD_TIME_MODULE_SOURCES
RUN if [ -n "$BUILD_TIME_GITHUB_TOKEN" ]; then \
      git config --global url."https://x-token:${BUILD_TIME_GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/"; \
    fi; \
    mkdir -p /app/.gatewaze-modules; \
    IFS=','; \
    for source in $BUILD_TIME_MODULE_SOURCES; do \
      url="${source%%#*}"; \
      fragment=""; \
      case "$source" in *\#*) fragment="${source#*#}" ;; esac; \
      case "$url" in http://*|https://*|git://*|git@*|*.git) ;; *) continue ;; esac; \
      branch="main"; \
      if [ -n "$fragment" ]; then \
        _OLD_IFS=$IFS; IFS=' '; \
        for kv in $(echo "$fragment" | tr '&' ' '); do \
          case "$kv" in branch=*) branch="${kv#branch=}" ;; esac; \
        done; \
        IFS=$_OLD_IFS; \
      fi; \
      slug=$(printf '%s' "$url" | sed -E 's|^https?://||; s|^git://||; s|^git@||' | sed -E 's|\.git$||' | sed -E 's|[^a-zA-Z0-9-]|-|g'); \
      target="/app/.gatewaze-modules/$slug"; \
      [ -d "$target/.git" ] && continue; \
      echo "[worker-prebuild] Cloning $url -> $target (branch: $branch)"; \
      git clone --depth 1 --branch "$branch" "$url" "$target" >/dev/null 2>&1 \
        || echo "[worker-prebuild] Warning: failed to clone $url"; \
    done; \
    unset IFS; \
    node /docker/shared/aggregate-module-deps.mjs /app/package.json; \
    cd /app && npm install --omit=dev 2>&1 | tail -5 \
      || echo "[worker-prebuild] Warning: npm install for aggregated module deps failed"

# Copy compiled @gatewaze/shared from the builder stage and expose it as a
# package in the runtime node_modules. Module job handlers transitively
# import from `@gatewaze/shared/modules` (AI sync, etc.); without this they
# throw MODULE_NOT_FOUND at handler load time and the dispatcher silently
# no-ops. Placed AFTER the module-deps `npm install` so its prune step
# can't remove the symlink as extraneous. Build-time require.resolve
# fails the image build loudly if the package layout is wrong.
COPY --from=builder /app/packages/shared/package.json packages/shared/package.json
COPY --from=builder /app/packages/shared/dist packages/shared/dist
RUN mkdir -p node_modules/@gatewaze && \
    ln -sfn /app/packages/shared node_modules/@gatewaze/shared && \
    node -e 'console.log("shared resolves:", require.resolve("@gatewaze/shared/modules"))'

# Runs as root: the entrypoint writes symlinks under / and .gitconfig under
# the user's home. Override via the chart's worker.securityContext if needed.

# Health check - verify worker can connect to Redis
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD node scripts/workers/health-check.js || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["npx", "tsx", "scripts/workers/job-worker.js"]
