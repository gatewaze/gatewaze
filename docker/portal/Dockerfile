# Single stage: clone modules at startup, build Next.js, serve
#
# Unlike the previous multi-stage build that baked a Next.js standalone
# bundle into the image, this container keeps the full source and dev deps
# so the entrypoint can clone MODULE_SOURCES at pod start, regenerate the
# module registry, and run `next build` — mirroring how the admin image
# works, so premium-module event pages make it into the bundle.
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3100 \
    HOSTNAME=0.0.0.0

# Workspace root
COPY package.json tsconfig.json gatewaze.config.ts ./
RUN printf 'packages:\n  - "packages/*"\n' > pnpm-workspace.yaml

# Package manifests for dependency resolution
COPY packages/portal/package.json packages/portal/
COPY packages/shared/package.json packages/shared/

# Install all deps — dev deps are needed for `next build` at runtime.
# `--config.dangerously-allow-all-builds=true` is required on pnpm 10+:
# without it `pnpm install` exits non-zero on ERR_PNPM_IGNORED_BUILDS
# for sharp / esbuild / @sentry/cli native build scripts. CI trusts the
# lockfile, so allow build scripts to run.
RUN --mount=type=cache,id=pnpm-portal,target=/root/.local/share/pnpm/store \
    pnpm install --no-frozen-lockfile --config.dangerously-allow-all-builds=true

# Source
COPY packages/shared/ packages/shared/
COPY packages/portal/ packages/portal/

# Shared lib is a compiled TS package that the portal imports
RUN pnpm --filter shared build

# Writable dirs for runtime clones + build artifacts
RUN mkdir -p /tmp/module-repos /app/packages/portal/.next

COPY docker/portal/entrypoint.sh /docker-entrypoint.sh
COPY docker/shared/aggregate-module-deps.mjs /docker/shared/aggregate-module-deps.mjs
RUN chmod +x /docker-entrypoint.sh

# Bake module npm deps at image-build time.
#
# Portal's Next.js build at pod start needs every module-side npm dep
# (@react-email/components, etc.) resolvable from /app/node_modules,
# because Webpack walks up from cloned module code at /<reponame>/
# modules/<id>/... and never reaches a module's own node_modules. The
# workspace pnpm install above only covers portal + shared deps; without
# this prebuild step, the first module that introduces a new npm dep
# breaks `next build` with MODULE_NOT_FOUND. Mirrors the api + worker
# pattern (docker/api/Dockerfile, docker/worker/Dockerfile).
ARG BUILD_TIME_MODULE_SOURCES="https://github.com/gatewaze/gatewaze-modules.git#branch=main&path=modules,https://github.com/gatewaze/lf-gatewaze-modules.git#branch=main&path=modules"
ARG BUILD_TIME_GITHUB_TOKEN=""
ENV BUILD_TIME_MODULE_SOURCES=$BUILD_TIME_MODULE_SOURCES
RUN if [ -n "$BUILD_TIME_GITHUB_TOKEN" ]; then \
      git config --global url."https://x-token:${BUILD_TIME_GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/"; \
    fi; \
    mkdir -p /app/.gatewaze-modules; \
    IFS=','; \
    for source in $BUILD_TIME_MODULE_SOURCES; do \
      url="${source%%#*}"; \
      fragment=""; \
      case "$source" in *\#*) fragment="${source#*#}" ;; esac; \
      case "$url" in http://*|https://*|git://*|git@*|*.git) ;; *) continue ;; esac; \
      branch="main"; \
      if [ -n "$fragment" ]; then \
        _OLD_IFS=$IFS; IFS=' '; \
        for kv in $(echo "$fragment" | tr '&' ' '); do \
          case "$kv" in branch=*) branch="${kv#branch=}" ;; esac; \
        done; \
        IFS=$_OLD_IFS; \
      fi; \
      slug=$(printf '%s' "$url" | sed -E 's|^https?://||; s|^git://||; s|^git@||' | sed -E 's|\.git$||' | sed -E 's|[^a-zA-Z0-9-]|-|g'); \
      target="/app/.gatewaze-modules/$slug"; \
      [ -d "$target/.git" ] && continue; \
      echo "[portal-prebuild] Cloning $url -> $target (branch: $branch)"; \
      git clone --depth 1 --branch "$branch" "$url" "$target" >/dev/null 2>&1 \
        || echo "[portal-prebuild] Warning: failed to clone $url"; \
    done; \
    unset IFS; \
    node /docker/shared/aggregate-module-deps.mjs /app/packages/portal/package.json; \
    cd /app && pnpm install --no-frozen-lockfile --config.dangerously-allow-all-builds=true 2>&1 | tail -5 \
      || echo "[portal-prebuild] Warning: pnpm install for aggregated module deps failed"

EXPOSE 3100

# Build takes 2-5 min depending on modules; give probes plenty of room.
HEALTHCHECK --interval=30s --timeout=5s --start-period=600s --retries=3 \
    CMD curl -f http://localhost:3100/api/health || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
