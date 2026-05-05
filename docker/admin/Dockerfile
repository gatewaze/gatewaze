# Single stage: clone modules at startup, build, and serve
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates nginx curl && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace root files
COPY package.json ./
COPY tsconfig.json ./
COPY gatewaze.config.ts ./

# Use a workspace config that only includes local packages
RUN printf 'packages:\n  - "packages/*"\n' > pnpm-workspace.yaml

# Copy source code and package manifests (includes unmodified package.json with all deps)
COPY packages/admin/ packages/admin/
COPY packages/shared/ packages/shared/

# Verify react-leaflet is in package.json (catch Docker cache issues)
RUN grep -q react-leaflet packages/admin/package.json || (echo "ERROR: react-leaflet missing from package.json - Docker cache is stale" && exit 1)

# Copy nginx config
COPY docker/admin/nginx.conf /etc/nginx/conf.d/default.conf
RUN rm -f /etc/nginx/sites-enabled/default

# Create directory for built output
RUN mkdir -p /usr/share/nginx/html

# Copy entrypoint script
COPY docker/admin/entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=3s --start-period=300s --retries=3 \
    CMD curl -f http://localhost/healthz || exit 1

CMD ["/docker-entrypoint.sh"]
