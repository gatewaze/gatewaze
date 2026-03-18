-- ============================================================================
-- Migration: 00013_app_settings
-- Description: App settings table and auto-link admin trigger
-- ============================================================================

-- ==========================================================================
-- App Settings (key-value store for runtime configuration)
-- ==========================================================================
CREATE TABLE IF NOT EXISTS public.app_settings (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.app_settings IS 'Key-value store for runtime app configuration';

-- Updated-at trigger
CREATE TRIGGER app_settings_updated_at
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Anyone can read settings (needed before login for app name display)
CREATE POLICY "anyone_select_settings"
  ON public.app_settings FOR SELECT
  USING (true);

-- Only super_admins can insert/update/delete settings
CREATE POLICY "super_admin_insert_settings"
  ON public.app_settings FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY "super_admin_update_settings"
  ON public.app_settings FOR UPDATE TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "super_admin_delete_settings"
  ON public.app_settings FOR DELETE TO authenticated
  USING (public.is_super_admin());

-- ==========================================================================
-- Auto-link admin_profiles.user_id when auth.users is created
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.auto_link_admin_profile()
RETURNS trigger AS $$
BEGIN
  UPDATE public.admin_profiles
  SET user_id = NEW.id
  WHERE email = NEW.email
    AND user_id IS NULL;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.auto_link_admin_profile()
  IS 'Automatically links admin_profiles to auth.users when email matches';

CREATE TRIGGER auto_link_admin_on_user_create
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_link_admin_profile();
