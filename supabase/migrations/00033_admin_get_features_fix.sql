-- ============================================================================
-- 00033_admin_get_features_fix
-- ============================================================================
-- Fix two bugs that combined to leave non-super-admin menus empty for every
-- brand:
--
-- 1) packages/admin/src/hooks/useFeaturePermissions.ts calls
--      PermissionsService.getAdminFeatures(userForPermissions.id, …)
--    which is the auth.users.id (the session user). The original RPC ran
--      WHERE admin_id = p_admin_id
--    against public.admin_permissions, but admin_permissions.admin_id holds
--    admin_profiles.id, not auth.users.id. So every non-super-admin got an
--    empty feature list and saw no menu items, even with a grant on file.
--
-- 2) The original RPC returned `text[]`, but
--      PermissionsService.getAdminFeatures()
--    does `(data || []).map((row: { feature: AdminFeature }) => row.feature)`
--    — i.e. expects a table-set with a `feature` column. Even when (1) was
--    sidestepped (passing the admin_profile_id), .map() walked the rows
--    looking for `.feature` on plain strings and ended up with `[undefined,
--    undefined, …]`. The permissions map was always empty for non-super-
--    admins.
--
-- Hit live on AAIF 2026-06-04 for skearns@linuxfoundation.org. They had a
-- valid `admin_permissions` row for `newsletters` after the 00032 schema
-- fixes but still saw no newsletter menu.
--
-- This migration: drop + recreate as RETURNS TABLE(feature text), resolve
-- the input id through admin_profiles (matches either auth.users.id or
-- admin_profiles.id), and emit one row per granted feature.
--
-- DROP+CREATE is required (cannot change return type via OR REPLACE).
-- ============================================================================

DROP FUNCTION IF EXISTS public.admin_get_features(uuid);

CREATE OR REPLACE FUNCTION public.admin_get_features(p_admin_id uuid)
RETURNS TABLE(feature text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid;
BEGIN
  -- Accept either auth.users.id or admin_profiles.id.
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
    RETURN;
  END IF;

  RETURN QUERY
  -- Direct per-feature grants.
  SELECT DISTINCT ap.feature
  FROM public.admin_permissions ap
  WHERE ap.admin_id = v_profile_id
    AND ap.is_active = true
    AND (ap.expires_at IS NULL OR ap.expires_at > now())
  UNION
  -- Group-derived grants.
  SELECT DISTINCT f::text
  FROM public.admin_permission_group_assignments ga
  JOIN public.admin_permission_groups g ON g.id = ga.group_id,
  LATERAL unnest(g.features) AS f
  WHERE ga.admin_id = v_profile_id
    AND COALESCE(ga.is_active, true) = true
    AND (ga.expires_at IS NULL OR ga.expires_at > now());
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_features(uuid)
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
