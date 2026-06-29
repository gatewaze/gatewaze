-- Public, read-only accessor for enabled modules.
--
-- Pre-auth surfaces (notably the admin login page) need to know which modules
-- are enabled so they can render module-contributed sign-in providers (e.g. the
-- lfid-auth "Sign in with LFID" button) and decide whether to suppress the
-- native magic-link form. The installed_modules table is admin/service-only
-- under RLS — and it holds provider config/secrets — so we cannot open it to
-- anon. Instead, expose ONLY the id + features of ENABLED modules via a
-- SECURITY DEFINER function. No config, no secrets, enabled rows only.
CREATE OR REPLACE FUNCTION public.public_enabled_modules()
RETURNS TABLE (id text, features text[])
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT id, features
  FROM public.installed_modules
  WHERE status = 'enabled';
$$;

REVOKE ALL ON FUNCTION public.public_enabled_modules() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_enabled_modules() TO anon, authenticated;
