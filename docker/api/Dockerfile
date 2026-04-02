# ---- Stage 1: Build ----
FROM node:20-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@latest --activate

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

# Install all dependencies (cache pnpm store between builds)
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
FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

ENV NODE_ENV=production

# Copy workspace root files
COPY package.json ./

# Use a workspace config that only includes local packages
RUN printf 'packages:\n  - "packages/*"\n' > pnpm-workspace.yaml

# Copy package manifests
COPY packages/api/package.json packages/api/
COPY packages/shared/package.json packages/shared/

# Install production dependencies only (cache pnpm store between builds)
RUN --mount=type=cache,id=pnpm-api,target=/root/.local/share/pnpm/store \
    pnpm install --no-frozen-lockfile --prod

# Copy built output
COPY --from=builder /app/packages/api/dist/packages/api/src packages/api/dist
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/packages/api/dist/gatewaze.config.js ./

# Link shared package to root node_modules so Node ESM resolver can find it
RUN mkdir -p node_modules/@gatewaze && ln -s ../../packages/shared node_modules/@gatewaze/shared

# Copy default modules (cloned at build time)
COPY --from=builder /gatewaze-modules/modules /gatewaze-modules/modules

# Create writable directories for runtime git clones and uploaded modules
RUN mkdir -p /app/.gatewaze-modules /app/data

# Create non-root user and grant access to writable directories
RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 appuser && \
    chown -R appuser:appgroup /app/.gatewaze-modules /app/data
USER appuser

EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "const http = require('http'); http.get('http://localhost:3002/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));" || exit 1

# Use tsx to support dynamic import of TypeScript module files at runtime
CMD ["npx", "tsx", "packages/api/dist/server.js"]
