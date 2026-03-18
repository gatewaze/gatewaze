-- ============================================================================
-- Migration: 00011_permissions
-- Description: Feature-level permission system for admins
-- ============================================================================

-- ==========================================================================
-- Direct feature permissions
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
-- Permission groups (predefined bundles of features)
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
-- Group assignments
-- ==========================================================================
CREATE TABLE IF NOT EXISTS public.admin_permission_group_assignments (
  admin_id    uuid NOT NULL REFERENCES public.admin_profiles(id) ON DELETE CASCADE,
  group_id    uuid NOT NULL REFERENCES public.admin_permission_groups(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES public.admin_profiles(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (admin_id, group_id)
);

-- ==========================================================================
-- Audit log
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
