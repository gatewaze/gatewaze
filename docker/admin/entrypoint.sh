#!/bin/sh
set -e

echo "[admin] Starting admin container..."

# Configure git authentication if GITHUB_TOKEN is set
if [ -n "$GITHUB_TOKEN" ]; then
  git config --global url."https://x-token:${GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/"
  echo "[admin] Git authentication configured"
fi

# Clone module sources from MODULE_SOURCES env var (comma-separated git URLs)
# Format: url[@branch][#path] e.g. https://github.com/org/repo.git@main#modules
if [ -n "$MODULE_SOURCES" ]; then
  echo "[admin] Cloning module sources..."
  IFS=','
  for source in $MODULE_SOURCES; do
    # Parse url[@branch][#path]
    url=$(echo "$source" | sed 's/@[^#]*//; s/#.*//')
    branch=$(echo "$source" | grep -o '@[^#]*' | sed 's/@//' || echo "main")
    subpath=$(echo "$source" | grep -o '#.*' | sed 's/#//' || echo "")
    [ -z "$branch" ] && branch="main"

    # Extract repo name from URL (e.g. gatewaze-modules from https://github.com/gatewaze/gatewaze-modules.git)
    reponame=$(echo "$url" | sed 's|.*/||; s|\.git$||')
    target="/tmp/module-repos/$reponame"

    echo "[admin] Cloning $url (branch: $branch) → $target"
    git clone --depth 1 --branch "$branch" "$url" "$target" || {
      echo "[admin] Warning: failed to clone $url"
      continue
    }

    # Create symlink that matches local dev layout: /<reponame> → cloned repo
    # This makes ../gatewaze-modules/modules resolve correctly from /app
    # Remove any existing directory first (mkdir in Dockerfile creates empty dirs)
    rm -rf "/$reponame" 2>/dev/null || true
    ln -sf "$target" "/$reponame"
    echo "[admin] Symlinked /$reponame → $target"
  done
  unset IFS
  echo "[admin] Module cloning complete"
fi

# Write .env.production with actual env vars for Vite build
cat > /app/packages/admin/.env.production << EOF
VITE_SUPABASE_URL=${VITE_SUPABASE_URL}
VITE_SUPABASE_ANON_KEY=${VITE_SUPABASE_ANON_KEY}
VITE_API_URL=${VITE_API_URL}
VITE_AUTH_PROVIDER=${VITE_AUTH_PROVIDER:-supabase}
VITE_DISABLE_BRANDING=${VITE_DISABLE_BRANDING:-false}
EXTRA_MODULE_SOURCES=${EXTRA_MODULE_SOURCES:-}
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
cd /app && pnpm install --no-frozen-lockfile 2>&1 | tail -5

# Build admin with Vite (modules are now available on disk). With all
# premium modules in the graph the build reliably exceeds Node's default
# ~1.5GB heap and the process exits 134 (SIGABRT) half-way through
# transforming. Give it explicit headroom — the chart's admin container
# memory limit is 3Gi, so 2.5GB of heap leaves ~500MB for buffers and
# the nginx process that starts after build.
echo "[admin] Building admin frontend..."
cd /app/packages/admin && NODE_OPTIONS="--max-old-space-size=2560" npx vite build

# Copy built assets to nginx html directory
cp -r /app/packages/admin/dist/* /usr/share/nginx/html/

echo "[admin] Build complete. Starting nginx..."
exec nginx -g "daemon off;"
