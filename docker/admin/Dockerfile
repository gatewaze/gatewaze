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

# Build with placeholder values that get replaced at container start
RUN printf "VITE_SUPABASE_URL=__VITE_SUPABASE_URL__\nVITE_SUPABASE_ANON_KEY=__VITE_SUPABASE_ANON_KEY__\nVITE_API_URL=__VITE_API_URL__\nVITE_AUTH_PROVIDER=__VITE_AUTH_PROVIDER__\nVITE_DISABLE_BRANDING=__VITE_DISABLE_BRANDING__\n" \
  > packages/admin/.env.production

# Build with Vite only (skip tsc -b which has issues with project references in Docker)
RUN cd packages/admin && npx vite build

# ---- Stage 2: Serve ----
FROM nginx:alpine

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy custom nginx config
COPY docker/admin/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets from builder stage
COPY --from=builder /app/packages/admin/dist /usr/share/nginx/html

# Runtime env injection script — replaces __VITE_*__ placeholders in JS
RUN printf '#!/bin/sh\nset -e\nfor f in /usr/share/nginx/html/assets/*.js; do\n  sed -i \\\n    -e "s|__VITE_SUPABASE_URL__|${VITE_SUPABASE_URL}|g" \\\n    -e "s|__VITE_SUPABASE_ANON_KEY__|${VITE_SUPABASE_ANON_KEY}|g" \\\n    -e "s|__VITE_API_URL__|${VITE_API_URL}|g" \\\n    -e "s|__VITE_AUTH_PROVIDER__|${VITE_AUTH_PROVIDER:-supabase}|g" \\\n    -e "s|__VITE_DISABLE_BRANDING__|${VITE_DISABLE_BRANDING:-false}|g" \\\n    "$f"\ndone\nexec nginx -g "daemon off;"\n' > /docker-entrypoint.sh \
    && chmod +x /docker-entrypoint.sh

EXPOSE 80

CMD ["/docker-entrypoint.sh"]
