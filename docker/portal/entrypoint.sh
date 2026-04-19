#!/bin/sh
set -e

echo "[portal] Starting portal container..."

# Configure git authentication if a token is provided. Needed to clone
# private premium module repos.
if [ -n "$GITHUB_TOKEN" ]; then
  git config --global url."https://x-token:${GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/"
  echo "[portal] Git authentication configured"
fi

# Clone MODULE_SOURCES (comma-separated list of url[@branch][#subpath])
# into /tmp/module-repos and symlink each at /<reponame> so generated
# registry absolute-path imports resolve during `next build`.
if [ -n "$MODULE_SOURCES" ]; then
  echo "[portal] Cloning module sources..."
  IFS=','
  for source in $MODULE_SOURCES; do
    url=$(echo "$source" | sed 's/@[^#]*//; s/#.*//')
    branch=$(echo "$source" | grep -o '@[^#]*' | sed 's/@//' || echo "main")
    [ -z "$branch" ] && branch="main"
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
  echo "[portal] Module cloning complete"
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
EXTRA_MODULE_SOURCES=${EXTRA_MODULE_SOURCES:-}
EOF

# Build Next.js — script generates the module registry first, then runs
# `next build`. Webpack follows absolute-path imports from the registry
# through the symlinks we just created.
echo "[portal] Running Next.js build..."
cd /app/packages/portal && pnpm build

echo "[portal] Build complete. Starting Next.js server..."
cd /app/packages/portal && exec pnpm start
