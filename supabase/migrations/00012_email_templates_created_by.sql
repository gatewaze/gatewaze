-- Add created_by column to email_templates with FK to admin_profiles
ALTER TABLE public.email_templates
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.admin_profiles(id) ON DELETE SET NULL;
