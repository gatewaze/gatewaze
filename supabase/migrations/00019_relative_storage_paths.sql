-- =============================================================================
-- Migration: Convert full Supabase storage URLs to relative paths.
--
-- See gatewaze-environments/specs/spec-relative-storage-paths.md for full design.
--
-- Scope:
--   Simple columns (text): events, accounts, admin_profiles, people, platform_settings
--   JSONB content:         newsletters_edition_blocks, newsletters_edition_bricks
--   Out of scope:          rendered_html, email_send_log.content_html, email_templates.html_body
--
-- Properties:
--   - Idempotent: re-running produces no further changes.
--   - Batched:    max 1000 simple-column rows, max 500 JSONB rows per statement.
--   - PK-ordered: stable cursor (not ctid).
--   - Scoped:     targets the `media` bucket only (per Non-Goals §multi-bucket).
-- =============================================================================

BEGIN;

-- 1. Seed the new setting row so the admin UI can edit it. Empty value triggers
--    the runtime fallback (${SUPABASE_URL}/storage/v1/object/public/media).
INSERT INTO public.platform_settings (key, value)
VALUES ('storage_bucket_url', '')
ON CONFLICT (key) DO NOTHING;

-- 2. Per-row error log. Operators inspect this table and drop it after review.
CREATE TABLE IF NOT EXISTS public.storage_migration_errors (
  id           bigserial PRIMARY KEY,
  table_name   text NOT NULL,
  row_pk       text NOT NULL,
  error_detail text,
  occurred_at  timestamptz NOT NULL DEFAULT now()
);

-- 3. Recursive JSONB path stripper. Marked STABLE because jsonb_each / jsonb_array_elements
--    are STABLE (regexp_replace is immutable; composition is STABLE).
CREATE OR REPLACE FUNCTION public._strip_storage_urls_jsonb(input jsonb)
RETURNS jsonb AS $$
DECLARE
    -- Hardcoded to the 'media' bucket — spec Non-Goals §multi-bucket.
    pattern text := '^https?://[^/]+/storage/v1/object/public/media/(.+)';
    rec     jsonb;
    k       text;
    v       jsonb;
    s       text;
BEGIN
    IF input IS NULL THEN RETURN NULL; END IF;

    CASE jsonb_typeof(input)
        WHEN 'object' THEN
            rec := '{}'::jsonb;
            FOR k, v IN SELECT * FROM jsonb_each(input) LOOP
                rec := rec || jsonb_build_object(k, public._strip_storage_urls_jsonb(v));
            END LOOP;
            RETURN rec;
        WHEN 'array' THEN
            rec := '[]'::jsonb;
            FOR v IN SELECT * FROM jsonb_array_elements(input) LOOP
                rec := rec || jsonb_build_array(public._strip_storage_urls_jsonb(v));
            END LOOP;
            RETURN rec;
        WHEN 'string' THEN
            s := input #>> '{}';
            RETURN to_jsonb(regexp_replace(s, pattern, '\1'));
        ELSE
            RETURN input;
    END CASE;
END;
$$ LANGUAGE plpgsql STABLE;

-- =============================================================================
-- 4. Simple-column migrations (batched, PK-ordered)
--
-- The events table lives in the events module and may not exist on a fresh
-- install (modules register after core bootstrap). Guard each block with a
-- table-existence check, matching the pattern used for newsletter tables below.
-- =============================================================================

-- events.screenshot_url
DO $$
DECLARE
    batch_size int := 1000;
    updated    int;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'events'
    ) THEN
        RAISE NOTICE 'events not present, skipping';
        RETURN;
    END IF;
    LOOP
        UPDATE public.events
        SET screenshot_url = regexp_replace(
            screenshot_url,
            '^https?://[^/]+/storage/v1/object/public/media/(.+)',
            '\1'
        )
        WHERE event_id IN (
            SELECT event_id FROM public.events
            WHERE screenshot_url LIKE 'http%storage/v1/object/public/media/%'
            ORDER BY event_id
            LIMIT batch_size
        );
        GET DIAGNOSTICS updated = ROW_COUNT;
        EXIT WHEN updated < batch_size;
    END LOOP;
END $$;

-- events.event_logo
DO $$
DECLARE
    batch_size int := 1000;
    updated    int;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'events'
    ) THEN
        RETURN;
    END IF;
    LOOP
        UPDATE public.events
        SET event_logo = regexp_replace(
            event_logo,
            '^https?://[^/]+/storage/v1/object/public/media/(.+)',
            '\1'
        )
        WHERE event_id IN (
            SELECT event_id FROM public.events
            WHERE event_logo LIKE 'http%storage/v1/object/public/media/%'
            ORDER BY event_id
            LIMIT batch_size
        );
        GET DIAGNOSTICS updated = ROW_COUNT;
        EXIT WHEN updated < batch_size;
    END LOOP;
END $$;

-- events.badge_logo
DO $$
DECLARE
    batch_size int := 1000;
    updated    int;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'events'
    ) THEN
        RETURN;
    END IF;
    LOOP
        UPDATE public.events
        SET badge_logo = regexp_replace(
            badge_logo,
            '^https?://[^/]+/storage/v1/object/public/media/(.+)',
            '\1'
        )
        WHERE event_id IN (
            SELECT event_id FROM public.events
            WHERE badge_logo LIKE 'http%storage/v1/object/public/media/%'
            ORDER BY event_id
            LIMIT batch_size
        );
        GET DIAGNOSTICS updated = ROW_COUNT;
        EXIT WHEN updated < batch_size;
    END LOOP;
END $$;

-- events.event_featured_image
DO $$
DECLARE
    batch_size int := 1000;
    updated    int;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'events'
    ) THEN
        RETURN;
    END IF;
    LOOP
        UPDATE public.events
        SET event_featured_image = regexp_replace(
            event_featured_image,
            '^https?://[^/]+/storage/v1/object/public/media/(.+)',
            '\1'
        )
        WHERE event_id IN (
            SELECT event_id FROM public.events
            WHERE event_featured_image LIKE 'http%storage/v1/object/public/media/%'
            ORDER BY event_id
            LIMIT batch_size
        );
        GET DIAGNOSTICS updated = ROW_COUNT;
        EXIT WHEN updated < batch_size;
    END LOOP;
END $$;

-- events.venue_map_image
DO $$
DECLARE
    batch_size int := 1000;
    updated    int;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'events'
    ) THEN
        RETURN;
    END IF;
    LOOP
        UPDATE public.events
        SET venue_map_image = regexp_replace(
            venue_map_image,
            '^https?://[^/]+/storage/v1/object/public/media/(.+)',
            '\1'
        )
        WHERE event_id IN (
            SELECT event_id FROM public.events
            WHERE venue_map_image LIKE 'http%storage/v1/object/public/media/%'
            ORDER BY event_id
            LIMIT batch_size
        );
        GET DIAGNOSTICS updated = ROW_COUNT;
        EXIT WHEN updated < batch_size;
    END LOOP;
END $$;

-- accounts.logo_url
DO $$
DECLARE
    batch_size int := 1000;
    updated    int;
BEGIN
    LOOP
        UPDATE public.accounts
        SET logo_url = regexp_replace(
            logo_url,
            '^https?://[^/]+/storage/v1/object/public/media/(.+)',
            '\1'
        )
        WHERE id IN (
            SELECT id FROM public.accounts
            WHERE logo_url LIKE 'http%storage/v1/object/public/media/%'
            ORDER BY id
            LIMIT batch_size
        );
        GET DIAGNOSTICS updated = ROW_COUNT;
        EXIT WHEN updated < batch_size;
    END LOOP;
END $$;

-- admin_profiles.avatar_url
DO $$
DECLARE
    batch_size int := 1000;
    updated    int;
BEGIN
    LOOP
        UPDATE public.admin_profiles
        SET avatar_url = regexp_replace(
            avatar_url,
            '^https?://[^/]+/storage/v1/object/public/media/(.+)',
            '\1'
        )
        WHERE id IN (
            SELECT id FROM public.admin_profiles
            WHERE avatar_url LIKE 'http%storage/v1/object/public/media/%'
            ORDER BY id
            LIMIT batch_size
        );
        GET DIAGNOSTICS updated = ROW_COUNT;
        EXIT WHEN updated < batch_size;
    END LOOP;
END $$;

-- people.avatar_url (legacy column; Gravatar/LinkedIn external URLs pass through
-- unchanged because the LIKE filter only matches Supabase storage URLs.)
DO $$
DECLARE
    batch_size int := 1000;
    updated    int;
BEGIN
    LOOP
        UPDATE public.people
        SET avatar_url = regexp_replace(
            avatar_url,
            '^https?://[^/]+/storage/v1/object/public/media/(.+)',
            '\1'
        )
        WHERE id IN (
            SELECT id FROM public.people
            WHERE avatar_url LIKE 'http%storage/v1/object/public/media/%'
            ORDER BY id
            LIMIT batch_size
        );
        GET DIAGNOSTICS updated = ROW_COUNT;
        EXIT WHEN updated < batch_size;
    END LOOP;
END $$;

-- platform_settings.value where key IN (logo_url, logo_icon_url, favicon_url)
DO $$
DECLARE
    batch_size int := 1000;
    updated    int;
BEGIN
    LOOP
        UPDATE public.platform_settings
        SET value = regexp_replace(
            value,
            '^https?://[^/]+/storage/v1/object/public/media/(.+)',
            '\1'
        )
        WHERE key IN (
            SELECT key FROM public.platform_settings
            WHERE key IN ('logo_url', 'logo_icon_url', 'favicon_url')
              AND value LIKE 'http%storage/v1/object/public/media/%'
            ORDER BY key
            LIMIT batch_size
        );
        GET DIAGNOSTICS updated = ROW_COUNT;
        EXIT WHEN updated < batch_size;
    END LOOP;
END $$;

-- =============================================================================
-- 5. JSONB content migration (batched, per-row exception isolation).
--    Failed rows are tracked in storage_migration_errors and excluded via NOT IN.
--
-- The newsletter tables live in the newsletters module and may not exist on every
-- deployment. Guard each block with a table-existence check.
-- =============================================================================

DO $$
DECLARE
    batch_size int := 500;
    processed  int;
    rec        record;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'newsletters_edition_blocks'
    ) THEN
        RAISE NOTICE 'newsletters_edition_blocks not present, skipping';
        RETURN;
    END IF;

    LOOP
        processed := 0;
        FOR rec IN
            SELECT id, content FROM public.newsletters_edition_blocks
            WHERE content::text LIKE '%storage/v1/object/public/media/%'
              AND id NOT IN (
                SELECT row_pk::uuid FROM public.storage_migration_errors
                WHERE table_name = 'newsletters_edition_blocks'
              )
            ORDER BY id
            LIMIT batch_size
        LOOP
            BEGIN
                UPDATE public.newsletters_edition_blocks
                SET content = public._strip_storage_urls_jsonb(rec.content)
                WHERE id = rec.id;
                processed := processed + 1;
            EXCEPTION WHEN OTHERS THEN
                INSERT INTO public.storage_migration_errors (table_name, row_pk, error_detail)
                VALUES ('newsletters_edition_blocks', rec.id::text, SQLERRM);
                processed := processed + 1;
            END;
        END LOOP;
        EXIT WHEN processed < batch_size;
    END LOOP;
END $$;

DO $$
DECLARE
    batch_size int := 500;
    processed  int;
    rec        record;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'newsletters_edition_bricks'
    ) THEN
        RAISE NOTICE 'newsletters_edition_bricks not present, skipping';
        RETURN;
    END IF;

    LOOP
        processed := 0;
        FOR rec IN
            SELECT id, content FROM public.newsletters_edition_bricks
            WHERE content::text LIKE '%storage/v1/object/public/media/%'
              AND id NOT IN (
                SELECT row_pk::uuid FROM public.storage_migration_errors
                WHERE table_name = 'newsletters_edition_bricks'
              )
            ORDER BY id
            LIMIT batch_size
        LOOP
            BEGIN
                UPDATE public.newsletters_edition_bricks
                SET content = public._strip_storage_urls_jsonb(rec.content)
                WHERE id = rec.id;
                processed := processed + 1;
            EXCEPTION WHEN OTHERS THEN
                INSERT INTO public.storage_migration_errors (table_name, row_pk, error_detail)
                VALUES ('newsletters_edition_bricks', rec.id::text, SQLERRM);
                processed := processed + 1;
            END;
        END LOOP;
        EXIT WHEN processed < batch_size;
    END LOOP;
END $$;

COMMIT;

-- =============================================================================
-- Post-migration audit query (run manually; every row count must be 0).
-- =============================================================================
-- SELECT 'events.screenshot_url' AS site, count(*) FROM public.events
--     WHERE screenshot_url LIKE '%storage/v1/object/public/media/%'
-- UNION ALL SELECT 'events.event_logo', count(*) FROM public.events
--     WHERE event_logo LIKE '%storage/v1/object/public/media/%'
-- UNION ALL SELECT 'events.badge_logo', count(*) FROM public.events
--     WHERE badge_logo LIKE '%storage/v1/object/public/media/%'
-- UNION ALL SELECT 'events.event_featured_image', count(*) FROM public.events
--     WHERE event_featured_image LIKE '%storage/v1/object/public/media/%'
-- UNION ALL SELECT 'events.venue_map_image', count(*) FROM public.events
--     WHERE venue_map_image LIKE '%storage/v1/object/public/media/%'
-- UNION ALL SELECT 'accounts.logo_url', count(*) FROM public.accounts
--     WHERE logo_url LIKE '%storage/v1/object/public/media/%'
-- UNION ALL SELECT 'admin_profiles.avatar_url', count(*) FROM public.admin_profiles
--     WHERE avatar_url LIKE '%storage/v1/object/public/media/%'
-- UNION ALL SELECT 'people.avatar_url', count(*) FROM public.people
--     WHERE avatar_url LIKE '%storage/v1/object/public/media/%'
-- UNION ALL SELECT 'platform_settings(logos)', count(*) FROM public.platform_settings
--     WHERE key IN ('logo_url', 'logo_icon_url', 'favicon_url')
--       AND value LIKE '%storage/v1/object/public/media/%'
-- UNION ALL SELECT 'newsletters_edition_blocks.content',
--     CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables
--         WHERE table_schema = 'public' AND table_name = 'newsletters_edition_blocks')
--     THEN (SELECT count(*) FROM public.newsletters_edition_blocks
--         WHERE content::text LIKE '%storage/v1/object/public/media/%') ELSE 0 END
-- UNION ALL SELECT 'newsletters_edition_bricks.content',
--     CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables
--         WHERE table_schema = 'public' AND table_name = 'newsletters_edition_bricks')
--     THEN (SELECT count(*) FROM public.newsletters_edition_bricks
--         WHERE content::text LIKE '%storage/v1/object/public/media/%') ELSE 0 END;
