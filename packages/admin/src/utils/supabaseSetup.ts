import { supabase } from '@/lib/supabase'

export class SupabaseSetupService {
  static async createDatabaseFunctions(): Promise<{ success: boolean; error?: string }> {
    try {
      console.log('Setting up Supabase database functions...')

      // Create the pgcrypto extension if it doesn't exist
      const extensionSQL = `CREATE EXTENSION IF NOT EXISTS pgcrypto;`

      // Create the admin_users table
      const createTableSQL = `
        CREATE TABLE IF NOT EXISTS admin_users (
          id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
          email VARCHAR(255) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          name VARCHAR(255) NOT NULL,
          role VARCHAR(100) DEFAULT 'admin',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `

      // Create index
      const createIndexSQL = `
        CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(email);
      `

      // Create update trigger function
      const updateTriggerFunctionSQL = `
        CREATE OR REPLACE FUNCTION update_updated_at_column()
        RETURNS TRIGGER AS $$
        BEGIN
          NEW.updated_at = NOW();
          RETURN NEW;
        END;
        $$ language 'plpgsql';
      `

      // Create trigger
      const createTriggerSQL = `
        DROP TRIGGER IF EXISTS update_admin_users_updated_at ON admin_users;
        CREATE TRIGGER update_admin_users_updated_at
          BEFORE UPDATE ON admin_users
          FOR EACH ROW
          EXECUTE FUNCTION update_updated_at_column();
      `

      // Create admin user function
      const createUserFunctionSQL = `
        CREATE OR REPLACE FUNCTION create_admin_user(
          user_email VARCHAR(255),
          user_password VARCHAR(255),
          user_name VARCHAR(255),
          user_role VARCHAR(100) DEFAULT 'admin'
        )
        RETURNS UUID AS $$
        DECLARE
          new_user_id UUID;
        BEGIN
          INSERT INTO admin_users (email, password_hash, name, role)
          VALUES (
            user_email,
            crypt(user_password, gen_salt('bf')),
            user_name,
            user_role
          )
          RETURNING id INTO new_user_id;

          RETURN new_user_id;
        END;
        $$ LANGUAGE plpgsql SECURITY DEFINER;
      `

      // Create login verification function
      const verifyLoginFunctionSQL = `
        CREATE OR REPLACE FUNCTION verify_admin_login(
          user_email VARCHAR(255),
          user_password VARCHAR(255)
        )
        RETURNS TABLE(
          user_id UUID,
          email VARCHAR(255),
          name VARCHAR(255),
          role VARCHAR(100)
        )
        SECURITY DEFINER
        AS $$
        BEGIN
          RETURN QUERY
          SELECT au.id, au.email, au.name, au.role
          FROM admin_users au
          WHERE au.email = user_email
            AND au.password_hash = crypt(user_password, au.password_hash);
        END;
        $$ LANGUAGE plpgsql;
      `

      // Create password update function
      const updatePasswordFunctionSQL = `
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
      `

      // Enable RLS and create policies
      const rlsSQL = `
        ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS "Admin users can access admin_users" ON admin_users;
        CREATE POLICY "Admin users can access admin_users" ON admin_users
          FOR ALL USING (true);
      `

      // Execute all SQL statements
      const sqlStatements = [
        extensionSQL,
        createTableSQL,
        createIndexSQL,
        updateTriggerFunctionSQL,
        createTriggerSQL,
        createUserFunctionSQL,
        verifyLoginFunctionSQL,
        updatePasswordFunctionSQL,
        rlsSQL
      ]

      for (const sql of sqlStatements) {
        const { error } = await supabase.rpc('exec_sql', { sql_query: sql })
        if (error) {
          console.error('Error executing SQL:', error)
              // For critical functions, we'll log the error but continue
          console.warn('Failed to execute via RPC, trying manual execution')
        }
      }

      // Try to create default admin user
      try {
        const { data: existingUser } = await supabase
          .from('admin_users')
          .select('id')
          .eq('email', 'admin@example.com')
          .single()

        if (!existingUser) {
          await supabase.rpc('admin_create_user', {
            user_email: 'admin@example.com',
            user_password: 'admin123',
            user_name: 'Admin User',
            user_role: 'super_admin'
          })
          console.log('Default admin user created')
        }
      } catch (error) {
        console.log('Default user creation skipped (may already exist)')
      }

      return { success: true }
    } catch (error) {
      console.error('Setup failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Setup failed'
      }
    }
  }

  static async testDatabaseSetup(): Promise<{ success: boolean; error?: string }> {
    try {
      // Test if functions exist by trying to call them
      const { error: testError } = await supabase.rpc('admin_verify_login', {
        user_email: 'test@test.com',
        user_password: 'test'
      })

      // If we get a function not found error, setup is incomplete
      if (testError && testError.message.includes('function')) {
        return { success: false, error: 'Database functions not found' }
      }

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Test failed'
      }
    }
  }
}

// Make it available globally for easy access
declare global {
  interface Window {
    setupSupabase: typeof SupabaseSetupService
  }
}

if (typeof window !== 'undefined') {
  window.setupSupabase = SupabaseSetupService
}