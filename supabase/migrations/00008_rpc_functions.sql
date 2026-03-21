-- 00008_rpc_functions.sql
-- Core RPC functions for admin, people, events, and platform
-- Runs after 00007_rls_policies.sql
-- NOTE: Module-specific functions (scrapers, calendars, segments, cohorts,
--       newsletters, blog, etc.) are NOT included here.

--------------------------------------------------------------------------------
-- 1. admin_has_feature_permission
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_has_feature_permission(
  p_admin_id uuid,
  p_feature text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  -- Check direct permission
  IF EXISTS (
    SELECT 1
    FROM public.admin_permissions
    WHERE admin_id = p_admin_id
      AND feature = p_feature
      AND is_active = true
      AND (expires_at IS NULL OR expires_at > now())
  ) THEN
    RETURN true;
  END IF;

  -- Check group-based permission
  IF EXISTS (
    SELECT 1
    FROM public.admin_permission_group_assignments ga
    JOIN public.admin_permission_groups g ON g.id = ga.group_id
    WHERE ga.admin_id = p_admin_id
      AND p_feature = ANY(g.features)
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

COMMENT ON FUNCTION public.admin_has_feature_permission(uuid, text)
  IS 'Check whether an admin has a specific feature permission (direct or via group)';

--------------------------------------------------------------------------------
-- 2. admin_get_features
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_get_features(p_admin_id uuid)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_features text[];
BEGIN
  -- Collect direct permissions
  SELECT array_agg(DISTINCT feature)
  INTO v_features
  FROM public.admin_permissions
  WHERE admin_id = p_admin_id
    AND is_active = true
    AND (expires_at IS NULL OR expires_at > now());

  -- Merge group-based permissions
  SELECT array_cat(
    coalesce(v_features, '{}'),
    coalesce(array_agg(DISTINCT f), '{}')
  )
  INTO v_features
  FROM public.admin_permission_group_assignments ga
  JOIN public.admin_permission_groups g ON g.id = ga.group_id,
  LATERAL unnest(g.features) AS f
  WHERE ga.admin_id = p_admin_id;

  -- Deduplicate
  SELECT array_agg(DISTINCT x)
  INTO v_features
  FROM unnest(v_features) AS x;

  RETURN coalesce(v_features, '{}');
END;
$$;

COMMENT ON FUNCTION public.admin_get_features(uuid)
  IS 'Return the deduplicated array of feature slugs an admin has access to';

--------------------------------------------------------------------------------
-- 3. events_get_registration_count
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.events_get_registration_count(p_event_id uuid)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT count(*)
  FROM public.events_registrations
  WHERE event_id = p_event_id
    AND status NOT IN ('cancelled');
$$;

COMMENT ON FUNCTION public.events_get_registration_count(uuid)
  IS 'Count non-cancelled registrations for an event';

--------------------------------------------------------------------------------
-- 4. admin_verify_login
--------------------------------------------------------------------------------

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
    AND is_active = true;

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

COMMENT ON FUNCTION public.admin_verify_login(text, text)
  IS 'Verify admin credentials and return profile info on success';

--------------------------------------------------------------------------------
-- 5. admin_create_user
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_create_user(
  user_email    text,
  user_password text,
  user_name     text,
  user_role     text DEFAULT 'editor'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id  uuid;
  v_admin_id uuid;
BEGIN
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = lower(user_email);

  IF v_user_id IS NULL THEN
    v_user_id := gen_random_uuid();

    INSERT INTO auth.users (
      id, instance_id, email, encrypted_password, email_confirmed_at,
      aud, role, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token
    )
    VALUES (
      v_user_id,
      '00000000-0000-0000-0000-000000000000',
      lower(user_email),
      crypt(user_password, gen_salt('bf')),
      now(),
      'authenticated',
      'authenticated',
      jsonb_build_object('provider', 'email', 'providers', ARRAY['email']),
      jsonb_build_object('name', user_name),
      now(),
      now(),
      ''
    );

    INSERT INTO auth.identities (
      id, user_id, provider_id, provider, identity_data,
      last_sign_in_at, created_at, updated_at
    )
    VALUES (
      gen_random_uuid(),
      v_user_id,
      lower(user_email),
      'email',
      jsonb_build_object('sub', v_user_id, 'email', lower(user_email)),
      now(),
      now(),
      now()
    );
  END IF;

  INSERT INTO public.admin_profiles (user_id, email, name, role, is_active)
  VALUES (v_user_id, lower(user_email), user_name, user_role, true)
  ON CONFLICT (email) DO UPDATE SET
    user_id    = v_user_id,
    name       = COALESCE(EXCLUDED.name, admin_profiles.name),
    role       = COALESCE(EXCLUDED.role, admin_profiles.role),
    is_active  = true,
    updated_at = now()
  RETURNING id INTO v_admin_id;

  RETURN jsonb_build_object(
    'success',  true,
    'user_id',  v_user_id,
    'admin_id', v_admin_id
  );
END;
$$;

COMMENT ON FUNCTION public.admin_create_user(text, text, text, text)
  IS 'Create an auth user + admin profile (or reactivate an existing one)';

--------------------------------------------------------------------------------
-- 6. admin_update_password
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_update_password(
  user_id          uuid,
  current_password text,
  new_password     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_encrypted text;
BEGIN
  SELECT encrypted_password
  INTO v_encrypted
  FROM auth.users
  WHERE id = user_id;

  IF v_encrypted IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;

  IF NOT (v_encrypted = crypt(current_password, v_encrypted)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Current password is incorrect');
  END IF;

  UPDATE auth.users
  SET encrypted_password = crypt(new_password, gen_salt('bf')),
      updated_at         = now()
  WHERE id = admin_update_password.user_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.admin_update_password(uuid, text, text)
  IS 'Change an admin user password after verifying the current one';

--------------------------------------------------------------------------------
-- 7. admin_update_avatar
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_update_avatar(
  user_id    uuid,
  avatar_url text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.admin_profiles
  SET avatar_url = admin_update_avatar.avatar_url,
      updated_at = now()
  WHERE admin_profiles.user_id = admin_update_avatar.user_id;
END;
$$;

COMMENT ON FUNCTION public.admin_update_avatar(uuid, text)
  IS 'Set the avatar URL for an admin profile';

--------------------------------------------------------------------------------
-- 8. people_upsert_with_auth
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.people_upsert_with_auth(
  p_cio_id     text,
  p_email      text,
  p_attributes jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_person_id uuid;
BEGIN
  INSERT INTO public.people (
    cio_id, email, attributes, last_synced_at
  )
  VALUES (
    p_cio_id,
    lower(p_email),
    p_attributes,
    now()
  )
  ON CONFLICT (email) DO UPDATE SET
    cio_id       = COALESCE(EXCLUDED.cio_id, people.cio_id),
    attributes   = people.attributes || p_attributes,
    last_synced_at = now(),
    updated_at     = now()
  RETURNING id INTO v_person_id;

  RETURN v_person_id;
END;
$$;

COMMENT ON FUNCTION public.people_upsert_with_auth(text, text, jsonb)
  IS 'Insert or update a person record, merging attributes on conflict';

--------------------------------------------------------------------------------
-- 9. people_update_attributes
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.people_update_attributes(
  p_person_id    uuid,
  p_first_name   text DEFAULT NULL,
  p_last_name    text DEFAULT NULL,
  p_company      text DEFAULT NULL,
  p_job_title    text DEFAULT NULL,
  p_linkedin_url text DEFAULT NULL,
  p_phone        text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_updates jsonb := '{}'::jsonb;
BEGIN
  IF p_first_name IS NOT NULL THEN v_updates := v_updates || jsonb_build_object('first_name', p_first_name); END IF;
  IF p_last_name IS NOT NULL THEN v_updates := v_updates || jsonb_build_object('last_name', p_last_name); END IF;
  IF p_company IS NOT NULL THEN v_updates := v_updates || jsonb_build_object('company', p_company); END IF;
  IF p_job_title IS NOT NULL THEN v_updates := v_updates || jsonb_build_object('job_title', p_job_title); END IF;
  IF p_linkedin_url IS NOT NULL THEN v_updates := v_updates || jsonb_build_object('linkedin_url', p_linkedin_url); END IF;

  UPDATE public.people
  SET
    attributes = CASE WHEN v_updates != '{}'::jsonb THEN attributes || v_updates ELSE attributes END,
    phone      = COALESCE(p_phone, phone),
    updated_at = now()
  WHERE id = p_person_id;
END;
$$;

COMMENT ON FUNCTION public.people_update_attributes(uuid, text, text, text, text, text, text)
  IS 'Selectively update person attributes in JSONB (NULL parameters are skipped)';

--------------------------------------------------------------------------------
-- 10. people_update_avatar
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.people_update_avatar(
  p_person_id    uuid,
  p_avatar_source text,
  p_storage_path text DEFAULT NULL,
  p_linkedin_url text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.people
  SET
    avatar_source       = p_avatar_source,
    avatar_storage_path = COALESCE(p_storage_path, avatar_storage_path),
    linkedin_avatar_url = COALESCE(p_linkedin_url, linkedin_avatar_url),
    avatar_url = CASE
      WHEN p_avatar_source = 'uploaded' AND p_storage_path IS NOT NULL THEN p_storage_path
      WHEN p_avatar_source = 'linkedin' AND p_linkedin_url IS NOT NULL THEN p_linkedin_url
      ELSE avatar_url
    END,
    avatar_updated_at = now(),
    updated_at        = now()
  WHERE id = p_person_id;
END;
$$;

COMMENT ON FUNCTION public.people_update_avatar(uuid, text, text, text)
  IS 'Update avatar for a person based on the chosen source (uploaded / linkedin)';

--------------------------------------------------------------------------------
-- 11. people_clear_avatar
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.people_clear_avatar(p_person_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.people
  SET
    avatar_url          = NULL,
    avatar_source       = NULL,
    avatar_storage_path = NULL,
    avatar_updated_at   = now(),
    updated_at          = now()
  WHERE id = p_person_id;
END;
$$;

COMMENT ON FUNCTION public.people_clear_avatar(uuid)
  IS 'Remove all avatar data for a person';

--------------------------------------------------------------------------------
-- 12. people_update_gravatar_status
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.people_update_gravatar_status(
  p_person_id   uuid,
  p_has_gravatar boolean
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE public.people
  SET has_gravatar = p_has_gravatar,
      updated_at   = now()
  WHERE id = p_person_id;
$$;

COMMENT ON FUNCTION public.people_update_gravatar_status(uuid, boolean)
  IS 'Record whether a person has a Gravatar';

--------------------------------------------------------------------------------
-- 13. people_get_authenticated_sorted
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.people_get_authenticated_sorted(
  p_offset      integer DEFAULT 0,
  p_limit       integer DEFAULT 50,
  p_sort_by     text    DEFAULT 'created_at',
  p_sort_order  text    DEFAULT 'desc',
  p_search_term text    DEFAULT NULL
)
RETURNS TABLE(
  id                  uuid,
  email               text,
  phone               text,
  avatar_url          text,
  cio_id              text,
  attributes          jsonb,
  attribute_timestamps jsonb,
  auth_user_id        uuid,
  has_gravatar        boolean,
  avatar_source       text,
  avatar_storage_path text,
  avatar_updated_at   timestamptz,
  linkedin_avatar_url text,
  is_guest            boolean,
  last_synced_at      timestamptz,
  created_at          timestamptz,
  updated_at          timestamptz,
  total_count         bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_sort_expr text;
  v_order text;
  v_search text;
BEGIN
  v_order := CASE WHEN upper(p_sort_order) = 'ASC' THEN 'ASC' ELSE 'DESC' END;
  v_search := CASE WHEN p_search_term IS NOT NULL AND p_search_term <> ''
                   THEN '%' || p_search_term || '%'
                   ELSE NULL END;

  -- Map sort columns: top-level columns use %I, JSONB fields use ->> expression
  v_sort_expr := CASE
    WHEN p_sort_by IN ('email', 'created_at', 'updated_at', 'created') THEN
      CASE WHEN p_sort_by = 'created' THEN format('%I', 'created_at')
           ELSE format('%I', p_sort_by) END
    WHEN p_sort_by = 'full_name' THEN $f$COALESCE(c.attributes->>'first_name', '') || ' ' || COALESCE(c.attributes->>'last_name', '')$f$
    WHEN p_sort_by = 'company' THEN $f$c.attributes->>'company'$f$
    ELSE format('%I', 'created_at')
  END;

  RETURN QUERY EXECUTE format(
    'SELECT c.id, c.email, c.phone, c.avatar_url, c.cio_id,
            c.attributes, c.attribute_timestamps, c.auth_user_id,
            c.has_gravatar, c.avatar_source, c.avatar_storage_path,
            c.avatar_updated_at, c.linkedin_avatar_url, c.is_guest,
            c.last_synced_at, c.created_at, c.updated_at,
            COUNT(*) OVER() AS total_count
     FROM public.people c
     WHERE c.auth_user_id IS NOT NULL
       AND ($1::text IS NULL
            OR c.email ILIKE $1
            OR (COALESCE(c.attributes->>''first_name'', '''') || '' '' || COALESCE(c.attributes->>''last_name'', '''')) ILIKE $1
            OR COALESCE(c.attributes->>''company'', '''') ILIKE $1)
     ORDER BY %s %s
     LIMIT $2 OFFSET $3',
    v_sort_expr,
    v_order
  )
  USING v_search, p_limit, p_offset;
END;
$$;

COMMENT ON FUNCTION public.people_get_authenticated_sorted(integer, integer, text, text, text)
  IS 'Paginated, sortable, searchable listing of authenticated people with total count';

--------------------------------------------------------------------------------
-- 14. people_count_with_linkedin
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.people_count_with_linkedin()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COUNT(*)
  FROM public.people
  WHERE auth_user_id IS NOT NULL
    AND attributes->>'linkedin_url' IS NOT NULL
    AND attributes->>'linkedin_url' <> '';
$$;

COMMENT ON FUNCTION public.people_count_with_linkedin()
  IS 'Count authenticated people who have a LinkedIn URL (in attributes)';

--------------------------------------------------------------------------------
-- 15. admin_get_auth_user_id_by_email
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_get_auth_user_id_by_email(p_email text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT id FROM auth.users WHERE email = lower(p_email) LIMIT 1;
$$;

COMMENT ON FUNCTION public.admin_get_auth_user_id_by_email(text)
  IS 'Look up an auth.users id by email address';

--------------------------------------------------------------------------------
-- 16. events_get_registration_stats
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.events_get_registration_stats(p_event_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'total',      COUNT(*)::int,
    'confirmed',  COUNT(*) FILTER (WHERE r.status = 'confirmed')::int,
    'pending',    COUNT(*) FILTER (WHERE r.status = 'pending')::int,
    'cancelled',  COUNT(*) FILTER (WHERE r.status = 'cancelled')::int,
    'waitlisted', COUNT(*) FILTER (WHERE r.status = 'waitlisted')::int,
    'checked_in', COUNT(*) FILTER (WHERE r.checked_in = true)::int
  )
  FROM public.events_registrations r
  JOIN public.events e ON e.id = r.event_id
  WHERE e.event_id = p_event_id;
$$;

COMMENT ON FUNCTION public.events_get_registration_stats(text)
  IS 'Aggregate registration status breakdown for an event';

--------------------------------------------------------------------------------
-- 17. events_get_attendance_stats
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.events_get_attendance_stats(p_event_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'total',      COUNT(*)::int,
    'checked_in', COUNT(*) FILTER (WHERE checked_in_at IS NOT NULL)::int
  )
  FROM public.events_attendance a
  JOIN public.events e ON e.id = a.event_id
  WHERE e.event_id = p_event_id;
$$;

COMMENT ON FUNCTION public.events_get_attendance_stats(text)
  IS 'Aggregate attendance stats (check-ins) for an event';

-- NOTE: events_get_sponsor_scan_stats has been moved to the badge-scanning module.

--------------------------------------------------------------------------------
-- 18. email_increment_template_usage
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.email_increment_template_usage(template_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE public.email_templates
  SET usage_count  = COALESCE(usage_count, 0) + 1,
      last_used_at = now(),
      updated_at   = now()
  WHERE id = template_id;
$$;

COMMENT ON FUNCTION public.email_increment_template_usage(uuid)
  IS 'Bump the usage counter and last-used timestamp on an email template';

--------------------------------------------------------------------------------
-- 20. increment (generic helper)
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.increment(x integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT x + 1;
$$;

COMMENT ON FUNCTION public.increment(integer)
  IS 'Generic helper: return x + 1';

--------------------------------------------------------------------------------
-- 21. people_get_or_create_profile
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.people_get_or_create_profile(p_person_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_profile_id uuid;
  v_qr_code_id varchar(12);
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  i integer;
BEGIN
  SELECT id INTO v_profile_id
  FROM public.people_profiles
  WHERE person_id = p_person_id;

  IF v_profile_id IS NOT NULL THEN
    RETURN v_profile_id;
  END IF;

  LOOP
    v_qr_code_id := '';
    FOR i IN 1..12 LOOP
      v_qr_code_id := v_qr_code_id || substr(chars, floor(random() * length(chars) + 1)::int, 1);
    END LOOP;

    BEGIN
      INSERT INTO public.people_profiles (person_id, qr_code_id)
      VALUES (p_person_id, v_qr_code_id)
      RETURNING id INTO v_profile_id;

      RETURN v_profile_id;
    EXCEPTION WHEN unique_violation THEN
      CONTINUE;
    END;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.people_get_or_create_profile(uuid)
  IS 'Get or create a people profile with a unique QR code';

--------------------------------------------------------------------------------
-- 22. admin_is_team_member
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_is_team_member(team_slug_param text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.accounts_users au
    JOIN public.admin_profiles ap ON ap.id = au.admin_profile_id
    JOIN public.accounts a ON a.id = au.account_id
    WHERE ap.user_id = auth.uid()
      AND a.slug = team_slug_param
      AND au.is_active = true
      AND ap.is_active = true
  );
$$;

COMMENT ON FUNCTION public.admin_is_team_member(text)
  IS 'Check whether the current auth user belongs to a team by slug';

--------------------------------------------------------------------------------
-- 23. admin_get_user_teams
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_get_user_teams()
RETURNS TABLE(
  account_id   uuid,
  account_name text,
  account_slug text,
  role         text,
  logo_url     text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    a.id,
    a.name::text,
    a.slug::text,
    au.role::text,
    a.logo_url
  FROM public.accounts_users au
  JOIN public.admin_profiles ap ON ap.id = au.admin_profile_id
  JOIN public.accounts a ON a.id = au.account_id
  WHERE ap.user_id = auth.uid()
    AND au.is_active = true
    AND ap.is_active = true
    AND a.is_active = true
  ORDER BY a.name;
$$;

COMMENT ON FUNCTION public.admin_get_user_teams()
  IS 'List all active teams the current auth user belongs to';

--------------------------------------------------------------------------------
-- 24. admin_has_event_permission
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_has_event_permission(
  event_id_param   text,
  permission_param text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_admin_id uuid;
  v_role     text;
BEGIN
  SELECT ap.id, ap.role
  INTO v_admin_id, v_role
  FROM public.admin_profiles ap
  WHERE ap.user_id = auth.uid()
    AND ap.is_active = true;

  IF v_admin_id IS NULL THEN
    RETURN false;
  END IF;

  -- Super admins have all event permissions
  IF v_role = 'super_admin' THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.admin_event_permissions
    WHERE admin_id = v_admin_id
      AND event_id = event_id_param
      AND is_active = true
      AND (expires_at IS NULL OR expires_at > now())
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

COMMENT ON FUNCTION public.admin_has_event_permission(text, text)
  IS 'Check whether the current user has a specific permission for an event';

--------------------------------------------------------------------------------
-- 25. admin_get_events_permissions
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_get_events_permissions(
  event_ids            text[],
  permissions_to_check text[]
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_result      jsonb := '{}'::jsonb;
  v_event_id    text;
  v_perm        text;
  v_event_perms jsonb;
BEGIN
  FOREACH v_event_id IN ARRAY event_ids LOOP
    v_event_perms := '{}'::jsonb;
    FOREACH v_perm IN ARRAY permissions_to_check LOOP
      v_event_perms := v_event_perms || jsonb_build_object(
        v_perm,
        public.admin_has_event_permission(v_event_id, v_perm)
      );
    END LOOP;
    v_result := v_result || jsonb_build_object(v_event_id, v_event_perms);
  END LOOP;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.admin_get_events_permissions(text[], text[])
  IS 'Batch-check permissions across multiple events for the current user';

--------------------------------------------------------------------------------
-- 26. admin_get_my_assigned_events
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_get_my_assigned_events()
RETURNS TABLE(
  event_id          text,
  event_title       text,
  event_start       timestamptz,
  permission_source text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_admin_id uuid;
  v_role     text;
BEGIN
  SELECT ap.id, ap.role
  INTO v_admin_id, v_role
  FROM public.admin_profiles ap
  WHERE ap.user_id = auth.uid()
    AND ap.is_active = true;

  IF v_admin_id IS NULL THEN
    RETURN;
  END IF;

  -- Super admins see every event
  IF v_role = 'super_admin' THEN
    RETURN QUERY
      SELECT e.event_id, e.event_title::text, e.event_start, 'super_admin'::text
      FROM public.events e
      ORDER BY e.event_start DESC NULLS LAST;
    RETURN;
  END IF;

  -- Other admins see only directly assigned events
  RETURN QUERY
    SELECT DISTINCT ON (e.event_id)
      e.event_id,
      e.event_title::text,
      e.event_start,
      'direct'::text
    FROM public.events e
    JOIN public.admin_event_permissions aep ON aep.event_id = e.event_id
    WHERE aep.admin_id = v_admin_id
      AND aep.is_active = true
      AND (aep.expires_at IS NULL OR aep.expires_at > now())
    ORDER BY e.event_id, e.event_start DESC NULLS LAST;
END;
$$;

COMMENT ON FUNCTION public.admin_get_my_assigned_events()
  IS 'List events the current admin has been assigned to (super_admins see all)';

--------------------------------------------------------------------------------
-- 27. accounts_get_members
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.accounts_get_members(account_uuid uuid)
RETURNS TABLE(
  id               uuid,
  admin_profile_id uuid,
  email            text,
  name             text,
  role             text,
  avatar_url       text,
  is_active        boolean,
  joined_at        timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    au.id,
    au.admin_profile_id,
    ap.email,
    ap.name,
    au.role::text,
    ap.avatar_url,
    au.is_active,
    au.created_at
  FROM public.accounts_users au
  JOIN public.admin_profiles ap ON ap.id = au.admin_profile_id
  WHERE au.account_id = account_uuid
  ORDER BY au.role, ap.name;
$$;

COMMENT ON FUNCTION public.accounts_get_members(uuid)
  IS 'List all members of an account/team with their profiles';

--------------------------------------------------------------------------------
-- 28. exec_sql — Used by the module migration runner
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.exec_sql(sql_text text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  EXECUTE sql_text;
END;
$$;

COMMENT ON FUNCTION public.exec_sql(text)
  IS 'Execute arbitrary SQL — used by the module migration runner. Access restricted by RLS + service_role.';

-- Only service_role should be able to call this
REVOKE ALL ON FUNCTION public.exec_sql(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.exec_sql(text) FROM anon;
REVOKE ALL ON FUNCTION public.exec_sql(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.exec_sql(text) TO service_role;

-- NOTE: Discount-related RPC functions (events_check_user_existing_code,
-- events_get_available_codes_count) are created by the discounts module migration.
