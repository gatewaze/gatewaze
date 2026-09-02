-- MCP LFID/OAuth access model + request audit log
-- (spec-mcp-lfid-access.md §4, §5)
--
-- Groups grant scope sets; membership is rule-based (email_domain,
-- all_authenticated) and/or explicit (person_id). Per-person grants add and
-- remove scopes on top. Everything keys on people(id): first-contact
-- provisioning (spec §3.1) guarantees a person exists by resolution time,
-- and it lets admins configure access for people who have never connected.
--
-- All five tables are service-role-only (RLS enabled, no policies — the
-- "silent table" pattern used by api_keys): the platform API is the only
-- reader/writer, via admin routes and the token-issuance path.

CREATE TABLE IF NOT EXISTS public.mcp_access_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,               -- machine name, e.g. 'members'
  label text NOT NULL,                     -- display name
  scopes text[] NOT NULL DEFAULT '{}',
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mcp_group_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.mcp_access_groups(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('email_domain', 'all_authenticated')),
  -- email_domain: the bare domain, lowercased ('example.org').
  -- all_authenticated: match is ignored (store '').
  match text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mcp_group_rules_group ON public.mcp_group_rules(group_id);

CREATE TABLE IF NOT EXISTS public.mcp_group_members (
  group_id uuid NOT NULL REFERENCES public.mcp_access_groups(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  added_by uuid,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, person_id)
);
CREATE INDEX IF NOT EXISTS idx_mcp_group_members_person ON public.mcp_group_members(person_id);

CREATE TABLE IF NOT EXISTS public.mcp_person_grants (
  person_id uuid PRIMARY KEY REFERENCES public.people(id) ON DELETE CASCADE,
  scopes_add text[] NOT NULL DEFAULT '{}',
  scopes_remove text[] NOT NULL DEFAULT '{}',
  note text,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Refresh-token / session registry for the MCP authorization server. Access
-- tokens are stateless JWTs (1h); refresh tokens are opaque ids referencing
-- rows here. Deleting a row revokes the session at next refresh.
CREATE TABLE IF NOT EXISTS public.mcp_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  subject text NOT NULL,                   -- LFID sub or platform user id
  email text NOT NULL,
  auth_mode text NOT NULL CHECK (auth_mode IN ('lfid', 'magic_link')),
  client_id text NOT NULL,                 -- OAuth client (CIMD URL or DCR id)
  client_name text,
  refresh_token_hash text NOT NULL UNIQUE, -- sha256 of the opaque token
  scopes text[] NOT NULL DEFAULT '{}',     -- snapshot at last issuance
  issued_at timestamptz NOT NULL DEFAULT now(),
  last_refreshed_at timestamptz,
  last_seen_at timestamptz,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_mcp_sessions_person ON public.mcp_sessions(person_id);
CREATE INDEX IF NOT EXISTS idx_mcp_sessions_expiry ON public.mcp_sessions(expires_at) WHERE revoked_at IS NULL;

-- Request audit log (spec §5). Written by the batch ingest endpoint; read by
-- the admin MCP Activity tab. 90-day retention (trimmed by scheduler cron).
CREATE TABLE IF NOT EXISTS public.mcp_request_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts timestamptz NOT NULL,
  identity_kind text NOT NULL CHECK (identity_kind IN ('anonymous', 'oauth', 'api_key')),
  subject text,
  email text,
  person_id uuid,
  tier text,                               -- comma-joined group names at call time
  ip text,
  client_name text,
  era text,
  tool text NOT NULL,
  args jsonb,
  outcome text NOT NULL CHECK (outcome IN ('ok', 'error', 'unknown_tool', 'insufficient_scope')),
  error text,
  ms integer,
  bytes integer,
  rows integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mcp_request_log_ts ON public.mcp_request_log(ts DESC);
CREATE INDEX IF NOT EXISTS idx_mcp_request_log_person ON public.mcp_request_log(person_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_mcp_request_log_tool ON public.mcp_request_log(tool, ts DESC);
CREATE INDEX IF NOT EXISTS idx_mcp_request_log_outcome ON public.mcp_request_log(outcome, ts DESC);

ALTER TABLE public.mcp_access_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_group_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_person_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_request_log ENABLE ROW LEVEL SECURITY;

-- updated_at triggers (set_updated_at ships in earlier platform migrations)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_mcp_access_groups_updated_at') THEN
    CREATE TRIGGER set_mcp_access_groups_updated_at
      BEFORE UPDATE ON public.mcp_access_groups
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_mcp_person_grants_updated_at') THEN
    CREATE TRIGGER set_mcp_person_grants_updated_at
      BEFORE UPDATE ON public.mcp_person_grants
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- Seed the default group. Deployment-specific groups (e.g. a "Staff"
-- with an email_domain rule for a staff domain) are created through
-- the admin UI or a brand rollout step — NOT in the shared core migration.
INSERT INTO public.mcp_access_groups (name, label, scopes, is_default)
VALUES (
  'members',
  'Members',
  ARRAY['events:read', 'calendars:read', 'blog:read', 'newsletters:read',
        'resources:read', 'speakers:read', 'sponsors:read'],
  true
) ON CONFLICT (name) DO NOTHING;

INSERT INTO public.mcp_group_rules (group_id, kind, match)
SELECT id, 'all_authenticated', '' FROM public.mcp_access_groups WHERE name = 'members'
  AND NOT EXISTS (
    SELECT 1 FROM public.mcp_group_rules r
    JOIN public.mcp_access_groups g ON g.id = r.group_id
    WHERE g.name = 'members' AND r.kind = 'all_authenticated'
  );
