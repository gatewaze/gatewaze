-- ============================================================================
-- 00043: people_import_batch — set-based CSV-import RPC for the People admin
--
-- One call imports a batch of rows: creates missing people (with the given
-- contact_kind + acquisition_source), fill-missing-merges attributes into
-- existing people (existing values always win; kind is NEVER changed on
-- existing rows), tags every touched person with the import batch id
-- (attributes.import_batches, comma-appended), and subscribes them to the
-- given lists with ON CONFLICT DO NOTHING — so a prior unsubscribe
-- (subscribed=false) is never overwritten by an import.
--
-- The batch tag is what makes "see these people at a glance" work: the admin
-- wizard creates a dynamic segment {attribute import_batches contains
-- <batch_id>}, which survives segment recalculation (unlike direct
-- segments_memberships inserts, which broadcast-send wipes on recalc).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.people_import_batch(
  p_rows                jsonb,                      -- [{email, attributes:{first_name,...}}, ...]
  p_batch_id            text,
  p_contact_kind        text    DEFAULT 'prospect', -- kind for NEW people only
  p_acquisition_source  text    DEFAULT NULL,
  p_list_ids            uuid[]  DEFAULT NULL,
  p_subscription_source text    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'people_import_batch: admin only';
  END IF;
  IF p_batch_id IS NULL OR p_batch_id = '' THEN
    RAISE EXCEPTION 'people_import_batch: p_batch_id is required';
  END IF;
  IF p_contact_kind NOT IN ('member', 'event_contact', 'prospect') THEN
    RAISE EXCEPTION 'people_import_batch: invalid contact_kind %', p_contact_kind;
  END IF;

  WITH raw AS (
    SELECT lower(trim(r->>'email')) AS email,
           COALESCE(r->'attributes', '{}'::jsonb) AS attrs
    FROM jsonb_array_elements(p_rows) r
  ),
  valid AS (
    SELECT * FROM raw WHERE email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  ),
  dedup AS (
    SELECT DISTINCT ON (email) email, attrs FROM valid
  ),
  updated AS (
    -- Existing people: fill only MISSING attribute keys (existing wins),
    -- append the batch tag, backfill acquisition_source if empty. contact_kind
    -- untouched — imports never downgrade a member to a prospect.
    UPDATE public.people p
    SET attributes = d.attrs || p.attributes || jsonb_build_object(
          'import_batches',
          COALESCE(NULLIF(p.attributes->>'import_batches', '') || ',', '') || p_batch_id
        ),
        acquisition_source = COALESCE(p.acquisition_source, p_acquisition_source),
        updated_at = now()
    FROM dedup d
    WHERE lower(p.email) = d.email
    RETURNING p.id, d.email
  ),
  inserted AS (
    INSERT INTO public.people (email, contact_kind, acquisition_source, attributes)
    SELECT d.email, p_contact_kind, p_acquisition_source,
           d.attrs || jsonb_build_object('import_batches', p_batch_id)
    FROM dedup d
    WHERE NOT EXISTS (SELECT 1 FROM public.people p WHERE lower(p.email) = d.email)
    RETURNING id, email
  ),
  touched AS (
    SELECT id, email FROM updated
    UNION ALL
    SELECT id, email FROM inserted
  ),
  subs AS (
    -- DO NOTHING on conflict: never flips an existing subscribed=false row.
    INSERT INTO public.list_subscriptions (list_id, email, person_id, subscribed, subscribed_at, source)
    SELECT l.list_id, t.email, t.id, true, now(),
           COALESCE(p_subscription_source, 'import:' || p_batch_id)
    FROM touched t
    CROSS JOIN unnest(COALESCE(p_list_ids, '{}'::uuid[])) AS l(list_id)
    ON CONFLICT (list_id, email) DO NOTHING
    RETURNING 1
  )
  SELECT jsonb_build_object(
    'created',             (SELECT count(*) FROM inserted),
    'updated',             (SELECT count(*) FROM updated),
    'subscriptions_added', (SELECT count(*) FROM subs),
    'skipped_invalid',     (SELECT count(*) FROM raw) - (SELECT count(*) FROM valid),
    'deduped',             (SELECT count(*) FROM valid) - (SELECT count(*) FROM dedup)
  ) INTO v_result;

  RETURN v_result;
END $$;

COMMENT ON FUNCTION public.people_import_batch(jsonb, text, text, text, uuid[], text) IS
  'Admin CSV import: create/fill-merge people, tag attributes.import_batches with the batch id (drives the per-import dynamic segment), subscribe to lists without overriding prior unsubscribes.';

REVOKE ALL ON FUNCTION public.people_import_batch(jsonb, text, text, text, uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.people_import_batch(jsonb, text, text, text, uuid[], text) TO authenticated, service_role;
