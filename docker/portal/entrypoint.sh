#!/bin/sh
set -e

echo "[portal] Starting portal container..."

# Configure git authentication if a token is provided. Needed to clone
# private premium module repos.
if [ -n "$GITHUB_TOKEN" ]; then
  git config --global url."https://x-token:${GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/"
  echo "[portal] Git authentication configured"
fi

# Process MODULE_SOURCES (comma-separated). Each entry is either a git
# URL (optionally `#branch=main&path=modules`) or a local absolute path.
# Git URLs get cloned and symlinked at /<reponame>; local paths are
# volume-mounted and skipped.
if [ -n "$MODULE_SOURCES" ]; then
  echo "[portal] Processing module sources..."
  IFS=','
  for source in $MODULE_SOURCES; do
    url="${source%%#*}"
    fragment=""
    case "$source" in *\#*) fragment="${source#*#}" ;; esac

    case "$url" in
      http://*|https://*|git://*|git@*|*.git) ;;
      *)
        echo "[portal] Skipping local source (volume-mounted): $url"
        continue
        ;;
    esac

    # Outer loop sets IFS=',' so the inner for-in over
    # `$(echo | tr '&' ' ')` would NOT word-split on spaces and the
    # whole `branch=main path=modules` would be one word, making the
    # branch parse to "main path=modules". Save/restore IFS.
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
      echo "[portal] Already cloned: $reponame"
    else
      echo "[portal] Cloning $url (branch: $branch) -> $target"
      if ! git clone --depth 1 --branch "$branch" "$url" "$target"; then
        echo "[portal] WARN: clone $url failed"
        continue
      fi
    fi

    rm -rf "/$reponame" 2>/dev/null || true
    ln -sfn "$target" "/$reponame"
    echo "[portal] Symlinked /$reponame -> $target"
  done
  unset IFS
  echo "[portal] Module source processing complete"
fi

# Write .env.production so Next.js inlines NEXT_PUBLIC_* vars into the
# client bundle. Runtime-only vars (SUPABASE_SERVICE_ROLE_KEY, etc.) come
# from envFrom and don't need to be in .env.production, but we include
# them anyway for scripts that read process.env during build.
cat > /app/packages/portal/.env.production <<EOF
NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL:-$SUPABASE_URL}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}
NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
SUPABASE_URL=${SUPABASE_URL}
SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}
INSTANCE_NAME=${INSTANCE_NAME:-gatewaze}
MODULE_SOURCES=${MODULE_SOURCES:-}
EOF

# Build Next.js — script generates the module registry first, then runs
# `next build`. Webpack follows absolute-path imports from the registry
# through the symlinks we just created.
echo "[portal] Running Next.js build..."
cd /app/packages/portal && pnpm build

echo "[portal] Build complete. Starting Next.js server..."
cd /app/packages/portal && exec pnpm start
