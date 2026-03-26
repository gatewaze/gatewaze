-- Enable Supabase Realtime for core event tables
-- This allows the admin UI to receive live updates via postgres_changes

ALTER PUBLICATION supabase_realtime ADD TABLE events_registrations;
ALTER PUBLICATION supabase_realtime ADD TABLE events_attendance;

-- REPLICA IDENTITY FULL is needed so DELETE events include the old row data
ALTER TABLE events_registrations REPLICA IDENTITY FULL;
ALTER TABLE events_attendance REPLICA IDENTITY FULL;
