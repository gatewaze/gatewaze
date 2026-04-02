-- Add admin_nav column to installed_modules for admin sidebar navigation
ALTER TABLE installed_modules ADD COLUMN IF NOT EXISTS admin_nav jsonb;
