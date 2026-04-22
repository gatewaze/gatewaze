#!/usr/bin/env bash
# brand-refresh — clean out the local dev caches that cause the most common
# "it suddenly stopped working" symptoms for a brand. Useful after:
#   - adding/removing a module
#   - updating a dependency
#   - switching branches on gatewaze-modules / premium-gatewaze-modules
#   - seeing Vite errors like "does not provide an export named X" (CJS interop)
#   - the admin hanging on startup
#   - portal showing stale module routes
#
# Usage:
#   ./scripts/brand-refresh.sh <brand>            # default: full clean
#   ./scripts/brand-refresh.sh <brand> --queue    # also flush Redis (kills in-flight jobs)
#
# Example:
#   ./scripts/brand-refresh.sh aaif
#
# What it does, in order:
#   1. Clears Vite's dep-optimization cache in the admin container.
#   2. Clears the Next.js build cache in the portal container.
#   3. (optional --queue) flushes Redis — removes any stale BullMQ jobs whose
#      DB rows may have been deleted.
#   4. Restarts the admin, portal, api, worker containers so they re-pick up
#      mounted module files and rebuild their first-request caches.

set -euo pipefail

BRAND="${1:-}"
FLAG="${2:-}"

if [[ -z "$BRAND" ]]; then
  echo "usage: $0 <brand> [--queue]" >&2
  echo "  --queue  also FLUSHDB on the brand's Redis (kills in-flight jobs)"
  exit 1
fi

containers=("${BRAND}-admin" "${BRAND}-portal" "${BRAND}-api" "${BRAND}-worker")
redis="${BRAND}-redis"

echo "==> Checking containers for brand '${BRAND}'..."
for c in "${containers[@]}"; do
  if ! docker ps --format '{{.Names}}' | grep -q "^${c}$"; then
    echo "    (skipping — ${c} not running)"
  fi
done

echo "==> Clearing Vite dep-optimization cache (admin)..."
docker exec "${BRAND}-admin" sh -c '
  rm -rf /app/packages/admin/node_modules/.vite /app/node_modules/.vite 2>/dev/null || true
' || echo "    (admin not running — skipped)"

echo "==> Clearing Next.js build cache (portal)..."
docker exec "${BRAND}-portal" sh -c '
  rm -rf /app/packages/portal/.next 2>/dev/null || true
' || echo "    (portal not running — skipped)"

if [[ "$FLAG" == "--queue" ]]; then
  echo "==> Flushing Redis queue (--queue)..."
  docker exec "$redis" redis-cli -a "${REDIS_PASSWORD:-gatewaze}" --no-auth-warning FLUSHDB \
    || echo "    (redis not running — skipped)"
fi

echo "==> Restarting containers..."
for c in "${containers[@]}"; do
  if docker ps --format '{{.Names}}' | grep -q "^${c}$"; then
    docker restart "$c" >/dev/null && echo "    restarted ${c}"
  fi
done

echo "==> Done. Give it ~10 seconds for Vite to pre-bundle deps."
echo "    If you still see issues, try: docker compose down && docker compose up -d --force-recreate"
