-- =============================================================================
-- 00028_tracking_super_admin_gate.sql
--
-- Closes spec PR-H-10 / §5.11. The tracking_head and tracking_body
-- columns on platform_settings are an admin-controlled JS injection
-- feature: their values are rendered as raw <script> tags on every
-- public portal page. Today, any 'admin' role can write them; this
-- migration restricts writes to 'super_admin' and adds an audit-log
-- entry on every change.
--
-- The schema for these tracking values is key/value style — they are
-- stored as rows on platform_settings with key='tracking_head' and
-- key='tracking_body'. We can't enforce per-key column gating via
-- RLS directly (RLS is per-row, but the predicate can inspect the
-- key column).
-- =============================================================================

-- Drop the broad admin policies for these specific keys and replace
-- with super-admin-only ones.
DROP POLICY IF EXISTS "admin_insert_platform_settings" ON public.platform_settings;
DROP POLICY IF EXISTS "admin_update_platform_settings" ON public.platform_settings;

-- Re-create the admin INSERT/UPDATE policies but EXCLUDE the tracking
-- keys (so admins can still write everything else).
CREATE POLICY "admin_insert_platform_settings_non_tracking"
  ON public.platform_settings FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin()
    AND key NOT IN ('tracking_head', 'tracking_body')
  );

CREATE POLICY "admin_update_platform_settings_non_tracking"
  ON public.platform_settings FOR UPDATE TO authenticated
  USING (
    public.is_admin()
    AND key NOT IN ('tracking_head', 'tracking_body')
  );

-- Tracking keys: super_admin only. The existing
-- super_admin_insert/update/delete policies already cover these via
-- is_super_admin(); no new policy needed for super_admin (they keep
-- full access).

-- Audit trail: trigger that writes an audit_log entry on every
-- INSERT/UPDATE to a tracking key. The audit_log schema was created
-- in 00020.
CREATE OR REPLACE FUNCTION public.audit_tracking_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.key IN ('tracking_head', 'tracking_body') THEN
    -- audit_log schema (00020): actor_user_id, actor_role, action,
    -- target_module_id, target_source_id, request_id, ts, metadata.
    -- The original draft of this trigger used actor/target_kind/target_id
    -- which never existed in 00020's table — every upsert to a tracking
    -- key 400'd. Stash the human-readable actor label in metadata since
    -- there's no free-form actor column to land it in.
    INSERT INTO public.audit_log (actor_user_id, action, target_module_id, metadata)
    VALUES (
      auth.uid(),
      'platform_settings.' || TG_OP || '.' || NEW.key,
      'platform_settings',
      jsonb_build_object(
        'key',          NEW.key,
        'op',           TG_OP,
        'value_length', length(NEW.value),
        'actor_email',  COALESCE(auth.email(), 'system')
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_tracking_change_trigger ON public.platform_settings;
CREATE TRIGGER audit_tracking_change_trigger
  AFTER INSERT OR UPDATE ON public.platform_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_tracking_change();
