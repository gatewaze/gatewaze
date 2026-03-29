-- ============================================================================
-- Migration: 00002_admin
-- Description: Core admin tables — profiles, feature permissions, permission
--              groups, calendar/event permissions, impersonation, accounts.
--              RLS policies live in 00007_rls_policies.sql.
--              RPC functions live in 00008_rpc_functions.sql.
-- ============================================================================

-- ==========================================================================
-- 1. Admin profiles
-- ==========================================================================
CREATE TABLE IF NOT EXISTS public.admin_profiles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email      text UNIQUE NOT NULL,
  name       text,
  first_name text,
  last_name  text,
  role       text NOT NULL DEFAULT 'editor'
               CHECK (role IN ('super_admin', 'admin', 'editor')),
  avatar_url text,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.admin_profiles IS 'Platform administrators and editors';

CREATE TRIGGER admin_profiles_updated_at
  BEFORE UPDATE ON public.admin_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ==========================================================================
-- 2. Feature permissions (direct)
-- ==========================================================================
CREATE TABLE IF NOT EXISTS public.admin_permissions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id   uuid NOT NULL REFERENCES public.admin_profiles(id) ON DELETE CASCADE,
  feature    text NOT NULL,
  is_active  boolean NOT NULL DEFAULT true,
  granted_by uuid REFERENCES public.admin_profiles(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  UNIQUE (admin_id, feature)
);

COMMENT ON TABLE public.admin_permissions IS 'Per-feature permissions granted to individual admins';

-- ==========================================================================
-- 3. Permission groups (predefined bundles of features)
-- ==========================================================================
CREATE TABLE IF NOT EXISTS public.admin_permission_groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text,
  features    text[] NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.admin_permission_groups IS 'Named bundles of features that can be assigned to admins';

-- ==========================================================================
-- 4. Permission group assignments
-- ==========================================================================
CREATE TABLE IF NOT EXISTS public.admin_permission_group_assignments (
  admin_id    uuid NOT NULL REFERENCES public.admin_profiles(id) ON DELETE CASCADE,
  group_id    uuid NOT NULL REFERENCES public.admin_permission_groups(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES public.admin_profiles(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (admin_id, group_id)
);

-- ==========================================================================
-- 5. Permission audit log
-- ==========================================================================
CREATE TABLE IF NOT EXISTS public.admin_permission_audit (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id     uuid,
  feature      text,
  action       text CHECK (action IN ('grant', 'revoke')),
  performed_by uuid,
  performed_at timestamptz NOT NULL DEFAULT now(),
  details      jsonb
);

COMMENT ON TABLE public.admin_permission_audit IS 'Immutable audit trail for permission changes';

-- NOTE: admin_calendar_permissions lives in the calendars module migration.
-- NOTE: admin_event_permissions is created by the core-events module migration.

-- ==========================================================================
-- 6. Admin impersonation sessions
-- ==========================================================================
CREATE TABLE IF NOT EXISTS public.admin_impersonation_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  impersonator_id  uuid NOT NULL REFERENCES public.admin_profiles(id) ON DELETE CASCADE,
  impersonated_id  uuid NOT NULL REFERENCES public.admin_profiles(id) ON DELETE CASCADE,
  started_at       timestamptz NOT NULL DEFAULT now(),
  ended_at         timestamptz,
  is_active        boolean NOT NULL DEFAULT true,
  session_metadata jsonb DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT different_users CHECK (impersonator_id != impersonated_id),
  CONSTRAINT valid_session CHECK (ended_at IS NULL OR ended_at > started_at)
);

CREATE INDEX IF NOT EXISTS idx_admin_impersonation_sessions_impersonator
  ON public.admin_impersonation_sessions(impersonator_id);
CREATE INDEX IF NOT EXISTS idx_admin_impersonation_sessions_impersonated
  ON public.admin_impersonation_sessions(impersonated_id);
CREATE INDEX IF NOT EXISTS idx_admin_impersonation_sessions_active
  ON public.admin_impersonation_sessions(is_active) WHERE is_active = true;

COMMENT ON TABLE public.admin_impersonation_sessions IS 'Tracks admin user impersonation sessions';

CREATE TRIGGER admin_impersonation_sessions_updated_at
  BEFORE UPDATE ON public.admin_impersonation_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ==========================================================================
-- 7. Admin impersonation audit
-- ==========================================================================
CREATE TABLE IF NOT EXISTS public.admin_impersonation_audit (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid REFERENCES public.admin_impersonation_sessions(id) ON DELETE CASCADE,
  impersonator_id uuid NOT NULL REFERENCES public.admin_profiles(id) ON DELETE CASCADE,
  impersonated_id uuid NOT NULL REFERENCES public.admin_profiles(id) ON DELETE CASCADE,
  action          text NOT NULL CHECK (action IN ('started', 'ended', 'failed')),
  action_metadata jsonb DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_impersonation_audit_session
  ON public.admin_impersonation_audit(session_id);
CREATE INDEX IF NOT EXISTS idx_admin_impersonation_audit_impersonator
  ON public.admin_impersonation_audit(impersonator_id);
CREATE INDEX IF NOT EXISTS idx_admin_impersonation_audit_created
  ON public.admin_impersonation_audit(created_at DESC);

COMMENT ON TABLE public.admin_impersonation_audit IS 'Audit log for all impersonation events';

-- ==========================================================================
-- 8. Accounts
-- ==========================================================================
CREATE TABLE IF NOT EXISTS public.accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          varchar(255) NOT NULL,
  slug          varchar(255) NOT NULL UNIQUE,
  description   text,
  logo_url      text,
  website       text,
  contact_email varchar(255),
  contact_phone varchar(50),
  is_active     boolean NOT NULL DEFAULT true,
  metadata      jsonb DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.accounts IS 'Organisational accounts that own events';

CREATE INDEX IF NOT EXISTS idx_accounts_slug      ON public.accounts(slug);
CREATE INDEX IF NOT EXISTS idx_accounts_is_active ON public.accounts(is_active);

CREATE TRIGGER accounts_updated_at
  BEFORE UPDATE ON public.accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ==========================================================================
-- 9. Account users
-- ==========================================================================
CREATE TABLE IF NOT EXISTS public.accounts_users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  admin_profile_id uuid NOT NULL REFERENCES public.admin_profiles(id) ON DELETE CASCADE,
  role             varchar(20) NOT NULL DEFAULT 'member'
                   CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, admin_profile_id)
);

COMMENT ON TABLE public.accounts_users IS 'Maps admin users to accounts with roles';

CREATE INDEX IF NOT EXISTS idx_accounts_users_account ON public.accounts_users(account_id);
CREATE INDEX IF NOT EXISTS idx_accounts_users_profile ON public.accounts_users(admin_profile_id);

CREATE TRIGGER accounts_users_updated_at
  BEFORE UPDATE ON public.accounts_users
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- NOTE: FK from events.account_id → accounts.id is added in 00006_platform.sql
-- (after the events table exists).
