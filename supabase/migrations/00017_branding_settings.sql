-- Add default branding settings to app_settings
INSERT INTO app_settings (key, value) VALUES
  ('app_name', 'Gatewaze'),
  ('primary_color', '#6366f1'),
  ('secondary_color', '#0d1218'),
  ('tertiary_color', '#1e2837'),
  ('font_heading', 'Poppins'),
  ('font_heading_weight', '600'),
  ('font_body', 'Inter'),
  ('font_body_weight', '400'),
  ('body_text_size', '16'),
  ('logo_url', ''),
  ('logo_icon_url', ''),
  ('favicon_url', ''),
  ('contact_email', ''),
  ('tracking_head', ''),
  ('tracking_body', '')
ON CONFLICT (key) DO NOTHING;

-- Create unified media storage bucket (single bucket, subfolders for organisation)
-- Subfolders: branding/, events/, avatars/, speakers/
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('media', 'media', true, 52428800)
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 52428800;

-- Public read access
CREATE POLICY "Public read access on media"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'media');

-- Authenticated users can manage media
CREATE POLICY "Authenticated upload on media"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'media');

CREATE POLICY "Authenticated update on media"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'media');

CREATE POLICY "Authenticated delete on media"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'media');
