#!/bin/sh
# Healthcheck for the Supabase PostgreSQL container.
#
# On first boot, docker-entrypoint-initdb.d scripts run migrations and seed
# data. During this window pg_isready returns 0 (PostgreSQL is up) but the
# schema is incomplete. Dependent services that start connecting will fail.
#
# We use two marker files written by the init scripts:
#   /tmp/gatewaze-init-started   — created by 00-set-admin-password.sh
#   /tmp/gatewaze-init-complete  — created by zz-gatewaze-init.sh
#
# Logic:
#   1. pg_isready must pass (PostgreSQL accepting connections)
#   2. If init has started but not completed → UNHEALTHY
#   3. Otherwise (init complete, or subsequent restart with no init) → HEALTHY

pg_isready -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-postgres}" -q || exit 1

if [ -f /tmp/gatewaze-init-started ] && [ ! -f /tmp/gatewaze-init-complete ]; then
  exit 1
fi

exit 0
