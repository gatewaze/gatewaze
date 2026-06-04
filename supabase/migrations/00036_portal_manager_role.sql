-- ============================================================================
-- 00036_portal_manager_role
-- ============================================================================
-- Portal RBAC foundation (spec-portal-workspace-shell.md §5, §10.1, §13.2a).
--
-- Adds a low-privilege `portal_manager` role so portal members can be granted
-- module management (blog author, newsletter author, ambassador-program admin,
-- event organizer) from inside the PORTAL while reusing the existing
-- admin_permissions model — WITHOUT becoming admin-SPA users.
--
-- CRITICAL (§13.2a): `is_admin()` currently returns true for ANY active
-- admin_profiles row regardless of role. Introducing `portal_manager` without
-- changing it would let a portal manager pass every is_admin()-gated RLS policy
-- across all modules (broad privilege escalation). This migration tightens
-- is_admin() to exclude portal_manager. The change is backward-compatible:
-- before this role existed every row was super_admin/admin/editor, so is_admin()
-- behavior is unchanged for all existing users.
--
-- The feature-resolution RPCs (admin_get_features, admin_has_feature_permission,
-- 00033/00034) resolve the profile by user_id/id + is_active WITHOUT role
-- filtering, so they already include portal_manager's explicit grants — exactly
-- the §13.2a corollary (implicit admin power excluded; explicit grants included).
-- is_super_admin() already filters role='super_admin'. No change needed there.
--
-- Additive + idempotent. Apply via the approved exec_sql path; record in
-- migration tracking. Do NOT run host `pnpm modules:migrate`.
-- ============================================================================

-- 1. Allow the new role -------------------------------------------------------
ALTER TABLE public.admin_profiles DROP CONSTRAINT IF EXISTS admin_profiles_role_check;
ALTER TABLE public.admin_profiles
  ADD CONSTRAINT admin_profiles_role_check
  CHECK (role IN ('super_admin', 'admin', 'editor', 'portal_manager'));

-- 2. Tighten is_admin() to exclude portal_manager (§13.2a) --------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_profiles
    WHERE user_id = auth.uid()
      AND is_active = true
      AND role IN ('super_admin', 'admin', 'editor')
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 3. Exclude portal_manager from admin-SPA password login ---------------------
-- (Portal managers authenticate via magic-link on the portal, never the admin SPA.)
CREATE OR REPLACE FUNCTION public.admin_verify_login(
  user_email text,
  user_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id            uuid;
  v_encrypted_password text;
  v_admin              admin_profiles%ROWTYPE;
BEGIN
  SELECT id, encrypted_password
  INTO v_user_id, v_encrypted_password
  FROM auth.users
  WHERE email = lower(user_email);

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid credentials');
  END IF;

  IF v_encrypted_password IS NULL
     OR NOT (v_encrypted_password = crypt(user_password, v_encrypted_password))
  THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid credentials');
  END IF;

  SELECT *
  INTO v_admin
  FROM public.admin_profiles
  WHERE user_id = v_user_id
    AND is_active = true
    AND role IN ('super_admin', 'admin', 'editor');  -- portal_manager excluded (§13.2a)

  IF v_admin.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not an admin user');
  END IF;

  RETURN jsonb_build_object(
    'success',    true,
    'admin_id',   v_admin.id,
    'email',      v_admin.email,
    'name',       v_admin.name,
    'role',       v_admin.role,
    'avatar_url', v_admin.avatar_url
  );
END;
$$;

-- 4. Promotion RPC: mint/activate a portal_manager profile (hardened, §10.1.1) -
CREATE OR REPLACE FUNCTION public.portal_promote_to_manager(
  p_user_id uuid,
  p_email text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''   -- hardened; all objects fully schema-qualified
AS $$
DECLARE
  v_id              uuid;
  v_existing        public.admin_profiles%ROWTYPE;
  v_actor_admin_id  uuid;
  v_actor_role      text;
  v_email           text := lower(btrim(p_email));   -- normalize: trim + lowercase
BEGIN
  -- basic email shape check (reject malformed input)
  IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'invalid_email';
  END IF;

  -- identity integrity: the auth user must exist AND its email must match,
  -- so a caller cannot link an arbitrary user_id to another email's profile.
  IF NOT EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id = p_user_id AND lower(btrim(u.email)) = v_email
  ) THEN
    RAISE EXCEPTION 'user_email_mismatch';
  END IF;

  -- authorize the actor: super_admin, OR an active admin/editor holding the
  -- `permissions` feature. A portal_manager may NEVER provision (final boundary).
  SELECT id, role INTO v_actor_admin_id, v_actor_role
  FROM public.admin_profiles
  WHERE user_id = auth.uid() AND is_active = true;

  IF v_actor_admin_id IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege';
  END IF;
  IF NOT public.is_super_admin()
     AND NOT (v_actor_role IN ('admin', 'editor')
              AND public.admin_has_feature_permission(v_actor_admin_id, 'permissions', NULL))
  THEN
    RAISE EXCEPTION 'insufficient_privilege';
  END IF;

  -- data-integrity preflight: legacy duplicate-email rows make the target ambiguous.
  IF (SELECT count(*) FROM public.admin_profiles WHERE lower(btrim(email)) = v_email) > 1 THEN
    RAISE EXCEPTION 'duplicate_email_profiles';
  END IF;

  SELECT * INTO v_existing
  FROM public.admin_profiles
  WHERE lower(btrim(email)) = v_email
  LIMIT 1;

  IF FOUND THEN
    IF v_existing.user_id IS NOT NULL AND v_existing.user_id <> p_user_id THEN
      RAISE EXCEPTION 'email_already_linked_to_different_user';
    END IF;
    -- Never silently touch an existing higher-role profile; manage real admins in the SPA.
    IF v_existing.role <> 'portal_manager' THEN
      RAISE EXCEPTION 'profile_exists_with_higher_role';
    END IF;

    UPDATE public.admin_profiles
    SET user_id    = COALESCE(user_id, p_user_id),
        is_active  = true,
        updated_at = now()
    WHERE id = v_existing.id
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.admin_profiles (user_id, email, role, is_active)
    VALUES (p_user_id, v_email, 'portal_manager', true)
    RETURNING id INTO v_id;
  END IF;

  -- audit every successful promotion (reuse existing audit conventions).
  INSERT INTO public.admin_permission_audit (admin_id, action, feature, performed_by, metadata)
  VALUES (v_id, 'granted', NULL, v_actor_admin_id,
          jsonb_build_object('event', 'promoted_to_portal_manager', 'email', v_email));

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_promote_to_manager(uuid, text)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
