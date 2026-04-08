--------------------------------------------------------------------------------
-- 00017: Make admin_profiles email matching case-insensitive
--
-- 1. Normalize existing emails to lowercase
-- 2. Update auto_link_admin_profile trigger to use LOWER()
--------------------------------------------------------------------------------

-- Normalize existing admin_profiles emails to lowercase
UPDATE public.admin_profiles
SET email = LOWER(email)
WHERE email <> LOWER(email);

-- Update trigger to use case-insensitive matching
CREATE OR REPLACE FUNCTION public.auto_link_admin_profile()
RETURNS trigger AS $$
BEGIN
  UPDATE public.admin_profiles
  SET user_id = NEW.id
  WHERE LOWER(email) = LOWER(NEW.email)
    AND user_id IS NULL;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
