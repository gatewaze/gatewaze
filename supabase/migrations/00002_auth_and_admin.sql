-- ============================================================================
-- Migration: 00002_auth_and_admin
-- Description: Admin profiles for managing the platform
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.admin_profiles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email      text UNIQUE NOT NULL,
  name       text,
  role       text NOT NULL DEFAULT 'editor'
               CHECK (role IN ('super_admin', 'admin', 'editor')),
  avatar_url text,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.admin_profiles IS 'Platform administrators and editors';

-- Updated-at trigger
CREATE TRIGGER admin_profiles_updated_at
  BEFORE UPDATE ON public.admin_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
