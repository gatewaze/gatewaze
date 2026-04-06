-- Track per-function deployment status for modules with edge functions
ALTER TABLE public.installed_modules
  ADD COLUMN IF NOT EXISTS edge_function_status JSONB DEFAULT '[]';

COMMENT ON COLUMN public.installed_modules.edge_function_status IS
  'Per-function deployment status: [{ "name": "fn-name", "status": "deployed"|"failed", "deployedAt": "ISO timestamp" }]';
