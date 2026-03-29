-- =============================================================================
-- 00010_module_sources.sql
-- Stores module source directories (local paths, git repos, uploaded zips)
-- that are configurable from the admin UI.
-- =============================================================================

CREATE TABLE public.module_sources (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  url         text        NOT NULL,
  path        text,
  branch      text,
  label       text,
  origin      text        NOT NULL DEFAULT 'user',  -- 'config', 'user', 'upload'
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS module_sources_url_path_unique
  ON public.module_sources (url, COALESCE(path, ''));

-- RLS
ALTER TABLE public.module_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_select_module_sources"
  ON public.module_sources FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "super_admin_insert_module_sources"
  ON public.module_sources FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY "super_admin_update_module_sources"
  ON public.module_sources FOR UPDATE TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "super_admin_delete_module_sources"
  ON public.module_sources FOR DELETE TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "service_role_all_module_sources"
  ON public.module_sources FOR ALL TO service_role
  USING (true) WITH CHECK (true);
