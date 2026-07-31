# Public Gatewaze MCP service: serves the read-only tool profile
# (events_*, content_*, platform_health) over streamable HTTP with NO client
# authentication — the container holds a read-scoped platform API key
# (GATEWAZE_MCP_API_KEY) and calls the public REST API on clients' behalf.
# Per-IP rate limiting + CORS are handled in-process; traefik routes the
# public hostname here. Self-contained npm build (mcp has only external deps).
FROM node:22-slim

ENV NODE_ENV=production \
    MCP_TRANSPORT=http \
    MCP_PROFILE=public \
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
