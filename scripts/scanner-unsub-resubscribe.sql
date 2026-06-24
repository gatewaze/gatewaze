-- Resubscribe the 283 "likely_scanner" unsubscribes from the 2026-06-23 send.
--
-- "Likely scanner" = 2+ of the following strong signals on the click event
-- that flipped list_subscriptions.subscribed to false:
--   1. click within 60s of delivery (often <0s — pre-delivery interception)
--   2. zero prior open
--   3. scanner UA string (currently never hits because SendGrid masks UA)
--
-- For each match we flip list_subscriptions back to subscribed=true and
-- record an audit trail in metadata.scanner_recovery_2026_06_24 so the
-- restoration can be reversed or audited later.
--
-- Wrapped in BEGIN/COMMIT — the SELECT after the UPDATE prints the rowcount,
-- but we don't COMMIT until we've eyeballed the number matches the diagnostic.
-- If it doesn't, ROLLBACK and re-investigate.

BEGIN;

WITH last_two_sends AS (
  SELECT DISTINCT ON (edition_id)
    ns.id AS send_id, ns.edition_id, ns.started_at, COALESCE(ns.completed_at, NOW()) AS completed_at
  FROM public.newsletter_sends ns
  WHERE ns.status IN ('sent', 'cancelled')
    AND ns.started_at IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.email_send_log sl WHERE sl.newsletter_send_id = ns.id)
  ORDER BY ns.edition_id, ns.started_at DESC
),
recent_two AS (
  SELECT
    send_id, edition_id, started_at, completed_at,
    LEAD(started_at) OVER (ORDER BY started_at ASC) AS next_send_started_at
  FROM (SELECT * FROM last_two_sends ORDER BY started_at DESC LIMIT 2) sub
),
unsubs_in_window AS (
  SELECT
    rs.send_id, rs.edition_id, rs.started_at AS send_started_at,
    lower(ls.email) AS recipient_email_lc,
    ls.id          AS ls_id,
    ls.list_id,
    ls.unsubscribed_at,
    ls.metadata    AS ls_metadata
  FROM recent_two rs
  JOIN public.list_subscriptions ls
    ON ls.subscribed = false
   AND ls.unsubscribed_at >= rs.started_at
   AND ls.unsubscribed_at <  COALESCE(rs.next_send_started_at, rs.started_at + interval '7 days')
),
recipients AS (
  SELECT DISTINCT ON (uiw.send_id, uiw.recipient_email_lc)
    uiw.send_id, uiw.edition_id, uiw.ls_id, uiw.list_id, uiw.unsubscribed_at, uiw.ls_metadata,
    sl.id AS send_log_id, sl.delivered_at, sl.first_opened_at
  FROM unsubs_in_window uiw
  LEFT JOIN public.email_send_log sl
    ON lower(sl.recipient_email) = uiw.recipient_email_lc
   AND sl.newsletter_send_id = uiw.send_id
  ORDER BY uiw.send_id, uiw.recipient_email_lc, sl.delivered_at DESC NULLS LAST
),
trigger_click AS (
  SELECT DISTINCT ON (ei.email_send_log_id)
    ei.email_send_log_id, ei.event_timestamp, ei.user_agent, ei.is_bot
  FROM public.email_interactions ei
  JOIN recipients r ON r.send_log_id = ei.email_send_log_id
  WHERE ei.event_type = 'click'
    AND (ei.clicked_url ILIKE '%unsub%' OR ei.clicked_url ILIKE '%/unsubscribe%')
  ORDER BY ei.email_send_log_id, ei.event_timestamp ASC
),
scored AS (
  SELECT
    r.ls_id,
    r.list_id,
    r.edition_id,
    r.unsubscribed_at,
    r.ls_metadata,
    tc.event_timestamp AS click_at,
    tc.user_agent      AS click_ua,
    EXTRACT(EPOCH FROM (tc.event_timestamp - r.delivered_at))::int     AS seconds_from_delivery,
    (r.first_opened_at IS NOT NULL AND r.first_opened_at < tc.event_timestamp) AS opened_first,
    (
      tc.user_agent ILIKE '%Mimecast%' OR tc.user_agent ILIKE '%Proofpoint%'
      OR tc.user_agent ILIKE '%Barracuda%' OR tc.user_agent ILIKE '%bitdefender%'
      OR tc.user_agent ILIKE '%Symantec%' OR tc.user_agent ILIKE '%FireEye%'
      OR tc.user_agent ILIKE '%BitDam%' OR tc.user_agent ILIKE '%URL-Shield%'
      OR tc.user_agent ILIKE '%MS-Defender%' OR tc.user_agent ILIKE '%Microsoft-Defender%'
      OR tc.user_agent ILIKE '%safelinks.protection.outlook%'
      OR tc.user_agent ILIKE '%SkyHigh%' OR tc.user_agent ILIKE '%Forcepoint%'
      OR tc.user_agent ILIKE '%TrendMicro%' OR tc.user_agent ILIKE '%Sophos%'
      OR tc.user_agent ILIKE '%cloudmark%' OR tc.user_agent ILIKE '%defender-link-checker%'
      OR tc.user_agent ILIKE '%scanner%' OR tc.user_agent ILIKE '%checker%'
      OR (tc.user_agent IS NOT NULL AND tc.user_agent ILIKE '%bot%' AND tc.user_agent NOT ILIKE '%robot%')
    ) AS ua_scanner
  FROM recipients r
  LEFT JOIN trigger_click tc ON tc.email_send_log_id = r.send_log_id
),
likely_scanner AS (
  SELECT *
  FROM scored
  WHERE (
    (CASE WHEN seconds_from_delivery IS NOT NULL AND seconds_from_delivery < 60 THEN 1 ELSE 0 END) +
    (CASE WHEN opened_first = false                                              THEN 1 ELSE 0 END) +
    (CASE WHEN ua_scanner = true                                                 THEN 1 ELSE 0 END)
  ) >= 2
)
UPDATE public.list_subscriptions ls
SET
  subscribed     = true,
  subscribed_at  = NOW(),
  unsubscribed_at = NULL,
  source         = COALESCE(ls.source, '') || ' + scanner_recovery_2026_06_24',
  metadata       = COALESCE(ls.metadata, '{}'::jsonb) || jsonb_build_object(
    'scanner_recovery_2026_06_24', jsonb_build_object(
      'prior_unsubscribed_at', s.unsubscribed_at,
      'prior_metadata',        s.ls_metadata,
      'edition_id',            s.edition_id,
      'click_at',              s.click_at,
      'seconds_from_delivery', s.seconds_from_delivery,
      'opened_first',          s.opened_first,
      'reason',                'auto-restored: <60s click + no prior open ⇒ likely corporate-scanner gateway, not user intent',
      'recovered_at',          NOW()
    )
  ),
  updated_at     = NOW()
FROM likely_scanner s
WHERE ls.id = s.ls_id;

-- Show the rowcount before committing.
SELECT
  'restored' AS action,
  COUNT(*) FILTER (WHERE metadata ? 'scanner_recovery_2026_06_24')
    AS rows_with_recovery_tag
FROM public.list_subscriptions
WHERE updated_at >= NOW() - interval '5 minutes';

-- After verifying rowcount ≈ 283, run:  COMMIT;
-- To abort:                              ROLLBACK;
