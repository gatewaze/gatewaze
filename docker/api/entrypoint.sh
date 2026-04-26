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

exec "$@"
