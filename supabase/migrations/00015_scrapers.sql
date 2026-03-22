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
-- Seed: Demo Community scrapers (56 Luma iCal scrapers)
-- Uses ON CONFLICT to be idempotent on base_url
-- ============================================================

-- Add unique constraint on base_url for upsert support
ALTER TABLE public.scrapers ADD CONSTRAINT scrapers_base_url_unique UNIQUE (base_url);

INSERT INTO public.scrapers (name, description, scraper_type, object_type, event_type, base_url, enabled, account, config, schedule_enabled, schedule_frequency)
VALUES
  ('Demo Community // London', '', 'LumaICalScraper', 'events', 'mixed', 'https://luma.com/london-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // New York City', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/nyc.demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Amsterdam', '', 'LumaICalScraper', 'events', 'mixed', 'https://luma.com/amsterdam-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Melbourne', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/melbourne-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // San Antonio', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/san-antonio-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Lagos', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/lagos-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // India', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/india-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Buenos Aires', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/buenosaires-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Scotland', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/scotland-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Turkey', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/demo-turkey', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Barcelona', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/barcelona-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Tel Aviv', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/telavivyafo-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Mexico City', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/mexicocity-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Atlanta', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/atlanta-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Madrid', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/madrid-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Toronto', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/toronto-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Helsinki', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/helsinki-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Frankfurt', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/frankfurt-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Munich', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/munich-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Montreal', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/montreal-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Bristol', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/bristol-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Medellín', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/medellin-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Seattle', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/seattle-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Bucharest', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/bucharest-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Washington DC', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/washington-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Berlin', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/berlin-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Addis Ababa', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/addisababa-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Copenhagen', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/copenhagen-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Utah', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/utah-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Portland', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/portland-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Charlotte', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/Charlottedemo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Boston', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/boston-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Bilbao', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/bilbao-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Cairo', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/cairo-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // SF Bay Area', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/demo-community-sfbayarea', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Switzerland', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/switzerland-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Sydney', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/sydney-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Oslo', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/oslo-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Paris', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/paris-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Los Angeles', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/losangeles-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Silicon Valley', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/silicon-valley-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Luxembourg', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/luxembourg-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Miami', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/miami-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Chicago', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/chicago-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Milan', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/milan-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Cape Town', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/capetown-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Lisbon', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/lisbon-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Stockholm', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/stockholm-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Seoul', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/seoul-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Vancouver', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/vancouver-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Lille', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/lille-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Gothenburg', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/gotenburg-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Austin', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/austin-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // San Francisco', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/sf-demo-community', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Bogotá', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/bogota-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily'),
  ('Demo Community // Colorado', '', 'LumaICalScraper', 'events', 'mixed', 'https://lu.ma/colorado-demo', true, 'demo', '{"past": true, "timezone": "UTC", "scrollTimeout": 5000, "maxScrollAttempts": 50}'::jsonb, true, 'daily')
ON CONFLICT (base_url) DO NOTHING;
