# ============================================================================
# Gatewaze Makefile
#
# Usage:
#   make up                  — start the default environment
#   make down                — stop all services
#   make reset               — stop, remove volumes, and restart fresh
#   make logs                — tail service logs
#   make ps                  — show running services
#
# Multi-brand (requires gatewaze-environments repo alongside this repo):
#   make aaif up             — start the "aaif" brand
#   make aaif down           — stop the "aaif" brand
#   make aaif reset          — reset the "aaif" brand
#   make aaif logs           — tail logs for the "aaif" brand
# ============================================================================

ENVIRONMENTS_DIR := ../gatewaze-environments
TRAEFIK_FILE     := -f docker/docker-compose.traefik.yml

# Detect Supabase mode from the active env file
SUPABASE_MODE := $(shell grep -E '^SUPABASE_MODE=' "$(if $(BRAND),$(ENVIRONMENTS_DIR)/$(BRAND).local.env,docker/.env)" 2>/dev/null | head -1 | cut -d= -f2-)

# Select base compose stack based on Supabase mode
ifeq ($(SUPABASE_MODE),cloud)
  COMPOSE_FILES := -f docker/docker-compose.cloud.yml -f docker/docker-compose.dev.yml
else
  COMPOSE_FILES := -f docker/docker-compose.yml -f docker/docker-compose.dev.yml
endif

# ---------------------------------------------------------------------------
# Brand detection: supports `make <brand> <action>` syntax
# ---------------------------------------------------------------------------
KNOWN_TARGETS := up down reset logs ps help init migrate

CMD_ARGS := $(filter-out $(KNOWN_TARGETS), $(MAKECMDGOALS))
ifneq ($(CMD_ARGS),)
  BRAND := $(firstword $(CMD_ARGS))
endif

# Resolve the env file
ifdef BRAND
  ENV_FILE := $(ENVIRONMENTS_DIR)/$(BRAND).local.env
else
  ENV_FILE := docker/.env
endif

# ---------------------------------------------------------------------------
# Targets
# ---------------------------------------------------------------------------
.PHONY: $(KNOWN_TARGETS)

help: ## Show this help
	@echo "Gatewaze Development Commands"
	@echo ""
	@echo "  make init              Copy example config and prepare for first run"
	@echo "  make up                Start all services (dev mode with hot reload)"
	@echo "  make down              Stop all services"
	@echo "  make reset             Stop, remove all volumes, and start fresh"
	@echo "  make logs              Tail logs (Ctrl-C to stop)"
	@echo "  make ps                Show running containers"
	@echo ""
	@echo "Database:"
	@echo "  make migrate           Push migrations to linked Supabase project"
	@echo "  make <brand> migrate   Link to brand's project and push migrations"
	@echo ""
	@echo "Multi-brand (requires gatewaze-environments):"
	@echo "  make <brand> up        Start a specific brand"
	@echo "  make <brand> down      Stop a specific brand"
	@echo "  make <brand> reset     Reset a specific brand"
	@echo "  make <brand> logs      Tail logs for a specific brand"

init: ## Copy example env file and prepare for first run
	@if [ -f docker/.env ]; then \
		echo "docker/.env already exists — skipping copy."; \
	else \
		cp docker/.env.example docker/.env; \
		echo "Created docker/.env from docker/.env.example"; \
		echo "Edit docker/.env to customize your settings, then run: make up"; \
	fi

up: _check-env _activate-brand _ensure-traefik _generate-mcp ## Start services
	docker compose $(COMPOSE_FILES) up -d --build
	@echo ""
	@echo "Services starting (dev mode with hot reload). Visit:"
	@grep -E '^ADMIN_HOST=' "$(ENV_FILE)" 2>/dev/null | sed 's/ADMIN_HOST=/  Admin:    http:\/\//'
	@grep -E '^PORTAL_HOST=' "$(ENV_FILE)" 2>/dev/null | sed 's/PORTAL_HOST=/  Portal:   http:\/\//'
	@grep -E '^API_HOST=' "$(ENV_FILE)" 2>/dev/null | sed 's/API_HOST=/  API:      http:\/\//'
	@grep -E '^STUDIO_HOST=' "$(ENV_FILE)" 2>/dev/null | sed 's/STUDIO_HOST=/  Studio:   http:\/\//'

down: _check-env _activate-brand ## Stop services
	docker compose $(COMPOSE_FILES) down

reset: _check-env _activate-brand ## Stop services, remove volumes, and restart fresh
	docker compose $(COMPOSE_FILES) down -v
	@$(MAKE) up $(if $(BRAND),$(BRAND),)

logs: _check-env _activate-brand ## Tail service logs
	docker compose $(COMPOSE_FILES) logs -f

ps: _check-env _activate-brand ## Show running containers
	docker compose $(COMPOSE_FILES) ps

migrate: _check-env _activate-brand ## Push migrations to the linked Supabase project
ifeq ($(SUPABASE_MODE),cloud)
	@SUPABASE_URL=$$(grep -E '^SUPABASE_URL=' "$(ENV_FILE)" | head -1 | cut -d= -f2-); \
	PROJECT_REF=$$(echo "$$SUPABASE_URL" | sed -E 's|https://([^.]+)\.supabase\.co.*|\1|'); \
	if [ -z "$$PROJECT_REF" ]; then \
		echo "Error: Could not extract project ref from SUPABASE_URL"; \
		exit 1; \
	fi; \
	echo "Linking to Supabase project: $$PROJECT_REF"; \
	npx supabase link --project-ref "$$PROJECT_REF" && \
	echo "Pushing migrations..." && \
	npx supabase db push
else
	@echo "Error: migrate is only supported in cloud mode (SUPABASE_MODE=cloud)"
	@echo "For self-hosted, migrations are applied automatically on container startup."
	@exit 1
endif

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------
.PHONY: _check-env _activate-brand _ensure-traefik _generate-mcp

_check-env:
ifdef BRAND
	@if [ ! -f "$(ENV_FILE)" ]; then \
		echo "Error: $(ENV_FILE) not found"; \
		echo ""; \
		if [ ! -d "$(ENVIRONMENTS_DIR)" ]; then \
			echo "The gatewaze-environments repo is not present at $(ENVIRONMENTS_DIR)/"; \
			echo "Clone it alongside this repo:"; \
			echo "  cd .. && git clone <your-environments-repo-url> gatewaze-environments"; \
		else \
			echo "Available brands:"; \
			for f in $(ENVIRONMENTS_DIR)/*.local.env; do \
				[ -f "$$f" ] || continue; \
				basename "$$f" .local.env; \
			done; \
		fi; \
		exit 1; \
	fi
else
	@if [ ! -f "docker/.env" ]; then \
		echo "Error: docker/.env not found"; \
		echo ""; \
		echo "Quick start:"; \
		echo "  make init"; \
		echo "  make up"; \
		exit 1; \
	fi
endif

_activate-brand:
ifdef BRAND
	@cp "$(ENV_FILE)" docker/.env
	@echo "Activated brand: $(BRAND)"
endif

_ensure-traefik:
ifneq ($(SUPABASE_MODE),cloud)
	@if ! docker ps --filter "name=gatewaze-traefik" --format '{{.Names}}' | grep -q gatewaze-traefik; then \
		echo "Starting shared Traefik reverse proxy..."; \
		docker compose $(TRAEFIK_FILE) up -d; \
	fi
endif

_generate-mcp:
	@SUPABASE_URL=$$(grep -E '^SUPABASE_URL=' "$(ENV_FILE)" | head -1 | cut -d= -f2-); \
	ANON_KEY=$$(grep -E '^ANON_KEY=' "$(ENV_FILE)" | head -1 | cut -d= -f2-); \
	SERVICE_KEY=$$(grep -E '^SERVICE_ROLE_KEY=' "$(ENV_FILE)" | head -1 | cut -d= -f2-); \
	PG_USER=$$(grep -E '^POSTGRES_USER=' "$(ENV_FILE)" | head -1 | cut -d= -f2-); \
	PG_PASS=$$(grep -E '^POSTGRES_PASSWORD=' "$(ENV_FILE)" | head -1 | cut -d= -f2-); \
	PG_PORT=$$(grep -E '^POSTGRES_PORT=' "$(ENV_FILE)" | head -1 | cut -d= -f2-); \
	PG_DB=$$(grep -E '^POSTGRES_DB=' "$(ENV_FILE)" | head -1 | cut -d= -f2-); \
	printf '{\n  "mcpServers": {\n    "supabase": {\n      "command": "npx",\n      "args": [\n        "-y",\n        "selfhosted-supabase-mcp@latest",\n        "--url",\n        "%s",\n        "--anon-key",\n        "%s",\n        "--service-key",\n        "%s",\n        "--db-url",\n        "postgresql://%s:%s@localhost:%s/%s"\n      ]\n    }\n  }\n}\n' \
		"$$SUPABASE_URL" "$$ANON_KEY" "$$SERVICE_KEY" "$$PG_USER" "$$PG_PASS" "$$PG_PORT" "$$PG_DB" > .mcp.json; \
	echo "Generated .mcp.json for Claude Code"

# ---------------------------------------------------------------------------
# Catch-all: silently ignore brand names passed as targets
# ---------------------------------------------------------------------------
ifdef BRAND
$(BRAND):
	@:
endif
