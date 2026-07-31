-- ============================================================================
-- 00044: people search / count indexes
--
-- The people table grew from a few thousand consented members to tens of
-- thousands of rows once legitimate-interest prospects were imported (Apollo
-- exports, CIO recipient profiles, etc. — see 00042/00043). Every people
-- lookup path was written as an unindexed predicate, so at that scale they all
-- do a full sequential scan and blow the statement timeout (57014):
--
--   * people_count_with_linkedin()  -> POST .../rpc/... 500 on the People
--     dashboard ("With LinkedIn" card).
--   * people_get_authenticated_sorted() broad ILIKE search -> "Total People 0"
--     because the caller swallows the timeout and returns an empty page.
--   * admin_users existing-person picker (email/first_name/last_name ILIKE)
--     -> "search doesn't find existing users".
--   * people-signup edge function's `.ilike('email', <exact>)` person lookup
--     -> "Add User" sits on "Creating…" forever (the fetch never returns).
--
-- pg_trgm is already enabled in 00001. Trigram GIN indexes serve ILIKE with a
-- leading wildcard (which a plain btree cannot), and also serve ILIKE against
-- an exact literal (people-signup's case-insensitive email match). The two
-- partial btree indexes serve the authenticated-people count and default
-- created_at listing without touching prospect rows.
--
-- NOTE: on an already-populated production table, build these with
-- CREATE INDEX CONCURRENTLY out-of-band so writes are not blocked while they
-- build; the IF NOT EXISTS clauses below then no-op when the migration later
-- runs. A fresh install runs them here in one shot.
-- ============================================================================

-- Count of authenticated people who have a LinkedIn URL (people_count_with_linkedin).
-- Predicate matches the RPC so COUNT(*) becomes an index-only scan of just the
-- qualifying rows instead of a full-table scan.
CREATE INDEX IF NOT EXISTS idx_people_auth_linkedin
  ON public.people (auth_user_id)
  WHERE auth_user_id IS NOT NULL AND (attributes->>'linkedin_url') <> '';

-- Default members listing: WHERE auth_user_id IS NOT NULL ORDER BY created_at.
CREATE INDEX IF NOT EXISTS idx_people_auth_created
  ON public.people (created_at DESC)
  WHERE auth_user_id IS NOT NULL;

-- Substring (ILIKE) search across the fields the People list, the prospects
-- list, the admin existing-person picker, and the "field:value" syntax query.
CREATE INDEX IF NOT EXISTS idx_people_email_trgm
  ON public.people USING gin (email gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_people_first_name_trgm
  ON public.people USING gin ((attributes->>'first_name') gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_people_last_name_trgm
  ON public.people USING gin ((attributes->>'last_name') gin_trgm_ops);

-- Matches people_get_authenticated_sorted's broad-search / name: concat
-- expression exactly, so that disjunct is index-backed too.
CREATE INDEX IF NOT EXISTS idx_people_fullname_trgm
  ON public.people USING gin (
    (COALESCE(attributes->>'first_name', '') || ' ' || COALESCE(attributes->>'last_name', '')) gin_trgm_ops
  );

CREATE INDEX IF NOT EXISTS idx_people_company_trgm
  ON public.people USING gin ((attributes->>'company') gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_people_job_title_trgm
  ON public.people USING gin ((attributes->>'job_title') gin_trgm_ops);

-- Prospects list searches acquisition_source (provenance) as well.
CREATE INDEX IF NOT EXISTS idx_people_acq_source_trgm
  ON public.people USING gin (acquisition_source gin_trgm_ops);
