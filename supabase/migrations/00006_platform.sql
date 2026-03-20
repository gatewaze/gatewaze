-- 00006_platform.sql
-- Core platform infrastructure tables
-- Runs after 00005 (people_extended), before 00007 (RLS policies)
-- NOTE: RLS policies are NOT included here; they live in 00007_rls_policies.sql

--------------------------------------------------------------------------------
-- 1. Email Templates
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.email_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  subject       text NOT NULL,
  html_body     text,
  text_body     text,
  template_type text,
  variables     jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active     boolean NOT NULL DEFAULT true,
  usage_count   integer NOT NULL DEFAULT 0,
  last_used_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.email_templates IS 'Reusable email templates with variable placeholders';

CREATE TRIGGER email_templates_updated_at
  BEFORE UPDATE ON public.email_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

--------------------------------------------------------------------------------
-- 2. Email Logs
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.email_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email      text NOT NULL,
  from_email    text,
  subject       text,
  template_id   uuid REFERENCES public.email_templates(id) ON DELETE SET NULL,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'sent', 'delivered', 'failed', 'bounced')),
  sent_at       timestamptz,
  error_message text,
  metadata      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.email_logs IS 'Audit trail for all outbound emails';

--------------------------------------------------------------------------------
-- 3. Platform Settings
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.platform_settings (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.platform_settings IS 'Key-value store for runtime platform configuration';

CREATE TRIGGER platform_settings_updated_at
  BEFORE UPDATE ON public.platform_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

--------------------------------------------------------------------------------
-- 4. Default Branding Settings
--------------------------------------------------------------------------------

INSERT INTO platform_settings (key, value) VALUES
  ('app_name', 'Gatewaze'),
  ('primary_color', '#20dd20'),
  ('secondary_color', '#0a0a0a'),
  ('tertiary_color', '#1a1a1a'),
  ('font_heading', 'Poppins'),
  ('font_heading_weight', '600'),
  ('font_body', 'Inter'),
  ('font_body_weight', '400'),
  ('body_text_size', '16'),
  ('logo_url', ''),
  ('logo_icon_url', ''),
  ('favicon_url', ''),
  ('contact_email', ''),
  ('tracking_head', ''),
  ('tracking_body', ''),
  ('portal_theme', 'blobs')
ON CONFLICT (key) DO NOTHING;

--------------------------------------------------------------------------------
-- 5. Installed Modules & Module Migrations
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.installed_modules (
  id           text PRIMARY KEY,
  name         text NOT NULL,
  version      text NOT NULL,
  features     text[] NOT NULL DEFAULT '{}',
  status       text NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled', 'error')),
  config       jsonb DEFAULT '{}',
  type         text DEFAULT 'feature',
  source       text DEFAULT 'bundled',
  visibility   text DEFAULT 'public',
  description  text DEFAULT '',
  installed_at timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.module_migrations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id    text NOT NULL REFERENCES public.installed_modules(id) ON DELETE CASCADE,
  filename     text NOT NULL,
  applied_at   timestamptz NOT NULL DEFAULT now(),
  checksum     text,
  UNIQUE(module_id, filename)
);

CREATE TRIGGER set_installed_modules_updated_at
  BEFORE UPDATE ON public.installed_modules
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

--------------------------------------------------------------------------------
-- 6. Storage Bucket (media)
--------------------------------------------------------------------------------

ALTER TABLE storage.buckets ADD COLUMN IF NOT EXISTS public boolean DEFAULT false;
ALTER TABLE storage.buckets ADD COLUMN IF NOT EXISTS file_size_limit bigint;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('media', 'media', true, 52428800)
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = EXCLUDED.file_size_limit;

--------------------------------------------------------------------------------
-- 7. Admin Event Permissions (deferred from 00002; needs events table)
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.admin_event_permissions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id         uuid NOT NULL REFERENCES public.admin_profiles(id) ON DELETE CASCADE,
  event_id         varchar(10) NOT NULL REFERENCES public.events(event_id) ON DELETE CASCADE,
  permission_level text CHECK (permission_level IN ('view', 'edit', 'manage')) DEFAULT 'view',
  granted_by       uuid REFERENCES public.admin_profiles(id),
  granted_at       timestamptz DEFAULT now(),
  expires_at       timestamptz,
  is_active        boolean DEFAULT true,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  UNIQUE(admin_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_admin_event_permissions_admin ON public.admin_event_permissions(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_event_permissions_event ON public.admin_event_permissions(event_id);

COMMENT ON TABLE public.admin_event_permissions IS 'Event-level admin permissions';

CREATE TRIGGER admin_event_permissions_updated_at
  BEFORE UPDATE ON public.admin_event_permissions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

--------------------------------------------------------------------------------
-- 8. FK from events.account_id -> accounts.id (deferred from 00002)
--------------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'events_account_id_fkey'
      AND table_name = 'events'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_account_id_fkey
      FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;
  END IF;
END $$;

--------------------------------------------------------------------------------
-- 9. Auto-link admin_profile trigger
--------------------------------------------------------------------------------

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
