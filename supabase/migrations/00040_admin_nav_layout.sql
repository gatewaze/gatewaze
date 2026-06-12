-- ============================================================================
-- 00040_admin_nav_layout.sql
--
-- User-configurable admin navigation. The admin sidebar/settings layout is
-- now an overlay on top of each module's declared default placement:
--
--   module defaults  ->  org layout  ->  per-user override  ->  permission filter
--
-- Two persistence layers, both holding the same NavLayout document shape
-- (see @gatewaze/shared/modules → NavLayout):
--
--   1. Org-wide default — platform_settings key 'admin_nav_layout' (a JSON
--      string). Writable by super_admins only; that gate lives at the API
--      layer (platform_settings has no per-row owner). Absence of the key
--      means "use module defaults", i.e. the sidebar renders exactly as it
--      did before this feature existed.
--
--   2. Per-user override — admin_ui_preferences.nav_layout (jsonb). NULL
--      means "follow the org default". Each admin owns exactly their own
--      row; enforced by RLS below.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.admin_ui_preferences (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nav_layout jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.admin_ui_preferences IS
  'Per-admin UI overrides. nav_layout overlays the org-wide admin_nav_layout (platform_settings); NULL = follow org default.';

CREATE TRIGGER admin_ui_preferences_updated_at
  BEFORE UPDATE ON public.admin_ui_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.admin_ui_preferences ENABLE ROW LEVEL SECURITY;

-- Each admin reads and writes only their own preferences row.
CREATE POLICY "admin_ui_preferences_owner"
  ON public.admin_ui_preferences FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Service role bypasses RLS for server-side reads (e.g. resolving a user's
-- effective layout in the API).
CREATE POLICY "admin_ui_preferences_service_role"
  ON public.admin_ui_preferences FOR ALL TO service_role
  USING (true) WITH CHECK (true);
