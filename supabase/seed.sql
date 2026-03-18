-- ============================================================================
-- Seed Data for Gatewaze
-- Description: Sample data for local development and demos
-- ============================================================================

-- ==========================================================================
-- Admin profile: created via the onboarding wizard on first run.
-- No seed admin is inserted — the setup wizard handles this.
-- ==========================================================================

-- ==========================================================================
-- Categories
-- ==========================================================================
INSERT INTO public.categories (id, name, slug, description) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'Technology',  'technology',  'Tech conferences, meetups, and workshops'),
  ('c0000000-0000-0000-0000-000000000002', 'Community',   'community',   'Community-driven events and gatherings')
ON CONFLICT (slug) DO NOTHING;

-- ==========================================================================
-- Topics
-- ==========================================================================
INSERT INTO public.topics (id, name, slug) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'AI/ML',        'ai-ml'),
  ('d0000000-0000-0000-0000-000000000002', 'DevOps',       'devops'),
  ('d0000000-0000-0000-0000-000000000003', 'Open Source',  'open-source')
ON CONFLICT (slug) DO NOTHING;

-- ==========================================================================
-- Speakers
-- ==========================================================================
INSERT INTO public.speakers (id, name, email, title, company, bio) VALUES
  (
    'b0000000-0000-0000-0000-000000000001',
    'Alex Rivera',
    'alex@example.com',
    'Principal Engineer',
    'CloudNative Inc.',
    'Alex has 15 years of experience building distributed systems and is a frequent open-source contributor.'
  ),
  (
    'b0000000-0000-0000-0000-000000000002',
    'Priya Sharma',
    'priya@example.com',
    'Head of AI Research',
    'DeepTech Labs',
    'Priya leads a team of researchers working on practical applications of large language models.'
  ),
  (
    'b0000000-0000-0000-0000-000000000003',
    'Jordan Chen',
    'jordan@example.com',
    'DevOps Lead',
    'ScaleUp Co.',
    'Jordan specializes in CI/CD pipelines, Kubernetes, and platform engineering.'
  )
ON CONFLICT DO NOTHING;

-- ==========================================================================
-- Events (5 total: mix of statuses, virtual/in-person, past/upcoming)
-- ==========================================================================

-- Event 1: Published, upcoming, in-person
INSERT INTO public.events (id, event_id, title, description, short_description, start_date, end_date, timezone, location_name, location_address, latitude, longitude, is_virtual, status, capacity, is_free)
VALUES (
  'e0000000-0000-0000-0000-000000000001',
  'EVT-SEED0001',
  'Open Source Summit 2026',
  'A two-day conference celebrating open-source software, featuring talks, workshops, and networking.',
  'The premier open-source conference of the year.',
  '2026-06-15 09:00:00+00',
  '2026-06-16 17:00:00+00',
  'America/New_York',
  'Convention Center',
  '123 Main St, New York, NY 10001',
  40.7128,
  -74.0060,
  false,
  'published',
  500,
  true
)
ON CONFLICT (event_id) DO NOTHING;

-- Event 2: Published, upcoming, virtual
INSERT INTO public.events (id, event_id, title, description, short_description, start_date, end_date, timezone, location_name, is_virtual, virtual_url, status, capacity, is_free)
VALUES (
  'e0000000-0000-0000-0000-000000000002',
  'EVT-SEED0002',
  'AI/ML Workshop: Building with LLMs',
  'A hands-on virtual workshop covering practical techniques for building applications with large language models.',
  'Hands-on LLM workshop for developers.',
  '2026-05-20 14:00:00+00',
  '2026-05-20 17:00:00+00',
  'America/Los_Angeles',
  'Online',
  true,
  'https://meet.example.com/ai-workshop',
  'published',
  200,
  true
)
ON CONFLICT (event_id) DO NOTHING;

-- Event 3: Published, past, in-person
INSERT INTO public.events (id, event_id, title, description, short_description, start_date, end_date, timezone, location_name, location_address, latitude, longitude, is_virtual, status, capacity, is_free, price, currency)
VALUES (
  'e0000000-0000-0000-0000-000000000003',
  'EVT-SEED0003',
  'DevOps Days San Francisco',
  'A community-organized conference covering DevOps, platform engineering, and site reliability.',
  'SF DevOps community conference.',
  '2025-11-10 09:00:00+00',
  '2025-11-11 17:00:00+00',
  'America/Los_Angeles',
  'Moscone Center',
  '747 Howard St, San Francisco, CA 94103',
  37.7749,
  -122.4194,
  false,
  'completed',
  300,
  false,
  49.99,
  'USD'
)
ON CONFLICT (event_id) DO NOTHING;

-- Event 4: Draft, upcoming, virtual
INSERT INTO public.events (id, event_id, title, description, short_description, start_date, end_date, timezone, is_virtual, virtual_url, status, is_free)
VALUES (
  'e0000000-0000-0000-0000-000000000004',
  'EVT-SEED0004',
  'Community Meetup: Getting Started with Kubernetes',
  'An introductory session for developers looking to learn Kubernetes fundamentals.',
  'Beginner-friendly K8s meetup.',
  '2026-07-01 18:00:00+00',
  '2026-07-01 20:00:00+00',
  'America/Chicago',
  true,
  'https://meet.example.com/k8s-intro',
  'draft',
  true
)
ON CONFLICT (event_id) DO NOTHING;

-- Event 5: Cancelled, past
INSERT INTO public.events (id, event_id, title, description, short_description, start_date, end_date, timezone, location_name, is_virtual, status, is_free)
VALUES (
  'e0000000-0000-0000-0000-000000000005',
  'EVT-SEED0005',
  'Tech Networking Mixer',
  'An informal evening mixer for tech professionals. Unfortunately cancelled due to venue issues.',
  'Informal tech networking evening.',
  '2026-03-01 18:00:00+00',
  '2026-03-01 21:00:00+00',
  'America/New_York',
  'TBD',
  false,
  'cancelled',
  true
)
ON CONFLICT (event_id) DO NOTHING;

-- ==========================================================================
-- Link speakers to events
-- ==========================================================================
INSERT INTO public.event_speakers (event_id, speaker_id, role, display_order) VALUES
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'keynote',  1),
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'speaker',  2),
  ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'speaker',  1),
  ('e0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000003', 'speaker',  1)
ON CONFLICT DO NOTHING;

-- ==========================================================================
-- Link events to categories
-- ==========================================================================
INSERT INTO public.event_categories (event_id, category_id) VALUES
  ('e0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001'),
  ('e0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002'),
  ('e0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001'),
  ('e0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;

-- ==========================================================================
-- Link events to topics
-- ==========================================================================
INSERT INTO public.event_topics (event_id, topic_id) VALUES
  ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003'),
  ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001'),
  ('e0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000002'),
  ('e0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000002')
ON CONFLICT DO NOTHING;

-- ==========================================================================
-- Calendar + link events
-- ==========================================================================
INSERT INTO public.calendars (id, calendar_id, name, slug, description, is_public, is_active)
VALUES (
  'f0000000-0000-0000-0000-000000000001',
  'CAL-MAIN0001',
  'Main Events',
  'main-events',
  'The primary public calendar featuring all major upcoming events.',
  true,
  true
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.calendar_events (calendar_id, event_id) VALUES
  ('f0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001'),
  ('f0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002'),
  ('f0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000003')
ON CONFLICT DO NOTHING;

-- ==========================================================================
-- Customers / members
-- ==========================================================================
INSERT INTO public.customers (id, email, first_name, last_name, company, job_title) VALUES
  (
    'aa000000-0000-0000-0000-000000000001',
    'jane.doe@example.com',
    'Jane',
    'Doe',
    'Acme Corp',
    'Software Engineer'
  ),
  (
    'aa000000-0000-0000-0000-000000000002',
    'bob.smith@example.com',
    'Bob',
    'Smith',
    'TechStart LLC',
    'Product Manager'
  )
ON CONFLICT (email) DO NOTHING;

-- ==========================================================================
-- Sample registrations
-- ==========================================================================
INSERT INTO public.event_registrations (event_id, customer_id, status) VALUES
  ('e0000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000001', 'confirmed'),
  ('e0000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000002', 'confirmed'),
  ('e0000000-0000-0000-0000-000000000002', 'aa000000-0000-0000-0000-000000000001', 'pending'),
  ('e0000000-0000-0000-0000-000000000003', 'aa000000-0000-0000-0000-000000000002', 'attended')
ON CONFLICT DO NOTHING;
