-- Restore unsubscribes wiped out by the 2026-06-16 mlops→aaif migration.
--
-- Background: scripts/migrate-mlops-to-aaif.mjs stage 4 seeded list_subscriptions
-- for the user-community list from the OLD mlops DB's email_subscriptions
-- (topic_1). It selected only subscribed=true source rows, hardcoded
-- subscribed=true on insert, and its ON CONFLICT clause did
-- `SET subscribed = true, unsubscribed_at = NULL` — so anyone whose
-- unsubscribe was recorded only on the AAIF side (email_events, or a
-- pre-existing list_subscriptions opt-out) was silently re-subscribed and
-- has been receiving newsletters since 2026-06-18.
--
-- Cohort: rows on the user-community list that
--   1. carry the migration marker (metadata.migrated_from = topic_1),
--   2. are currently subscribed = true,
--   3. belong to an email with an `unsubscribed` email_event BEFORE the
--      migration ran (< 2026-06-16).
-- Diagnostic on 2026-08-04 found 429 such rows; all 429 received
-- newsletters after the migration. (520 total were resurrected; 91 had
-- already unsubscribed again on their own by 2026-08-04.)
--
-- For each row we flip subscribed back to false and record an audit trail
-- in metadata.migration_unsub_restore_2026_08_04 so the restoration can be
-- audited or reversed. unsubscribed_at is set to NOW() (the original
-- unsubscribe moment is preserved in the audit blob as first_unsub_event).
--
-- Wrapped in BEGIN/COMMIT — the SELECT after the UPDATE prints the rowcount;
-- don't COMMIT until it matches the diagnostic (~429). Otherwise ROLLBACK.

BEGIN;

WITH unsub_events AS (
  SELECT lower(email) AS email_lc, MIN(event_timestamp) AS first_unsub
  FROM public.email_events
  WHERE event_type = 'unsubscribed'
    AND event_timestamp < '2026-06-16'
  GROUP BY lower(email)
),
cohort AS (
  SELECT ls.id AS ls_id, u.first_unsub,
         ls.subscribed_at AS prior_subscribed_at,
         ls.source        AS prior_source
  FROM unsub_events u
  JOIN public.list_subscriptions ls
    ON lower(ls.email) = u.email_lc
   AND ls.list_id = '48125915-abdb-4ad7-b17b-9d214290f3ea'  -- user-community
  WHERE ls.metadata->>'migrated_from' = 'mlops.email_subscriptions/topic_1'
    AND ls.subscribed = true
)
UPDATE public.list_subscriptions ls
SET
  subscribed      = false,
  unsubscribed_at = NOW(),
  source          = COALESCE(ls.source, '') || ' + unsub-restore-2026-08-04',
  metadata        = COALESCE(ls.metadata, '{}'::jsonb) || jsonb_build_object(
    'migration_unsub_restore_2026_08_04', jsonb_build_object(
      'first_unsub_event',   c.first_unsub,
      'prior_subscribed_at', c.prior_subscribed_at,
      'prior_source',        c.prior_source,
      'reason',              'pre-migration unsubscribe (email_events) was overwritten by migrate-mlops-to-aaif.mjs on 2026-06-16',
      'restored_at',         NOW()
    )
  ),
  updated_at      = NOW()
FROM cohort c
WHERE ls.id = c.ls_id;

-- Show the rowcount before committing.
SELECT
  'restored' AS action,
  COUNT(*) AS rows_with_restore_tag
FROM public.list_subscriptions
WHERE metadata ? 'migration_unsub_restore_2026_08_04';

-- After verifying rowcount ≈ 429, run:  COMMIT;
-- To abort:                             ROLLBACK;
