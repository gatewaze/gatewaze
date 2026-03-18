-- ============================================================================
-- Migration: 00020_accounts
-- Description: Create accounts and account_users tables
-- ============================================================================

-- Accounts table
CREATE TABLE IF NOT EXISTS public.accounts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             varchar(255) NOT NULL,
  slug             varchar(255) NOT NULL UNIQUE,
  description      text,
  logo_url         text,
  website          text,
  contact_email    varchar(255),
  contact_phone    varchar(50),
  is_active        boolean NOT NULL DEFAULT true,
  metadata         jsonb DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.accounts IS 'Organisational accounts that own events';

CREATE INDEX IF NOT EXISTS idx_accounts_slug      ON public.accounts (slug);
CREATE INDEX IF NOT EXISTS idx_accounts_is_active ON public.accounts (is_active);

CREATE TRIGGER accounts_updated_at
  BEFORE UPDATE ON public.accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Account users junction table
CREATE TABLE IF NOT EXISTS public.account_users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES public.accounts (id) ON DELETE CASCADE,
  admin_profile_id  uuid NOT NULL REFERENCES public.admin_profiles (id) ON DELETE CASCADE,
  role              varchar(20) NOT NULL DEFAULT 'member'
                    CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, admin_profile_id)
);

COMMENT ON TABLE public.account_users IS 'Maps admin users to accounts with roles';

CREATE INDEX IF NOT EXISTS idx_account_users_account ON public.account_users (account_id);
CREATE INDEX IF NOT EXISTS idx_account_users_profile ON public.account_users (admin_profile_id);

CREATE TRIGGER account_users_updated_at
  BEFORE UPDATE ON public.account_users
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Add foreign key from events.account_id to accounts if not already present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'events_account_id_fkey'
      AND table_name = 'events'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_account_id_fkey
      FOREIGN KEY (account_id) REFERENCES public.accounts (id) ON DELETE SET NULL;
  END IF;
END $$;

-- RLS
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_users ENABLE ROW LEVEL SECURITY;

-- Accounts policies
CREATE POLICY "accounts_select_admin"
  ON public.accounts FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "accounts_insert_admin"
  ON public.accounts FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "accounts_update_admin"
  ON public.accounts FOR UPDATE TO authenticated
  USING (public.is_admin());

CREATE POLICY "accounts_delete_super_admin"
  ON public.accounts FOR DELETE TO authenticated
  USING (public.is_super_admin());

-- Account users policies
CREATE POLICY "account_users_select_admin"
  ON public.account_users FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "account_users_insert_admin"
  ON public.account_users FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "account_users_update_admin"
  ON public.account_users FOR UPDATE TO authenticated
  USING (public.is_admin());

CREATE POLICY "account_users_delete_super_admin"
  ON public.account_users FOR DELETE TO authenticated
  USING (public.is_super_admin());
