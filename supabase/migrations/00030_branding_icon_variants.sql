--------------------------------------------------------------------------------
-- Branding: split the single logo icon into light/dark variants.
--
-- The admin sidebar's collapsed (icon-only) rail uses the light icon. The
-- pre-existing `logo_icon_url` is kept (the portal sign-in still reads it),
-- and seeded as the light variant where present.
--------------------------------------------------------------------------------

INSERT INTO platform_settings (key, value) VALUES
  ('logo_icon_url_light', ''),
  ('logo_icon_url_dark', '')
ON CONFLICT (key) DO NOTHING;

-- Carry an existing single icon over to the light variant.
UPDATE platform_settings AS light
SET value = legacy.value
FROM platform_settings AS legacy
WHERE light.key = 'logo_icon_url_light'
  AND legacy.key = 'logo_icon_url'
  AND COALESCE(light.value, '') = ''
  AND COALESCE(legacy.value, '') <> '';
