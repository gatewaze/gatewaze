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
  -- 320 is the longest valid address; the cap also bounds the loop.
  IF p_email IS NULL OR p_email = '' OR length(p_email) > 320 OR p_email !~ '^[ -~]+$' THEN
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

-- The trigger runs as whoever writes people (admins through the API as
-- authenticated, server code as service_role). Nobody needs it as anon.
REVOKE ALL ON FUNCTION public.people_encode_email(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.people_encode_email(text) TO authenticated, service_role;

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
    ELSIF TG_OP = 'UPDATE' AND NEW.email IS DISTINCT FROM OLD.email THEN
      -- The new address cannot be encoded; don't keep one that decodes to
      -- the old address.
      NEW.attributes := coalesce(NEW.attributes, '{}'::jsonb) - 'email_encoded';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS people_email_encoded ON public.people;
CREATE TRIGGER people_email_encoded
  BEFORE INSERT OR UPDATE OF email, attributes ON public.people
  FOR EACH ROW EXECUTE FUNCTION public.people_set_email_encoded();

-- Backfill people created without it. (This bumps updated_at on those rows.)
SET LOCAL lock_timeout = '10s';
UPDATE public.people p
   SET attributes = coalesce(p.attributes, '{}'::jsonb) || jsonb_build_object('email_encoded', x.v)
  FROM (SELECT id, public.people_encode_email(email) AS v
          FROM public.people
         WHERE NOT (coalesce(attributes, '{}'::jsonb) ? 'email_encoded')) x
 WHERE p.id = x.id
   AND x.v IS NOT NULL;
