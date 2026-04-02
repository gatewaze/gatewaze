-- Additional functions for user management

-- Function to update admin user password
CREATE OR REPLACE FUNCTION update_admin_password(
  user_id UUID,
  current_password VARCHAR(255),
  new_password VARCHAR(255)
)
RETURNS BOOLEAN
SECURITY DEFINER
AS $$
DECLARE
  user_exists BOOLEAN;
BEGIN
  -- Check if current password is correct
  SELECT EXISTS(
    SELECT 1 FROM admin_users
    WHERE id = user_id
    AND password_hash = crypt(current_password, password_hash)
  ) INTO user_exists;

  -- If current password is wrong, return false
  IF NOT user_exists THEN
    RETURN FALSE;
  END IF;

  -- Update the password
  UPDATE admin_users
  SET password_hash = crypt(new_password, gen_salt('bf')),
      updated_at = NOW()
  WHERE id = user_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Function to get user profile by ID (for profile editing)
CREATE OR REPLACE FUNCTION get_admin_user_profile(user_id UUID)
RETURNS TABLE(
  id UUID,
  email VARCHAR(255),
  name VARCHAR(255),
  role VARCHAR(100),
  created_at TIMESTAMP WITH TIME ZONE
)
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT au.id, au.email, au.name, au.role, au.created_at
  FROM admin_users au
  WHERE au.id = user_id;
END;
$$ LANGUAGE plpgsql;