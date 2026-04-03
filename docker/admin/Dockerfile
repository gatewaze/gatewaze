# Single stage: clone modules at startup, build, and serve
FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates nginx curl && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace root files
COPY package.json ./
COPY tsconfig.json ./
COPY gatewaze.config.ts ./

# Use a workspace config that only includes local packages
RUN printf 'packages:\n  - "packages/*"\n' > pnpm-workspace.yaml

# Copy package manifests for dependency resolution
COPY packages/admin/package.json packages/admin/
COPY packages/shared/package.json packages/shared/

# Strip @gatewaze-modules/* deps (resolved by Vite plugin at runtime, not by pnpm)
RUN node -e " \
  const pkg = require('./packages/admin/package.json'); \
  pkg.dependencies = Object.fromEntries( \
    Object.entries(pkg.dependencies || {}).filter(([k]) => !k.startsWith('@gatewaze-modules/')) \
  ); \
  require('fs').writeFileSync('./packages/admin/package.json', JSON.stringify(pkg, null, 2) + '\n'); \
"

# Install dependencies (cache pnpm store between builds)
RUN --mount=type=cache,id=pnpm-admin,target=/root/.local/share/pnpm/store \
    pnpm install --no-frozen-lockfile

# Copy source code
COPY packages/shared/ packages/shared/
COPY packages/admin/ packages/admin/

# Copy nginx config
COPY docker/admin/nginx.conf /etc/nginx/conf.d/default.conf
RUN rm -f /etc/nginx/sites-enabled/default

# Create directories for modules and built output
RUN mkdir -p /gatewaze-modules /usr/share/nginx/html

# Copy entrypoint script
COPY docker/admin/entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=3s --start-period=120s --retries=3 \
    CMD curl -f http://localhost/healthz || exit 1

CMD ["/docker-entrypoint.sh"]
