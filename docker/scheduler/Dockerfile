# Scheduler Dockerfile
# Runs background jobs (scraper scheduler, embedding scheduler) and
# any module-declared `schedulers[]` cron handlers (start-scheduler.js
# calls loadModules() and dynamic-imports each handler at startup).

FROM node:22-slim

# Install Chromium + git (loadModules clones MODULE_SOURCES at runtime)
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    git \
    ca-certificates \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set Puppeteer to use system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production

WORKDIR /app

# Copy package files and install dependencies
COPY scripts/package.json scripts/package-lock.json ./
RUN npm ci

# Copy scraper scripts
COPY scripts/ ./scripts/

# Bake module npm deps at image-build time.
#
# start-scheduler.js calls loadModules() and dynamic-imports each
# module's scheduler `handler`. Those handlers `require()` their
# declared deps (e.g. AI module's daily-briefing-research scheduler
# imports `openai`). scripts/package.json only has core scheduler
# deps — module-side deps must also live in /app/node_modules so
# Node's resolver finds them when the handler loads.
#
# Same approach as the worker image: clone MODULE_SOURCES, aggregate
# every module's `dependencies`, merge into /app/package.json, run
# one npm install. At runtime loadModules sees existing repos in
# /app/.gatewaze-modules and `git pull`s instead of re-cloning.
COPY docker/shared/aggregate-module-deps.mjs /docker/shared/aggregate-module-deps.mjs
ARG BUILD_TIME_MODULE_SOURCES="https://github.com/gatewaze/gatewaze-modules.git#branch=main&path=modules,https://github.com/gatewaze/premium-gatewaze-modules.git#branch=main&path=modules,https://github.com/gatewaze/lf-gatewaze-modules.git#branch=main&path=modules"
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
      echo "[scheduler-prebuild] Cloning $url -> $target (branch: $branch)"; \
      git clone --depth 1 --branch "$branch" "$url" "$target" >/dev/null 2>&1 \
        || echo "[scheduler-prebuild] Warning: failed to clone $url"; \
    done; \
    unset IFS; \
    node /docker/shared/aggregate-module-deps.mjs /app/package.json; \
    cd /app && npm install --omit=dev 2>&1 | tail -5 \
      || echo "[scheduler-prebuild] Warning: npm install for aggregated module deps failed"

# Create non-root user for security
RUN groupadd -r gatewaze && useradd -r -g gatewaze gatewaze \
    && chown -R gatewaze:gatewaze /app

USER gatewaze

CMD ["node", "scripts/scheduler/start-scheduler.js"]
