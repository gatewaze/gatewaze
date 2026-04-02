import { supabase } from '@/lib/supabase'

export class SupabaseTestService {
  static async testConnection() {
    try {
      console.log('Testing Supabase connection...')

      // Test basic connection
      const { data, error } = await supabase
        .from('admin_users')
        .select('count(*)')
        .limit(1)

      console.log('Connection test result:', { data, error })

      if (error) {
        return { success: false, error: error.message }
      }

      return { success: true, message: 'Connection successful' }
    } catch (error) {
      console.error('Connection test failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  static async checkAdminUser(email: string = 'admin@example.com') {
    try {
      console.log(`Checking for admin user: ${email}`)

      const { data, error } = await supabase
        .from('admin_users')
        .select('id, email, name, role, created_at')
        .eq('email', email)
        .single()

      console.log('Admin user check result:', { data, error })

      if (error) {
        if (error.code === 'PGRST116') {
          return { exists: false, message: 'User not found' }
        }
        return { exists: false, error: error.message }
      }

      return { exists: true, user: data }
    } catch (error) {
      console.error('Admin user check failed:', error)
      return {
        exists: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  static async testRpcFunction() {
    try {
      console.log('Testing RPC function...')

      const { data, error } = await supabase.rpc('admin_verify_login', {
        user_email: 'admin@example.com',
        user_password: 'admin123'
      })

      console.log('RPC test result:', { data, error })

      if (error) {
        return { success: false, error: error.message }
      }

      return { success: true, data }
    } catch (error) {
      console.error('RPC test failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  static async createTestUser() {
    try {
      console.log('Creating test admin user...')

      const { data, error } = await supabase.rpc('admin_create_user', {
        user_email: 'test@example.com',
        user_password: 'test123',
        user_name: 'Test Admin',
        user_role: 'admin'
      })

      console.log('Create user result:', { data, error })

      if (error) {
        return { success: false, error: error.message }
      }

      return { success: true, userId: data }
    } catch (error) {
      console.error('Create user failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  static async runAllTests() {
    console.log('=== Running Supabase Tests ===')

    const connectionTest = await this.testConnection()
    console.log('1. Connection Test:', connectionTest)

    const userCheck = await this.checkAdminUser()
    console.log('2. Admin User Check:', userCheck)

    const rpcTest = await this.testRpcFunction()
    console.log('3. RPC Function Test:', rpcTest)

    return {
      connection: connectionTest,
      adminUser: userCheck,
      rpcFunction: rpcTest
    }
  }
}

// Make it available globally for debugging
declare global {
  interface Window {
    testSupabase: typeof SupabaseTestService
  }
}

if (typeof window !== 'undefined') {
  window.testSupabase = SupabaseTestService
}