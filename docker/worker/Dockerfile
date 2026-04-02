# Worker Dockerfile
# Processes background jobs from the BullMQ queue
# Includes Puppeteer for scraper jobs

FROM node:20-slim

# Install Chromium and dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
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

# Create non-root user for security and ensure Chrome cache is accessible
RUN groupadd -r gatewaze && useradd -r -g gatewaze gatewaze \
    && chown -R gatewaze:gatewaze /app \
    && mkdir -p /tmp/crashpad && chmod 777 /tmp/crashpad

USER gatewaze

# Health check - verify worker can connect to Redis
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD node scripts/workers/health-check.js || exit 1

CMD ["node", "scripts/workers/job-worker.js"]
