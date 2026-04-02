# Scheduler Dockerfile
# Runs background jobs (scraper scheduler, embedding scheduler)

FROM node:20-slim

# Install Chromium and dependencies for browser automation
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set Puppeteer to use system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production

WORKDIR /app

# Copy package files and install dependencies
COPY scripts/package.json scripts/package-lock.json ./
RUN npm ci

# Copy scraper scripts
COPY scripts/ ./scripts/

# Create non-root user for security
RUN groupadd -r gatewaze && useradd -r -g gatewaze gatewaze \
    && chown -R gatewaze:gatewaze /app

USER gatewaze

CMD ["node", "scripts/scheduler/start-scheduler.js"]
