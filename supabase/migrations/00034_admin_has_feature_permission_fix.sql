-- ============================================================================
-- 00034_admin_has_feature_permission_fix
-- ============================================================================
-- Same shape of bug as 00033 admin_get_features, but on the route-guard
-- side. FeatureGuard → useHasPermission → PermissionsService.hasPermission
-- calls:
--   supabase.rpc('admin_has_feature_permission', {
--     p_admin_id: user.id,       -- auth.users.id
--     p_feature, p_account_id,
--   })
-- The deployed RPC's signature was admin_has_feature_permission(uuid, text)
-- — two args, no p_account_id. PostgREST returned PGRST202 "function not
-- found" for every call, hasPermission silently became false, and every
-- guarded route bounced the operator to /unauthorized. On AAIF for
-- skearns@linuxfoundation.org: the home page briefly rendered the
-- newsletters menu item (via the working admin_get_features) and then
-- the FeatureGuard around /newsletters redirected to /unauthorized.
--
-- Drop both legacy signatures, replace with a 3-arg version that:
--   • accepts either auth.users.id or admin_profiles.id;
--   • returns true if the admin has the feature globally (account_id IS NULL
--     on the grant) OR specifically for p_account_id.
--
-- Idempotent; safe to re-run.
-- ============================================================================

DROP FUNCTION IF EXISTS public.admin_has_feature_permission(uuid, text);
DROP FUNCTION IF EXISTS public.admin_has_feature_permission(uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.admin_has_feature_permission(
  p_admin_id uuid,
  p_feature text,
  p_account_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid;
BEGIN
  -- Accept either auth.users.id or admin_profiles.id (same convention as
  -- admin_get_features in 00033).
  SELECT id INTO v_profile_id
  FROM public.admin_profiles
  WHERE user_id = p_admin_id AND is_active = true
  LIMIT 1;

  IF v_profile_id IS NULL THEN
    SELECT id INTO v_profile_id
    FROM public.admin_profiles
    WHERE id = p_admin_id AND is_active = true
    LIMIT 1;
  END IF;

  IF v_profile_id IS NULL THEN
    RETURN false;
  END IF;

  -- Direct per-feature grant. account_id semantics:
  --   • NULL grant       → applies to every account this admin can see.
  --   • Specific account → only counts when caller asked for that account
  --                        OR didn't specify (p_account_id IS NULL).
  IF EXISTS (
    SELECT 1
    FROM public.admin_permissions ap
    WHERE ap.admin_id = v_profile_id
      AND ap.feature = p_feature
      AND ap.is_active = true
      AND (ap.expires_at IS NULL OR ap.expires_at > now())
      AND (
        ap.account_id IS NULL
        OR p_account_id IS NULL
        OR ap.account_id = p_account_id
      )
  ) THEN
    RETURN true;
  END IF;

  -- Group-derived grant.
  IF EXISTS (
    SELECT 1
    FROM public.admin_permission_group_assignments ga
    JOIN public.admin_permission_groups g ON g.id = ga.group_id
    WHERE ga.admin_id = v_profile_id
      AND COALESCE(ga.is_active, true) = true
      AND (ga.expires_at IS NULL OR ga.expires_at > now())
      AND p_feature = ANY(g.features)
      AND (
        ga.account_id IS NULL
        OR p_account_id IS NULL
        OR ga.account_id = p_account_id
      )
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_has_feature_permission(uuid, text, uuid)
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
