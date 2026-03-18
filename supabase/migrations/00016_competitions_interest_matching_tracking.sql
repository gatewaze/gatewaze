-- Migration: 00016_competitions_interest_matching_tracking
-- Description: Add tables for event interest, attendee matching, competitions,
--              communication settings, ad tracking, conversion logging, and email batch jobs.

-- ============================================================================
-- 1. event_interest - Expressions of interest in events
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.event_interest (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  email text NOT NULL,
  first_name text,
  last_name text,
  company text,
  job_title text,
  phone text,
  linkedin_url text,
  interest_source text,
  interest_type text,
  status text DEFAULT 'active' CHECK (status IN ('active', 'converted', 'withdrawn')),
  source text,
  expressed_at timestamptz DEFAULT now(),
  member_profile_id uuid,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  converted_to_registration_id uuid REFERENCES public.event_registrations(id) ON DELETE SET NULL,
  converted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_interest_event ON public.event_interest (event_id);
CREATE INDEX IF NOT EXISTS idx_event_interest_email ON public.event_interest (email);

CREATE TRIGGER event_interest_updated_at
  BEFORE UPDATE ON public.event_interest
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 2. event_interest_with_details - View joining interest with customer names
-- ============================================================================
CREATE OR REPLACE VIEW public.event_interest_with_details AS
SELECT ei.*,
  c.full_name AS display_first_name,
  NULL::text AS display_last_name
FROM public.event_interest ei
LEFT JOIN public.customers c ON ei.customer_id = c.id;

-- ============================================================================
-- 3. event_attendee_matches - AI-generated attendee matches
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.event_attendee_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  registration_a_id uuid NOT NULL REFERENCES public.event_registrations(id) ON DELETE CASCADE,
  registration_b_id uuid NOT NULL REFERENCES public.event_registrations(id) ON DELETE CASCADE,
  match_score numeric(5,2),
  match_reason text,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected')),
  intro_email_sent_at timestamptz,
  preceding_word_a text,
  preceding_word_b text,
  generated_at timestamptz DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_matches_event ON public.event_attendee_matches (event_id);

CREATE TRIGGER event_matches_updated_at
  BEFORE UPDATE ON public.event_attendee_matches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 4. event_competitions - Competitions/giveaways for events
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.event_competitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  prize_description text,
  competition_type text DEFAULT 'giveaway' CHECK (competition_type IN ('giveaway', 'raffle', 'contest', 'quiz')),
  status text DEFAULT 'active' CHECK (status IN ('draft', 'active', 'closed', 'completed')),
  start_date timestamptz,
  end_date timestamptz,
  max_entries integer,
  sponsor_id uuid REFERENCES public.event_sponsors(id) ON DELETE SET NULL,
  rules text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_competitions_event ON public.event_competitions (event_id);

CREATE TRIGGER event_competitions_updated_at
  BEFORE UPDATE ON public.event_competitions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 5. competition_entries - Entries for competitions
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.competition_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES public.event_competitions(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  entry_data jsonb,
  status text DEFAULT 'active' CHECK (status IN ('active', 'winner', 'disqualified')),
  entered_at timestamptz DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_competition_entries_comp ON public.competition_entries (competition_id);
CREATE INDEX IF NOT EXISTS idx_competition_entries_customer ON public.competition_entries (customer_id);

-- ============================================================================
-- 6. competition_winners - Selected winners
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.competition_winners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES public.event_competitions(id) ON DELETE CASCADE,
  entry_id uuid NOT NULL REFERENCES public.competition_entries(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  prize_awarded text,
  discount_code_id uuid REFERENCES public.discount_codes(id) ON DELETE SET NULL,
  notified_at timestamptz,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_competition_winners_comp ON public.competition_winners (competition_id);

-- ============================================================================
-- 7. event_communication_settings - Per-event email communication settings
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.event_communication_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE UNIQUE,
  registration_email_enabled boolean DEFAULT true,
  registration_email_template_id uuid,
  registration_email_from_key text DEFAULT 'events',
  registration_email_reply_to text,
  registration_email_cc text,
  registration_email_subject text,
  registration_email_content text,
  reminder_email_enabled boolean DEFAULT false,
  reminder_email_template_id uuid,
  reminder_email_from_key text DEFAULT 'events',
  reminder_email_reply_to text,
  reminder_email_cc text,
  reminder_email_subject text,
  reminder_email_content text,
  reminder_email_sent_at timestamptz,
  speaker_submitted_email_enabled boolean DEFAULT true,
  speaker_submitted_email_template_id uuid,
  speaker_submitted_email_from_key text DEFAULT 'events',
  speaker_submitted_email_reply_to text,
  speaker_submitted_email_cc text,
  speaker_submitted_email_subject text,
  speaker_submitted_email_content text,
  speaker_approved_email_enabled boolean DEFAULT true,
  speaker_approved_email_template_id uuid,
  speaker_approved_email_from_key text DEFAULT 'events',
  speaker_approved_email_reply_to text,
  speaker_approved_email_cc text,
  speaker_approved_email_subject text,
  speaker_approved_email_content text,
  speaker_rejected_email_enabled boolean DEFAULT true,
  speaker_rejected_email_template_id uuid,
  speaker_rejected_email_from_key text DEFAULT 'events',
  speaker_rejected_email_reply_to text,
  speaker_rejected_email_cc text,
  speaker_rejected_email_subject text,
  speaker_rejected_email_content text,
  speaker_reserve_email_enabled boolean DEFAULT true,
  speaker_reserve_email_template_id uuid,
  speaker_reserve_email_from_key text DEFAULT 'events',
  speaker_reserve_email_reply_to text,
  speaker_reserve_email_cc text,
  speaker_reserve_email_subject text,
  speaker_reserve_email_content text,
  speaker_confirmed_email_enabled boolean DEFAULT true,
  speaker_confirmed_email_template_id uuid,
  speaker_confirmed_email_from_key text DEFAULT 'events',
  speaker_confirmed_email_reply_to text,
  speaker_confirmed_email_cc text,
  speaker_confirmed_email_subject text,
  speaker_confirmed_email_content text,
  post_event_attendee_email_enabled boolean DEFAULT false,
  post_event_attendee_email_template_id uuid,
  post_event_attendee_email_from_key text DEFAULT 'events',
  post_event_attendee_email_reply_to text,
  post_event_attendee_email_cc text,
  post_event_attendee_email_subject text,
  post_event_attendee_email_content text,
  post_event_non_attendee_email_enabled boolean DEFAULT false,
  post_event_non_attendee_email_template_id uuid,
  post_event_non_attendee_email_from_key text DEFAULT 'events',
  post_event_non_attendee_email_reply_to text,
  post_event_non_attendee_email_cc text,
  post_event_non_attendee_email_subject text,
  post_event_non_attendee_email_content text,
  registrant_email_enabled boolean DEFAULT false,
  registrant_email_template_id uuid,
  registrant_email_from_key text DEFAULT 'events',
  registrant_email_reply_to text,
  registrant_email_cc text,
  registrant_email_subject text,
  registrant_email_content text,
  match_intro_email_template_id uuid,
  match_intro_email_from_key text DEFAULT 'events',
  match_intro_email_reply_to text,
  match_intro_email_subject text,
  match_intro_email_content text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER event_comm_settings_updated_at
  BEFORE UPDATE ON public.event_communication_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 8. ad_tracking_sessions - Ad click tracking sessions
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ad_tracking_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  click_ids jsonb,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  ip_address text,
  user_agent text,
  landing_page text,
  referrer text,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'converted', 'expired')),
  matched_registration_id uuid REFERENCES public.event_registrations(id) ON DELETE SET NULL,
  matched_via text,
  conversions_sent jsonb,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tracking_sessions_session ON public.ad_tracking_sessions (session_id);
CREATE INDEX IF NOT EXISTS idx_tracking_sessions_event ON public.ad_tracking_sessions (event_id);

CREATE TRIGGER tracking_sessions_updated_at
  BEFORE UPDATE ON public.ad_tracking_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 9. conversion_events_log - Conversion event log for ad platforms
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.conversion_events_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_session_id uuid REFERENCES public.ad_tracking_sessions(id) ON DELETE SET NULL,
  registration_id uuid REFERENCES public.event_registrations(id) ON DELETE SET NULL,
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  platform text NOT NULL,
  event_name text NOT NULL,
  dedup_event_id text,
  request_payload jsonb,
  request_url text,
  response_payload jsonb,
  http_status integer,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'success', 'failed', 'error')),
  error_message text,
  sent_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversion_log_session ON public.conversion_events_log (tracking_session_id);
CREATE INDEX IF NOT EXISTS idx_conversion_log_event ON public.conversion_events_log (event_id);
CREATE INDEX IF NOT EXISTS idx_conversion_log_platform ON public.conversion_events_log (platform);

-- ============================================================================
-- 10. email_batch_jobs - Batch email jobs
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.email_batch_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  email_type text NOT NULL,
  subject_template text,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  total_recipients integer DEFAULT 0,
  processed_count integer DEFAULT 0,
  success_count integer DEFAULT 0,
  fail_count integer DEFAULT 0,
  errors jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_email_batch_jobs_event ON public.email_batch_jobs (event_id);

CREATE TRIGGER email_batch_jobs_updated_at
  BEFORE UPDATE ON public.email_batch_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- RLS Policies
-- ============================================================================

-- event_interest
ALTER TABLE public.event_interest ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_select_event_interest"
  ON public.event_interest FOR SELECT TO anon
  USING (true);

CREATE POLICY "authenticated_all_event_interest"
  ON public.event_interest FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- event_attendee_matches
ALTER TABLE public.event_attendee_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_all_event_attendee_matches"
  ON public.event_attendee_matches FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- event_competitions
ALTER TABLE public.event_competitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_select_event_competitions"
  ON public.event_competitions FOR SELECT TO anon
  USING (true);

CREATE POLICY "authenticated_all_event_competitions"
  ON public.event_competitions FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- competition_entries
ALTER TABLE public.competition_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_select_competition_entries"
  ON public.competition_entries FOR SELECT TO anon
  USING (true);

CREATE POLICY "authenticated_all_competition_entries"
  ON public.competition_entries FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- competition_winners
ALTER TABLE public.competition_winners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_all_competition_winners"
  ON public.competition_winners FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- event_communication_settings
ALTER TABLE public.event_communication_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_all_event_communication_settings"
  ON public.event_communication_settings FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ad_tracking_sessions
ALTER TABLE public.ad_tracking_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_all_ad_tracking_sessions"
  ON public.ad_tracking_sessions FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- conversion_events_log
ALTER TABLE public.conversion_events_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_all_conversion_events_log"
  ON public.conversion_events_log FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- email_batch_jobs
ALTER TABLE public.email_batch_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_all_email_batch_jobs"
  ON public.email_batch_jobs FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
