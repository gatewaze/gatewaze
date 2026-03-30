#!/bin/bash
set -e

# ---------------------------------------------------------------------------
# Gatewaze Dev Script
#
# Usage:
#   ./dev.sh [action]              — run with docker/.env (single-brand default)
#   ./dev.sh <brand> [action]      — run a specific brand from gatewaze-environments
#
# Actions: up (default), down, restart, logs, ps
# ---------------------------------------------------------------------------

ENVIRONMENTS_DIR="../gatewaze-environments"
ACTIONS="up|down|restart|logs|ps"

# Determine if the first arg is a brand or an action
if [ -z "$1" ] || echo "$1" | grep -qE "^(up|down|restart|logs|ps)$"; then
  # No brand specified — use docker/.env directly
  ACTION="${1:-up}"
  SHIFT_COUNT=1
  ENV_FILE="docker/.env"

  if [ ! -f "$ENV_FILE" ]; then
    echo "Error: docker/.env not found"
    echo ""
    echo "Quick start:"
    echo "  cp docker/.env.example docker/.env"
    echo "  ./dev.sh up"
    exit 1
  fi

  echo "Using default config: docker/.env"
else
  # Brand specified — look in the environments repo
  BRAND="$1"
  ACTION="${2:-up}"
  SHIFT_COUNT=2
  ENV_FILE="${ENVIRONMENTS_DIR}/${BRAND}.local.env"

  if [ ! -f "$ENV_FILE" ]; then
    echo "Error: ${ENV_FILE} not found"
    echo ""

    if [ ! -d "$ENVIRONMENTS_DIR" ]; then
      echo "The gatewaze-environments repo is not present at ${ENVIRONMENTS_DIR}/"
      echo ""
      echo "Clone it alongside this repo:"
      echo "  cd .. && git clone <your-environments-repo-url> gatewaze-environments"
    else
      echo "Available brands:"
      for f in "${ENVIRONMENTS_DIR}"/*.local.env; do
        [ -f "$f" ] || continue
        name="$(basename "$f" .local.env)"
        echo "  $name"
      done
    fi
    echo ""
    echo "Or run without a brand to use the default config:"
    echo "  ./dev.sh up"
    exit 1
  fi

  # Copy brand env to docker/.env so Docker Compose picks it up
  cp "$ENV_FILE" docker/.env
  echo "Activated brand: $BRAND"
fi

# Helper: read a value from the active env file
env_val() { grep -E "^${1}=" "$ENV_FILE" | head -1 | cut -d= -f2-; }

# Generate .mcp.json for Claude Code (Supabase MCP server)
generate_mcp_config() {
  local supabase_url anon_key service_key pg_user pg_pass pg_port pg_db
  supabase_url="$(env_val SUPABASE_URL)"
  anon_key="$(env_val ANON_KEY)"
  service_key="$(env_val SERVICE_ROLE_KEY)"
  pg_user="$(env_val POSTGRES_USER)"
  pg_pass="$(env_val POSTGRES_PASSWORD)"
  pg_port="$(env_val POSTGRES_PORT)"
  pg_db="$(env_val POSTGRES_DB)"

  cat > .mcp.json <<MCPEOF
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": [
        "-y",
        "selfhosted-supabase-mcp@latest",
        "--url",
        "${supabase_url}",
        "--anon-key",
        "${anon_key}",
        "--service-key",
        "${service_key}",
        "--db-url",
        "postgresql://${pg_user}:${pg_pass}@localhost:${pg_port}/${pg_db}"
      ]
    }
  }
}
MCPEOF
  echo "Generated .mcp.json for Claude Code"
}

# Detect Supabase mode from the active env file
SUPABASE_MODE="$(env_val SUPABASE_MODE)"

# Compose files — select base stack based on Supabase mode
if [ "$SUPABASE_MODE" = "cloud" ]; then
  echo "Supabase mode: cloud (no local Supabase containers)"
  COMPOSE_FILES="-f docker/docker-compose.cloud.yml -f docker/docker-compose.dev.yml"
else
  COMPOSE_FILES="-f docker/docker-compose.yml -f docker/docker-compose.dev.yml"
fi

# Ensure shared Traefik is running (self-hosted only; cloud compose has its own)
ensure_traefik() {
  if [ "$SUPABASE_MODE" = "cloud" ]; then
    return
  fi
  if ! docker ps --filter "name=gatewaze-traefik" --format '{{.Names}}' | grep -q gatewaze-traefik; then
    echo "Starting shared Traefik reverse proxy..."
    docker compose -f docker/docker-compose.traefik.yml up -d
  fi
}

case "$ACTION" in
  up)
    generate_mcp_config
    ensure_traefik
    docker compose $COMPOSE_FILES up -d --build
    echo ""
    echo "Services starting (dev mode with hot reload). Visit:"
    grep -E '^ADMIN_HOST=' "$ENV_FILE" | sed 's/ADMIN_HOST=/  Admin:    http:\/\//'
    grep -E '^PORTAL_HOST=' "$ENV_FILE" | sed 's/PORTAL_HOST=/  Portal:   http:\/\//'
    grep -E '^API_HOST=' "$ENV_FILE" | sed 's/API_HOST=/  API:      http:\/\//'
    grep -E '^STUDIO_HOST=' "$ENV_FILE" | sed 's/STUDIO_HOST=/  Studio:   http:\/\//'
    ;;
  down)
    docker compose $COMPOSE_FILES down
    ;;
  restart)
    docker compose $COMPOSE_FILES restart
    ;;
  logs)
    shift "$SHIFT_COUNT" 2>/dev/null || true
    docker compose $COMPOSE_FILES logs -f "$@"
    ;;
  ps)
    docker compose $COMPOSE_FILES ps
    ;;
  *)
    echo "Unknown action: $ACTION"
    echo "Available actions: up, down, restart, logs, ps"
    exit 1
    ;;
esac
