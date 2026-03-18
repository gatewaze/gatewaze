-- ============================================================================
-- Migration: 00013_rpc_functions
-- Description: RPC helper functions exposed via PostgREST
-- ============================================================================

-- ==========================================================================
-- has_feature_permission
-- Returns true if the admin has the given feature — either directly
-- or via a permission group.
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.has_feature_permission(
  p_admin_id uuid,
  p_feature  text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  -- Check direct permission
  IF EXISTS (
    SELECT 1 FROM public.admin_permissions
    WHERE admin_id  = p_admin_id
      AND feature   = p_feature
      AND is_active = true
      AND (expires_at IS NULL OR expires_at > now())
  ) THEN
    RETURN true;
  END IF;

  -- Check via permission groups
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

COMMENT ON FUNCTION public.has_feature_permission(uuid, text)
  IS 'Check whether an admin has a specific feature permission (direct or via group)';

-- ==========================================================================
-- get_admin_features
-- Returns the complete list of features available to the admin.
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.get_admin_features(
  p_admin_id uuid
)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_features text[];
BEGIN
  -- Direct permissions
  SELECT array_agg(DISTINCT feature) INTO v_features
  FROM public.admin_permissions
  WHERE admin_id  = p_admin_id
    AND is_active = true
    AND (expires_at IS NULL OR expires_at > now());

  -- Group permissions
  SELECT array_cat(
    coalesce(v_features, '{}'),
    coalesce(array_agg(DISTINCT f), '{}')
  ) INTO v_features
  FROM public.admin_permission_group_assignments ga
  JOIN public.admin_permission_groups g ON g.id = ga.group_id,
  LATERAL unnest(g.features) AS f
  WHERE ga.admin_id = p_admin_id;

  -- Deduplicate
  SELECT array_agg(DISTINCT x) INTO v_features
  FROM unnest(v_features) AS x;

  RETURN coalesce(v_features, '{}');
END;
$$;

COMMENT ON FUNCTION public.get_admin_features(uuid)
  IS 'Return all feature keys available to the given admin (direct + group)';

-- ==========================================================================
-- get_event_registration_count
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.get_event_registration_count(
  p_event_id uuid
)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT count(*)
  FROM public.event_registrations
  WHERE event_id = p_event_id
    AND status NOT IN ('cancelled');
$$;

COMMENT ON FUNCTION public.get_event_registration_count(uuid)
  IS 'Count active (non-cancelled) registrations for an event';

-- ==========================================================================
-- get_calendar_event_count
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.get_calendar_event_count(
  p_calendar_id uuid
)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT count(*)
  FROM public.calendar_events
  WHERE calendar_id = p_calendar_id;
$$;

COMMENT ON FUNCTION public.get_calendar_event_count(uuid)
  IS 'Count the number of events in a calendar';
