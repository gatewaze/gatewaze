-- 00013_portal_nav.sql
-- Adds portal_nav JSONB column to installed_modules for dynamic portal navigation

ALTER TABLE public.installed_modules
  ADD COLUMN IF NOT EXISTS portal_nav jsonb;

COMMENT ON COLUMN public.installed_modules.portal_nav IS
  'Portal navigation config: { "label": "...", "path": "/...", "icon": "...", "order": 10 }';
