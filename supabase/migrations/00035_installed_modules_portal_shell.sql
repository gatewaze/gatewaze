-- Portal workspace shell: per-module rail item + contextual nav.
-- Populated on module enable from the module manifest's `portalShell`, and projected into
-- `railItems` by the portal's enabledModules loader. Additive + idempotent.
-- Spec: spec-portal-workspace-shell.md §8 / §10.4.

ALTER TABLE public.installed_modules
  ADD COLUMN IF NOT EXISTS portal_shell jsonb;

COMMENT ON COLUMN public.installed_modules.portal_shell IS
  'Workspace-shell config { rail, nav, publicNav } projected into the portal rail/sidebar. See spec-portal-workspace-shell.md §8.';
