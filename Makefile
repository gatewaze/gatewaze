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

# ---------------------------------------------------------------------------
# Brand detection: supports `make <brand> <action>` syntax
# ---------------------------------------------------------------------------
KNOWN_TARGETS := up down reset logs ps help init migrate deploy-functions \
	_check-env _activate-brand _link-cloud _cloud-reset _sync-secrets _ensure-traefik _generate-mcp

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

# Detect Supabase mode from the resolved env file
SUPABASE_MODE := $(shell grep -E '^SUPABASE_MODE=' "$(ENV_FILE)" 2>/dev/null | head -1 | cut -d= -f2-)

# Select base compose stack based on Supabase mode
ifeq ($(SUPABASE_MODE),cloud)
  COMPOSE_FILES := -f docker/docker-compose.cloud.yml -f docker/docker-compose.dev.yml
else
  COMPOSE_FILES := -f docker/docker-compose.yml -f docker/docker-compose.dev.yml
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
	@echo "  make reset             Stop, remove all volumes, and start fresh (cloud: wipes DB, auth, storage)"
	@echo "  make logs              Tail logs (Ctrl-C to stop)"
	@echo "  make ps                Show running containers"
	@echo ""
	@echo "Cloud deployment:"
	@echo "  make migrate              Push migrations to linked Supabase project"
	@echo "  make deploy-functions     Deploy all edge functions to Supabase Cloud"
	@echo "  make <brand> migrate      Link to brand's project and push migrations"
	@echo "  make <brand> deploy-functions  Deploy edge functions for a brand"
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
	@echo "Removing cached modules and module-installed edge functions..."
	@rm -rf .gatewaze-modules data/uploaded-modules data/.tmp-uploads
	@git checkout -- supabase/functions/ 2>/dev/null || true
	@git clean -fdx -- supabase/functions/
ifeq ($(SUPABASE_MODE),cloud)
	@$(MAKE) _cloud-reset $(if $(BRAND),$(BRAND),)
endif
	@$(MAKE) up $(if $(BRAND),$(BRAND),)

logs: _check-env _activate-brand ## Tail service logs
	docker compose $(COMPOSE_FILES) logs -f

ps: _check-env _activate-brand ## Show running containers
	docker compose $(COMPOSE_FILES) ps

deploy-functions: _check-env _activate-brand _link-cloud _sync-secrets ## Deploy all edge functions to Supabase Cloud
ifeq ($(SUPABASE_MODE),cloud)
	@echo "Deploying edge functions..."
	npx supabase functions deploy
else
	@echo "Error: deploy-functions is only supported in cloud mode (SUPABASE_MODE=cloud)"
	@echo "For self-hosted, edge functions are served automatically from supabase/functions/."
	@exit 1
endif

migrate: _check-env _activate-brand _link-cloud ## Push migrations to the linked Supabase project
ifeq ($(SUPABASE_MODE),cloud)
	@echo "Pushing migrations..."
	npx supabase db push
else
	@echo "Error: migrate is only supported in cloud mode (SUPABASE_MODE=cloud)"
	@echo "For self-hosted, migrations are applied automatically on container startup."
	@exit 1
endif

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------
.PHONY: _check-env _activate-brand _link-cloud _cloud-reset _sync-secrets _ensure-traefik _generate-mcp

# Env vars that edge functions read (beyond the auto-provided SUPABASE_* vars).
# Only non-empty values from the env file are synced.
EDGE_FUNCTION_SECRETS := \
	EMAIL_PROVIDER EMAIL_FROM EMAIL_FROM_NAME \
	SENDGRID_API_KEY SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS \
	SENDGRID_FROM_EVENTS SENDGRID_FROM_PARTNERS SENDGRID_FROM_MEMBERS SENDGRID_FROM_ADMIN SENDGRID_FROM_DEFAULT \
	OPENAI_API_KEY ENRICHLAYER_API_KEY GW_API_BEARER \
	VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY VAPID_SUBJECT \
	CUSTOMERIO_SITE_ID CUSTOMERIO_API_KEY CUSTOMERIO_APP_API_KEY

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

_link-cloud:
ifeq ($(SUPABASE_MODE),cloud)
	@PROJECT_REF=$$(grep -E '^SUPABASE_PROJECT_REF=' "$(ENV_FILE)" | head -1 | cut -d= -f2-); \
	if [ -z "$$PROJECT_REF" ]; then \
		echo "Error: SUPABASE_PROJECT_REF is not set in $(ENV_FILE)"; \
		exit 1; \
	fi; \
	echo "Linking to Supabase project: $$PROJECT_REF"; \
	npx supabase link --project-ref "$$PROJECT_REF"
endif

_sync-secrets:
ifeq ($(SUPABASE_MODE),cloud)
	@echo "Syncing edge function secrets from $(ENV_FILE)..."
	@SECRETS=""; \
	for key in $(EDGE_FUNCTION_SECRETS); do \
		val=$$(grep -E "^$$key=" "$(ENV_FILE)" 2>/dev/null | head -1 | cut -d= -f2-); \
		if [ -n "$$val" ]; then \
			SECRETS="$$SECRETS $$key=$$val"; \
		fi; \
	done; \
	if [ -n "$$SECRETS" ]; then \
		echo "  Setting: $$(echo $$SECRETS | sed 's/=[^ ]*/=***/g')"; \
		npx supabase secrets set $$SECRETS; \
	else \
		echo "  No secrets to sync."; \
	fi
	@echo "Configuring auth redirect URLs..."
	@ADMIN_HOST=$$(grep -E '^ADMIN_HOST=' "$(ENV_FILE)" | head -1 | cut -d= -f2-); \
	PORTAL_HOST=$$(grep -E '^PORTAL_HOST=' "$(ENV_FILE)" | head -1 | cut -d= -f2-); \
	ACCESS_TOKEN=$$(grep -E '^SUPABASE_ACCESS_TOKEN=' "$(ENV_FILE)" | head -1 | cut -d= -f2-); \
	PROJECT_REF=$$(grep -E '^SUPABASE_PROJECT_REF=' "$(ENV_FILE)" | head -1 | cut -d= -f2-); \
	if [ -n "$$ACCESS_TOKEN" ] && [ -n "$$ADMIN_HOST" ] && [ -n "$$PROJECT_REF" ]; then \
		SITE_URL="http://$$ADMIN_HOST"; \
		ALLOW="http://$$ADMIN_HOST"; \
		if [ -n "$$PORTAL_HOST" ]; then ALLOW="$$ALLOW,http://$$PORTAL_HOST"; fi; \
		echo "  SITE_URL=$$SITE_URL"; \
		echo "  URI_ALLOW_LIST=$$ALLOW"; \
		curl -s -X PATCH "https://api.supabase.com/v1/projects/$$PROJECT_REF/config/auth" \
			-H "Authorization: Bearer $$ACCESS_TOKEN" \
			-H "Content-Type: application/json" \
			-d "{\"site_url\":\"$$SITE_URL\",\"uri_allow_list\":\"$$ALLOW\"}" > /dev/null; \
	else \
		echo "  Skipping auth config (missing SUPABASE_ACCESS_TOKEN or ADMIN_HOST)"; \
	fi
endif

_cloud-reset: _link-cloud
	@ALLOW=$$(grep -E '^ALLOW_CLOUD_RESET=' "$(ENV_FILE)" 2>/dev/null | head -1 | cut -d= -f2-); \
	if [ "$$ALLOW" != "true" ]; then \
		echo ""; \
		echo "Error: Cloud reset is blocked for this environment."; \
		echo ""; \
		echo "To allow cloud reset, add this to your env file:"; \
		echo "  ALLOW_CLOUD_RESET=true"; \
		echo ""; \
		echo "This is a safety measure to prevent accidental wipes of production data."; \
		exit 1; \
	fi
	@echo "Resetting cloud Supabase project data..."
	@echo ""
	@echo "  [1/5] Deleting edge functions..."
	@PROJECT_REF=$$(grep -E '^SUPABASE_PROJECT_REF=' "$(ENV_FILE)" | head -1 | cut -d= -f2-); \
	ACCESS_TOKEN=$$(grep -E '^SUPABASE_ACCESS_TOKEN=' "$(ENV_FILE)" | head -1 | cut -d= -f2-); \
	if [ -n "$$PROJECT_REF" ] && [ -n "$$ACCESS_TOKEN" ]; then \
		echo "    Fetching function list from Supabase Cloud..."; \
		SLUGS=$$(curl -s "https://api.supabase.com/v1/projects/$$PROJECT_REF/functions" \
			-H "Authorization: Bearer $$ACCESS_TOKEN" \
			| python3 -c "import sys,json; [print(f['slug']) for f in json.load(sys.stdin)]" 2>/dev/null); \
		for slug in $$SLUGS; do \
			echo "    Deleting $$slug..."; \
			curl -s -X DELETE "https://api.supabase.com/v1/projects/$$PROJECT_REF/functions/$$slug" \
				-H "Authorization: Bearer $$ACCESS_TOKEN" > /dev/null; \
		done; \
	else \
		echo "    Warning: SUPABASE_PROJECT_REF or SUPABASE_ACCESS_TOKEN not set, skipping cloud function deletion"; \
	fi
	@echo "    Done."
	@echo "  [2/5] Emptying storage..."
	@SUPABASE_URL=$$(grep -E '^SUPABASE_URL=' "$(ENV_FILE)" | head -1 | cut -d= -f2-); \
	SERVICE_KEY=$$(grep -E '^SERVICE_ROLE_KEY=' "$(ENV_FILE)" | head -1 | cut -d= -f2-); \
	curl -s -X POST "$$SUPABASE_URL/storage/v1/bucket/media/empty" \
		-H "Authorization: Bearer $$SERVICE_KEY" \
		-H "apikey: $$SERVICE_KEY" || true; \
	echo "    Done."
	@echo "  [3/5] Resetting database (drop & re-apply migrations)..."
	@npx supabase db reset --linked --yes
	@echo "    Done."
	@echo "  [4/5] Deleting auth users..."
	@SUPABASE_URL=$$(grep -E '^SUPABASE_URL=' "$(ENV_FILE)" | head -1 | cut -d= -f2-); \
	SERVICE_KEY=$$(grep -E '^SERVICE_ROLE_KEY=' "$(ENV_FILE)" | head -1 | cut -d= -f2-); \
	echo "    Listing users from $$SUPABASE_URL/auth/v1/admin/users ..."; \
	TOTAL=0; \
	while true; do \
		RESP=$$(curl -s "$$SUPABASE_URL/auth/v1/admin/users?per_page=100" \
			-H "Authorization: Bearer $$SERVICE_KEY" \
			-H "apikey: $$SERVICE_KEY"); \
		echo "    API response (first 300 chars): $$(echo "$$RESP" | cut -c1-300)"; \
		if [ -z "$$RESP" ]; then \
			echo "    Warning: empty response from auth API"; \
			break; \
		fi; \
		UIDS=$$(echo "$$RESP" | python3 -c "import sys,json;d=json.load(sys.stdin);[print(u['id']) for u in (d.get('users',[]) if isinstance(d,dict) else d)]" 2>&1); \
		echo "    Parsed UIDs: $$UIDS"; \
		if [ -z "$$UIDS" ]; then break; fi; \
		for uid in $$UIDS; do \
			echo "    Deleting user $$uid ..."; \
			DEL_RESP=$$(curl -s -X DELETE "$$SUPABASE_URL/auth/v1/admin/users/$$uid" \
				-H "Authorization: Bearer $$SERVICE_KEY" \
				-H "apikey: $$SERVICE_KEY"); \
			echo "    Delete response: $$DEL_RESP"; \
			TOTAL=$$((TOTAL + 1)); \
		done; \
	done; \
	echo "    Deleted $$TOTAL auth users."
	@echo "  [5/5] Re-deploying edge functions & secrets..."
	@$(MAKE) _sync-secrets
	@npx supabase functions deploy
	@echo ""
	@echo "Cloud reset complete."

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
