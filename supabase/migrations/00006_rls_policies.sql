-- =============================================================================
-- 00007_rls_policies.sql
-- Comprehensive RLS policies for all core tables
-- Runs after 00006_platform.sql
--
-- NOTE: Event-related RLS (events, events_registrations, events_attendance,
--       admin_event_permissions) has been moved to the core-events module
--       migration (002_events_rls_functions.sql).
-- =============================================================================

-- =============================================================================
-- STEP 0: HELPER FUNCTIONS
-- =============================================================================

-- is_admin: check if current user is an active admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_profiles
    WHERE user_id = auth.uid()
    AND is_active = true
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- is_super_admin: check if current user is a super_admin
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_profiles
    WHERE user_id = auth.uid()
    AND role = 'super_admin'
    AND is_active = true
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- can_admin_event: Stub that returns false when events module is not installed.
-- The core-events module overrides this with the full implementation.
CREATE OR REPLACE FUNCTION public.can_admin_event(p_event_uuid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT public.is_super_admin();
$$;

-- can_admin_event_by_eid: Stub — overridden by core-events module.
CREATE OR REPLACE FUNCTION public.can_admin_event_by_eid(p_event_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT public.is_super_admin();
$$;

-- is_own_people_profile: Check if a people_profile belongs to the current user
CREATE OR REPLACE FUNCTION public.is_own_people_profile(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.people_profiles pp
    JOIN public.people p ON p.id = pp.person_id
    WHERE pp.id = p_profile_id
      AND p.auth_user_id = auth.uid()
  );
$$;

-- can_admin_member: Check if current user can access a people profile.
-- Base version only checks super_admin + admin status.
-- The core-events module overrides this to also check event registrations.
CREATE OR REPLACE FUNCTION public.can_admin_member(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT public.is_admin();
$$;


-- =============================================================================
-- STEP 1: ENABLE RLS ON ALL CORE TABLES
-- =============================================================================

-- Admin tables
ALTER TABLE public.admin_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_permission_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_permission_group_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_permission_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_impersonation_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_impersonation_audit ENABLE ROW LEVEL SECURITY;

-- Account tables
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts_users ENABLE ROW LEVEL SECURITY;

-- NOTE: Event table RLS (events, events_registrations, events_attendance,
--       admin_event_permissions) is enabled by core-events module migration.

-- People tables
ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.people_profiles ENABLE ROW LEVEL SECURITY;

-- Email tables
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_logs ENABLE ROW LEVEL SECURITY;

-- Platform tables
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.installed_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.module_migrations ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- STEP 2: CREATE POLICIES
-- =============================================================================


-- -----------------------------------------------------------------------------
-- ADMIN_PROFILES
-- -----------------------------------------------------------------------------

-- Portal reads first admin email as contact fallback; only active profiles
CREATE POLICY "admin_profiles_select_anon"
  ON public.admin_profiles FOR SELECT TO anon
  USING (is_active = true);

-- Admins see all; auth users see own
CREATE POLICY "admin_profiles_select_own"
  ON public.admin_profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "admin_profiles_insert_super_admin"
  ON public.admin_profiles FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY "admin_profiles_update_super_admin"
  ON public.admin_profiles FOR UPDATE TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "admin_profiles_delete_super_admin"
  ON public.admin_profiles FOR DELETE TO authenticated
  USING (public.is_super_admin());


-- -----------------------------------------------------------------------------
-- ADMIN_PERMISSIONS
-- -----------------------------------------------------------------------------

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


-- -----------------------------------------------------------------------------
-- ADMIN_PERMISSION_GROUPS
-- -----------------------------------------------------------------------------

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


-- -----------------------------------------------------------------------------
-- ADMIN_PERMISSION_GROUP_ASSIGNMENTS
-- -----------------------------------------------------------------------------

CREATE POLICY "admin_permission_group_assignments_select_admin"
  ON public.admin_permission_group_assignments FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "admin_permission_group_assignments_insert_super_admin"
  ON public.admin_permission_group_assignments FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY "admin_permission_group_assignments_delete_super_admin"
  ON public.admin_permission_group_assignments FOR DELETE TO authenticated
  USING (public.is_super_admin());


-- -----------------------------------------------------------------------------
-- ADMIN_PERMISSION_AUDIT
-- -----------------------------------------------------------------------------

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


-- NOTE: admin_event_permissions policies are created by core-events module.


-- -----------------------------------------------------------------------------
-- ADMIN_IMPERSONATION_SESSIONS
-- -----------------------------------------------------------------------------

CREATE POLICY "admin_impersonation_sessions_select"
  ON public.admin_impersonation_sessions FOR SELECT TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "admin_impersonation_sessions_insert"
  ON public.admin_impersonation_sessions FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY "admin_impersonation_sessions_update"
  ON public.admin_impersonation_sessions FOR UPDATE TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "admin_impersonation_sessions_delete"
  ON public.admin_impersonation_sessions FOR DELETE TO authenticated
  USING (public.is_super_admin());


-- -----------------------------------------------------------------------------
-- ADMIN_IMPERSONATION_AUDIT
-- -----------------------------------------------------------------------------

CREATE POLICY "admin_impersonation_audit_select"
  ON public.admin_impersonation_audit FOR SELECT TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "admin_impersonation_audit_insert"
  ON public.admin_impersonation_audit FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());


-- -----------------------------------------------------------------------------
-- ACCOUNTS
-- -----------------------------------------------------------------------------

CREATE POLICY "accounts_select_admin"
  ON public.accounts FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "accounts_insert_super_admin"
  ON public.accounts FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY "accounts_update_super_admin"
  ON public.accounts FOR UPDATE TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "accounts_delete_super_admin"
  ON public.accounts FOR DELETE TO authenticated
  USING (public.is_super_admin());


-- -----------------------------------------------------------------------------
-- ACCOUNTS_USERS
-- -----------------------------------------------------------------------------

CREATE POLICY "accounts_users_select_admin"
  ON public.accounts_users FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "accounts_users_insert_super_admin"
  ON public.accounts_users FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY "accounts_users_update_super_admin"
  ON public.accounts_users FOR UPDATE TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "accounts_users_delete_super_admin"
  ON public.accounts_users FOR DELETE TO authenticated
  USING (public.is_super_admin());


-- NOTE: Events, events_registrations, events_attendance policies are created
-- by the core-events module migration.


-- -----------------------------------------------------------------------------
-- PEOPLE
-- -----------------------------------------------------------------------------

CREATE POLICY "people_select_own"
  ON public.people FOR SELECT TO authenticated
  USING (email = (auth.jwt() ->> 'email') OR public.is_admin());

CREATE POLICY "people_insert_admin"
  ON public.people FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "people_insert_self"
  ON public.people FOR INSERT TO authenticated
  WITH CHECK (email = (auth.jwt() ->> 'email'));

CREATE POLICY "people_update_admin"
  ON public.people FOR UPDATE TO authenticated
  USING (public.is_admin());

CREATE POLICY "people_update_own"
  ON public.people FOR UPDATE TO authenticated
  USING (email = (auth.jwt() ->> 'email'));

CREATE POLICY "people_delete_admin"
  ON public.people FOR DELETE TO authenticated
  USING (public.is_admin());


-- -----------------------------------------------------------------------------
-- PEOPLE_PROFILES (uses is_own_people_profile + can_admin_member)
-- -----------------------------------------------------------------------------

CREATE POLICY "member_profiles_select"
  ON public.people_profiles FOR SELECT TO authenticated
  USING (public.is_own_people_profile(id) OR public.can_admin_member(id));

CREATE POLICY "member_profiles_insert"
  ON public.people_profiles FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "member_profiles_update"
  ON public.people_profiles FOR UPDATE TO authenticated
  USING (public.is_own_people_profile(id) OR public.can_admin_member(id));

CREATE POLICY "member_profiles_delete"
  ON public.people_profiles FOR DELETE TO authenticated
  USING (public.is_super_admin());


-- NOTE: Badge templates, badge prints, badge print jobs, QR access tokens,
-- and contact scans RLS policies are now in the badge-scanning module.


-- -----------------------------------------------------------------------------
-- EMAIL_TEMPLATES
-- -----------------------------------------------------------------------------

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


-- -----------------------------------------------------------------------------
-- EMAIL_LOGS
-- -----------------------------------------------------------------------------

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


-- -----------------------------------------------------------------------------
-- PLATFORM_SETTINGS
-- -----------------------------------------------------------------------------

-- Anyone can read settings (needed before login for app name)
CREATE POLICY "anyone_select_platform_settings"
  ON public.platform_settings FOR SELECT
  USING (true);

CREATE POLICY "super_admin_insert_platform_settings"
  ON public.platform_settings FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY "super_admin_update_platform_settings"
  ON public.platform_settings FOR UPDATE TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "super_admin_delete_platform_settings"
  ON public.platform_settings FOR DELETE TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "admin_insert_platform_settings"
  ON public.platform_settings FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "admin_update_platform_settings"
  ON public.platform_settings FOR UPDATE TO authenticated
  USING (public.is_admin());


-- -----------------------------------------------------------------------------
-- INSTALLED_MODULES
-- -----------------------------------------------------------------------------

CREATE POLICY "installed_modules_select_anon"
  ON public.installed_modules FOR SELECT TO anon
  USING (status = 'enabled');

CREATE POLICY "authenticated_select_installed_modules"
  ON public.installed_modules FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "admin_insert_installed_modules"
  ON public.installed_modules FOR INSERT TO authenticated
  WITH CHECK (status = 'disabled' OR public.is_admin());

CREATE POLICY "admin_update_installed_modules"
  ON public.installed_modules FOR UPDATE TO authenticated
  USING (status = 'disabled' OR public.is_admin());

CREATE POLICY "admin_delete_installed_modules"
  ON public.installed_modules FOR DELETE TO authenticated
  USING (public.is_admin());

CREATE POLICY "service_role_all_installed_modules"
  ON public.installed_modules FOR ALL TO service_role
  USING (true) WITH CHECK (true);


-- -----------------------------------------------------------------------------
-- MODULE_MIGRATIONS
-- -----------------------------------------------------------------------------

CREATE POLICY "Service role full access on module_migrations"
  ON public.module_migrations FOR ALL
  USING (auth.role() = 'service_role');


-- -----------------------------------------------------------------------------
-- STORAGE.OBJECTS (media bucket)
-- -----------------------------------------------------------------------------

CREATE POLICY "storage_select_media_public"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'media');

CREATE POLICY "storage_insert_media_admin"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'media' AND public.is_admin());

CREATE POLICY "storage_update_media_admin"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'media' AND public.is_admin());

CREATE POLICY "storage_delete_media_admin"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'media' AND public.is_admin());
