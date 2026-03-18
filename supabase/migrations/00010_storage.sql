-- ============================================================================
-- Migration: 00010_storage
-- Description: Storage buckets and access policies
-- ============================================================================

-- ==========================================================================
-- Create storage buckets
-- Ensure the "public" and "file_size_limit" columns exist before inserting.
-- storage-api normally adds these on startup, but migrations run first.
-- ==========================================================================
ALTER TABLE storage.buckets ADD COLUMN IF NOT EXISTS public boolean DEFAULT false;
ALTER TABLE storage.buckets ADD COLUMN IF NOT EXISTS file_size_limit bigint;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES
  ('event-images',    'event-images',    true, 52428800),
  ('customer-avatars','customer-avatars', true, 5242880),
  ('speaker-avatars', 'speaker-avatars', true, 5242880)
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = EXCLUDED.file_size_limit;

-- ==========================================================================
-- Public read access for all three buckets
-- ==========================================================================
CREATE POLICY "Public read access on event-images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'event-images');

CREATE POLICY "Public read access on customer-avatars"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'customer-avatars');

CREATE POLICY "Public read access on speaker-avatars"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'speaker-avatars');

-- ==========================================================================
-- Authenticated users can upload / update / delete in all buckets
-- ==========================================================================
CREATE POLICY "Authenticated upload on event-images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'event-images');

CREATE POLICY "Authenticated update on event-images"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'event-images');

CREATE POLICY "Authenticated delete on event-images"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'event-images');

CREATE POLICY "Authenticated upload on customer-avatars"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'customer-avatars');

CREATE POLICY "Authenticated update on customer-avatars"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'customer-avatars');

CREATE POLICY "Authenticated delete on customer-avatars"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'customer-avatars');

CREATE POLICY "Authenticated upload on speaker-avatars"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'speaker-avatars');

CREATE POLICY "Authenticated update on speaker-avatars"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'speaker-avatars');

CREATE POLICY "Authenticated delete on speaker-avatars"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'speaker-avatars');
