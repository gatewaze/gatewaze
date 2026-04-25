-- Migration: Module system v1.1 improvements
-- Addresses: UNIQUE constraint fix, source_id FK, install tracking,
-- idempotency keys, audit log, updated_at triggers, exec_sql hardening,
-- status enum fix, source origin extension

-- =============================================================================
-- 1. Fix module_sources UNIQUE constraint (NULL semantics allow duplicates)
-- =============================================================================

-- Drop old unique constraint if it exists
DO $$
BEGIN
  -- Try to drop any existing unique constraint on module_sources
  -- The constraint name varies by installation
  PERFORM 1 FROM pg_constraint
    WHERE conrelid = 'public.module_sources'::regclass
    AND contype = 'u';
  IF FOUND THEN
    EXECUTE (
      SELECT 'ALTER TABLE public.module_sources DROP CONSTRAINT ' || conname
      FROM pg_constraint
      WHERE conrelid = 'public.module_sources'::regclass
      AND contype = 'u'
      LIMIT 1
    );
  END IF;
END $$;

-- Drop old unique index if exists
DROP INDEX IF EXISTS public.module_sources_url_path_key;
DROP INDEX IF EXISTS public.module_sources_uniq;

-- Create proper COALESCE-indexed unique to handle NULLs correctly
CREATE UNIQUE INDEX IF NOT EXISTS module_sources_uniq ON public.module_sources (
  origin,
  COALESCE(url, ''),
  COALESCE(path, ''),
  COALESCE(branch, ''),
  COALESCE(CASE WHEN origin = 'config' THEN '' ELSE url END, ''),
  COALESCE(CASE WHEN origin = 'upload' THEN url ELSE '' END, '')
);

-- Add origin index if missing
CREATE INDEX IF NOT EXISTS module_sources_origin_idx ON public.module_sources (origin);

-- Extend origin check to include 'orphaned' state
ALTER TABLE public.module_sources DROP CONSTRAINT IF EXISTS module_sources_origin_check;
ALTER TABLE public.module_sources ADD CONSTRAINT module_sources_origin_check
  CHECK (origin IN ('config', 'user', 'upload', 'orphaned'));

-- Add token_enc column for encrypted token storage (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'module_sources' AND column_name = 'token_enc') THEN
    ALTER TABLE public.module_sources ADD COLUMN token_enc text;
  END IF;
  -- Add commit_sha column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'module_sources' AND column_name = 'commit_sha') THEN
    ALTER TABLE public.module_sources ADD COLUMN commit_sha text;
  END IF;
  -- Add local_path column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'module_sources' AND column_name = 'local_path') THEN
    ALTER TABLE public.module_sources ADD COLUMN local_path text;
  END IF;
END $$;

-- =============================================================================
-- 2. Add source_id FK and install tracking to installed_modules
-- =============================================================================

DO $$
BEGIN
  -- Add source_id FK
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'installed_modules' AND column_name = 'source_id') THEN
    ALTER TABLE public.installed_modules ADD COLUMN source_id uuid REFERENCES public.module_sources(id);
    CREATE INDEX IF NOT EXISTS installed_modules_source_id_idx ON public.installed_modules (source_id);
  END IF;

  -- Add install completion tracking
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'installed_modules' AND column_name = 'on_install_ran_at') THEN
    ALTER TABLE public.installed_modules ADD COLUMN on_install_ran_at timestamptz;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'installed_modules' AND column_name = 'install_completed_at') THEN
    ALTER TABLE public.installed_modules ADD COLUMN install_completed_at timestamptz;
  END IF;

  -- Add UI contributions tracking
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'installed_modules' AND column_name = 'ui_contributions_ignored') THEN
    ALTER TABLE public.installed_modules ADD COLUMN ui_contributions_ignored jsonb NOT NULL DEFAULT '[]';
  END IF;

  -- Add package_name column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'installed_modules' AND column_name = 'package_name') THEN
    ALTER TABLE public.installed_modules ADD COLUMN package_name text;
  END IF;

  -- Add dependencies column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'installed_modules' AND column_name = 'dependencies') THEN
    ALTER TABLE public.installed_modules ADD COLUMN dependencies jsonb NOT NULL DEFAULT '[]';
  END IF;

  -- Ensure portal_nav has a default
  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'installed_modules' AND column_name = 'portal_nav') THEN
    ALTER TABLE public.installed_modules ALTER COLUMN portal_nav SET DEFAULT '[]';
  END IF;

  -- Ensure last_enabled_at exists
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'installed_modules' AND column_name = 'last_enabled_at') THEN
    ALTER TABLE public.installed_modules ADD COLUMN last_enabled_at timestamptz;
  END IF;
END $$;

-- Fix status enum: remove 'not_installed', ensure 'error' exists
-- (Can't easily remove check constraint values in Postgres without recreation)
ALTER TABLE public.installed_modules DROP CONSTRAINT IF EXISTS installed_modules_status_check;
ALTER TABLE public.installed_modules ADD CONSTRAINT installed_modules_status_check
  CHECK (status IN ('enabled', 'disabled', 'not_installed', 'error'));

-- Add GIN index on features for querying
CREATE INDEX IF NOT EXISTS installed_modules_features_gin_idx
  ON public.installed_modules USING GIN (features);

-- =============================================================================
-- 3. Updated_at triggers
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Module sources trigger
DROP TRIGGER IF EXISTS trg_module_sources_updated ON public.module_sources;
CREATE TRIGGER trg_module_sources_updated
  BEFORE UPDATE ON public.module_sources
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Installed modules trigger
DROP TRIGGER IF EXISTS trg_installed_modules_updated ON public.installed_modules;
CREATE TRIGGER trg_installed_modules_updated
  BEFORE UPDATE ON public.installed_modules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- 4. Idempotency keys table
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.idempotency_keys (
  idempotency_key text NOT NULL,
  actor_user_id   uuid NOT NULL,
  route           text NOT NULL,
  resource_key    text NOT NULL DEFAULT 'global',
  request_hash    text NOT NULL,
  response_json   jsonb NOT NULL,
  status_code     int  NOT NULL,
  in_progress     boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  PRIMARY KEY (actor_user_id, route, resource_key, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idempotency_keys_expires_idx ON public.idempotency_keys (expires_at);
CREATE INDEX IF NOT EXISTS idempotency_keys_resource_idx ON public.idempotency_keys (resource_key);

-- =============================================================================
-- 5. Audit log table (append-only)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.audit_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id   uuid,
  actor_role      text,
  action          text NOT NULL,
  target_module_id text,
  target_source_id uuid,
  request_id      text,
  ts              timestamptz NOT NULL DEFAULT now(),
  metadata        jsonb
);

CREATE INDEX IF NOT EXISTS audit_log_ts_idx ON public.audit_log (ts);
CREATE INDEX IF NOT EXISTS audit_log_action_idx ON public.audit_log (action);
CREATE INDEX IF NOT EXISTS audit_log_module_idx ON public.audit_log (target_module_id);

-- =============================================================================
-- 6. exec_sql hardening (tighten grants)
-- =============================================================================

-- Ensure exec_sql exists and has proper grants
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'exec_sql') THEN
    -- Revoke from public and lesser roles
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.exec_sql(text) FROM PUBLIC';

    -- Revoke from anon and authenticated if those roles exist
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE EXECUTE ON FUNCTION public.exec_sql(text) FROM anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE 'REVOKE EXECUTE ON FUNCTION public.exec_sql(text) FROM authenticated';
    END IF;

    -- Grant only to service_role
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE 'GRANT EXECUTE ON FUNCTION public.exec_sql(text) TO service_role';
    END IF;
  END IF;
END $$;

-- =============================================================================
-- 7. RLS policies for module tables
-- =============================================================================

-- module_sources: deny all non-service-role access
ALTER TABLE public.module_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS module_sources_service_only ON public.module_sources;
CREATE POLICY module_sources_service_only ON public.module_sources
  FOR ALL
  USING (
    current_setting('role', true) = 'service_role'
    OR current_setting('request.jwt.claims', true)::jsonb->>'role' = 'service_role'
  );

-- installed_modules: SELECT for admin/super_admin, writes service-role only
ALTER TABLE public.installed_modules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS installed_modules_admin_read ON public.installed_modules;
CREATE POLICY installed_modules_admin_read ON public.installed_modules
  FOR SELECT
  USING (
    current_setting('role', true) = 'service_role'
    OR current_setting('request.jwt.claims', true)::jsonb->'app_metadata'->>'gatewaze_role' IN ('admin', 'super_admin')
  );

DROP POLICY IF EXISTS installed_modules_service_write ON public.installed_modules;
CREATE POLICY installed_modules_service_write ON public.installed_modules
  FOR ALL
  USING (
    current_setting('role', true) = 'service_role'
    OR current_setting('request.jwt.claims', true)::jsonb->>'role' = 'service_role'
  );

-- module_migrations: service-role only
ALTER TABLE public.module_migrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS module_migrations_service_only ON public.module_migrations;
CREATE POLICY module_migrations_service_only ON public.module_migrations
  FOR ALL
  USING (
    current_setting('role', true) = 'service_role'
    OR current_setting('request.jwt.claims', true)::jsonb->>'role' = 'service_role'
  );

-- idempotency_keys: service-role only
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS idempotency_keys_service_only ON public.idempotency_keys;
CREATE POLICY idempotency_keys_service_only ON public.idempotency_keys
  FOR ALL
  USING (
    current_setting('role', true) = 'service_role'
    OR current_setting('request.jwt.claims', true)::jsonb->>'role' = 'service_role'
  );

-- audit_log: admin/super_admin can SELECT, service-role writes only
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_log_admin_read ON public.audit_log;
CREATE POLICY audit_log_admin_read ON public.audit_log
  FOR SELECT
  USING (
    current_setting('role', true) = 'service_role'
    OR current_setting('request.jwt.claims', true)::jsonb->'app_metadata'->>'gatewaze_role' IN ('admin', 'super_admin')
  );

DROP POLICY IF EXISTS audit_log_service_write ON public.audit_log;
CREATE POLICY audit_log_service_write ON public.audit_log
  FOR INSERT
  WITH CHECK (
    current_setting('role', true) = 'service_role'
    OR current_setting('request.jwt.claims', true)::jsonb->>'role' = 'service_role'
  );
