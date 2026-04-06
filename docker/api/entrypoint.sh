#!/bin/sh
set -e

# Configure git authentication if GITHUB_TOKEN is set
if [ -n "$GITHUB_TOKEN" ]; then
  git config --global url."https://x-token:${GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/"
fi

# Clone additional module sources from MODULE_SOURCES env var
# The open-source gatewaze-modules is already cloned at build time.
# This clones any additional repos (premium, lf, etc.)
if [ -n "$MODULE_SOURCES" ]; then
  IFS=','
  for source in $MODULE_SOURCES; do
    url=$(echo "$source" | sed 's/@[^#]*//; s/#.*//')
    branch=$(echo "$source" | grep -o '@[^#]*' | sed 's/@//' || echo "main")
    [ -z "$branch" ] && branch="main"

    reponame=$(echo "$url" | sed 's|.*/||; s|\.git$||')
    target="/tmp/module-repos/$reponame"

    # Skip if already cloned this run
    if [ -d "$target" ]; then
      continue
    fi

    echo "[api] Cloning $url (branch: $branch)..."
    git clone --depth 1 --branch "$branch" "$url" "$target" || {
      echo "[api] Warning: failed to clone $url"
      continue
    }

    # Remove any existing directory and create symlink
    rm -rf "/$reponame" 2>/dev/null || true
    ln -sf "$target" "/$reponame"
  done
  unset IFS
fi

exec "$@"
