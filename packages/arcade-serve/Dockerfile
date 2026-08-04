# Arcade Serve — the only application behind PLAY_ORIGIN (play.<domain>).
# Serves versioned game snapshots out of the private `arcade` storage bucket
# with the §6 header contract, plus /sdk/*, /healthz, /readyz and /metrics.
# See spec-arcade-module.md §3, §6, §13.
#
# Self-contained npm build (this package is not in the pnpm workspace graph);
# only external deps, so no monorepo context is needed.
FROM node:22-slim

ENV NODE_ENV=production \
    PORT=8080

WORKDIR /app

# Install from the committed lockfile (`npm ci`, not `npm install`) so a cache
# bust cannot float a caret dependency to a new release — the failure mode that
# broke a worker image once already. Dev deps are forced despite
# NODE_ENV=production so tsc is present; the runtime image is pruned below.
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# The SDK is plain JS with no build step; it is served verbatim from /sdk/*.
# It sits beside dist/ so `new URL('../sdk/…', import.meta.url)` resolves.
COPY sdk ./sdk

# No shell tools, no write paths: the service only reads Postgres and storage.
USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:8080/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/index.js"]
