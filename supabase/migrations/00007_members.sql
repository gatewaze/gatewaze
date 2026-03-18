-- ============================================================================
-- Migration: 00007_members
-- Description: Customers / members table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.customers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email        text UNIQUE NOT NULL,
  first_name   text,
  last_name    text,
  full_name    text GENERATED ALWAYS AS (
                 coalesce(first_name || ' ' || last_name, first_name, last_name, email)
               ) STORED,
  avatar_url   text,
  company      text,
  job_title    text,
  location     text,
  bio          text,
  linkedin_url text,
  twitter_url  text,
  website_url  text,
  phone        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.customers IS 'Event attendees / community members';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_customers_email     ON public.customers (email);
CREATE INDEX IF NOT EXISTS idx_customers_full_name ON public.customers (full_name);

-- Updated-at trigger
CREATE TRIGGER customers_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
