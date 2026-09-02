-- Narrow the authenticated SELECT policy on installed_modules to admins.
--
-- 00006 created:
--
--   CREATE POLICY "authenticated_select_installed_modules"
--     ON public.installed_modules FOR SELECT TO authenticated
--     USING (true);
--
-- 00020 later added an admin-scoped policy, but Postgres ORs permissive
-- policies together, so the earlier USING (true) kept granting every
-- authenticated user a full read of the table -- including operational columns
-- such as reconcile_error and last_rebuild_error. Any signed-in portal member
-- could read them.
--
-- Replace it with the same predicate scoped to admins. This stays at
-- is_admin() rather than is_super_admin() on purpose: the admin app builds its
-- routes, navigation and feature flags by reading installed_modules directly
-- through PostgREST, and that has to keep working for every admin-app user.
-- Restricting who may *change* modules is enforced separately, on the API
-- routes and in the admin UI.
--
-- The anon policy is untouched: the portal reads enabled modules through
-- installed_modules_select_anon (status = 'enabled'), which it still needs.

DROP POLICY IF EXISTS "authenticated_select_installed_modules" ON public.installed_modules;

CREATE POLICY "admin_select_installed_modules"
  ON public.installed_modules FOR SELECT TO authenticated
  USING (public.is_admin());

COMMENT ON POLICY "admin_select_installed_modules" ON public.installed_modules IS
  'Authenticated reads are limited to admin roles. Replaces the USING (true) policy from 00006, which OR-ed with later admin policies and left the table readable by every signed-in user.';
