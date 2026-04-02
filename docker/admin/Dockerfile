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

# Build args for Vite (inlined at build time via .env file)
ARG VITE_SUPABASE_URL=http://gatewaze-supabase.localhost
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_API_URL=http://gatewaze-api.localhost
ARG VITE_AUTH_PROVIDER=supabase
ARG VITE_DISABLE_BRANDING=false

# Write .env file for Vite to read during build
RUN printf "VITE_SUPABASE_URL=%s\nVITE_SUPABASE_ANON_KEY=%s\nVITE_API_URL=%s\nVITE_AUTH_PROVIDER=%s\nVITE_DISABLE_BRANDING=%s\n" \
  "$VITE_SUPABASE_URL" "$VITE_SUPABASE_ANON_KEY" "$VITE_API_URL" "$VITE_AUTH_PROVIDER" "$VITE_DISABLE_BRANDING" \
  > packages/admin/.env.production

# Build admin (tsc -b handles shared via project references, then vite builds)
RUN pnpm --filter admin build

# ---- Stage 2: Serve ----
FROM nginx:alpine

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy custom nginx config
COPY docker/admin/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets from builder stage
COPY --from=builder /app/packages/admin/dist /usr/share/nginx/html

# Expose port 80
EXPOSE 80

# Nginx runs in foreground by default with this base image
CMD ["nginx", "-g", "daemon off;"]
