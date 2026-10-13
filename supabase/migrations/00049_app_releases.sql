-- Per-account, per-platform "latest build available" record (issue #94).
--
-- The device already knows its own version/build (src/core/appInfo.ts). What
-- it cannot know on its own is whether a newer build has been released,
-- because that information only exists at release time, on a pipeline the
-- device was not running when it was built. This table is written once, at
-- the moment packages/mobile/scripts/testflight-release-build.mjs confirms a
-- build is VALID and attached to its beta group, and read by every signed-in
-- device via GET /api/app-releases/latest.
--
-- RLS enabled, no policies — the "silent table" pattern used by
-- mcp_access_groups et al (00047_mcp_access.sql) and api_keys: the only
-- reader/writer is the service-role client, either through the API route
-- (packages/api/src/routes/app-releases.ts, which applies account scoping
-- from req.accountId in application code) or the release script writing
-- directly with the service-role key. RLS stays on so an anon/authenticated
-- PostgREST client gets nothing, by default-deny.

CREATE TABLE IF NOT EXISTS public.app_releases (
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('ios', 'android')),
  latest_version text NOT NULL,
  latest_build integer NOT NULL CHECK (latest_build > 0),
  released_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, platform)
);

ALTER TABLE public.app_releases ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_app_releases_updated_at') THEN
    CREATE TRIGGER set_app_releases_updated_at
      BEFORE UPDATE ON public.app_releases
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

COMMENT ON TABLE public.app_releases IS
  'Latest build Apple (iOS) or Google Play (android, unused until a Play confirmation signal exists) has confirmed is live for testers, per account. Read by the mobile app to show an "update available" notice; written only by the service-role client.';
