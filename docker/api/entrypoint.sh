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
# npm deps are NOT in the api image's /app/node_modules, so without a
# per-module install Node throws MODULE_NOT_FOUND and the outer catch in
# registerModuleRoutes() swallows it, taking ALL module routes down
# (not just the offending module's).
#
# Pre-clone to the same path the loader uses (slug = url minus scheme
# + .git, [^a-zA-Z0-9-] -> '-'), then `pnpm install --prod` per-module.
# Loader sees the existing .git and does `git pull --ff-only` instead
# of re-cloning, so the populated node_modules survives across the
# clone/pull cycle.
if [ -n "$MODULE_SOURCES" ]; then
  echo "[api] Pre-populating /app/.gatewaze-modules + installing per-module npm deps..."
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
        echo "[api] Warning: failed to pre-clone $url (loader will retry; module deps may be missing)"
        continue
      fi
    fi

    if [ -d "$target/modules" ]; then
      for mod in "$target/modules"/*; do
        [ -d "$mod" ] || continue
        [ -f "$mod/package.json" ] || continue
        # Skip modules with no `dependencies` block to avoid pointless installs.
        grep -q '"dependencies"' "$mod/package.json" || continue
        modname=$(basename "$mod")
        echo "[api] $modname: pnpm install --prod"
        (cd "$mod" && pnpm install --prod --no-frozen-lockfile --config.dangerously-allow-all-builds=true 2>&1 | tail -2) \
          || echo "[api] Warning: pnpm install failed for $modname (module will fail to load at runtime)"
      done
    fi
  done
  unset IFS
  echo "[api] Module npm dep install complete."
fi

exec "$@"
