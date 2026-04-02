#!/bin/sh
set -e

# Signal that initdb scripts are running (used by db-healthcheck.sh)
touch /tmp/gatewaze-init-started

# The supabase/postgres Docker image is designed for AMI builds where
# supabase_admin is pre-created. In Docker with a fresh volume, initdb
# only creates the 'postgres' user. This script creates supabase_admin
# and sets its password BEFORE migrate.sh runs (sorts before 'm').

echo "Creating supabase_admin role..."
psql -v ON_ERROR_STOP=1 --no-password --no-psqlrc -U postgres <<EOSQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    CREATE ROLE supabase_admin SUPERUSER LOGIN NOINHERIT BYPASSRLS CREATEROLE CREATEDB REPLICATION PASSWORD '$POSTGRES_PASSWORD';
  ELSE
    ALTER USER supabase_admin WITH PASSWORD '$POSTGRES_PASSWORD';
  END IF;
END
\$\$;
EOSQL
echo "supabase_admin role ready."
