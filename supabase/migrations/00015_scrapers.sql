-- ============================================================
-- Migration: Scrapers tables and seed data
-- ============================================================

-- Create scrapers table
CREATE TABLE IF NOT EXISTS public.scrapers (
  id                     serial PRIMARY KEY,
  name                   text NOT NULL,
  description            text DEFAULT '',
  scraper_type           text NOT NULL,
  object_type            varchar(50) DEFAULT 'events',
  event_type             varchar(50) DEFAULT 'mixed',
  base_url               text NOT NULL,
  enabled                boolean DEFAULT true,
  account                text DEFAULT '',
  config                 jsonb DEFAULT '{}'::jsonb,
  total_items_scraped    integer DEFAULT 0,
  last_run               timestamptz,
  last_success           timestamptz,
  last_error             text,
  schedule_enabled       boolean DEFAULT false,
  schedule_frequency     varchar(50) DEFAULT 'none',
  schedule_time          time,
  schedule_days          integer[],
  schedule_cron          text,
  next_scheduled_run     timestamptz,
  created_at             timestamptz DEFAULT now(),
  updated_at             timestamptz DEFAULT now()
);

-- Create scrapers_runs table (for run logs)
CREATE TABLE IF NOT EXISTS public.scrapers_runs (
  id                     serial PRIMARY KEY,
  scraper_id             integer REFERENCES public.scrapers(id) ON DELETE CASCADE,
  status                 varchar(50) DEFAULT 'pending',
  started_at             timestamptz DEFAULT now(),
  completed_at           timestamptz,
  items_found            integer DEFAULT 0,
  items_processed        integer DEFAULT 0,
  items_skipped          integer DEFAULT 0,
  items_failed           integer DEFAULT 0,
  error_message          text,
  log_output             text,
  created_by             text DEFAULT 'system',
  created_at             timestamptz DEFAULT now()
);

-- Create scrapers_jobs table (for job queue tracking)
CREATE TABLE IF NOT EXISTS public.scrapers_jobs (
  id                     serial PRIMARY KEY,
  scraper_id             integer REFERENCES public.scrapers(id) ON DELETE CASCADE,
  status                 varchar(50) DEFAULT 'pending',
  started_at             timestamptz DEFAULT now(),
  completed_at           timestamptz,
  items_found            integer DEFAULT 0,
  items_processed        integer DEFAULT 0,
  items_skipped          integer DEFAULT 0,
  items_failed           integer DEFAULT 0,
  error_message          text,
  log_output             text,
  created_by             text DEFAULT 'system',
  created_at             timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_scrapers_enabled ON public.scrapers(enabled);
CREATE INDEX IF NOT EXISTS idx_scrapers_scraper_type ON public.scrapers(scraper_type);
CREATE INDEX IF NOT EXISTS idx_scrapers_runs_scraper_id ON public.scrapers_runs(scraper_id);
CREATE INDEX IF NOT EXISTS idx_scrapers_runs_status ON public.scrapers_runs(status);
CREATE INDEX IF NOT EXISTS idx_scrapers_jobs_scraper_id ON public.scrapers_jobs(scraper_id);
CREATE INDEX IF NOT EXISTS idx_scrapers_jobs_status ON public.scrapers_jobs(status);

-- ============================================================
-- Seed: MLOps Community scrapers (56 Luma iCal scrapers)
-- Uses ON CONFLICT to be idempotent on base_url
-- ============================================================

-- Add unique constraint on base_url for upsert support
ALTER TABLE public.scrapers ADD CONSTRAINT scrapers_base_url_unique UNIQUE (base_url);

INSERT INTO public.scrapers (name, description, scraper_type, object_type, event_type, base_url, enabled, account, config, schedule_enabled, schedule_frequency)
VALUES
  ('MLOps Community // London', '', 'LumaICalScraper', 'events', 'mixed', 'https://luma.com/london-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // New York City', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/nyc.mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Amsterdam', '', 'LumaICalScraper', 'events', 'mixed', 'https://luma.com/amsterdam-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Melbourne', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/melbourne-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // San Antonio', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/san-antonio-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Lagos', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/lagos-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // India', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/india-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Buenos Aires', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/buenosaires-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Scotland', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/scotland-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Turkey', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/mlops-turkey', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Barcelona', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/barcelona-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Tel Aviv', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/telavivyafo-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Mexico City', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/mexicocity-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Atlanta', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/atlanta-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Madrid', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/madrid-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Toronto', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/toronto-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Helsinki', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/helsinki-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Frankfurt', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/frankfurt-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Munich', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/munich-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Montreal', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/montreal-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Bristol', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/bristol-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Medellín', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/medellin-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Seattle', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/seattle-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Bucharest', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/bucharest-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Washington DC', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/washington-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Berlin', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/berlin-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Addis Ababa', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/addisababa-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Copenhagen', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/copenhagen-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Utah', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/utah-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Portland', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/portland-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Charlotte', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/Charlottemlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Boston', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/boston-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Bilbao', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/bilbao-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Cairo', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/cairo-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // SF Bay Area', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/mlops-community-sfbayarea', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Switzerland', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/switzerland-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Sydney', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/sydney-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Oslo', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/oslo-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Paris', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/paris-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Los Angeles', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/losangeles-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Silicon Valley', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/silicon-valley-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Luxembourg', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/luxembourg-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Miami', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/miami-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Chicago', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/chicago-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Milan', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/milan-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Cape Town', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/capetown-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Lisbon', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/lisbon-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Stockholm', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/stockholm-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Seoul', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/seoul-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Vancouver', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/vancouver-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Lille', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/lille-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Gothenburg', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/gotenburg-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Austin', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/austin-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // San Francisco', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/sf-mlops-community', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Bogotá', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/bogota-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('MLOps Community // Colorado', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/colorado-mlops', true, 'mlops', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily')
ON CONFLICT (base_url) DO NOTHING;
