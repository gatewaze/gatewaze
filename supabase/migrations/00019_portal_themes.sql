-- Portal theme system: brand-level default theme + per-event overrides
--
-- Themes: 'blobs' (current animated blobs), 'gradient_wave', 'basic'
-- Theme colors stored as JSON in app_settings and events.theme_colors

-- Brand-level default theme
INSERT INTO app_settings (key, value) VALUES
  ('portal_theme', 'blobs')
ON CONFLICT (key) DO NOTHING;

-- Per-event theme override
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS portal_theme text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS theme_colors jsonb;

COMMENT ON COLUMN public.events.portal_theme IS 'Override the brand default portal theme for this event. NULL = use brand default. Values: blobs, gradient_wave, basic';
COMMENT ON COLUMN public.events.theme_colors IS 'Theme-specific color overrides as JSON. Structure depends on portal_theme. NULL = use brand defaults.';
