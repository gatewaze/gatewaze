#!/bin/sh
# Dev-only: install npm deps declared by bind-mounted (and cloned) modules into
# /app/node_modules so the api/worker can resolve them at runtime.
#
# The prod images bake module deps at build via the entrypoint's PREBUILD
# aggregation over cloned MODULE_SOURCES. The *dev* images don't run that path
# and the bind-mounted module sources (/gatewaze-modules, /lf-gatewaze-modules)
# aren't in the build context — so a module's own deps (openai, cheerio,
# @anthropic-ai/claude-agent-sdk, ...) are missing from /app/node_modules and
# every module that requires one fails to load with MODULE_NOT_FOUND, taking
# down its whole route/handler surface.
#
# Approach: aggregate every module's `dependencies` -> keep only what isn't
# already resolvable from /app -> isolated `npm install` (npm can't run inside
# the pnpm workspace at /app: "Cannot read properties of null (reading
# 'name')") -> copy into /app/node_modules with cp -Rn so the pnpm-managed
# packages already there are never clobbered. Runs once per container start;
# on a warm /app/node_modules everything resolves and it is a no-op.
set -e

WORK=/tmp/module-deps
AGG=/docker/shared/aggregate-module-deps.mjs
mkdir -p "$WORK"
echo '{"name":"gatewaze-module-deps","version":"1.0.0","private":true,"dependencies":{}}' > "$WORK/package.json"

if [ -f "$AGG" ]; then
  node "$AGG" "$WORK/package.json" || echo "[dev-module-deps] aggregate step failed (continuing)"

  # Drop deps already resolvable from /app so we only install the missing ones.
  node -e '
    const fs = require("fs");
    const { createRequire } = require("module");
    const p = process.argv[1];
    const pkg = JSON.parse(fs.readFileSync(p, "utf8"));
    const dep = pkg.dependencies || {};
    const req = createRequire("/app/packages/api/package.json");
    for (const name of Object.keys(dep)) {
      try { req.resolve(name); delete dep[name]; } catch { /* keep: missing */ }
    }
    pkg.dependencies = dep;
    fs.writeFileSync(p, JSON.stringify(pkg, null, 2));
  ' "$WORK/package.json" || echo "[dev-module-deps] resolve-filter failed (continuing)"

  COUNT=$(node -e 'console.log(Object.keys((JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).dependencies)||{}).length)' "$WORK/package.json" 2>/dev/null || echo 0)
  if [ "$COUNT" -gt 0 ]; then
    echo "[dev-module-deps] installing $COUNT missing module dep(s)..."
    # --legacy-peer-deps: modules are independent packages with their own peer
    # ranges (e.g. conflicting zod majors between the agent SDK and another
    # module); strict npm peer resolution would ERESOLVE-abort the whole install
    # and leave every dep missing. We only need each package resolvable on disk,
    # not a single satisfiable peer graph, so install flat and ignore peers.
    ( cd "$WORK" && npm install --no-save --no-audit --no-fund --legacy-peer-deps --loglevel=error ) \
      || echo "[dev-module-deps] npm install reported errors (continuing)"
    if [ -d "$WORK/node_modules" ]; then
      cp -Rn "$WORK/node_modules/." /app/node_modules/ 2>/dev/null || true
    fi
    echo "[dev-module-deps] done."
  else
    echo "[dev-module-deps] all module deps already resolvable; nothing to install."
  fi
else
  echo "[dev-module-deps] $AGG not found; skipping module-dep install."
fi

exec "$@"
