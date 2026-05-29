--------------------------------------------------------------------------------
-- 00031: people_get_authenticated_sorted — support "field:value" search syntax
--------------------------------------------------------------------------------
-- The People list search box advertises field-scoped queries (e.g.
-- "company:microsoft", "first_name:john"), but the RPC only ever matched the
-- whole term as a literal substring across email/name/company. So "company:test"
-- searched for the literal text "company:test" and returned nothing.
--
-- This replaces the function with a parser: when the term is "<field>:<value>"
-- and <field> is in the whitelist below, it matches <value> against that one
-- field; otherwise it falls back to the original broad search. The field name
-- only selects a hard-coded SQL expression from the CASE whitelist — the value
-- is always bound as parameter $1 and never interpolated, so this is not
-- injectable.
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.people_get_authenticated_sorted(
  p_offset      integer DEFAULT 0,
  p_limit       integer DEFAULT 50,
  p_sort_by     text    DEFAULT 'created_at',
  p_sort_order  text    DEFAULT 'desc',
  p_search_term text    DEFAULT NULL
)
RETURNS TABLE(
  id                  uuid,
  email               text,
  phone               text,
  avatar_url          text,
  cio_id              text,
  attributes          jsonb,
  attribute_timestamps jsonb,
  auth_user_id        uuid,
  has_gravatar        boolean,
  avatar_source       text,
  avatar_storage_path text,
  avatar_updated_at   timestamptz,
  linkedin_avatar_url text,
  is_guest            boolean,
  last_synced_at      timestamptz,
  created_at          timestamptz,
  updated_at          timestamptz,
  total_count         bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_sort_expr text;
  v_order text;
  v_search text;
  v_field text;
  v_value text;
  v_field_expr text;
  v_predicate text;
BEGIN
  v_order := CASE WHEN upper(p_sort_order) = 'ASC' THEN 'ASC' ELSE 'DESC' END;

  -- Map sort columns: top-level columns use %I, JSONB fields use ->> expression
  v_sort_expr := CASE
    WHEN p_sort_by IN ('email', 'created_at', 'updated_at', 'created') THEN
      CASE WHEN p_sort_by = 'created' THEN format('%I', 'created_at')
           ELSE format('%I', p_sort_by) END
    WHEN p_sort_by = 'full_name' THEN $f$COALESCE(c.attributes->>'first_name', '') || ' ' || COALESCE(c.attributes->>'last_name', '')$f$
    WHEN p_sort_by = 'company' THEN $f$c.attributes->>'company'$f$
    ELSE format('%I', 'created_at')
  END;

  -- Parse optional "field:value" syntax. Recognised field names map to a
  -- hard-coded expression below; the value is bound as $1 (not interpolated).
  IF p_search_term IS NOT NULL AND p_search_term <> '' AND position(':' in p_search_term) > 0 THEN
    v_field := lower(btrim(split_part(p_search_term, ':', 1)));
    v_value := btrim(substr(p_search_term, position(':' in p_search_term) + 1));
    v_field_expr := CASE v_field
      WHEN 'email'        THEN $f$c.email$f$
      WHEN 'first_name'   THEN $f$c.attributes->>'first_name'$f$
      WHEN 'last_name'    THEN $f$c.attributes->>'last_name'$f$
      WHEN 'name'         THEN $f$(COALESCE(c.attributes->>'first_name', '') || ' ' || COALESCE(c.attributes->>'last_name', ''))$f$
      WHEN 'full_name'    THEN $f$(COALESCE(c.attributes->>'first_name', '') || ' ' || COALESCE(c.attributes->>'last_name', ''))$f$
      WHEN 'company'      THEN $f$c.attributes->>'company'$f$
      WHEN 'job_title'    THEN $f$c.attributes->>'job_title'$f$
      WHEN 'title'        THEN $f$c.attributes->>'job_title'$f$
      WHEN 'city'         THEN $f$c.attributes->>'city'$f$
      WHEN 'country'      THEN $f$c.attributes->>'country'$f$
      WHEN 'linkedin_url' THEN $f$c.attributes->>'linkedin_url'$f$
      WHEN 'linkedin'     THEN $f$c.attributes->>'linkedin_url'$f$
      ELSE NULL
    END;
  END IF;

  IF v_field_expr IS NOT NULL AND v_value IS NOT NULL AND v_value <> '' THEN
    -- Field-scoped search
    v_search := '%' || v_value || '%';
    v_predicate := format($f$COALESCE(%s, '') ILIKE $1$f$, v_field_expr);
  ELSE
    -- Broad search across email / name / company (original behaviour)
    v_search := CASE WHEN p_search_term IS NOT NULL AND p_search_term <> ''
                     THEN '%' || p_search_term || '%'
                     ELSE NULL END;
    v_predicate := $f$c.email ILIKE $1
            OR (COALESCE(c.attributes->>'first_name', '') || ' ' || COALESCE(c.attributes->>'last_name', '')) ILIKE $1
            OR COALESCE(c.attributes->>'company', '') ILIKE $1$f$;
  END IF;

  RETURN QUERY EXECUTE format(
    'SELECT c.id, c.email, c.phone, c.avatar_url, c.cio_id,
            c.attributes, c.attribute_timestamps, c.auth_user_id,
            c.has_gravatar, c.avatar_source, c.avatar_storage_path,
            c.avatar_updated_at, c.linkedin_avatar_url, c.is_guest,
            c.last_synced_at, c.created_at, c.updated_at,
            COUNT(*) OVER() AS total_count
     FROM public.people c
     WHERE c.auth_user_id IS NOT NULL
       AND ($1::text IS NULL OR (%s))
     ORDER BY %s %s
     LIMIT $2 OFFSET $3',
    v_predicate,
    v_sort_expr,
    v_order
  )
  USING v_search, p_limit, p_offset;
END;
$$;

COMMENT ON FUNCTION public.people_get_authenticated_sorted(integer, integer, text, text, text)
  IS 'Paginated, sortable, searchable listing of authenticated people with total count. Search supports "field:value" syntax (email, first_name, last_name, name, company, job_title, city, country, linkedin_url) and falls back to broad email/name/company matching.';
