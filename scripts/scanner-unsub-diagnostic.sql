-- Scanner-unsubscribe diagnostic for the last two AAIF newsletter sends.
--
-- Each unsubscribe is attributed to exactly one send: the send whose natural
-- window contains list_subscriptions.unsubscribed_at. The window for send N
-- is [N.started_at, min(N+1.started_at, N.started_at + 7d)).
--
-- For each attributed unsubscribe we left-join to the corresponding
-- email_send_log row (same recipient + same newsletter_send_id), then to the
-- first click on an unsubscribe URL in email_interactions. We score five
-- signals and bucket each row:
--
--   Strong signals (>=2 => "likely_scanner"):
--     1. seconds_from_delivery < 60       — click within 60s of delivery
--     2. opened_first = false             — click with NO prior open
--     3. ua_scanner = true                — UA matches known scanner string
--
--   Medium signals (medium>=2 OR (strong>=1) => "ambiguous"):
--     4. signals_bot = true               — signals-v1 flagged is_bot
--     5. ip_cluster_size >= 3             — 3+ unsubs same /24 within +/-5min
--
-- Read-only. Run as service-role / supabase_admin.

WITH last_two_sends AS (
  SELECT DISTINCT ON (edition_id)
    ns.id                                       AS send_id,
    ns.edition_id,
    ns.started_at,
    COALESCE(ns.completed_at, NOW())            AS completed_at
  FROM public.newsletter_sends ns
  WHERE ns.status IN ('sent', 'cancelled')
    AND ns.started_at IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.email_send_log sl WHERE sl.newsletter_send_id = ns.id)
  ORDER BY ns.edition_id, ns.started_at DESC
),
recent_two AS (
  SELECT
    send_id,
    edition_id,
    started_at,
    completed_at,
    LEAD(started_at) OVER (ORDER BY started_at ASC) AS next_send_started_at
  FROM (SELECT * FROM last_two_sends ORDER BY started_at DESC LIMIT 2) sub
),
unsubs_in_window AS (
  SELECT
    rs.send_id,
    rs.edition_id,
    rs.started_at AS send_started_at,
    lower(ls.email) AS recipient_email_lc,
    ls.unsubscribed_at,
    ls.source        AS ls_source,
    ls.metadata      AS ls_metadata
  FROM recent_two rs
  JOIN public.list_subscriptions ls
    ON ls.subscribed = false
   AND ls.unsubscribed_at >= rs.started_at
   AND ls.unsubscribed_at <  COALESCE(rs.next_send_started_at, rs.started_at + interval '7 days')
),
recipients AS (
  SELECT DISTINCT ON (uiw.send_id, uiw.recipient_email_lc)
    uiw.send_id,
    uiw.edition_id,
    uiw.send_started_at,
    uiw.recipient_email_lc,
    uiw.unsubscribed_at,
    uiw.ls_source,
    uiw.ls_metadata,
    sl.id          AS send_log_id,
    sl.delivered_at,
    sl.first_opened_at
  FROM unsubs_in_window uiw
  LEFT JOIN public.email_send_log sl
    ON lower(sl.recipient_email) = uiw.recipient_email_lc
   AND sl.newsletter_send_id = uiw.send_id
  ORDER BY uiw.send_id, uiw.recipient_email_lc, sl.delivered_at DESC NULLS LAST
),
trigger_click AS (
  SELECT DISTINCT ON (ei.email_send_log_id)
    ei.email_send_log_id,
    ei.event_timestamp,
    ei.user_agent,
    ei.ip_address,
    ei.is_bot,
    ei.scorer_id,
    ei.clicked_url
  FROM public.email_interactions ei
  JOIN recipients r ON r.send_log_id = ei.email_send_log_id
  WHERE ei.event_type = 'click'
    AND (ei.clicked_url ILIKE '%unsub%' OR ei.clicked_url ILIKE '%/unsubscribe%')
  ORDER BY ei.email_send_log_id, ei.event_timestamp ASC
),
joined AS (
  SELECT
    r.send_id,
    r.edition_id,
    r.send_log_id,
    r.recipient_email_lc,
    r.delivered_at,
    r.first_opened_at,
    r.unsubscribed_at,
    r.ls_source,
    r.ls_metadata,
    tc.event_timestamp AS click_at,
    tc.user_agent      AS click_ua,
    tc.ip_address      AS click_ip,
    tc.is_bot          AS click_is_bot
  FROM recipients r
  LEFT JOIN trigger_click tc ON tc.email_send_log_id = r.send_log_id
),
clustered AS (
  SELECT
    a.send_log_id,
    COUNT(b.send_log_id) FILTER (WHERE b.send_log_id IS DISTINCT FROM a.send_log_id) AS ip_cluster_size
  FROM joined a
  LEFT JOIN joined b
    ON a.click_ip IS NOT NULL
   AND b.click_ip IS NOT NULL
   AND set_masklen(a.click_ip::cidr, 24) = set_masklen(b.click_ip::cidr, 24)
   AND b.click_at BETWEEN a.click_at - interval '5 minutes'
                      AND a.click_at + interval '5 minutes'
  GROUP BY a.send_log_id
),
scored AS (
  SELECT
    j.*,
    EXTRACT(EPOCH FROM (j.click_at - j.delivered_at))::int             AS seconds_from_delivery,
    (j.first_opened_at IS NOT NULL AND j.first_opened_at < j.click_at)  AS opened_first,
    (
      j.click_ua ILIKE '%Mimecast%'
      OR j.click_ua ILIKE '%Proofpoint%'
      OR j.click_ua ILIKE '%Barracuda%'
      OR j.click_ua ILIKE '%bitdefender%'
      OR j.click_ua ILIKE '%Symantec%'
      OR j.click_ua ILIKE '%FireEye%'
      OR j.click_ua ILIKE '%BitDam%'
      OR j.click_ua ILIKE '%URL-Shield%'
      OR j.click_ua ILIKE '%MS-Defender%'
      OR j.click_ua ILIKE '%Microsoft-Defender%'
      OR j.click_ua ILIKE '%safelinks.protection.outlook%'
      OR j.click_ua ILIKE '%SkyHigh%'
      OR j.click_ua ILIKE '%Forcepoint%'
      OR j.click_ua ILIKE '%TrendMicro%'
      OR j.click_ua ILIKE '%Sophos%'
      OR j.click_ua ILIKE '%cloudmark%'
      OR j.click_ua ILIKE '%defender-link-checker%'
      OR j.click_ua ILIKE '%scanner%'
      OR j.click_ua ILIKE '%checker%'
      OR (j.click_ua IS NOT NULL AND j.click_ua ILIKE '%bot%' AND j.click_ua NOT ILIKE '%robot%')
    )                                                                   AS ua_scanner,
    COALESCE(j.click_is_bot, false)                                     AS signals_bot,
    COALESCE(c.ip_cluster_size, 0)                                      AS ip_cluster_size
  FROM joined j
  LEFT JOIN clustered c ON c.send_log_id = j.send_log_id
),
classified AS (
  SELECT
    *,
    (
      (CASE WHEN seconds_from_delivery IS NOT NULL AND seconds_from_delivery < 60 THEN 1 ELSE 0 END) +
      (CASE WHEN opened_first = false                                              THEN 1 ELSE 0 END) +
      (CASE WHEN ua_scanner = true                                                 THEN 1 ELSE 0 END)
    ) AS strong_signal_count,
    (
      (CASE WHEN signals_bot = true   THEN 1 ELSE 0 END) +
      (CASE WHEN ip_cluster_size >= 3 THEN 1 ELSE 0 END)
    ) AS medium_signal_count
  FROM scored
),
bucketed AS (
  SELECT
    *,
    CASE
      WHEN strong_signal_count >= 2                              THEN 'likely_scanner'
      WHEN strong_signal_count >= 1 OR medium_signal_count >= 2  THEN 'ambiguous'
      ELSE                                                            'likely_human'
    END                                                          AS bucket
  FROM classified
)
SELECT
  send_id::text                                                AS send_id,
  edition_id::text                                             AS edition_id,
  bucket,
  COUNT(*)                                                     AS recipients,
  COUNT(*) FILTER (WHERE seconds_from_delivery < 60)           AS lt_60s,
  COUNT(*) FILTER (WHERE opened_first = false)                 AS no_prior_open,
  COUNT(*) FILTER (WHERE ua_scanner)                           AS scanner_ua,
  COUNT(*) FILTER (WHERE signals_bot)                          AS signals_v1_bot,
  COUNT(*) FILTER (WHERE ip_cluster_size >= 3)                 AS ip_cluster,
  ROUND(AVG(seconds_from_delivery)::numeric, 0)                AS avg_seconds,
  MIN(seconds_from_delivery)                                   AS min_seconds,
  MAX(seconds_from_delivery)                                   AS max_seconds,
  COUNT(*) FILTER (WHERE click_at IS NULL)                     AS no_click_record
FROM bucketed
GROUP BY send_id, edition_id, bucket
ORDER BY send_id, bucket;
