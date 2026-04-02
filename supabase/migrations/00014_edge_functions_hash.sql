-- Add edge_functions_hash column for detecting source changes without version bumps
ALTER TABLE public.installed_modules
  ADD COLUMN IF NOT EXISTS edge_functions_hash text;

COMMENT ON COLUMN public.installed_modules.edge_functions_hash IS
  'SHA-256 hash of all edge function source files for change detection';
