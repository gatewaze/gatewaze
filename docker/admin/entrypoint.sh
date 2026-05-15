#!/bin/sh
set -e

echo "[admin] Starting admin container..."

# Configure git authentication if GITHUB_TOKEN is set
if [ -n "$GITHUB_TOKEN" ]; then
  git config --global url."https://x-token:${GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/"
  echo "[admin] Git authentication configured"
fi

# Fast path: if a pre-built bundle was baked in at image build time AND
# the runtime MODULE_SOURCES is a subset of the build-time MODULE_SOURCES,
# we can skip pnpm install + clone + vite build entirely and start nginx
# in ~5 seconds rather than 3-5 minutes.
#
# Subset check: every comma-separated entry in MODULE_SOURCES must appear
# verbatim in BUILD_TIME_MODULE_SOURCES. If runtime adds a new repo or
# changes the branch on an existing one, we fall through to the slow path.
#
# Disabled when PREBUILD=1 (we're inside the image-build step and there
# is nothing pre-built yet to compare against).
if [ -z "$PREBUILD" ] && [ -d /usr/share/nginx/html-prebuilt ] && [ -n "$BUILD_TIME_MODULE_SOURCES" ]; then
  fast_path=1
  if [ -z "$MODULE_SOURCES" ]; then
    # No runtime override — the image's defaults are exactly right.
    :
  else
    _OLD_IFS=$IFS
    IFS=','
    for entry in $MODULE_SOURCES; do
      # Each entry must appear as a comma-bounded substring in the
      # build-time sources. Cheap string check, no regex.
      case ",$BUILD_TIME_MODULE_SOURCES," in
        *",$entry,"*) ;;
        *) fast_path=0; echo "[admin] Fast-path miss — runtime module source '$entry' not in baked bundle"; break ;;
      esac
    done
    IFS=$_OLD_IFS
  fi
  if [ "$fast_path" = "1" ]; then
    echo "[admin] Fast path: copying pre-built bundle to nginx html"
    cp -r /usr/share/nginx/html-prebuilt/* /usr/share/nginx/html/
    echo "[admin] Pre-built bundle served. Starting nginx..."
    exec nginx -g "daemon off;"
  fi
  echo "[admin] Falling back to full rebuild (slow path)"
fi

# Clone module sources from MODULE_SOURCES env var. Comma-separated list
# where each entry is one of:
#   - git URL: https://github.com/org/repo.git[#branch=main&path=modules]
#   - local absolute path: /premium-gatewaze-modules/modules
# Local paths are volume-mounted by docker-compose.local-modules.yml and
# don't need to be cloned — the plugin will scan them in place.
if [ -n "$MODULE_SOURCES" ]; then
  echo "[admin] Processing module sources..."
  IFS=','
  for source in $MODULE_SOURCES; do
    # Strip fragment to get bare URL / path
    url="${source%%#*}"
    fragment=""
    case "$source" in *\#*) fragment="${source#*#}" ;; esac

    # Skip non-git entries — local paths pass through untouched
    case "$url" in
      http://*|https://*|git://*|git@*|*.git) ;;
      *)
        echo "[admin] Skipping local source (volume-mounted): $url"
        continue
        ;;
    esac

    # Parse branch from fragment (format: branch=main&path=modules).
    # The outer loop sets IFS=',' so the inner for-in over
    # `$(echo | tr '&' ' ')` would NOT word-split on spaces and the
    # fragment would be treated as a single word — "branch=main
    # path=modules" — which then matches `branch=*` and sets branch to
    # "main path=modules". Save/restore IFS around this inner split.
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

    echo "[admin] Cloning $url (branch: $branch) → $target"
    git clone --depth 1 --branch "$branch" "$url" "$target" || {
      echo "[admin] Warning: failed to clone $url"
      continue
    }

    # Symlink /<reponame> → cloned path so the plugin's pre-cloned lookup finds it.
    rm -rf "/$reponame" 2>/dev/null || true
    ln -sf "$target" "/$reponame"
    echo "[admin] Symlinked /$reponame → $target"
  done
  unset IFS
  echo "[admin] Module source processing complete"
fi

# Write .env.production with actual env vars for Vite build
cat > /app/packages/admin/.env.production << EOF
VITE_SUPABASE_URL=${VITE_SUPABASE_URL}
VITE_SUPABASE_ANON_KEY=${VITE_SUPABASE_ANON_KEY}
VITE_API_URL=${VITE_API_URL}
VITE_PORTAL_URL=${VITE_PORTAL_URL:-${NEXT_PUBLIC_APP_URL:-}}
VITE_AUTH_PROVIDER=${VITE_AUTH_PROVIDER:-supabase}
VITE_DISABLE_BRANDING=${VITE_DISABLE_BRANDING:-false}
MODULE_SOURCES=${MODULE_SOURCES:-}
EOF

# Strip @gatewaze-modules/* workspace deps and re-install
echo "[admin] Ensuring all dependencies are installed..."
cd /app && node --input-type=module -e "
import { readFileSync, writeFileSync } from 'fs';
const pkg = JSON.parse(readFileSync('./packages/admin/package.json', 'utf8'));
for (const field of ['dependencies', 'devDependencies']) {
  if (pkg[field]) {
    pkg[field] = Object.fromEntries(
      Object.entries(pkg[field]).filter(([k]) => !k.startsWith('@gatewaze-modules/'))
    );
  }
}
writeFileSync('./packages/admin/package.json', JSON.stringify(pkg, null, 2) + '\n');
console.log('[admin] Stripped @gatewaze-modules deps. Remaining deps:', Object.keys(pkg.dependencies || {}).length);
"
echo "[admin] Installing dependencies..."
# `--config.dangerously-allow-all-builds=true` required on pnpm 10+ —
# sharp / esbuild / @sentry/cli native build scripts otherwise abort
# the install with ERR_PNPM_IGNORED_BUILDS.
cd /app && pnpm install --no-frozen-lockfile --config.dangerously-allow-all-builds=true 2>&1 | tail -5

# Build admin with Vite (modules are now available on disk). With all
# premium modules in the graph the build reliably exceeds Node's default
# ~1.5GB heap and the process exits 134 (SIGABRT) half-way through
# transforming. Give it explicit headroom — leave ~25% of the container
# memory limit for buffers + the nginx process that starts after build.
# Allow per-instance override via ADMIN_NODE_HEAP_MB env (set in the
# Helm values when an instance's bundle outgrows the default), since
# growing module graphs eventually outpace any single hardcoded value.
echo "[admin] Building admin frontend..."
NODE_HEAP_MB="${ADMIN_NODE_HEAP_MB:-2560}"
echo "[admin] Node heap cap: ${NODE_HEAP_MB}MB"
cd /app/packages/admin && NODE_OPTIONS="--max-old-space-size=${NODE_HEAP_MB}" npx vite build

# Copy built assets to nginx html directory
cp -r /app/packages/admin/dist/* /usr/share/nginx/html/

if [ -n "$PREBUILD" ]; then
  echo "[admin] PREBUILD=1 — build complete, exiting without starting nginx (Dockerfile will snapshot the dist)"
  exit 0
fi

echo "[admin] Build complete. Starting nginx..."
exec nginx -g "daemon off;"
