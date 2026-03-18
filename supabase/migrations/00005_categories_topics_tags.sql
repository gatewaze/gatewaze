-- ============================================================================
-- Migration: 00005_categories_topics_tags
-- Description: Taxonomy system — categories, topics, tags and their junctions
-- ============================================================================

-- ==========================================================================
-- Categories (hierarchical via parent_id)
-- ==========================================================================
CREATE TABLE IF NOT EXISTS public.categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text UNIQUE NOT NULL,
  description text,
  parent_id   uuid REFERENCES public.categories(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.categories IS 'Event categories with optional hierarchy';

CREATE TABLE IF NOT EXISTS public.event_categories (
  event_id    uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, category_id)
);

-- ==========================================================================
-- Topics
-- ==========================================================================
CREATE TABLE IF NOT EXISTS public.topics (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL
);

COMMENT ON TABLE public.topics IS 'Event topics / subject areas';

CREATE TABLE IF NOT EXISTS public.event_topics (
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  topic_id uuid NOT NULL REFERENCES public.topics(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, topic_id)
);

-- ==========================================================================
-- Tags
-- ==========================================================================
CREATE TABLE IF NOT EXISTS public.tags (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL
);

COMMENT ON TABLE public.tags IS 'Freeform tags for events';

CREATE TABLE IF NOT EXISTS public.event_tags (
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  tag_id   uuid NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, tag_id)
);
