#!/bin/sh
set -e

# Always signal init completion so the healthcheck doesn't block forever.
# If a migration fails, set -e still exits with an error (which fails the
# entrypoint and prevents PostgreSQL from starting), but the marker ensures
# a future container restart won't be stuck in permanent "unhealthy" limbo.
trap 'touch /tmp/gatewaze-init-complete' EXIT

echo "Setting up Gatewaze role passwords and default privileges..."

# Set passwords for Supabase service roles (created by the image's init-scripts)
# and configure ALTER DEFAULT PRIVILEGES so tables created by supabase_admin
# in migrations automatically get the right GRANTs for anon/authenticated/service_role.
psql -v ON_ERROR_STOP=1 --no-password --no-psqlrc -U supabase_admin -d "${POSTGRES_DB:-postgres}" <<EOSQL
ALTER USER supabase_auth_admin WITH PASSWORD '$POSTGRES_PASSWORD';
ALTER USER supabase_storage_admin WITH PASSWORD '$POSTGRES_PASSWORD';

-- Allow API roles to use the public schema
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Default privileges: tables created by supabase_admin get auto-granted
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;

-- Same for tables created by postgres (belt-and-suspenders)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
EOSQL

echo "Running Gatewaze migrations..."

for f in /gatewaze-migrations/*.sql; do
  if [ -f "$f" ]; then
    echo "  Running: $(basename $f)"
    psql -v ON_ERROR_STOP=1 --no-password --no-psqlrc -U supabase_admin -d "${POSTGRES_DB:-postgres}" -f "$f"
  fi
done

echo "Gatewaze migrations complete."

# Grant API roles access to all tables/functions/sequences created by migrations.
# ALTER DEFAULT PRIVILEGES (set above) handles tables created after the GRANT,
# but this catch-all covers any tables the defaults may have missed.
echo "Granting API role access to public schema objects..."
psql -v ON_ERROR_STOP=1 --no-password --no-psqlrc -U supabase_admin -d "${POSTGRES_DB:-postgres}" <<EOSQL
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
EOSQL
echo "API role grants applied."
