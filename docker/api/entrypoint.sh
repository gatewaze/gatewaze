#!/bin/sh
set -e

# Configure git authentication if GITHUB_TOKEN is set
if [ -n "$GITHUB_TOKEN" ]; then
  git config --global url."https://x-token:${GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/"
fi

# Process MODULE_SOURCES (comma-separated). Each entry is either a git
# URL (optionally `#branch=main&path=modules`) or a local absolute path
# (volume-mounted in dev; skipped here). Git URLs get cloned and
# symlinked at /<reponame>. The open-source gatewaze-modules is already
# cloned at image build time.
if [ -n "$MODULE_SOURCES" ]; then
  IFS=','
  for source in $MODULE_SOURCES; do
    url="${source%%#*}"
    fragment=""
    case "$source" in *\#*) fragment="${source#*#}" ;; esac

    case "$url" in
      http://*|https://*|git://*|git@*|*.git) ;;
      *)
        continue
        ;;
    esac

    # Outer loop sets IFS=',' so the inner for-in over
    # `$(echo | tr '&' ' ')` would NOT word-split on spaces — the whole
    # `branch=main path=modules` would become one word, making the
    # branch parse to "main path=modules" and the git clone fail.
    branch="main"
    if [ -n "$fragment" ]; then
      _OLD_IFS=$IFS
      IFS=' '
      for kv in $(echo "$fragment" | tr '&' ' '); do
        case "$kv" in
          branch=*) branch="${kv#branch=}" ;;
        esac
      done
      IFS=$_OLD_IFS
    fi

    reponame=$(echo "$url" | sed 's|.*/||; s|\.git$||')
    target="/tmp/module-repos/$reponame"

    if [ -d "$target" ]; then
      continue
    fi

    echo "[api] Cloning $url (branch: $branch)..."
    git clone --depth 1 --branch "$branch" "$url" "$target" || {
      echo "[api] Warning: failed to clone $url"
      continue
    }

    rm -rf "/$reponame" 2>/dev/null || true
    ln -sf "$target" "/$reponame"
  done
  unset IFS
fi

# Module npm deps.
#
# The Node-side loader (packages/shared/src/modules/loader.ts
# cloneOrUpdateRepo) clones MODULE_SOURCES into /app/.gatewaze-modules/<slug>
# at api startup, then registerModuleRoutes() evaluates each enabled
# module's source — at which point Node resolves require('openai'),
# require('ws'), etc. relative to the cloned module dir. Module-specific
# npm deps are NOT in the api image's /app/node_modules out of the
# box, so without making them available Node throws MODULE_NOT_FOUND
# and the outer catch in registerModuleRoutes() swallows it, taking
# ALL module routes down (not just the offending module's).
#
# Approach: pre-clone each MODULE_SOURCES repo to the same path the
# loader uses, then aggregate every module's `dependencies` from its
# package.json into a flat list, merge into packages/api/package.json,
# and run a single `pnpm install` against the api workspace. The deps
# end up in /app/node_modules where Node's resolver finds them when
# walking up from cloned module code.
#
# Why this instead of per-module `pnpm install`: per-module install
# inherits the cloned repo's pnpm-workspace.yaml (gatewaze-modules
# and gatewaze-modules both have one with sibling-repo paths
# that don't exist in the container), causing pnpm to fall back to
# private-registry lookups it isn't authed for ("No authorization
# header was set for the request"). The aggregated approach runs
# install from /app's known-good workspace, sidestepping that whole
# class of problem.
if [ -n "$MODULE_SOURCES" ]; then
  echo "[api] Pre-populating /app/.gatewaze-modules..."
  mkdir -p /app/.gatewaze-modules
  IFS=','
  for source in $MODULE_SOURCES; do
    url="${source%%#*}"
    fragment=""
    case "$source" in *\#*) fragment="${source#*#}" ;; esac

    case "$url" in
      http://*|https://*|git://*|git@*|*.git) ;;
      *) continue ;;
    esac

    branch="main"
    if [ -n "$fragment" ]; then
      _OLD_IFS=$IFS
      IFS=' '
      for kv in $(echo "$fragment" | tr '&' ' '); do
        case "$kv" in
          branch=*) branch="${kv#branch=}" ;;
        esac
      done
      IFS=$_OLD_IFS
    fi

    # Slug rule MUST match loader.ts cloneOrUpdateRepo, otherwise the
    # runtime clone goes to a different path and our installed deps
    # are wasted.
    slug=$(printf '%s' "$url" \
      | sed -E 's|^https?://||; s|^git://||; s|^git@||' \
      | sed -E 's|\.git$||' \
      | sed -E 's|[^a-zA-Z0-9-]|-|g')
    target="/app/.gatewaze-modules/$slug"

    if [ ! -d "$target/.git" ]; then
      echo "[api] Cloning $url -> $target (branch: $branch)"
      if ! git clone --depth 1 --branch "$branch" "$url" "$target" >/dev/null 2>&1; then
        echo "[api] Warning: failed to pre-clone $url (loader will retry at runtime)"
        continue
      fi
    fi
  done
  unset IFS

  # PREBUILD only: aggregate deps + reinstall the api workspace. At
  # runtime, the api package.json already has these merged in (baked
  # into the image), so we don't redo install — the chart's liveness
  # probe gives only ~55s before it kills the pod, and a full pnpm
  # install is way over that.
  if [ -n "$PREBUILD" ]; then
    node /docker/shared/aggregate-module-deps.mjs /app/packages/api/package.json
    echo "[api] Reinstalling api workspace with aggregated module deps..."
    # --shamefully-hoist creates top-level symlinks at /app/node_modules
    # for every transitive dep. Required because Node's resolver walks
    # up from /app/.gatewaze-modules/<slug>/modules/<id>/... — it never
    # reaches /app/packages/api/node_modules where the strict pnpm
    # layout would put the symlinks. Without this, openai, ws, etc.
    # are in the pnpm store but MODULE_NOT_FOUND from cloned module
    # code.
    #
    # CI=true: switching layouts (strict → hoisted) makes pnpm want to
    # purge node_modules first, and it asks for TTY confirmation. In
    # docker build there is no TTY, so without this env var pnpm
    # aborts with ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY and the
    # whole install becomes a silent no-op. Show output in full
    # (no tail) so future failures surface clearly.
    (cd /app && CI=true pnpm install --no-frozen-lockfile --prod --shamefully-hoist --config.dangerously-allow-all-builds=true 2>&1 | tail -10) \
      || echo "[api] Warning: pnpm install for aggregated module deps failed"
    echo "[api] Module deps aggregation complete."
  fi
fi

# PREBUILD=1 runs this script during `docker build` to populate
# /app/.gatewaze-modules + per-module node_modules into the image.
# In that mode we MUST NOT exec the server — there's no server arg,
# and the build step just needs the filesystem changes captured.
if [ -n "$PREBUILD" ]; then
  echo "[api] PREBUILD=1 — module deps populated, exiting without exec."
  exit 0
fi

exec "$@"
