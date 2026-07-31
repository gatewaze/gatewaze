#!/usr/bin/env sh
# Shared gitleaks entrypoint for the pre-push hook and CI.
#
# Usage:
#   scripts/security/gitleaks-scan.sh                 # scan the working tree + index (uncommitted)
#   scripts/security/gitleaks-scan.sh --range A..B    # scan commits in a git range
#   scripts/security/gitleaks-scan.sh --all           # scan full history
#
# Requires the `gitleaks` binary on PATH. Locally: `brew install gitleaks`
# (or see https://github.com/gitleaks/gitleaks#installing). CI installs a
# pinned binary before calling this script. Fails closed: if gitleaks is
# missing, the scan is treated as blocking rather than silently skipped.
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CONFIG="$ROOT/.gitleaks.toml"

if ! command -v gitleaks >/dev/null 2>&1; then
  cat >&2 <<'EOF'
✖ gitleaks is not installed, so secrets cannot be scanned before push.

  Install it, then retry:
    macOS:   brew install gitleaks
    Linux:   see https://github.com/gitleaks/gitleaks#installing
    Go:      go install github.com/gitleaks/gitleaks/v8@latest

  This gate is intentionally blocking. To bypass in a genuine emergency:
    git push --no-verify   (discouraged — CI will still scan)
EOF
  exit 1
fi

MODE="${1:-working}"

case "$MODE" in
  --all)
    echo "→ gitleaks: scanning full history"
    exec gitleaks git "$ROOT" --config "$CONFIG" --redact --no-banner
    ;;
  --range)
    RANGE="${2:?--range requires an A..B argument}"
    echo "→ gitleaks: scanning commits in $RANGE"
    exec gitleaks git "$ROOT" --config "$CONFIG" --redact --no-banner \
      --log-opts="$RANGE"
    ;;
  *)
    echo "→ gitleaks: scanning working tree and staged changes"
    exec gitleaks dir "$ROOT" --config "$CONFIG" --redact --no-banner
    ;;
esac
