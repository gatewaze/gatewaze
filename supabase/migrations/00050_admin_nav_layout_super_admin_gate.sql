-- =============================================================================
-- 00050_admin_nav_layout_super_admin_gate.sql
--
-- The org-wide admin navigation layout lives on platform_settings as the
-- row key = 'admin_nav_layout'. The API only lets a super_admin change it
-- (packages/api/src/routes/admin-nav-layout.ts), but the broad admin
-- INSERT/UPDATE policies let any admin write the row directly through
-- PostgREST, skipping that gate.
--
-- That mattered less while the layout only arranged existing menu items.
-- It can now hold custom hub cards that link to any https URL, shown to
-- every admin (and, through the admin embed, inside LFX under a trusted
-- heading). So this restricts writes to that key to super_admin, the same
-- way 00028 did for the tracking keys.
-- =============================================================================

DROP POLICY IF EXISTS "admin_insert_platform_settings_non_tracking" ON public.platform_settings;
DROP POLICY IF EXISTS "admin_update_platform_settings_non_tracking" ON public.platform_settings;

-- Admins keep write access to every other key. Without a WITH CHECK, the
-- UPDATE policy's USING expression also applies to the new row, so an admin
-- can't rename another row's key into one of these either.
CREATE POLICY "admin_insert_platform_settings_non_gated"
  ON public.platform_settings FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin()
    AND key NOT IN ('tracking_head', 'tracking_body', 'admin_nav_layout')
  );

CREATE POLICY "admin_update_platform_settings_non_gated"
  ON public.platform_settings FOR UPDATE TO authenticated
  USING (
    public.is_admin()
    AND key NOT IN ('tracking_head', 'tracking_body', 'admin_nav_layout')
  );

-- super_admin keeps full access through the existing
-- super_admin_insert/update/delete_platform_settings policies.
