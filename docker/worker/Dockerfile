# Worker Dockerfile
# Processes background jobs from the BullMQ queue
# Includes Puppeteer for scraper jobs and Goose CLI for recipe execution

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

# Install Goose CLI. Use TARGETARCH (set automatically by docker
# buildx) to pick the right tarball — Linux/aarch64 for ARM builds,
# Linux/x86_64 otherwise. Verify the binary launches after install
# so an upstream change to the tarball layout fails the build loudly
# instead of silently shipping a broken worker.
ARG TARGETARCH=amd64
RUN set -eux; \
    case "$TARGETARCH" in \
      amd64) goose_target=x86_64-unknown-linux-gnu ;; \
      arm64) goose_target=aarch64-unknown-linux-gnu ;; \
      *) echo "unsupported TARGETARCH=$TARGETARCH"; exit 1 ;; \
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
# at /premium-gatewaze-modules need a node_modules somewhere in that ancestor chain.
# Using `ln -sfn` so it always creates/replaces the symlink and fails loudly on real errors.
RUN ln -sfn /app/node_modules /node_modules && \
    ls -la /node_modules && \
    ls /node_modules/node-ical/package.json

# Copy the same entrypoint the api image uses: it clones MODULE_SOURCES into
# /tmp/module-repos and symlinks them under / before handing off to CMD.
# Without this the worker crashes on `import '/premium-gatewaze-modules/...'`.
COPY docker/api/entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh && mkdir -p /tmp/module-repos

# Runs as root: the entrypoint writes symlinks under / and .gitconfig under
# the user's home. Override via the chart's worker.securityContext if needed.

# Health check - verify worker can connect to Redis
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD node scripts/workers/health-check.js || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "scripts/workers/job-worker.js"]
