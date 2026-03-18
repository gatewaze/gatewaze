-- ============================================================================
-- Migration: 00018_scrapers
-- Description: Scraper infrastructure - tables, jobs, logs, and RPC functions
--              Matches TechTickets schema for compatibility with existing scrapers
-- ============================================================================

-- ==========================================================================
-- 1. Scrapers table
-- ==========================================================================

CREATE SEQUENCE IF NOT EXISTS scrapers_id_seq;

CREATE TABLE IF NOT EXISTS public.scrapers (
  id                  integer NOT NULL DEFAULT nextval('scrapers_id_seq'::regclass) PRIMARY KEY,
  name                text NOT NULL,
  description         text,
  scraper_type        text NOT NULL,
  event_type          text NOT NULL,
  base_url            text NOT NULL,
  enabled             boolean DEFAULT true,
  last_run            timestamp without time zone,
  last_success        timestamp without time zone,
  last_error          text,
  total_items_scraped integer DEFAULT 0,
  config              jsonb DEFAULT '{}'::jsonb,
  created_at          timestamp without time zone DEFAULT now(),
  updated_at          timestamp without time zone DEFAULT now(),
  timezone            text DEFAULT 'UTC',
  schedule_enabled    boolean DEFAULT false,
  schedule_frequency  varchar(20) DEFAULT 'none',
  schedule_time       time without time zone,
  schedule_days       integer[],
  schedule_cron       varchar(100),
  next_scheduled_run  timestamptz,
  object_type         text NOT NULL DEFAULT 'events',
  account             text
);

ALTER TABLE public.scrapers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_scrapers" ON public.scrapers FOR SELECT TO anon USING (true);
CREATE POLICY "auth_all_scrapers" ON public.scrapers FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ==========================================================================
-- 2. Scraper jobs table
-- ==========================================================================

CREATE SEQUENCE IF NOT EXISTS scraper_jobs_id_seq;

CREATE TABLE IF NOT EXISTS public.scraper_jobs (
  id               integer NOT NULL DEFAULT nextval('scraper_jobs_id_seq'::regclass) PRIMARY KEY,
  scraper_id       integer REFERENCES public.scrapers(id) ON DELETE CASCADE,
  status           text DEFAULT 'pending',
  started_at       timestamp without time zone DEFAULT now(),
  completed_at     timestamp without time zone,
  items_found      integer DEFAULT 0,
  items_processed  integer DEFAULT 0,
  items_skipped    integer DEFAULT 0,
  items_failed     integer DEFAULT 0,
  error_message    text,
  log_output       text,
  created_by       text,
  created_at       timestamp without time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scraper_jobs_scraper ON public.scraper_jobs (scraper_id);
CREATE INDEX IF NOT EXISTS idx_scraper_jobs_status ON public.scraper_jobs (status);

ALTER TABLE public.scraper_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_scraper_jobs" ON public.scraper_jobs FOR SELECT TO anon USING (true);
CREATE POLICY "auth_all_scraper_jobs" ON public.scraper_jobs FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ==========================================================================
-- 3. Scraper job logs table
-- ==========================================================================

CREATE TABLE IF NOT EXISTS public.scraper_job_logs (
  id         bigserial PRIMARY KEY,
  job_id     integer NOT NULL REFERENCES public.scraper_jobs(id) ON DELETE CASCADE,
  log_type   text NOT NULL DEFAULT 'log',
  log_level  text NOT NULL DEFAULT 'info',
  message    text NOT NULL,
  metadata   jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scraper_job_logs_job ON public.scraper_job_logs (job_id);

ALTER TABLE public.scraper_job_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_scraper_job_logs" ON public.scraper_job_logs FOR SELECT TO anon USING (true);
CREATE POLICY "auth_all_scraper_job_logs" ON public.scraper_job_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ==========================================================================
-- 4. RPC: create_event
-- ==========================================================================

CREATE OR REPLACE FUNCTION public.create_event(
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
    p_listing_type text DEFAULT NULL,
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
        listing_type, event_region, event_location, event_type,
        venue_address, scraped_by, scraper_id, source_type, source_details, event_timezone,
        luma_event_id, source_event_id, luma_page_data, meetup_page_data, created_at, updated_at
    ) VALUES (
        p_event_id, p_event_title, p_listing_intro, p_offer_result, p_offer_close_display,
        p_event_topics, p_offer_ticket_details, p_offer_value, p_event_city, p_event_country_code,
        CASE WHEN normalized_link = '' THEN NULL ELSE normalized_link END,
        p_event_logo, p_offer_slug, p_offer_close_date, p_event_start, p_event_end,
        p_listing_type, p_event_region, p_event_location, p_event_type,
        p_venue_address, p_scraped_by, p_scraper_id, p_source_type, p_source_details, p_event_timezone,
        p_luma_event_id, p_source_event_id, p_luma_page_data, p_meetup_page_data, NOW(), NOW()
    ) RETURNING id INTO new_id;

    RETURN new_id;
END;
$$;

-- ==========================================================================
-- 5. RPC: update_event
-- ==========================================================================

CREATE OR REPLACE FUNCTION public.update_event(
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
    p_listing_type text DEFAULT NULL,
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
        listing_type = COALESCE(p_listing_type, listing_type),
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
-- 6. RPC: get_scraper_job
-- ==========================================================================

CREATE OR REPLACE FUNCTION public.get_scraper_job(job_id integer)
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
    j.status,
    j.started_at,
    j.completed_at,
    j.items_found,
    j.items_processed,
    j.items_skipped,
    j.items_failed,
    j.error_message,
    j.log_output,
    j.created_by
  FROM scraper_jobs j
  JOIN scrapers s ON j.scraper_id = s.id
  WHERE j.id = get_scraper_job.job_id;
END;
$$;

-- ==========================================================================
-- 7. RPC: update_scraper_job_v2
-- ==========================================================================

CREATE OR REPLACE FUNCTION public.update_scraper_job_v2(
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
  UPDATE public.scraper_jobs
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
  WHERE id = update_scraper_job_v2.job_id;

  IF new_status IN ('completed', 'failed') THEN
    UPDATE public.scrapers s
    SET
      last_run = NOW(),
      last_success = CASE WHEN new_status = 'completed' THEN NOW() ELSE s.last_success END,
      last_error = CASE WHEN new_status = 'failed' THEN error_msg ELSE s.last_error END,
      total_items_scraped = s.total_items_scraped + COALESCE(items_processed_count, 0)
    FROM public.scraper_jobs j
    WHERE s.id = j.scraper_id AND j.id = update_scraper_job_v2.job_id;
  END IF;
END;
$$;

-- ==========================================================================
-- 8. RPC: update_event_screenshot_status
-- ==========================================================================

CREATE OR REPLACE FUNCTION public.update_event_screenshot_status(
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

-- ==========================================================================
-- 9. RPC: get_scrapers_due_for_run
-- ==========================================================================

CREATE OR REPLACE FUNCTION public.get_scrapers_due_for_run()
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
      FROM scraper_jobs sj
      WHERE sj.scraper_id = s.id
        AND sj.status IN ('pending', 'running')
    )
  ORDER BY s.next_scheduled_run NULLS FIRST;
$$;

-- ==========================================================================
-- 10. RPC: create_scraper_job
-- ==========================================================================

CREATE OR REPLACE FUNCTION public.create_scraper_job(
    scraper_ids integer[],
    created_by_user text DEFAULT 'scheduler'
) RETURNS TABLE(job_id integer)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    INSERT INTO public.scraper_jobs (scraper_id, status, created_by)
    SELECT unnest(scraper_ids), 'pending', created_by_user
    RETURNING id AS job_id;
END;
$$;

-- ==========================================================================
-- 11. RPC: insert_scraper_job_log
-- ==========================================================================

CREATE OR REPLACE FUNCTION public.insert_scraper_job_log(
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
    INSERT INTO public.scraper_job_logs (job_id, log_type, log_level, message, metadata)
    VALUES (p_job_id, p_log_type, p_log_level, p_message, p_metadata)
    RETURNING id INTO new_id;

    RETURN new_id;
END;
$$;
