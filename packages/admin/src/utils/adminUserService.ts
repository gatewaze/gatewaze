import { supabase, AdminUser } from '@/lib/supabase'
import { SupabaseAuthService } from '@/utils/supabaseAuth'

export interface CreateUserData {
  email: string
  name: string
  role?: string
  first_name?: string
  last_name?: string
}

export interface UpdateUserData {
  email?: string
  name?: string
  role?: string
  first_name?: string
  last_name?: string
}

export interface UpdatePasswordData {
  currentPassword: string
  newPassword: string
}

export class AdminUserService {
  static async getAllUsers(): Promise<{ users: AdminUser[] | null; error: string | null }> {
    try {
      const { data, error } = await supabase
        .from('admin_profiles')
        .select('id, email, name, role, is_active, created_at, updated_at')
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Error fetching users:', error)
        return { users: null, error: error.message }
      }

      // Map admin_profiles to AdminUser format
      const users = data?.map(profile => ({
        id: profile.id,
        email: profile.email,
        name: profile.name,
        role: profile.role,
        is_active: profile.is_active,
        created_at: profile.created_at,
        updated_at: profile.updated_at,
        avatar_url: null, // Not stored in admin_profiles yet
        permissions: null // Not stored in admin_profiles yet
      })) || []

      return { users, error: null }
    } catch (error) {
      console.error('Error fetching users:', error)
      return {
        users: null,
        error: error instanceof Error ? error.message : 'Failed to fetch users'
      }
    }
  }

  static async getUserById(id: string): Promise<{ user: AdminUser | null; error: string | null }> {
    try {
      const { data, error } = await supabase
        .from('admin_profiles')
        .select('id, email, name, role, created_at, updated_at')
        .eq('id', id)
        .single()

      if (error) {
        console.error('Error fetching user:', error)
        return { user: null, error: error.message }
      }

      return { user: data, error: null }
    } catch (error) {
      console.error('Error fetching user:', error)
      return {
        user: null,
        error: error instanceof Error ? error.message : 'Failed to fetch user'
      }
    }
  }

  static async createUser(userData: CreateUserData): Promise<{ success: boolean; error?: string; user?: AdminUser }> {
    try {
      // Use the new magic link admin creation system
      const result = await SupabaseAuthService.createAdminAccount(
        userData.email,
        userData.name,
        userData.role as 'super_admin' | 'admin' | 'editor' || 'admin',
        {
          first_name: userData.first_name,
          last_name: userData.last_name
        }
      )

      if (result.success && result.userId) {
        // Fetch the complete user object
        const { user, error: fetchError } = await this.getUserById(result.userId)
        if (fetchError || !user) {
          return { success: true, user: undefined } // Profile created but couldn't fetch
        }
        return { success: true, user }
      } else {
        return { success: false, error: result.error }
      }
    } catch (error) {
      console.error('Error creating user:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create user'
      }
    }
  }

  static async updateUser(id: string, userData: UpdateUserData): Promise<{ success: boolean; error?: string }> {
    try {
      // Update admin profile
      const { error } = await supabase
        .from('admin_profiles')
        .update({
          ...(userData.email && { email: userData.email }),
          ...(userData.name && { name: userData.name }),
          ...(userData.role && { role: userData.role }),
          updated_at: new Date().toISOString()
        })
        .eq('id', id)

      if (error) {
        console.error('Error updating user:', error)
        return { success: false, error: error.message }
      }

      // If first_name or last_name are provided, update the customer record
      if (userData.first_name || userData.last_name) {
        try {
          await SupabaseAuthService.updateAdminCustomer(id, {
            first_name: userData.first_name,
            last_name: userData.last_name,
            full_name: userData.name
          })
        } catch (error) {
          console.warn('Failed to update customer record:', error)
          // Don't fail the whole operation if customer update fails
        }
      }

      return { success: true }
    } catch (error) {
      console.error('Error updating user:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update user'
      }
    }
  }

  static async updatePassword(userId: string, passwordData: UpdatePasswordData): Promise<{ success: boolean; error?: string }> {
    try {
      const { data, error } = await supabase.rpc('admin_update_password', {
        user_id: userId,
        current_password: passwordData.currentPassword,
        new_password: passwordData.newPassword
      })

      if (error) {
        console.error('Error updating password:', error)
        return { success: false, error: error.message }
      }

      if (!data) {
        return { success: false, error: 'Current password is incorrect' }
      }

      return { success: true }
    } catch (error) {
      console.error('Error updating password:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update password'
      }
    }
  }

  static async deleteUser(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Instead of deleting, we deactivate the user to preserve the auth account
      const { error } = await supabase
        .from('admin_profiles')
        .update({
          is_active: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)

      if (error) {
        console.error('Error deactivating user:', error)
        return { success: false, error: error.message }
      }

      return { success: true }
    } catch (error) {
      console.error('Error deactivating user:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to deactivate user'
      }
    }
  }
}