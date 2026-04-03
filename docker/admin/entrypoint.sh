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

    # Generate a directory name from the URL
    dirname=$(echo "$url" | sed 's|https://||; s|\.git$||; s|/|-|g')
    target="/gatewaze-modules/$dirname"

    echo "[admin] Cloning $url (branch: $branch) → $target"
    git clone --depth 1 --branch "$branch" "$url" "$target" || {
      echo "[admin] Warning: failed to clone $url"
      continue
    }

    # If subpath specified, create a symlink at the expected location
    if [ -n "$subpath" ] && [ -d "$target/$subpath" ]; then
      ln -sf "$target/$subpath" "/gatewaze-modules/$(basename $dirname)-modules"
    fi
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
EOF

# Build admin with Vite (modules are now available on disk)
echo "[admin] Building admin frontend..."
cd /app/packages/admin && npx vite build

# Copy built assets to nginx html directory
cp -r /app/packages/admin/dist/* /usr/share/nginx/html/

echo "[admin] Build complete. Starting nginx..."
exec nginx -g "daemon off;"
