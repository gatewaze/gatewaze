-- ============================================================================
-- 00037_admin_newsletter_permissions
-- ============================================================================
-- Row-level newsletter grants for portal RBAC (spec-portal-workspace-shell.md §10.3):
-- a newsletter author is scoped to one or more collections (a "newsletter" =
-- public.newsletters_template_collections row). Mirrors the events row-grant
-- precedent (admin_event_permissions / can_admin_event).
--
-- The `newsletters` FEATURE grant says "see the newsletters surface"; this ROW
-- grant narrows WHICH collections are editable. can_admin_newsletter is the
-- authoritative data gate (used by RLS); the feature grant is navigation only
-- (spec §9.3a). RLS row functions are intentionally row-only (no feature check),
-- consistent with can_admin_event — revoke feature + rows together via groups.
--
-- NOTE: this belongs to the newsletters MODULE's migration list; it lives in core
-- for the localhost rollout, but it depends on a module-owned table
-- (public.newsletters_template_collections). Platform-only migration applies
-- (e.g. `supabase test db` in CI, or a fresh env before the newsletters module is
-- installed) don't have that table, so the whole thing is GATED on its presence:
-- when the module isn't installed this migration is a no-op, and it runs verbatim
-- once the module's table exists. Additive + idempotent either way.
-- ============================================================================

DO $mig$
BEGIN
  IF to_regclass('public.newsletters_template_collections') IS NULL THEN
    RAISE NOTICE '00037: newsletters module not installed (newsletters_template_collections absent) — skipping admin newsletter permissions.';
    RETURN;
  END IF;

  EXECUTE $ddl$
    CREATE TABLE IF NOT EXISTS public.admin_newsletter_permissions (
      id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      admin_id         uuid NOT NULL REFERENCES public.admin_profiles(id) ON DELETE CASCADE,
      collection_id    uuid NOT NULL REFERENCES public.newsletters_template_collections(id) ON DELETE CASCADE,
      permission_level text NOT NULL DEFAULT 'edit'
        CHECK (permission_level IN ('view', 'edit', 'manage')),
      granted_by       uuid REFERENCES public.admin_profiles(id),
      granted_at       timestamptz NOT NULL DEFAULT now(),
      expires_at       timestamptz,
      is_active        boolean NOT NULL DEFAULT true,
      created_at       timestamptz NOT NULL DEFAULT now(),
      updated_at       timestamptz NOT NULL DEFAULT now(),
      UNIQUE (admin_id, collection_id)
    )
  $ddl$;

  EXECUTE $ddl$
    CREATE INDEX IF NOT EXISTS idx_anp_admin
      ON public.admin_newsletter_permissions(admin_id) WHERE is_active
  $ddl$;
  EXECUTE $ddl$
    CREATE INDEX IF NOT EXISTS idx_anp_collection
      ON public.admin_newsletter_permissions(collection_id) WHERE is_active
  $ddl$;

  -- Lock the grant table down: RLS ON (not FORCE — the SECURITY DEFINER lookups
  -- below run as the table owner and must read it reliably; FORCE would subject
  -- them to the super-admin-only policy and silently deny legitimate managers, §10.3).
  EXECUTE $ddl$ ALTER TABLE public.admin_newsletter_permissions ENABLE ROW LEVEL SECURITY $ddl$;
  EXECUTE $ddl$ REVOKE ALL ON public.admin_newsletter_permissions FROM anon, authenticated $ddl$;
  EXECUTE $ddl$ DROP POLICY IF EXISTS anp_super_admin_read ON public.admin_newsletter_permissions $ddl$;
  EXECUTE $ddl$
    CREATE POLICY anp_super_admin_read ON public.admin_newsletter_permissions
      FOR SELECT USING (public.is_super_admin())
  $ddl$;

  -- Authoritative data gate (RLS). Row-only by design (see header).
  EXECUTE $ddl$
    CREATE OR REPLACE FUNCTION public.can_admin_newsletter(
      p_collection_id uuid,
      p_min_level text DEFAULT 'edit'
    )
    RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
    AS $fn$
      SELECT public.is_super_admin()
        OR EXISTS (
          SELECT 1
          FROM public.admin_newsletter_permissions anp
          JOIN public.admin_profiles ap ON ap.id = anp.admin_id
          WHERE anp.collection_id = p_collection_id
            AND ap.user_id = auth.uid()
            AND ap.is_active
            AND anp.is_active
            AND (anp.expires_at IS NULL OR anp.expires_at > now())
            AND (
              p_min_level = 'view'
              OR (p_min_level = 'edit'   AND anp.permission_level IN ('edit', 'manage'))
              OR (p_min_level = 'manage' AND anp.permission_level = 'manage')
            )
        );
    $fn$
  $ddl$;

  -- Scope lister for the portal resolver (admin_get_my_newsletters).
  EXECUTE $ddl$
    CREATE OR REPLACE FUNCTION public.admin_get_my_newsletters()
    RETURNS TABLE (
      collection_id uuid,
      name text,
      permission_level text,
      permission_source text
    )
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
    AS $fn$
      SELECT c.id, c.name, 'manage'::text, 'super_admin'::text
      FROM public.newsletters_template_collections c
      WHERE public.is_super_admin()
      UNION
      SELECT c.id, c.name, anp.permission_level, 'direct'::text
      FROM public.newsletters_template_collections c
      JOIN public.admin_newsletter_permissions anp ON anp.collection_id = c.id
      JOIN public.admin_profiles ap ON ap.id = anp.admin_id
      WHERE NOT public.is_super_admin()
        AND ap.user_id = auth.uid()
        AND ap.is_active
        AND anp.is_active
        AND (anp.expires_at IS NULL OR anp.expires_at > now());
    $fn$
  $ddl$;

  EXECUTE $ddl$ GRANT EXECUTE ON FUNCTION public.can_admin_newsletter(uuid, text) TO anon, authenticated, service_role $ddl$;
  EXECUTE $ddl$ GRANT EXECUTE ON FUNCTION public.admin_get_my_newsletters() TO anon, authenticated, service_role $ddl$;
END
$mig$;

NOTIFY pgrst, 'reload schema';
