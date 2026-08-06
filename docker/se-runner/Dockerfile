# SE-runner Dockerfile — dedicated runner for the software-engineer module.
#
# Runs the SAME modern worker entry as the dev worker (packages/api/src/workers/
# job-worker.ts via tsx) but scoped to a single module: WORKER_MODULES=
# software-engineer + WORKER_BUILTIN_QUEUES="" (set by compose/helm) make this
# process load only the SE module and consume only its dedicated 'se' queue.
#
# Deliberately LEAN (spec §7.5 "software-engineer-runner"): Node + git + the
# Agent SDK — no Chromium, no Goose/uv/Python, no scraper toolchain. Agent
# phases are network/IO-bound (git clones + streaming model calls), so this
# image is a fraction of the standard worker's size and shares none of its
# crash surface (the Chromium-150 SIGTRAP class of failure can't touch it).
# The standard worker, in turn, excludes this module's deps entirely
# (docker/worker/Dockerfile MODULE_DEPS_EXCLUDE) — see the SE-runner split.

# ---- Stage 1: build @gatewaze/shared ----
FROM node:22-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.31.0 --activate
WORKDIR /app
COPY package.json ./
COPY tsconfig.json ./
RUN printf 'packages:\n  - "packages/*"\n' > pnpm-workspace.yaml
COPY packages/api/package.json packages/api/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm-se-runner,target=/root/.local/share/pnpm/store \
    pnpm install --no-frozen-lockfile
COPY packages/shared/ packages/shared/
# tsconfig.tsbuildinfo is gitignored, but an untracked local copy can still reach the
# build context, and a stale one makes `tsc -b` a no-op (no dist emitted, so the runtime
# COPY fails). Drop it first so the emit always happens.
RUN rm -f packages/shared/tsconfig.tsbuildinfo && pnpm --filter @gatewaze/shared build && test -d packages/shared/dist

# ---- Stage 2: runtime ----
FROM node:22-slim

# git: the agent clones project repos into per-run worktrees, and the
# entrypoint clones MODULE_SOURCES. curl: healthcheck convenience.
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.31.0 --activate

WORKDIR /app
ENV NODE_ENV=production

# Workspace install (api + shared deps) — the modern worker entry imports
# packages/api/src/lib/queue/*, which needs the api package's dependency set.
COPY package.json ./
COPY tsconfig.json ./
RUN printf 'packages:\n  - "packages/*"\n' > pnpm-workspace.yaml
COPY packages/api/package.json packages/api/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm-se-runner,target=/root/.local/share/pnpm/store \
    pnpm install --no-frozen-lockfile --prod=false

# Sources: api (worker entry + queue lib), built shared, config.
COPY gatewaze.config.ts ./
COPY packages/api/ packages/api/
COPY --from=builder /app/packages/shared/package.json packages/shared/package.json
COPY --from=builder /app/packages/shared/dist packages/shared/dist
RUN mkdir -p node_modules/@gatewaze && \
    ln -sfn /app/packages/shared node_modules/@gatewaze/shared && \
    node -e 'console.log("shared resolves:", require.resolve("@gatewaze/shared/modules"))'

# ESM resolution for module code mounted/cloned at /: modules import their
# deps by walking up from /<repo>/modules/<id>/..., so /node_modules must
# point at the image's node_modules.
RUN ln -sfn /app/node_modules /node_modules

# Entrypoint (clones MODULE_SOURCES → symlinks under /) + module-dep baking,
# scoped to ONLY the software-engineer module: this image carries the Agent
# SDK + SE deps and nothing from any other module.
COPY docker/api/entrypoint.sh /docker-entrypoint.sh
COPY docker/shared/aggregate-module-deps.mjs /docker/shared/aggregate-module-deps.mjs
RUN chmod +x /docker-entrypoint.sh && mkdir -p /tmp/module-repos

ARG BUILD_TIME_MODULE_SOURCES="https://github.com/gatewaze/gatewaze-modules.git#branch=main&path=modules"
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
      echo "[se-runner-prebuild] Cloning $url -> $target (branch: $branch)"; \
      git clone --depth 1 --branch "$branch" "$url" "$target" >/dev/null 2>&1 \
        || echo "[se-runner-prebuild] Warning: failed to clone $url"; \
    done; \
    unset IFS; \
    MODULE_DEPS_ONLY="software-engineer" node /docker/shared/aggregate-module-deps.mjs /app/package.json; \
    cd /app && pnpm install --no-frozen-lockfile 2>&1 | tail -5 \
      || echo "[se-runner-prebuild] Warning: install for SE module deps failed"

# Runs as root: the runner's agent sessions manage per-run git worktrees under
# /tmp and the entrypoint writes symlinks under /.

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["pnpm", "exec", "tsx", "packages/api/src/workers/job-worker.ts"]
