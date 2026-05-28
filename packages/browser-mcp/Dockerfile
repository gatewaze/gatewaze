# Dedicated MCP service: serves the browser_* tools + browserbase_fetch/search
# over streamable HTTP. Registered in ai_mcp_servers as type=streamable_http and
# reached by the recipe executor at http://browser-mcp:8080/mcp on the internal
# network. Self-contained npm build (browser-mcp has only external deps).
FROM node:22-slim

# Chromium for the `local` backend (puppeteer-core uses the system binary).
# The `browserbase` backend runs the browser in Browserbase's cloud and does
# not need it, but the service supports either backend.
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    ca-certificates \
    libgomp1 \
    libxcb1 \
    libdbus-1-3 \
    --no-install-recommends \
 && rm -rf /var/lib/apt/lists/* \
 && mv /usr/lib/chromium/chrome_crashpad_handler /usr/lib/chromium/chrome_crashpad_handler.real \
 && printf '#!/bin/sh\nexec /usr/lib/chromium/chrome_crashpad_handler.real --database=/tmp/crashpad "$@"\n' > /usr/lib/chromium/chrome_crashpad_handler \
 && chmod +x /usr/lib/chromium/chrome_crashpad_handler \
 && mkdir -p /tmp/crashpad && chmod 777 /tmp/crashpad

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production \
    MCP_TRANSPORT=http \
    PORT=8080

WORKDIR /app

# Install (forcing dev deps despite NODE_ENV=production so tsc is present),
# compile, then prune to prod deps for the runtime image.
COPY package.json ./
RUN npm install --include=dev --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:8080/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/index.js"]
