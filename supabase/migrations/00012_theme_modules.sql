-- Enforce at most one active theme module at a time.
-- The installed_modules.type column is already text with no CHECK constraint,
-- so 'theme' values are accepted without schema changes.
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_theme
  ON public.installed_modules ((true))
  WHERE type = 'theme' AND status = 'enabled';
