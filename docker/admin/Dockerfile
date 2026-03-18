# ---- Stage 1: Build ----
FROM node:20-slim AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace root files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY tsconfig.json ./

# Copy package manifests for dependency resolution
COPY packages/admin/package.json packages/admin/
COPY packages/shared/package.json packages/shared/

# Install dependencies
RUN pnpm install --frozen-lockfile

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

# Build shared library first, then admin
RUN pnpm --filter shared build 2>/dev/null || true
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
