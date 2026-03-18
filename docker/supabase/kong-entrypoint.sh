#!/bin/sh
# Substitute environment variables in kong.yml template and start Kong
sed -e "s|\${SUPABASE_ANON_KEY}|${SUPABASE_ANON_KEY}|g" \
    -e "s|\${SUPABASE_SERVICE_KEY}|${SUPABASE_SERVICE_KEY}|g" \
    /var/lib/kong/kong.yml.template > /tmp/kong.yml

export KONG_DECLARATIVE_CONFIG=/tmp/kong.yml
exec /docker-entrypoint.sh kong docker-start
