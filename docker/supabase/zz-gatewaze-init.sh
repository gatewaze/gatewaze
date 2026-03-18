#!/bin/sh
set -e

echo "Setting up Gatewaze role passwords..."

# Set passwords for Supabase service roles (created by the image's init-scripts)
psql -v ON_ERROR_STOP=1 --no-password --no-psqlrc -U supabase_admin -d "${POSTGRES_DB:-postgres}" <<EOSQL
ALTER USER supabase_auth_admin WITH PASSWORD '$POSTGRES_PASSWORD';
ALTER USER supabase_storage_admin WITH PASSWORD '$POSTGRES_PASSWORD';
EOSQL

echo "Running Gatewaze migrations..."

for f in /gatewaze-migrations/*.sql; do
  if [ -f "$f" ]; then
    echo "  Running: $(basename $f)"
    psql -v ON_ERROR_STOP=1 --no-password --no-psqlrc -U supabase_admin -d "${POSTGRES_DB:-postgres}" -f "$f"
  fi
done

echo "Gatewaze migrations complete."

if [ -f /gatewaze-seed/seed.sql ]; then
  echo "Running Gatewaze seed data..."
  psql -v ON_ERROR_STOP=1 --no-password --no-psqlrc -U supabase_admin -d "${POSTGRES_DB:-postgres}" -f /gatewaze-seed/seed.sql
  echo "Gatewaze seed data loaded."
fi
