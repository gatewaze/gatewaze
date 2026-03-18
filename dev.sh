#!/bin/bash
set -e

BRAND="${1:?Usage: ./dev.sh <brand> [up|down|restart|logs|ps]}"
ACTION="${2:-up}"
ENV_FILE="docker/.env.${BRAND}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: $ENV_FILE not found"
  echo ""
  echo "Available brands:"
  for f in docker/.env.*; do
    [ -f "$f" ] || continue
    name="${f#docker/.env.}"
    # Skip .example files in the listing
    case "$name" in
      *.example) continue ;;
    esac
    echo "  $name"
  done
  echo ""
  echo "To create a brand config, copy an example:"
  echo "  cp docker/.env.mlops.example docker/.env.mlops"
  exit 1
fi

# Copy brand env to active .env
cp "$ENV_FILE" docker/.env
echo "Activated brand: $BRAND"

# Helper: read a value from the brand env file
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

# Compose files — always include dev overrides for hot reload
COMPOSE_FILES="-f docker/docker-compose.yml -f docker/docker-compose.dev.yml"

# Ensure shared Traefik is running
ensure_traefik() {
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
    shift 2 2>/dev/null || true
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
