import { supabase } from '@/lib/supabase'

export class QuickSupabaseSetup {
  static async setupMissingFunctions(): Promise<{ success: boolean; error?: string }> {
    try {
      console.log('Creating missing Supabase functions...')

      // First, let's try to create the update password function directly
      const { error } = await supabase.rpc('admin_update_password', {
        user_id: '00000000-0000-0000-0000-000000000000',
        current_password: 'test',
        new_password: 'test'
      })

      // If we get a "function not found" error, the function doesn't exist
      if (error && error.message.includes('Could not find the function')) {
        return {
          success: false,
          error: 'The update_admin_password function needs to be created. Please run the SQL from supabase-missing-functions.sql in your Supabase dashboard.'
        }
      }

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Setup check failed'
      }
    }
  }

  static async testAllFunctions(): Promise<{ success: boolean; missing: string[]; error?: string }> {
    const missing: string[] = []

    try {
      // Test create_admin_user
      const { error: createError } = await supabase.rpc('admin_create_user', {
        user_email: 'test@test.com',
        user_password: 'test',
        user_name: 'Test',
        user_role: 'admin'
      })

      if (createError && createError.message.includes('Could not find the function')) {
        missing.push('create_admin_user')
      }

      // Test verify_admin_login
      const { error: verifyError } = await supabase.rpc('admin_verify_login', {
        user_email: 'test@test.com',
        user_password: 'test'
      })

      if (verifyError && verifyError.message.includes('Could not find the function')) {
        missing.push('verify_admin_login')
      }

      // Test update_admin_password
      const { error: updateError } = await supabase.rpc('admin_update_password', {
        user_id: '00000000-0000-0000-0000-000000000000',
        current_password: 'test',
        new_password: 'test'
      })

      if (updateError && updateError.message.includes('Could not find the function')) {
        missing.push('update_admin_password')
      }

      return {
        success: missing.length === 0,
        missing,
        error: missing.length > 0 ? `Missing functions: ${missing.join(', ')}` : undefined
      }
    } catch (error) {
      return {
        success: false,
        missing: [],
        error: error instanceof Error ? error.message : 'Test failed'
      }
    }
  }

  static async createDefaultAdminUser(): Promise<{ success: boolean; error?: string }> {
    try {
      // Check if admin user already exists
      const { data: existingUser } = await supabase
        .from('admin_users')
        .select('id')
        .eq('email', 'admin@example.com')
        .single()

      if (existingUser) {
        return { success: true, error: 'Admin user already exists' }
      }

      // Create the default admin user
      const { data, error } = await supabase.rpc('admin_create_user', {
        user_email: 'admin@example.com',
        user_password: 'admin123',
        user_name: 'Admin User',
        user_role: 'super_admin'
      })

      if (error) {
        return { success: false, error: error.message }
      }

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create admin user'
      }
    }
  }
}

// Make it available globally
declare global {
  interface Window {
    quickSetupSupabase: typeof QuickSupabaseSetup
  }
}

if (typeof window !== 'undefined') {
  window.quickSetupSupabase = QuickSupabaseSetup
}