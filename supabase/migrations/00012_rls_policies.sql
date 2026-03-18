-- ============================================================================
-- Migration: 00012_rls_policies
-- Description: Comprehensive Row Level Security policies for all tables
--
-- Security model:
--   anon            -> Read-only access to public-facing data (published events,
--                      public calendars, public speakers, reference taxonomy data)
--   authenticated   -> Can read own profile/registrations, create registrations,
--                      update own profile. NO admin access.
--   admin (helper)  -> Active admin_profiles members can manage most content.
--   super_admin     -> Destructive operations (deleting users, changing permissions)
--   service_role    -> Bypasses RLS (used by edge functions and the API server)
--
-- This file is idempotent: it drops all existing policies before recreating.
-- ============================================================================

-- ============================================================================
-- STEP 0: Drop ALL existing policies (clean slate)
-- ============================================================================

-- Helper to drop all policies on a table. We list them explicitly so the
-- migration is self-documenting and does not rely on dynamic SQL.

-- events
DROP POLICY IF EXISTS "anon_select_published_events"      ON public.events;
DROP POLICY IF EXISTS "authenticated_select_events"        ON public.events;
DROP POLICY IF EXISTS "authenticated_insert_events"        ON public.events;
DROP POLICY IF EXISTS "authenticated_update_events"        ON public.events;
DROP POLICY IF EXISTS "authenticated_delete_events"        ON public.events;
DROP POLICY IF EXISTS "events_select_public"               ON public.events;
DROP POLICY IF EXISTS "events_select_admin"                ON public.events;
DROP POLICY IF EXISTS "events_insert_admin"                ON public.events;
DROP POLICY IF EXISTS "events_update_admin"                ON public.events;
DROP POLICY IF EXISTS "events_delete_super_admin"          ON public.events;

-- customers (members)
DROP POLICY IF EXISTS "authenticated_select_customers"     ON public.customers;
DROP POLICY IF EXISTS "authenticated_insert_customers"     ON public.customers;
DROP POLICY IF EXISTS "authenticated_update_customers"     ON public.customers;
DROP POLICY IF EXISTS "customers_select_own"               ON public.customers;
DROP POLICY IF EXISTS "customers_select_admin"             ON public.customers;
DROP POLICY IF EXISTS "customers_insert_admin"             ON public.customers;
DROP POLICY IF EXISTS "customers_insert_self"              ON public.customers;
DROP POLICY IF EXISTS "customers_update_own"               ON public.customers;
DROP POLICY IF EXISTS "customers_update_admin"             ON public.customers;
DROP POLICY IF EXISTS "customers_delete_admin"             ON public.customers;

-- calendars
DROP POLICY IF EXISTS "anon_select_public_active_calendars" ON public.calendars;
DROP POLICY IF EXISTS "authenticated_select_calendars"      ON public.calendars;
DROP POLICY IF EXISTS "authenticated_insert_calendars"      ON public.calendars;
DROP POLICY IF EXISTS "authenticated_update_calendars"      ON public.calendars;
DROP POLICY IF EXISTS "calendars_select_public"             ON public.calendars;
DROP POLICY IF EXISTS "calendars_select_admin"              ON public.calendars;
DROP POLICY IF EXISTS "calendars_insert_admin"              ON public.calendars;
DROP POLICY IF EXISTS "calendars_update_admin"              ON public.calendars;
DROP POLICY IF EXISTS "calendars_delete_admin"              ON public.calendars;

-- calendar_events
DROP POLICY IF EXISTS "anon_select_calendar_events"             ON public.calendar_events;
DROP POLICY IF EXISTS "authenticated_select_calendar_events"    ON public.calendar_events;
DROP POLICY IF EXISTS "authenticated_insert_calendar_events"    ON public.calendar_events;
DROP POLICY IF EXISTS "authenticated_delete_calendar_events"    ON public.calendar_events;
DROP POLICY IF EXISTS "calendar_events_select_public"           ON public.calendar_events;
DROP POLICY IF EXISTS "calendar_events_select_admin"            ON public.calendar_events;
DROP POLICY IF EXISTS "calendar_events_insert_admin"            ON public.calendar_events;
DROP POLICY IF EXISTS "calendar_events_update_admin"            ON public.calendar_events;
DROP POLICY IF EXISTS "calendar_events_delete_admin"            ON public.calendar_events;

-- event_registrations
DROP POLICY IF EXISTS "authenticated_select_registrations"  ON public.event_registrations;
DROP POLICY IF EXISTS "authenticated_insert_registrations"  ON public.event_registrations;
DROP POLICY IF EXISTS "authenticated_update_registrations"  ON public.event_registrations;
DROP POLICY IF EXISTS "registrations_select_own"            ON public.event_registrations;
DROP POLICY IF EXISTS "registrations_select_admin"          ON public.event_registrations;
DROP POLICY IF EXISTS "registrations_insert_self"           ON public.event_registrations;
DROP POLICY IF EXISTS "registrations_insert_admin"          ON public.event_registrations;
DROP POLICY IF EXISTS "registrations_update_admin"          ON public.event_registrations;
DROP POLICY IF EXISTS "registrations_delete_admin"          ON public.event_registrations;

-- speakers
DROP POLICY IF EXISTS "anon_select_speakers"                ON public.speakers;
DROP POLICY IF EXISTS "authenticated_select_speakers"       ON public.speakers;
DROP POLICY IF EXISTS "authenticated_insert_speakers"       ON public.speakers;
DROP POLICY IF EXISTS "authenticated_update_speakers"       ON public.speakers;
DROP POLICY IF EXISTS "authenticated_delete_speakers"       ON public.speakers;
DROP POLICY IF EXISTS "speakers_select_public"              ON public.speakers;
DROP POLICY IF EXISTS "speakers_select_admin"               ON public.speakers;
DROP POLICY IF EXISTS "speakers_insert_admin"               ON public.speakers;
DROP POLICY IF EXISTS "speakers_update_admin"               ON public.speakers;
DROP POLICY IF EXISTS "speakers_delete_admin"               ON public.speakers;

-- event_speakers
DROP POLICY IF EXISTS "anon_select_event_speakers"              ON public.event_speakers;
DROP POLICY IF EXISTS "authenticated_select_event_speakers"     ON public.event_speakers;
DROP POLICY IF EXISTS "authenticated_insert_event_speakers"     ON public.event_speakers;
DROP POLICY IF EXISTS "authenticated_update_event_speakers"     ON public.event_speakers;
DROP POLICY IF EXISTS "authenticated_delete_event_speakers"     ON public.event_speakers;
DROP POLICY IF EXISTS "event_speakers_select_public"            ON public.event_speakers;
DROP POLICY IF EXISTS "event_speakers_select_admin"             ON public.event_speakers;
DROP POLICY IF EXISTS "event_speakers_insert_admin"             ON public.event_speakers;
DROP POLICY IF EXISTS "event_speakers_update_admin"             ON public.event_speakers;
DROP POLICY IF EXISTS "event_speakers_delete_admin"             ON public.event_speakers;

-- categories
DROP POLICY IF EXISTS "anon_select_categories"              ON public.categories;
DROP POLICY IF EXISTS "authenticated_select_categories"     ON public.categories;
DROP POLICY IF EXISTS "authenticated_insert_categories"     ON public.categories;
DROP POLICY IF EXISTS "authenticated_update_categories"     ON public.categories;
DROP POLICY IF EXISTS "authenticated_delete_categories"     ON public.categories;
DROP POLICY IF EXISTS "categories_select_public"            ON public.categories;
DROP POLICY IF EXISTS "categories_insert_admin"             ON public.categories;
DROP POLICY IF EXISTS "categories_update_admin"             ON public.categories;
DROP POLICY IF EXISTS "categories_delete_admin"             ON public.categories;

-- event_categories
DROP POLICY IF EXISTS "anon_select_event_categories"            ON public.event_categories;
DROP POLICY IF EXISTS "authenticated_select_event_categories"   ON public.event_categories;
DROP POLICY IF EXISTS "authenticated_insert_event_categories"   ON public.event_categories;
DROP POLICY IF EXISTS "authenticated_delete_event_categories"   ON public.event_categories;
DROP POLICY IF EXISTS "event_categories_select_public"          ON public.event_categories;
DROP POLICY IF EXISTS "event_categories_insert_admin"           ON public.event_categories;
DROP POLICY IF EXISTS "event_categories_update_admin"           ON public.event_categories;
DROP POLICY IF EXISTS "event_categories_delete_admin"           ON public.event_categories;

-- topics
DROP POLICY IF EXISTS "anon_select_topics"                  ON public.topics;
DROP POLICY IF EXISTS "authenticated_select_topics"         ON public.topics;
DROP POLICY IF EXISTS "authenticated_insert_topics"         ON public.topics;
DROP POLICY IF EXISTS "authenticated_update_topics"         ON public.topics;
DROP POLICY IF EXISTS "authenticated_delete_topics"         ON public.topics;
DROP POLICY IF EXISTS "topics_select_public"                ON public.topics;
DROP POLICY IF EXISTS "topics_insert_admin"                 ON public.topics;
DROP POLICY IF EXISTS "topics_update_admin"                 ON public.topics;
DROP POLICY IF EXISTS "topics_delete_admin"                 ON public.topics;

-- event_topics
DROP POLICY IF EXISTS "anon_select_event_topics"            ON public.event_topics;
DROP POLICY IF EXISTS "authenticated_select_event_topics"   ON public.event_topics;
DROP POLICY IF EXISTS "authenticated_insert_event_topics"   ON public.event_topics;
DROP POLICY IF EXISTS "authenticated_delete_event_topics"   ON public.event_topics;
DROP POLICY IF EXISTS "event_topics_select_public"          ON public.event_topics;
DROP POLICY IF EXISTS "event_topics_insert_admin"           ON public.event_topics;
DROP POLICY IF EXISTS "event_topics_update_admin"           ON public.event_topics;
DROP POLICY IF EXISTS "event_topics_delete_admin"           ON public.event_topics;

-- tags
DROP POLICY IF EXISTS "anon_select_tags"                    ON public.tags;
DROP POLICY IF EXISTS "authenticated_select_tags"           ON public.tags;
DROP POLICY IF EXISTS "authenticated_insert_tags"           ON public.tags;
DROP POLICY IF EXISTS "authenticated_update_tags"           ON public.tags;
DROP POLICY IF EXISTS "authenticated_delete_tags"           ON public.tags;
DROP POLICY IF EXISTS "tags_select_public"                  ON public.tags;
DROP POLICY IF EXISTS "tags_insert_admin"                   ON public.tags;
DROP POLICY IF EXISTS "tags_update_admin"                   ON public.tags;
DROP POLICY IF EXISTS "tags_delete_admin"                   ON public.tags;

-- event_tags
DROP POLICY IF EXISTS "anon_select_event_tags"              ON public.event_tags;
DROP POLICY IF EXISTS "authenticated_select_event_tags"     ON public.event_tags;
DROP POLICY IF EXISTS "authenticated_insert_event_tags"     ON public.event_tags;
DROP POLICY IF EXISTS "authenticated_delete_event_tags"     ON public.event_tags;
DROP POLICY IF EXISTS "event_tags_select_public"            ON public.event_tags;
DROP POLICY IF EXISTS "event_tags_insert_admin"             ON public.event_tags;
DROP POLICY IF EXISTS "event_tags_update_admin"             ON public.event_tags;
DROP POLICY IF EXISTS "event_tags_delete_admin"             ON public.event_tags;

-- admin_profiles
DROP POLICY IF EXISTS "authenticated_select_admin_profiles"  ON public.admin_profiles;
DROP POLICY IF EXISTS "super_admin_insert_admin_profiles"    ON public.admin_profiles;
DROP POLICY IF EXISTS "super_admin_update_admin_profiles"    ON public.admin_profiles;
DROP POLICY IF EXISTS "admin_profiles_select_own"            ON public.admin_profiles;
DROP POLICY IF EXISTS "admin_profiles_select_admin"          ON public.admin_profiles;
DROP POLICY IF EXISTS "admin_profiles_insert_super_admin"    ON public.admin_profiles;
DROP POLICY IF EXISTS "admin_profiles_update_super_admin"    ON public.admin_profiles;
DROP POLICY IF EXISTS "admin_profiles_delete_super_admin"    ON public.admin_profiles;

-- admin_permissions
DROP POLICY IF EXISTS "authenticated_select_own_permissions" ON public.admin_permissions;
DROP POLICY IF EXISTS "super_admin_insert_permissions"       ON public.admin_permissions;
DROP POLICY IF EXISTS "super_admin_update_permissions"       ON public.admin_permissions;
DROP POLICY IF EXISTS "super_admin_delete_permissions"       ON public.admin_permissions;
DROP POLICY IF EXISTS "admin_permissions_select_admin"       ON public.admin_permissions;
DROP POLICY IF EXISTS "admin_permissions_insert_super_admin" ON public.admin_permissions;
DROP POLICY IF EXISTS "admin_permissions_update_super_admin" ON public.admin_permissions;
DROP POLICY IF EXISTS "admin_permissions_delete_super_admin" ON public.admin_permissions;

-- admin_permission_groups
DROP POLICY IF EXISTS "authenticated_select_permission_groups"        ON public.admin_permission_groups;
DROP POLICY IF EXISTS "super_admin_insert_permission_groups"          ON public.admin_permission_groups;
DROP POLICY IF EXISTS "super_admin_update_permission_groups"          ON public.admin_permission_groups;
DROP POLICY IF EXISTS "super_admin_delete_permission_groups"          ON public.admin_permission_groups;
DROP POLICY IF EXISTS "admin_permission_groups_select_admin"          ON public.admin_permission_groups;
DROP POLICY IF EXISTS "admin_permission_groups_insert_super_admin"    ON public.admin_permission_groups;
DROP POLICY IF EXISTS "admin_permission_groups_update_super_admin"    ON public.admin_permission_groups;
DROP POLICY IF EXISTS "admin_permission_groups_delete_super_admin"    ON public.admin_permission_groups;

-- admin_permission_group_assignments
DROP POLICY IF EXISTS "authenticated_select_group_assignments"                    ON public.admin_permission_group_assignments;
DROP POLICY IF EXISTS "super_admin_insert_group_assignments"                      ON public.admin_permission_group_assignments;
DROP POLICY IF EXISTS "super_admin_delete_group_assignments"                      ON public.admin_permission_group_assignments;
DROP POLICY IF EXISTS "admin_permission_group_assignments_select_admin"           ON public.admin_permission_group_assignments;
DROP POLICY IF EXISTS "admin_permission_group_assignments_insert_super_admin"     ON public.admin_permission_group_assignments;
DROP POLICY IF EXISTS "admin_permission_group_assignments_delete_super_admin"     ON public.admin_permission_group_assignments;

-- admin_permission_audit
DROP POLICY IF EXISTS "super_admin_select_audit"             ON public.admin_permission_audit;
DROP POLICY IF EXISTS "super_admin_insert_audit"             ON public.admin_permission_audit;
DROP POLICY IF EXISTS "admin_permission_audit_select_admin"  ON public.admin_permission_audit;
DROP POLICY IF EXISTS "admin_permission_audit_insert_admin"  ON public.admin_permission_audit;
DROP POLICY IF EXISTS "admin_permission_audit_update_super_admin" ON public.admin_permission_audit;
DROP POLICY IF EXISTS "admin_permission_audit_delete_super_admin" ON public.admin_permission_audit;

-- email_templates
DROP POLICY IF EXISTS "authenticated_select_email_templates" ON public.email_templates;
DROP POLICY IF EXISTS "admin_insert_email_templates"         ON public.email_templates;
DROP POLICY IF EXISTS "admin_update_email_templates"         ON public.email_templates;
DROP POLICY IF EXISTS "email_templates_select_admin"         ON public.email_templates;
DROP POLICY IF EXISTS "email_templates_insert_admin"         ON public.email_templates;
DROP POLICY IF EXISTS "email_templates_update_admin"         ON public.email_templates;
DROP POLICY IF EXISTS "email_templates_delete_admin"         ON public.email_templates;

-- email_logs
DROP POLICY IF EXISTS "authenticated_select_email_logs"      ON public.email_logs;
DROP POLICY IF EXISTS "admin_insert_email_logs"              ON public.email_logs;
DROP POLICY IF EXISTS "email_logs_select_admin"              ON public.email_logs;
DROP POLICY IF EXISTS "email_logs_insert_admin"              ON public.email_logs;
DROP POLICY IF EXISTS "email_logs_update_super_admin"        ON public.email_logs;
DROP POLICY IF EXISTS "email_logs_delete_super_admin"        ON public.email_logs;

-- storage.objects (from 00010_storage.sql — drop old permissive policies)
DROP POLICY IF EXISTS "Public read access on event-images"       ON storage.objects;
DROP POLICY IF EXISTS "Public read access on customer-avatars"   ON storage.objects;
DROP POLICY IF EXISTS "Public read access on speaker-avatars"    ON storage.objects;
DROP POLICY IF EXISTS "Authenticated upload on event-images"     ON storage.objects;
DROP POLICY IF EXISTS "Authenticated update on event-images"     ON storage.objects;
DROP POLICY IF EXISTS "Authenticated delete on event-images"     ON storage.objects;
DROP POLICY IF EXISTS "Authenticated upload on customer-avatars" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated update on customer-avatars" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated delete on customer-avatars" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated upload on speaker-avatars"  ON storage.objects;
DROP POLICY IF EXISTS "Authenticated update on speaker-avatars"  ON storage.objects;
DROP POLICY IF EXISTS "Authenticated delete on speaker-avatars"  ON storage.objects;
-- Drop new-style storage policies too (idempotency)
DROP POLICY IF EXISTS "storage_select_event_images_public"       ON storage.objects;
DROP POLICY IF EXISTS "storage_select_customer_avatars_public"   ON storage.objects;
DROP POLICY IF EXISTS "storage_select_speaker_avatars_public"    ON storage.objects;
DROP POLICY IF EXISTS "storage_insert_event_images_admin"        ON storage.objects;
DROP POLICY IF EXISTS "storage_update_event_images_admin"        ON storage.objects;
DROP POLICY IF EXISTS "storage_delete_event_images_admin"        ON storage.objects;
DROP POLICY IF EXISTS "storage_insert_customer_avatars_admin"    ON storage.objects;
DROP POLICY IF EXISTS "storage_update_customer_avatars_admin"    ON storage.objects;
DROP POLICY IF EXISTS "storage_delete_customer_avatars_admin"    ON storage.objects;
DROP POLICY IF EXISTS "storage_insert_speaker_avatars_admin"     ON storage.objects;
DROP POLICY IF EXISTS "storage_update_speaker_avatars_admin"     ON storage.objects;
DROP POLICY IF EXISTS "storage_delete_speaker_avatars_admin"     ON storage.objects;


-- ============================================================================
-- STEP 1: Helper functions
-- ============================================================================

-- Check if the current authenticated user is an active admin (any admin role)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_profiles
    WHERE user_id = auth.uid()
    AND is_active = true
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

COMMENT ON FUNCTION public.is_admin()
  IS 'Returns true if the current user has an active admin_profiles record (any role)';

-- Check if the current authenticated user is a super_admin
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_profiles
    WHERE user_id = auth.uid()
    AND role = 'super_admin'
    AND is_active = true
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

COMMENT ON FUNCTION public.is_super_admin()
  IS 'Returns true if the current user is an active super_admin';


-- ============================================================================
-- STEP 2: Enable RLS on ALL tables
-- ============================================================================

ALTER TABLE public.admin_profiles                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events                             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.speakers                           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_speakers                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories                         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_categories                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.topics                             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_topics                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags                               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_tags                         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendars                          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_events                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers                          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_registrations                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_templates                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_logs                         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_permissions                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_permission_groups            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_permission_group_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_permission_audit             ENABLE ROW LEVEL SECURITY;


-- ============================================================================
-- STEP 3: Create policies — grouped by table
-- ============================================================================


-- **************************************************************************
-- ADMIN_PROFILES
-- Admins can see all admin profiles. Authenticated users can see their own.
-- Only super_admins can create, modify, or delete admin profiles.
-- **************************************************************************

-- Admins see all profiles; regular authenticated users see only their own
CREATE POLICY "admin_profiles_select_own"
  ON public.admin_profiles FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_admin()
  );

-- Only super_admins can create new admin profiles
CREATE POLICY "admin_profiles_insert_super_admin"
  ON public.admin_profiles FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

-- Only super_admins can update admin profiles
CREATE POLICY "admin_profiles_update_super_admin"
  ON public.admin_profiles FOR UPDATE TO authenticated
  USING (public.is_super_admin());

-- Only super_admins can delete admin profiles
CREATE POLICY "admin_profiles_delete_super_admin"
  ON public.admin_profiles FOR DELETE TO authenticated
  USING (public.is_super_admin());


-- **************************************************************************
-- EVENTS
-- anon + authenticated can read published events.
-- Admins can read all events. Admins can insert and update.
-- Only super_admins can delete.
-- **************************************************************************

-- Public visitors see only published events
CREATE POLICY "events_select_public"
  ON public.events FOR SELECT TO anon
  USING (status = 'published');

-- Authenticated non-admins see published events; admins see all
CREATE POLICY "events_select_admin"
  ON public.events FOR SELECT TO authenticated
  USING (
    status = 'published'
    OR public.is_admin()
  );

-- Only admins can create events
CREATE POLICY "events_insert_admin"
  ON public.events FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

-- Only admins can update events
CREATE POLICY "events_update_admin"
  ON public.events FOR UPDATE TO authenticated
  USING (public.is_admin());

-- Only super_admins can delete events
CREATE POLICY "events_delete_super_admin"
  ON public.events FOR DELETE TO authenticated
  USING (public.is_super_admin());


-- **************************************************************************
-- SPEAKERS
-- anon + authenticated can see speakers linked to at least one published event.
-- Admins can see all speakers. Admins can insert, update, delete.
-- **************************************************************************

-- Public visitors see speakers that have at least one published event
CREATE POLICY "speakers_select_public"
  ON public.speakers FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.event_speakers es
      JOIN public.events e ON e.id = es.event_id
      WHERE es.speaker_id = speakers.id
        AND e.status = 'published'
    )
  );

-- Authenticated non-admins see speakers with published events; admins see all
CREATE POLICY "speakers_select_admin"
  ON public.speakers FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.event_speakers es
      JOIN public.events e ON e.id = es.event_id
      WHERE es.speaker_id = speakers.id
        AND e.status = 'published'
    )
    OR public.is_admin()
  );

-- Only admins can create speakers
CREATE POLICY "speakers_insert_admin"
  ON public.speakers FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

-- Only admins can update speakers
CREATE POLICY "speakers_update_admin"
  ON public.speakers FOR UPDATE TO authenticated
  USING (public.is_admin());

-- Only admins can delete speakers
CREATE POLICY "speakers_delete_admin"
  ON public.speakers FOR DELETE TO authenticated
  USING (public.is_admin());


-- **************************************************************************
-- EVENT_SPEAKERS (junction table)
-- Follows the same visibility rules as speakers/events.
-- Only admins can manage links.
-- **************************************************************************

-- Public visitors see event_speaker rows for published events
CREATE POLICY "event_speakers_select_public"
  ON public.event_speakers FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_speakers.event_id
        AND e.status = 'published'
    )
  );

-- Authenticated users see event_speaker rows for published events; admins see all
CREATE POLICY "event_speakers_select_admin"
  ON public.event_speakers FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_speakers.event_id
        AND e.status = 'published'
    )
    OR public.is_admin()
  );

-- Only admins can insert
CREATE POLICY "event_speakers_insert_admin"
  ON public.event_speakers FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

-- Only admins can update
CREATE POLICY "event_speakers_update_admin"
  ON public.event_speakers FOR UPDATE TO authenticated
  USING (public.is_admin());

-- Only admins can delete
CREATE POLICY "event_speakers_delete_admin"
  ON public.event_speakers FOR DELETE TO authenticated
  USING (public.is_admin());


-- **************************************************************************
-- CATEGORIES (public reference data)
-- anon + authenticated can read all categories.
-- Only admins can create, update, or delete.
-- **************************************************************************

CREATE POLICY "categories_select_public"
  ON public.categories FOR SELECT
  USING (true);

CREATE POLICY "categories_insert_admin"
  ON public.categories FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "categories_update_admin"
  ON public.categories FOR UPDATE TO authenticated
  USING (public.is_admin());

CREATE POLICY "categories_delete_admin"
  ON public.categories FOR DELETE TO authenticated
  USING (public.is_admin());


-- **************************************************************************
-- EVENT_CATEGORIES (junction — public reference data)
-- anon + authenticated can read. Only admins can manage.
-- **************************************************************************

CREATE POLICY "event_categories_select_public"
  ON public.event_categories FOR SELECT
  USING (true);

CREATE POLICY "event_categories_insert_admin"
  ON public.event_categories FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "event_categories_update_admin"
  ON public.event_categories FOR UPDATE TO authenticated
  USING (public.is_admin());

CREATE POLICY "event_categories_delete_admin"
  ON public.event_categories FOR DELETE TO authenticated
  USING (public.is_admin());


-- **************************************************************************
-- TOPICS (public reference data)
-- anon + authenticated can read all topics.
-- Only admins can create, update, or delete.
-- **************************************************************************

CREATE POLICY "topics_select_public"
  ON public.topics FOR SELECT
  USING (true);

CREATE POLICY "topics_insert_admin"
  ON public.topics FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "topics_update_admin"
  ON public.topics FOR UPDATE TO authenticated
  USING (public.is_admin());

CREATE POLICY "topics_delete_admin"
  ON public.topics FOR DELETE TO authenticated
  USING (public.is_admin());


-- **************************************************************************
-- EVENT_TOPICS (junction — public reference data)
-- anon + authenticated can read. Only admins can manage.
-- **************************************************************************

CREATE POLICY "event_topics_select_public"
  ON public.event_topics FOR SELECT
  USING (true);

CREATE POLICY "event_topics_insert_admin"
  ON public.event_topics FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "event_topics_update_admin"
  ON public.event_topics FOR UPDATE TO authenticated
  USING (public.is_admin());

CREATE POLICY "event_topics_delete_admin"
  ON public.event_topics FOR DELETE TO authenticated
  USING (public.is_admin());


-- **************************************************************************
-- TAGS (public reference data)
-- anon + authenticated can read all tags.
-- Only admins can create, update, or delete.
-- **************************************************************************

CREATE POLICY "tags_select_public"
  ON public.tags FOR SELECT
  USING (true);

CREATE POLICY "tags_insert_admin"
  ON public.tags FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "tags_update_admin"
  ON public.tags FOR UPDATE TO authenticated
  USING (public.is_admin());

CREATE POLICY "tags_delete_admin"
  ON public.tags FOR DELETE TO authenticated
  USING (public.is_admin());


-- **************************************************************************
-- EVENT_TAGS (junction — public reference data)
-- anon + authenticated can read. Only admins can manage.
-- **************************************************************************

CREATE POLICY "event_tags_select_public"
  ON public.event_tags FOR SELECT
  USING (true);

CREATE POLICY "event_tags_insert_admin"
  ON public.event_tags FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "event_tags_update_admin"
  ON public.event_tags FOR UPDATE TO authenticated
  USING (public.is_admin());

CREATE POLICY "event_tags_delete_admin"
  ON public.event_tags FOR DELETE TO authenticated
  USING (public.is_admin());


-- **************************************************************************
-- CALENDARS
-- anon + authenticated can see public + active calendars.
-- Admins can see all calendars. Only admins can manage.
-- **************************************************************************

-- Public visitors see only public, active calendars
CREATE POLICY "calendars_select_public"
  ON public.calendars FOR SELECT TO anon
  USING (is_public = true AND is_active = true);

-- Authenticated non-admins see public+active calendars; admins see all
CREATE POLICY "calendars_select_admin"
  ON public.calendars FOR SELECT TO authenticated
  USING (
    (is_public = true AND is_active = true)
    OR public.is_admin()
  );

-- Only admins can create calendars
CREATE POLICY "calendars_insert_admin"
  ON public.calendars FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

-- Only admins can update calendars
CREATE POLICY "calendars_update_admin"
  ON public.calendars FOR UPDATE TO authenticated
  USING (public.is_admin());

-- Only admins can delete calendars
CREATE POLICY "calendars_delete_admin"
  ON public.calendars FOR DELETE TO authenticated
  USING (public.is_admin());


-- **************************************************************************
-- CALENDAR_EVENTS (junction table)
-- anon + authenticated can see events in public calendars.
-- Admins can see all. Only admins can manage.
-- **************************************************************************

-- Public visitors see calendar_event rows for public + active calendars
CREATE POLICY "calendar_events_select_public"
  ON public.calendar_events FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.calendars c
      WHERE c.id = calendar_events.calendar_id
        AND c.is_public = true
        AND c.is_active = true
    )
  );

-- Authenticated non-admins see rows for public calendars; admins see all
CREATE POLICY "calendar_events_select_admin"
  ON public.calendar_events FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.calendars c
      WHERE c.id = calendar_events.calendar_id
        AND c.is_public = true
        AND c.is_active = true
    )
    OR public.is_admin()
  );

-- Only admins can insert
CREATE POLICY "calendar_events_insert_admin"
  ON public.calendar_events FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

-- Only admins can update
CREATE POLICY "calendar_events_update_admin"
  ON public.calendar_events FOR UPDATE TO authenticated
  USING (public.is_admin());

-- Only admins can delete
CREATE POLICY "calendar_events_delete_admin"
  ON public.calendar_events FOR DELETE TO authenticated
  USING (public.is_admin());


-- **************************************************************************
-- CUSTOMERS (members)
-- Authenticated users can see their own record (matched by email via auth).
-- Admins can see all. Self-registration and self-update are allowed.
-- Only admins can delete.
--
-- Note: customers.email is matched against auth.jwt()->>'email' for
-- self-service access, since customers are not directly linked to auth.users
-- by user_id.
-- **************************************************************************

-- Authenticated users see their own record (by email match); admins see all
CREATE POLICY "customers_select_own"
  ON public.customers FOR SELECT TO authenticated
  USING (
    email = (auth.jwt() ->> 'email')
    OR public.is_admin()
  );

-- Admins can create customer records for anyone
CREATE POLICY "customers_insert_admin"
  ON public.customers FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

-- Self-registration: authenticated users can create their own record
CREATE POLICY "customers_insert_self"
  ON public.customers FOR INSERT TO authenticated
  WITH CHECK (email = (auth.jwt() ->> 'email'));

-- Admins can update any customer record
CREATE POLICY "customers_update_admin"
  ON public.customers FOR UPDATE TO authenticated
  USING (public.is_admin());

-- Authenticated users can update their own record
CREATE POLICY "customers_update_own"
  ON public.customers FOR UPDATE TO authenticated
  USING (email = (auth.jwt() ->> 'email'));

-- Only admins can delete customer records
CREATE POLICY "customers_delete_admin"
  ON public.customers FOR DELETE TO authenticated
  USING (public.is_admin());


-- **************************************************************************
-- EVENT_REGISTRATIONS
-- Authenticated users can see their own registrations (via customer email).
-- Admins can see all. Users can register themselves. Admins can register anyone.
-- Only admins can update or delete registrations.
-- **************************************************************************

-- Authenticated users see their own registrations; admins see all
CREATE POLICY "registrations_select_own"
  ON public.event_registrations FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = event_registrations.customer_id
        AND c.email = (auth.jwt() ->> 'email')
    )
    OR public.is_admin()
  );

-- Authenticated users can register themselves (customer must match their email)
CREATE POLICY "registrations_insert_self"
  ON public.event_registrations FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = event_registrations.customer_id
        AND c.email = (auth.jwt() ->> 'email')
    )
  );

-- Admins can register anyone
CREATE POLICY "registrations_insert_admin"
  ON public.event_registrations FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

-- Only admins can update registrations (status changes, check-ins, etc.)
CREATE POLICY "registrations_update_admin"
  ON public.event_registrations FOR UPDATE TO authenticated
  USING (public.is_admin());

-- Only admins can delete registrations
CREATE POLICY "registrations_delete_admin"
  ON public.event_registrations FOR DELETE TO authenticated
  USING (public.is_admin());


-- **************************************************************************
-- EMAIL_TEMPLATES
-- No public access. Only admins can read or manage email templates.
-- **************************************************************************

CREATE POLICY "email_templates_select_admin"
  ON public.email_templates FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "email_templates_insert_admin"
  ON public.email_templates FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "email_templates_update_admin"
  ON public.email_templates FOR UPDATE TO authenticated
  USING (public.is_admin());

CREATE POLICY "email_templates_delete_admin"
  ON public.email_templates FOR DELETE TO authenticated
  USING (public.is_admin());


-- **************************************************************************
-- EMAIL_LOGS
-- No public access. Only admins can read and insert.
-- Only super_admins can update or delete (audit trail protection).
-- **************************************************************************

CREATE POLICY "email_logs_select_admin"
  ON public.email_logs FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "email_logs_insert_admin"
  ON public.email_logs FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "email_logs_update_super_admin"
  ON public.email_logs FOR UPDATE TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "email_logs_delete_super_admin"
  ON public.email_logs FOR DELETE TO authenticated
  USING (public.is_super_admin());


-- **************************************************************************
-- ADMIN_PERMISSIONS
-- Admins can see permissions. Only super_admins can manage.
-- **************************************************************************

CREATE POLICY "admin_permissions_select_admin"
  ON public.admin_permissions FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "admin_permissions_insert_super_admin"
  ON public.admin_permissions FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY "admin_permissions_update_super_admin"
  ON public.admin_permissions FOR UPDATE TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "admin_permissions_delete_super_admin"
  ON public.admin_permissions FOR DELETE TO authenticated
  USING (public.is_super_admin());


-- **************************************************************************
-- ADMIN_PERMISSION_GROUPS
-- Admins can see groups. Only super_admins can manage.
-- **************************************************************************

CREATE POLICY "admin_permission_groups_select_admin"
  ON public.admin_permission_groups FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "admin_permission_groups_insert_super_admin"
  ON public.admin_permission_groups FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY "admin_permission_groups_update_super_admin"
  ON public.admin_permission_groups FOR UPDATE TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "admin_permission_groups_delete_super_admin"
  ON public.admin_permission_groups FOR DELETE TO authenticated
  USING (public.is_super_admin());


-- **************************************************************************
-- ADMIN_PERMISSION_GROUP_ASSIGNMENTS
-- Admins can see assignments. Only super_admins can manage.
-- **************************************************************************

CREATE POLICY "admin_permission_group_assignments_select_admin"
  ON public.admin_permission_group_assignments FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "admin_permission_group_assignments_insert_super_admin"
  ON public.admin_permission_group_assignments FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY "admin_permission_group_assignments_delete_super_admin"
  ON public.admin_permission_group_assignments FOR DELETE TO authenticated
  USING (public.is_super_admin());


-- **************************************************************************
-- ADMIN_PERMISSION_AUDIT
-- Admins can read the audit trail. Admins can insert (logging permission changes).
-- Only super_admins can update or delete (immutable audit trail).
-- **************************************************************************

CREATE POLICY "admin_permission_audit_select_admin"
  ON public.admin_permission_audit FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "admin_permission_audit_insert_admin"
  ON public.admin_permission_audit FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "admin_permission_audit_update_super_admin"
  ON public.admin_permission_audit FOR UPDATE TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "admin_permission_audit_delete_super_admin"
  ON public.admin_permission_audit FOR DELETE TO authenticated
  USING (public.is_super_admin());


-- **************************************************************************
-- STORAGE.OBJECTS
-- Public read for all image buckets (they are marked as public buckets).
-- Only admins can upload, update, or delete files in any bucket.
-- **************************************************************************

-- Public read: event-images
CREATE POLICY "storage_select_event_images_public"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'event-images');

-- Public read: customer-avatars
CREATE POLICY "storage_select_customer_avatars_public"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'customer-avatars');

-- Public read: speaker-avatars
CREATE POLICY "storage_select_speaker_avatars_public"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'speaker-avatars');

-- Admin upload: event-images
CREATE POLICY "storage_insert_event_images_admin"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'event-images' AND public.is_admin());

-- Admin update: event-images
CREATE POLICY "storage_update_event_images_admin"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'event-images' AND public.is_admin());

-- Admin delete: event-images
CREATE POLICY "storage_delete_event_images_admin"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'event-images' AND public.is_admin());

-- Admin upload: customer-avatars
CREATE POLICY "storage_insert_customer_avatars_admin"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'customer-avatars' AND public.is_admin());

-- Admin update: customer-avatars
CREATE POLICY "storage_update_customer_avatars_admin"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'customer-avatars' AND public.is_admin());

-- Admin delete: customer-avatars
CREATE POLICY "storage_delete_customer_avatars_admin"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'customer-avatars' AND public.is_admin());

-- Admin upload: speaker-avatars
CREATE POLICY "storage_insert_speaker_avatars_admin"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'speaker-avatars' AND public.is_admin());

-- Admin update: speaker-avatars
CREATE POLICY "storage_update_speaker_avatars_admin"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'speaker-avatars' AND public.is_admin());

-- Admin delete: speaker-avatars
CREATE POLICY "storage_delete_speaker_avatars_admin"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'speaker-avatars' AND public.is_admin());
