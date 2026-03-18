-- ============================================================================
-- Migration: 00009_email
-- Description: Email templates and sending logs
-- ============================================================================

-- ==========================================================================
-- Email templates
-- ==========================================================================
CREATE TABLE IF NOT EXISTS public.email_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  subject       text NOT NULL,
  html_body     text,
  text_body     text,
  template_type text,
  variables     jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.email_templates IS 'Reusable email templates with variable placeholders';

CREATE TRIGGER email_templates_updated_at
  BEFORE UPDATE ON public.email_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ==========================================================================
-- Email logs
-- ==========================================================================
CREATE TABLE IF NOT EXISTS public.email_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email      text NOT NULL,
  from_email    text,
  subject       text,
  template_id   uuid REFERENCES public.email_templates(id) ON DELETE SET NULL,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'sent', 'delivered', 'failed', 'bounced')),
  sent_at       timestamptz,
  error_message text,
  metadata      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.email_logs IS 'Audit trail for all outbound emails';
