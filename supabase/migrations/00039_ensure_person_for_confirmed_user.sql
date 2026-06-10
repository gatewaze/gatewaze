--------------------------------------------------------------------------------
-- Ensure every CONFIRMED auth user has a linked public.people row.
--
-- Why: the portal sign-in flow (people-signup edge function) creates a person
-- alongside the auth user, but other auth paths do not — notably the sites
-- module's website /account/signup, which runs a bare Supabase auth.signUp and
-- leaves an auth.users row with NO public.people record. Those users then miss
-- from the admin People list (RPC people_get_authenticated_sorted filters
-- auth_user_id IS NOT NULL) and every people-keyed feature.
--
-- This trigger closes that gap at the database level, for ALL signup paths.
--
-- Gated on email_confirmed_at: a person is created only once the user is
-- CONFIRMED (proves a real human), so unconfirmed / abandoned / bot signups
-- never pollute public.people. (An audit of aaif prod found 51 orphan auth
-- users — all unconfirmed, never-logged-in bot signups.)
--
-- Defensive: the body is wrapped so a failure can NEVER roll back the auth
-- write. Worst case it logs a warning and the person row is simply not created
-- (same as before this migration).
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ensure_person_for_confirmed_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS NULL OR NEW.email_confirmed_at IS NULL THEN
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
    RAISE WARNING '[ensure_person_for_confirmed_user] %: %', NEW.email, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.ensure_person_for_confirmed_user()
  IS 'Creates/links a public.people row when an auth user becomes confirmed. Closes the website-signup gap; unconfirmed signups are ignored.';

-- Fires on insert-with-confirmed and on the unconfirmed→confirmed transition.
-- On Supabase Cloud, creating triggers on auth.users requires elevated
-- privileges; wrap so the migration doesn't fail where it can't be created.
DO $$
BEGIN
  DROP TRIGGER IF EXISTS ensure_person_on_confirm ON auth.users;
  CREATE TRIGGER ensure_person_on_confirm
    AFTER INSERT OR UPDATE OF email_confirmed_at ON auth.users
    FOR EACH ROW
    WHEN (NEW.email_confirmed_at IS NOT NULL)
    EXECUTE FUNCTION public.ensure_person_for_confirmed_user();
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping auth.users trigger ensure_person_on_confirm — needs elevated privileges (on Cloud, wire a database webhook instead)';
END;
$$;
