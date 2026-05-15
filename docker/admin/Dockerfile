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

# Pre-build the admin bundle at image build time using a SUPERSET of
# the module sources every brand uses. At pod startup the entrypoint
# checks whether the runtime MODULE_SOURCES is a subset of the baked
# superset — if yes, copy the cached dist/ to nginx html (start in
# seconds rather than 5+ minutes). If the brand introduces a module
# source we didn't bake in, the entrypoint falls back to a full
# rebuild (current behaviour, unchanged).
#
# This is the single biggest reliability improvement for admin pods:
# fast cold-starts → faster recovery from node failures → less time
# in unhealthy state when the cluster has issues.
ARG BUILD_TIME_MODULE_SOURCES="https://github.com/gatewaze/gatewaze-modules.git#branch=main&path=modules,https://github.com/gatewaze/premium-gatewaze-modules.git#branch=main&path=modules,https://github.com/gatewaze/lf-gatewaze-modules.git#branch=main&path=modules"
ARG BUILD_TIME_GITHUB_TOKEN=""
ENV BUILD_TIME_MODULE_SOURCES=$BUILD_TIME_MODULE_SOURCES
ENV ADMIN_NODE_HEAP_MB=4608
# Wrap in `|| (clean up and warn)` so a private-repo clone failure or
# any other prebuild error doesn't abort the image build — the runtime
# entrypoint will fall back to a full rebuild on pod start, exactly
# the same behaviour as before the prebuild was added.
RUN MODULE_SOURCES="$BUILD_TIME_MODULE_SOURCES" \
    GITHUB_TOKEN="$BUILD_TIME_GITHUB_TOKEN" \
    PREBUILD=1 \
    /docker-entrypoint.sh && \
    mv /usr/share/nginx/html /usr/share/nginx/html-prebuilt && \
    mkdir -p /usr/share/nginx/html \
  || { \
    echo "[admin] Prebuild failed — runtime will do a full build (slow path)"; \
    rm -rf /usr/share/nginx/html-prebuilt 2>/dev/null || true; \
    mkdir -p /usr/share/nginx/html; \
  }

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=3s --start-period=300s --retries=3 \
    CMD curl -f http://localhost/healthz || exit 1

CMD ["/docker-entrypoint.sh"]
