-- Module Namespacing & Contribution Points — Phase 0 (identity) + Phase 1 (reservations).
-- spec: gatewaze-environments/specs/spec-module-namespacing-contribution-points.md
--
-- Additive + behavior-neutral: every currently-installed module is grandfathered
-- (its bare id stays the resolved identity). New/duplicate installs are scoped by
-- the loader. `installed_modules.id` remains the immutable PK + sole FK target;
-- `resolved_id` is the mutable display/route/capability identity.

-- ---------------------------------------------------------------------------
-- Phase 0: identity columns on installed_modules
-- ---------------------------------------------------------------------------
ALTER TABLE public.installed_modules
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS qualified_id text,
  ADD COLUMN IF NOT EXISTS resolved_id text;

-- Grandfather backfill: slug = id, and both qualified/resolved default to the
-- bare id. The loader overwrites qualified_id with the true `<source>/<slug>`
-- on the next reconcile; resolved_id stays bare because every current name is
-- reserved (seeded in Phase 1 below, by the loader).
UPDATE public.installed_modules
   SET slug         = COALESCE(slug, id),
       qualified_id = COALESCE(qualified_id, id),
       resolved_id  = COALESCE(resolved_id, id)
 WHERE slug IS NULL OR qualified_id IS NULL OR resolved_id IS NULL;

-- Globally unique once populated. Partial (WHERE NOT NULL) so a row mid-reconcile
-- can never trip the constraint, and so these are valid ON CONFLICT targets.
CREATE UNIQUE INDEX IF NOT EXISTS installed_modules_qualified_id_key
  ON public.installed_modules (qualified_id) WHERE qualified_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS installed_modules_resolved_id_key
  ON public.installed_modules (resolved_id) WHERE resolved_id IS NOT NULL;

COMMENT ON COLUMN public.installed_modules.slug IS
  'Author-preferred short handle (folder name). Unique within a source, not globally.';
COMMENT ON COLUMN public.installed_modules.qualified_id IS
  'Always-unique machine identity: <source_slug>/<slug>. Not an FK target.';
COMMENT ON COLUMN public.installed_modules.resolved_id IS
  'Mutable resolved identity used for routes/capability keys/feature slugs: bare slug if reserved, else qualified_id. NOT the PK (id is).';

-- ---------------------------------------------------------------------------
-- Phase 1: reservation registry (governance allowlist)
-- ---------------------------------------------------------------------------
-- Grants a (source, name) the right to hold the BARE identity (kind=module_id)
-- and/or a vanity top-level route (kind=route). Core/first-party names are
-- seeded by the loader on first reconcile using loader-computed source slugs
-- (so owner_source matches the loader's identity resolution exactly). Writes
-- are service-role only (seeded by the platform, never the admin UI) — §14.
CREATE TABLE IF NOT EXISTS public.module_reserved_names (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN ('module_id', 'route')),
  name        text NOT NULL,          -- e.g. 'broadcasts' or 'events'
  owner_source text,                  -- source_slug allowed to hold it (null = legacy/any)
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, name)
);

COMMENT ON TABLE public.module_reserved_names IS
  'Allowlist: which (source, name) may hold a bare module id / vanity route. Seeded by the loader; service-role write only.';

ALTER TABLE public.module_reserved_names ENABLE ROW LEVEL SECURITY;

-- Readable by any authenticated admin (the Modules UI reads reservation status);
-- no write policy → only the service-role loader can INSERT/UPDATE/DELETE.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'module_reserved_names'
      AND policyname = 'module_reserved_names_read'
  ) THEN
    CREATE POLICY module_reserved_names_read
      ON public.module_reserved_names FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- A one-time seed marker so the loader grandfathers exactly the set present at
-- first reconcile after this migration, then never auto-reserves again.
INSERT INTO public.platform_settings (key, value)
VALUES ('module_reservations_seeded', 'false')
ON CONFLICT (key) DO NOTHING;
