# Admin BFF (packages/admin-bff): the session holder for the admin SPA in
# host-session mode (VITE_AUTH_MODE=host-session). Self-contained: besides
# external npm dependencies it needs only packages/host-session (its
# framework-free core, built here from the workspace), so no module sources
# and no PAT are needed.
# See docs/admin-bff.md.
#
# The base image is pinned by digest (node:22-slim, multi-arch index) so a
# rebuild of the same commit gets the same base. Bump it deliberately.
ARG NODE_IMAGE=node:22-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392

# ---- Stage 1: Build ----
FROM ${NODE_IMAGE} AS builder

RUN corepack enable && corepack prepare pnpm@10.31.0 --activate

WORKDIR /app

# The committed lockfile pins every version. The workspace is narrowed to
# this package and host-session, and --filter installs only their importers
# ("admin-bff..." selects admin-bff and its workspace dependencies), so the
# lockfile's entries for the other packages (and for the sibling
# gatewaze-modules checkout, which is absent here) are not needed.
COPY package.json pnpm-lock.yaml ./
RUN printf 'packages:\n  - "packages/admin-bff"\n  - "packages/host-session"\n' > pnpm-workspace.yaml
COPY packages/admin-bff/package.json packages/admin-bff/
COPY packages/host-session/package.json packages/host-session/

RUN --mount=type=cache,id=pnpm-admin-bff,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@gatewaze/admin-bff..."

COPY packages/host-session/tsconfig.json packages/host-session/tsconfig.build.json packages/host-session/
COPY packages/host-session/src packages/host-session/src
RUN pnpm --filter @gatewaze/host-session build

COPY packages/admin-bff/tsconfig.json packages/admin-bff/tsconfig.build.json packages/admin-bff/
COPY packages/admin-bff/src packages/admin-bff/src
RUN pnpm --filter @gatewaze/admin-bff build

# ---- Stage 2: Production dependencies ----
# A separate install with --prod, so the runtime stage needs neither pnpm
# nor corepack. pnpm also installs the workspace root's two dependencies
# (pdf-lib, about 28 MB); trimming the root manifest would break
# --frozen-lockfile, so they are left in.
FROM ${NODE_IMAGE} AS deps

RUN corepack enable && corepack prepare pnpm@10.31.0 --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN printf 'packages:\n  - "packages/admin-bff"\n  - "packages/host-session"\n' > pnpm-workspace.yaml
COPY packages/admin-bff/package.json packages/admin-bff/
COPY packages/host-session/package.json packages/host-session/
RUN --mount=type=cache,id=pnpm-admin-bff,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter "@gatewaze/admin-bff..." --ignore-scripts

# ---- Stage 3: Run ----
FROM ${NODE_IMAGE}

ENV NODE_ENV=production \
    PORT=3001

WORKDIR /app
COPY --from=deps /app /app
COPY --from=builder /app/packages/host-session/dist packages/host-session/dist
COPY --from=builder /app/packages/admin-bff/dist packages/admin-bff/dist

WORKDIR /app/packages/admin-bff

# The image's built-in unprivileged user. The BFF writes nothing to disk, so
# the files stay owned by root and read-only to it.
USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/bff/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/server.js"]
