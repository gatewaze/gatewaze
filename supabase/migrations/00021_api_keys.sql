-- Public API key management infrastructure
-- Supports the /api/v1/ public REST API and future MCP server auth

CREATE TABLE IF NOT EXISTS public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  key_hash text NOT NULL UNIQUE,               -- hex(HMAC-SHA256(apiKey, API_KEY_PEPPER)), 64 chars
  key_prefix varchar(16) NOT NULL,             -- e.g. "gw_live_a1b2c3d4"
  scopes text[] NOT NULL DEFAULT '{}',         -- e.g. ['events:read', 'calendars:read']
  rate_limit_rpm integer NOT NULL DEFAULT 60,
  write_rate_limit_rpm integer NOT NULL DEFAULT 10,
  is_active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  last_used_at timestamptz,
  total_requests bigint NOT NULL DEFAULT 0,
  created_by uuid REFERENCES admin_profiles(id),
  metadata jsonb NOT NULL DEFAULT '{}',
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_active_hash
  ON api_keys (key_hash) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix
  ON api_keys (key_prefix);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- updated_at trigger (reuses existing function from platform migrations)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_api_keys_updated_at'
  ) THEN
    CREATE TRIGGER set_api_keys_updated_at
      BEFORE UPDATE ON api_keys
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- Idempotency tracking for public API write endpoints
CREATE TABLE IF NOT EXISTS public.public_api_idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id uuid NOT NULL REFERENCES api_keys(id),
  method text NOT NULL,
  route_template text NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL,
  response_status integer NOT NULL,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  UNIQUE (api_key_id, method, route_template, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_expires
  ON public_api_idempotency_keys (expires_at);

ALTER TABLE public_api_idempotency_keys ENABLE ROW LEVEL SECURITY;

-- Seed a default dev API key for local development.
-- Key: gw_live_dev00000000000000000000000000000001
-- Pepper: Z2F0ZXdhemUtZGV2LXBlcHBlci0wMDAwMDAwMDAwMDA= (set as API_KEY_PEPPER env var)
-- Hash: HMAC-SHA256(key, pepper) — pre-computed so local dev works out of the box.
INSERT INTO api_keys (id, name, key_hash, key_prefix, scopes, rate_limit_rpm, write_rate_limit_rpm, metadata)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Local Development',
  'afbf14897e9b561e6762b0984bdb45bf3071aad5e47c210c40cbc2e34d0e33b2',
  'gw_live_dev00000',
  ARRAY['events:read', 'calendars:read', 'forms:read', 'forms:submit', 'lists:read',
        'lists:subscribe', 'blog:read', 'speakers:read', 'sponsors:read',
        'registrations:create', 'newsletters:read'],
  1000,
  100,
  '{"purpose": "local development", "note": "seeded by migration — do not use in production"}'::jsonb
) ON CONFLICT (id) DO NOTHING;
