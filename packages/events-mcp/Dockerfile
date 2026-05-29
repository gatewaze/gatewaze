# Dedicated MCP service: serves the events_* tools (luma-syncable read +
# luma_sync_* writeback) over streamable HTTP using a service-role Supabase
# client. Registered in ai_mcp_servers as type=streamable_http and reached by
# the recipe executor at http://events-mcp:8080/mcp on the internal network.
# Self-contained npm build (events-mcp has only external deps).
FROM node:22-slim

ENV NODE_ENV=production \
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
