--------------------------------------------------------------------------------
-- Ensure every auth user has a linked public.people row.
--
-- Why: the portal sign-in flow (people-signup edge function) creates a person
-- alongside the auth user, but other auth paths do not — notably the sites
-- module's website /account/signup, which runs a bare Supabase auth.signUp and
-- leaves an auth.users row with NO public.people record. Those users then miss
-- from the admin People list (RPC people_get_authenticated_sorted filters
-- auth_user_id IS NOT NULL) and every people-keyed feature.
--
-- Policy (per product decision): create a person for EVERY auth user as soon
-- as it's created — confirmed or not. We'd rather capture a real signup as a
-- person than lose it waiting on an email confirmation that may never complete.
--
-- This is a pure database insert: it NEVER sends an email (no GoTrue signup /
-- confirmation / magic-link is invoked). It is also exception-wrapped so a
-- person-creation hiccup can never roll back the auth write.
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ensure_person_for_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    INSERT INTO public.people (email, auth_user_id, attributes, last_synced_at)
    VALUES (
      NEW.email,
      NEW.id,
      jsonb_strip_nulls(jsonb_build_object('full_name', NEW.raw_user_meta_data->>'full_name')),
      now()
    )
    ON CONFLICT (email) DO UPDATE
      SET auth_user_id = COALESCE(public.people.auth_user_id, EXCLUDED.auth_user_id),
          updated_at   = now();
  EXCEPTION WHEN OTHERS THEN
    -- Never break auth on a person-creation hiccup.
    RAISE WARNING '[ensure_person_for_auth_user] %: %', NEW.email, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.ensure_person_for_auth_user()
  IS 'Creates/links a public.people row for every auth user on creation. Pure DB insert — sends no email. Closes the website-signup gap.';

-- Fire on every new auth user. On Supabase Cloud, creating triggers on
-- auth.users requires elevated privileges; wrap so the migration doesn't fail
-- where it can't be created.
DO $$
BEGIN
  -- Replace the earlier confirmation-gated trigger if present.
  DROP TRIGGER IF EXISTS ensure_person_on_confirm ON auth.users;
  DROP TRIGGER IF EXISTS ensure_person_on_signup ON auth.users;
  CREATE TRIGGER ensure_person_on_signup
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.ensure_person_for_auth_user();
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping auth.users trigger ensure_person_on_signup — needs elevated privileges (on Cloud, wire a database webhook instead)';
END;
$$;
