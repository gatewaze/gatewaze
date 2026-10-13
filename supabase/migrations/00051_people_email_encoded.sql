-- ============================================================================
-- people.attributes.email_encoded, set by the database for every person
-- ============================================================================
-- email_encoded is the legacy tech.tickets link identity: the address XOR'd
-- with "HideMe" and URL-safe base64'd. The portal decodes it from
-- ?utm_medium= / ?e= (packages/portal/lib/emailEncoding.ts), calendar links
-- carry it, and broadcasts can write it with {{email_encoded}}.
--
-- It used to be set by a database webhook calling the email-generate-encoded
-- edge function on each new person. Those webhooks did not survive the move to
-- the modular stack, so people created since (sign-up, offer claims, imports,
-- RSVPs) had none. Setting it in a trigger covers every insert path and needs
-- no webhook.
--
-- Only printable-ASCII addresses are encoded, matching the TypeScript
-- encoders (a non-ASCII address has no stable form in the byte-wise scheme).
-- Existing values are left as they are: some were encoded before an address's
-- capitalisation changed and still decode to the same mailbox.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.people_encode_email(p_email text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  e bytea;
  k bytea := convert_to('HideMe', 'UTF8');
  o bytea;
  i int;
BEGIN
  IF p_email IS NULL OR p_email = '' OR p_email !~ '^[ -~]+$' THEN
    RETURN NULL;
  END IF;
  e := convert_to(lower(p_email), 'UTF8');
  o := e;
  FOR i IN 0 .. length(e) - 1 LOOP
    o := set_byte(o, i, get_byte(e, i) # get_byte(k, i % 6));
  END LOOP;
  -- URL-safe base64 without padding; encode() wraps at 76 chars, drop those.
  RETURN rtrim(translate(encode(o, 'base64'), E'+/\n', '-_'), '=');
END;
$$;

COMMENT ON FUNCTION public.people_encode_email(text) IS
  'Legacy tech.tickets email link encoding (XOR "HideMe" + URL-safe base64). Same as portal lib/emailEncoding.ts encodeEmail.';

CREATE OR REPLACE FUNCTION public.people_set_email_encoded()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v text;
BEGIN
  -- Set it when missing, or when the address itself changed (then the old
  -- value no longer decodes to this person).
  IF TG_OP = 'INSERT'
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NOT (coalesce(NEW.attributes, '{}'::jsonb) ? 'email_encoded') THEN
    v := public.people_encode_email(NEW.email);
    IF v IS NOT NULL THEN
      NEW.attributes := coalesce(NEW.attributes, '{}'::jsonb) || jsonb_build_object('email_encoded', v);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS people_email_encoded ON public.people;
CREATE TRIGGER people_email_encoded
  BEFORE INSERT OR UPDATE OF email, attributes ON public.people
  FOR EACH ROW EXECUTE FUNCTION public.people_set_email_encoded();

-- Backfill people created without it.
UPDATE public.people
   SET attributes = coalesce(attributes, '{}'::jsonb)
                    || jsonb_build_object('email_encoded', public.people_encode_email(email))
 WHERE NOT (coalesce(attributes, '{}'::jsonb) ? 'email_encoded')
   AND public.people_encode_email(email) IS NOT NULL;
