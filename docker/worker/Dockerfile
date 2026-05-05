# Worker Dockerfile
# Processes background jobs from the BullMQ queue
# Includes Puppeteer for scraper jobs

FROM node:22-slim

# Install Chromium, git (entrypoint clones module repos), and dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    git \
    ca-certificates \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/* \
    # Replace crashpad handler with a wrapper that provides the required --database flag
    && mv /usr/lib/chromium/chrome_crashpad_handler /usr/lib/chromium/chrome_crashpad_handler.real \
    && printf '#!/bin/sh\nexec /usr/lib/chromium/chrome_crashpad_handler.real --database=/tmp/crashpad "$@"\n' > /usr/lib/chromium/chrome_crashpad_handler \
    && chmod +x /usr/lib/chromium/chrome_crashpad_handler \
    && mkdir -p /tmp/crashpad

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
