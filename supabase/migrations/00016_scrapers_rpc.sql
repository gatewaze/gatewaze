-- ============================================================
-- Migration: Scrapers RPC functions, job logs table, and RLS
-- ============================================================

-- ==========================================================================
-- 1. Scrapers job logs table
-- ==========================================================================
CREATE TABLE IF NOT EXISTS public.scrapers_job_logs (
  id         bigserial PRIMARY KEY,
  job_id     integer NOT NULL REFERENCES public.scrapers_jobs(id) ON DELETE CASCADE,
  log_type   text NOT NULL DEFAULT 'log',
  log_level  text NOT NULL DEFAULT 'info',
  message    text NOT NULL,
  metadata   jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scrapers_job_logs_job ON public.scrapers_job_logs(job_id);

-- ==========================================================================
-- 2. RLS policies
-- ==========================================================================
ALTER TABLE public.scrapers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scrapers_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scrapers_job_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'scrapers' AND policyname = 'anon_read_scrapers') THEN
    CREATE POLICY "anon_read_scrapers" ON public.scrapers FOR SELECT TO anon USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'scrapers' AND policyname = 'auth_all_scrapers') THEN
    CREATE POLICY "auth_all_scrapers" ON public.scrapers FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'scrapers_jobs' AND policyname = 'anon_read_scrapers_jobs') THEN
    CREATE POLICY "anon_read_scrapers_jobs" ON public.scrapers_jobs FOR SELECT TO anon USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'scrapers_jobs' AND policyname = 'auth_all_scrapers_jobs') THEN
    CREATE POLICY "auth_all_scrapers_jobs" ON public.scrapers_jobs FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'scrapers_job_logs' AND policyname = 'anon_read_scrapers_job_logs') THEN
    CREATE POLICY "anon_read_scrapers_job_logs" ON public.scrapers_job_logs FOR SELECT TO anon USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'scrapers_job_logs' AND policyname = 'auth_all_scrapers_job_logs') THEN
    CREATE POLICY "auth_all_scrapers_job_logs" ON public.scrapers_job_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Also ensure scrapers_runs has RLS
DO $$
BEGIN
  ALTER TABLE public.scrapers_runs ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'scrapers_runs' AND policyname = 'anon_read_scrapers_runs') THEN
    CREATE POLICY "anon_read_scrapers_runs" ON public.scrapers_runs FOR SELECT TO anon USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'scrapers_runs' AND policyname = 'auth_all_scrapers_runs') THEN
    CREATE POLICY "auth_all_scrapers_runs" ON public.scrapers_runs FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
EXCEPTION WHEN undefined_table THEN
  NULL; -- scrapers_runs may not exist yet
END $$;

-- ==========================================================================
-- 3. RPC: scrapers_get_job
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.scrapers_get_job(job_id integer)
RETURNS TABLE(
    id integer,
    scraper_id integer,
    scraper_name text,
    scraper_type text,
    event_type text,
    status text,
    started_at timestamp without time zone,
    completed_at timestamp without time zone,
    items_found integer,
    items_processed integer,
    items_skipped integer,
    items_failed integer,
    error_message text,
    log_output text,
    created_by text
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    j.id,
    j.scraper_id,
    s.name as scraper_name,
    s.scraper_type,
    s.event_type,
    j.status::text,
    j.started_at::timestamp without time zone,
    j.completed_at::timestamp without time zone,
    j.items_found,
    j.items_processed,
    j.items_skipped,
    j.items_failed,
    j.error_message,
    j.log_output,
    j.created_by
  FROM scrapers_jobs j
  JOIN scrapers s ON j.scraper_id = s.id
  WHERE j.id = scrapers_get_job.job_id;
END;
$$;

-- ==========================================================================
-- 4. RPC: scrapers_update_job
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.scrapers_update_job(
    job_id integer,
    new_status text,
    items_found_count integer DEFAULT NULL,
    items_processed_count integer DEFAULT NULL,
    items_skipped_count integer DEFAULT NULL,
    items_failed_count integer DEFAULT NULL,
    error_msg text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.scrapers_jobs
  SET
    status = new_status,
    completed_at = CASE
      WHEN new_status IN ('completed', 'failed', 'cancelled') THEN NOW()
      ELSE completed_at
    END,
    items_found = COALESCE(items_found_count, items_found),
    items_processed = COALESCE(items_processed_count, items_processed),
    items_skipped = COALESCE(items_skipped_count, items_skipped),
    items_failed = COALESCE(items_failed_count, items_failed),
    error_message = COALESCE(error_msg, error_message)
  WHERE id = scrapers_update_job.job_id;

  IF new_status IN ('completed', 'failed') THEN
    UPDATE public.scrapers s
    SET
      last_run = NOW(),
      last_success = CASE WHEN new_status = 'completed' THEN NOW() ELSE s.last_success END,
      last_error = CASE WHEN new_status = 'failed' THEN error_msg ELSE s.last_error END,
      total_items_scraped = s.total_items_scraped + COALESCE(items_processed_count, 0)
    FROM public.scrapers_jobs j
    WHERE s.id = j.scraper_id AND j.id = scrapers_update_job.job_id;
  END IF;
END;
$$;

-- ==========================================================================
-- 5. RPC: scrapers_create_job
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.scrapers_create_job(
    scraper_ids integer[],
    created_by_user text DEFAULT 'scheduler'
) RETURNS TABLE(job_id integer)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    INSERT INTO public.scrapers_jobs (scraper_id, status, created_by)
    SELECT unnest(scraper_ids), 'pending', created_by_user
    RETURNING id AS job_id;
END;
$$;

-- ==========================================================================
-- 6. RPC: scrapers_insert_job_log
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.scrapers_insert_job_log(
    p_job_id integer,
    p_log_type text DEFAULT 'log',
    p_log_level text DEFAULT 'info',
    p_message text DEFAULT '',
    p_metadata jsonb DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    new_id bigint;
BEGIN
    INSERT INTO public.scrapers_job_logs (job_id, log_type, log_level, message, metadata)
    VALUES (p_job_id, p_log_type, p_log_level, p_message, p_metadata)
    RETURNING id INTO new_id;

    RETURN new_id;
END;
$$;

-- ==========================================================================
-- 7. RPC: scrapers_get_with_status
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.scrapers_get_with_status()
RETURNS TABLE(
  id integer,
  name text,
  description text,
  scraper_type text,
  event_type text,
  base_url text,
  enabled boolean,
  last_run timestamp without time zone,
  last_success timestamp without time zone,
  last_error text,
  total_items_scraped integer,
  config jsonb,
  schedule_enabled boolean,
  schedule_frequency varchar,
  next_scheduled_run timestamptz,
  object_type varchar,
  account text,
  latest_job_id integer,
  latest_job_status text,
  latest_job_started_at timestamp without time zone
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    s.id,
    s.name,
    s.description::text,
    s.scraper_type,
    s.event_type::text,
    s.base_url,
    s.enabled,
    s.last_run::timestamp without time zone,
    s.last_success::timestamp without time zone,
    s.last_error,
    s.total_items_scraped,
    s.config,
    s.schedule_enabled,
    s.schedule_frequency::varchar,
    s.next_scheduled_run,
    s.object_type,
    s.account,
    lj.id as latest_job_id,
    lj.status as latest_job_status,
    lj.started_at as latest_job_started_at
  FROM scrapers s
  LEFT JOIN LATERAL (
    SELECT sj.id, sj.status::text, sj.started_at
    FROM scrapers_jobs sj
    WHERE sj.scraper_id = s.id
    ORDER BY sj.started_at DESC
    LIMIT 1
  ) lj ON true
  ORDER BY s.name;
$$;

-- ==========================================================================
-- 8. RPC: scrapers_get_due_for_run (for scheduler)
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.scrapers_get_due_for_run()
RETURNS TABLE(
    id integer,
    name text,
    schedule_frequency text,
    schedule_time time without time zone,
    schedule_days integer[],
    schedule_cron text
)
LANGUAGE sql
AS $$
  SELECT
    s.id,
    s.name,
    s.schedule_frequency::text,
    s.schedule_time,
    s.schedule_days,
    s.schedule_cron::text
  FROM scrapers s
  WHERE s.enabled = true
    AND s.schedule_enabled = true
    AND s.schedule_frequency != 'none'
    AND (
      s.next_scheduled_run IS NULL
      OR s.next_scheduled_run <= NOW()
    )
    AND NOT EXISTS (
      SELECT 1
      FROM scrapers_jobs sj
      WHERE sj.scraper_id = s.id
        AND sj.status IN ('pending', 'running')
    )
  ORDER BY s.next_scheduled_run NULLS FIRST;
$$;

-- ==========================================================================
-- 9. RPC: events_create (for scraper worker to insert events)
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.events_create(
    p_event_id text,
    p_event_title text,
    p_listing_intro text DEFAULT NULL,
    p_offer_result text DEFAULT NULL,
    p_offer_close_display text DEFAULT NULL,
    p_event_topics text[] DEFAULT NULL,
    p_offer_ticket_details text DEFAULT NULL,
    p_offer_value text DEFAULT NULL,
    p_event_city text DEFAULT NULL,
    p_event_country_code text DEFAULT NULL,
    p_event_link text DEFAULT NULL,
    p_event_logo text DEFAULT NULL,
    p_offer_slug text DEFAULT NULL,
    p_offer_close_date timestamptz DEFAULT NULL,
    p_event_start timestamptz DEFAULT NULL,
    p_event_end timestamptz DEFAULT NULL,
    p_event_region text DEFAULT NULL,
    p_event_location text DEFAULT NULL,
    p_event_topics_updated_at timestamptz DEFAULT NULL,
    p_event_type text DEFAULT NULL,
    p_venue_address text DEFAULT NULL,
    p_scraped_by text DEFAULT NULL,
    p_scraper_id integer DEFAULT NULL,
    p_source_type text DEFAULT NULL,
    p_source_details jsonb DEFAULT NULL,
    p_event_timezone text DEFAULT NULL,
    p_luma_event_id text DEFAULT NULL,
    p_source_event_id text DEFAULT NULL,
    p_luma_page_data jsonb DEFAULT NULL,
    p_meetup_page_data jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    new_id uuid;
    existing_event RECORD;
    normalized_link text;
BEGIN
    normalized_link := RTRIM(COALESCE(p_event_link, ''), '/');

    IF normalized_link IS NOT NULL AND normalized_link != '' THEN
        SELECT id, event_id, event_title INTO existing_event
        FROM events
        WHERE RTRIM(COALESCE(event_link, ''), '/') = normalized_link
        LIMIT 1;

        IF FOUND THEN
            RAISE EXCEPTION 'Duplicate event link: An event with this link already exists (ID: %, Title: "%")',
                existing_event.event_id, existing_event.event_title
                USING ERRCODE = '23505';
        END IF;
    END IF;

    INSERT INTO events (
        event_id, event_title, listing_intro, offer_result, offer_close_display,
        event_topics, offer_ticket_details, offer_value, event_city, event_country_code,
        event_link, event_logo, offer_slug, offer_close_date, event_start, event_end,
        event_region, event_location, event_type,
        venue_address, scraped_by, scraper_id, source_type, source_details, event_timezone,
        luma_event_id, source_event_id, luma_page_data, meetup_page_data, created_at, updated_at
    ) VALUES (
        p_event_id, p_event_title, p_listing_intro, p_offer_result, p_offer_close_display,
        p_event_topics, p_offer_ticket_details, p_offer_value, p_event_city, p_event_country_code,
        CASE WHEN normalized_link = '' THEN NULL ELSE normalized_link END,
        p_event_logo, p_offer_slug, p_offer_close_date, p_event_start, p_event_end,
        p_event_region, p_event_location, p_event_type,
        p_venue_address, p_scraped_by, p_scraper_id, p_source_type, p_source_details, p_event_timezone,
        p_luma_event_id, p_source_event_id, p_luma_page_data, p_meetup_page_data, NOW(), NOW()
    ) RETURNING id INTO new_id;

    RETURN new_id;
END;
$$;

-- ==========================================================================
-- 10. RPC: events_update (for scraper worker to update existing events)
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.events_update(
    p_id uuid,
    p_event_title text DEFAULT NULL,
    p_listing_intro text DEFAULT NULL,
    p_offer_result text DEFAULT NULL,
    p_offer_close_display text DEFAULT NULL,
    p_event_topics text[] DEFAULT NULL,
    p_offer_ticket_details text DEFAULT NULL,
    p_offer_value text DEFAULT NULL,
    p_event_city text DEFAULT NULL,
    p_event_country_code text DEFAULT NULL,
    p_event_link text DEFAULT NULL,
    p_event_logo text DEFAULT NULL,
    p_offer_slug text DEFAULT NULL,
    p_offer_close_date timestamptz DEFAULT NULL,
    p_event_start timestamptz DEFAULT NULL,
    p_event_end timestamptz DEFAULT NULL,
    p_event_region text DEFAULT NULL,
    p_event_location text DEFAULT NULL,
    p_event_topics_updated_at timestamptz DEFAULT NULL,
    p_event_type text DEFAULT NULL,
    p_venue_address text DEFAULT NULL,
    p_scraped_by text DEFAULT NULL,
    p_scraper_id integer DEFAULT NULL,
    p_source_type text DEFAULT NULL,
    p_source_details jsonb DEFAULT NULL,
    p_event_timezone text DEFAULT NULL,
    p_luma_event_id text DEFAULT NULL,
    p_source_event_id text DEFAULT NULL,
    p_luma_page_data jsonb DEFAULT NULL,
    p_meetup_page_data jsonb DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE events
    SET
        event_title = COALESCE(p_event_title, event_title),
        listing_intro = COALESCE(p_listing_intro, listing_intro),
        offer_result = COALESCE(p_offer_result, offer_result),
        offer_close_display = COALESCE(p_offer_close_display, offer_close_display),
        event_topics = COALESCE(p_event_topics, event_topics),
        offer_ticket_details = COALESCE(p_offer_ticket_details, offer_ticket_details),
        offer_value = COALESCE(p_offer_value, offer_value),
        event_city = COALESCE(p_event_city, event_city),
        event_country_code = COALESCE(p_event_country_code, event_country_code),
        event_link = COALESCE(p_event_link, event_link),
        event_logo = COALESCE(p_event_logo, event_logo),
        offer_slug = COALESCE(p_offer_slug, offer_slug),
        offer_close_date = COALESCE(p_offer_close_date, offer_close_date),
        event_start = COALESCE(p_event_start, event_start),
        event_end = COALESCE(p_event_end, event_end),
        event_region = COALESCE(p_event_region, event_region),
        event_location = COALESCE(p_event_location, event_location),
        event_type = COALESCE(p_event_type, event_type),
        venue_address = COALESCE(p_venue_address, venue_address),
        scraped_by = COALESCE(p_scraped_by, scraped_by),
        scraper_id = COALESCE(p_scraper_id, scraper_id),
        source_type = COALESCE(p_source_type, source_type),
        source_details = COALESCE(p_source_details, source_details),
        event_timezone = COALESCE(p_event_timezone, event_timezone),
        luma_event_id = COALESCE(p_luma_event_id, luma_event_id),
        source_event_id = COALESCE(p_source_event_id, source_event_id),
        luma_page_data = COALESCE(p_luma_page_data, luma_page_data),
        meetup_page_data = COALESCE(p_meetup_page_data, meetup_page_data),
        updated_at = NOW()
    WHERE id = p_id;

    RETURN FOUND;
END;
$$;

-- ==========================================================================
-- 11. RPC: events_update_screenshot_status
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.events_update_screenshot_status(
    p_event_id varchar,
    p_screenshot_generated boolean,
    p_screenshot_url text DEFAULT NULL,
    p_screenshot_generated_at timestamptz DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.events SET
        screenshot_generated = p_screenshot_generated,
        screenshot_url = p_screenshot_url,
        screenshot_generated_at = p_screenshot_generated_at,
        updated_at = NOW()
    WHERE event_id = p_event_id;

    RETURN FOUND;
END;
$$;
