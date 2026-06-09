#!/usr/bin/env bash
# Wrapper for migrate-mlops-to-aaif.mjs. Extracts DB connection details from the
# environment files (handling CRLF) and exports them, then runs the migration.
#
#   SOURCE is always mlops prod (READ-ONLY).
#   TARGET is selected by the first argument: `local` or `prod`.
#
# Usage:
#   scripts/migrate-mlops-to-aaif.sh local                      # dry-run vs local aaif
#   scripts/migrate-mlops-to-aaif.sh local --limit 2000 --events-limit 20000 --commit
#   scripts/migrate-mlops-to-aaif.sh prod                       # dry-run vs aaif prod
#   scripts/migrate-mlops-to-aaif.sh prod --commit              # full prod migration
#
# Env file locations (override with env vars if they move):
ENVDIR="${GATEWAZE_ENV_DIR:-/Users/dan/Git/danthebaker/gatewaze-environments}"
ADMINDIR="${GATEWAZE_ADMIN_DIR:-/Users/dan/Git/danthebaker/gatewaze-admin}"
SRC_ENV="${SRC_ENV:-$ADMINDIR/.env.mlops.production}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

set -euo pipefail

TARGET="${1:-}"; shift || true
if [[ "$TARGET" != "local" && "$TARGET" != "prod" ]]; then
  echo "First arg must be 'local' or 'prod'. Got: '${TARGET:-}'" >&2; exit 1
fi

# Read KEY from an env file, stripping quotes and CRLF.
val() { grep -E "^$2=" "$1" | head -1 | cut -d= -f2- | tr -d '"\r'; }

# ---- SOURCE: mlops prod (read-only) ----
export SRC_DB_HOST="$(val "$SRC_ENV" SUPABASE_DB_HOST)"
export SRC_DB_PORT="$(val "$SRC_ENV" SUPABASE_DB_PORT)"
export SRC_DB_USER="$(val "$SRC_ENV" SUPABASE_DB_USER)"
export SRC_DB_PASSWORD="$(val "$SRC_ENV" SUPABASE_DB_PASSWORD)"
export SRC_DB_SSL=require

# ---- TARGET ----
if [[ "$TARGET" == "local" ]]; then
  LOCAL_ENV="$ENVDIR/aaif.local.env"
  export DST_DB_HOST=127.0.0.1
  export DST_DB_PORT="$(val "$LOCAL_ENV" POSTGRES_PORT)"
  export DST_DB_USER="$(val "$LOCAL_ENV" POSTGRES_USER)"
  export DST_DB_PASSWORD="$(val "$LOCAL_ENV" POSTGRES_PASSWORD)"
  export DST_DB_NAME="$(val "$LOCAL_ENV" POSTGRES_DB)"
  export DST_DB_SSL=disable
else
  PROD_ENV="$ENVDIR/aaif.production.env"
  export DST_DB_HOST="$(val "$PROD_ENV" SUPABASE_DB_HOST)"
  export DST_DB_PORT="$(val "$PROD_ENV" SUPABASE_DB_PORT)"
  export DST_DB_USER="$(val "$PROD_ENV" SUPABASE_DB_USER)"
  export DST_DB_PASSWORD="$(val "$PROD_ENV" SUPABASE_DB_PASSWORD)"
  export DST_DB_SSL=require
fi

if [[ -z "$SRC_DB_HOST" || -z "$DST_DB_HOST" || -z "${DST_DB_PASSWORD:-}" ]]; then
  echo "Failed to load connection details — check env file paths." >&2; exit 1
fi

exec node "$SCRIPT_DIR/migrate-mlops-to-aaif.mjs" "$@"
