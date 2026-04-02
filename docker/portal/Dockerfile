# ---- Stage 1: Build ----
FROM node:20-slim AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace root files (lockfile excluded – external workspace packages
# from ../gatewaze-modules are not available at build time)
COPY package.json ./
COPY tsconfig.json ./

# Use a workspace config that only includes local packages
RUN printf 'packages:\n  - "packages/*"\n' > pnpm-workspace.yaml

# Copy package manifests for dependency resolution
COPY packages/portal/package.json packages/portal/
COPY packages/shared/package.json packages/shared/

# Install dependencies (cache pnpm store between builds)
RUN --mount=type=cache,id=pnpm-portal,target=/root/.local/share/pnpm/store \
    pnpm install --no-frozen-lockfile

# Copy source code
COPY packages/shared/ packages/shared/
COPY packages/portal/ packages/portal/

# Build shared library first, then portal
RUN pnpm --filter shared build

# Next.js standalone output mode
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter portal build

# ---- Stage 2: Run ----
FROM node:20-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3100
ENV HOSTNAME="0.0.0.0"

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy standalone build output
COPY --from=builder --chown=nextjs:nodejs /app/packages/portal/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/packages/portal/.next/static ./packages/portal/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/packages/portal/public ./packages/portal/public

USER nextjs

EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "const http = require('http'); http.get('http://localhost:3100/api/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));" || exit 1

CMD ["node", "packages/portal/server.js"]
