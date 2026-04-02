import { supabase, Account, AccountUser, AccountMemberDetail } from '@/lib/supabase'

export interface CreateAccountData {
  name: string
  slug: string
  description?: string
  logo_url?: string
  website?: string
  contact_email?: string
  contact_phone?: string
  metadata?: Record<string, any>
}

export interface UpdateAccountData {
  name?: string
  slug?: string
  description?: string
  logo_url?: string
  website?: string
  contact_email?: string
  contact_phone?: string
  is_active?: boolean
  metadata?: Record<string, any>
}

export interface AddAccountUserData {
  account_id: string
  admin_profile_id: string
  role: 'owner' | 'admin' | 'member' | 'viewer'
}

export class AccountService {
  /**
   * Get all accounts (filtered by RLS)
   */
  static async getAllAccounts(): Promise<{ accounts: Account[] | null; error: string | null }> {
    try {
      const { data, error } = await supabase
        .from('accounts')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Error fetching accounts:', error)
        return { accounts: null, error: error.message }
      }

      return { accounts: data, error: null }
    } catch (error) {
      console.error('Error fetching accounts:', error)
      return {
        accounts: null,
        error: error instanceof Error ? error.message : 'Failed to fetch accounts'
      }
    }
  }

  /**
   * Get active accounts only
   */
  static async getActiveAccounts(): Promise<{ accounts: Account[] | null; error: string | null }> {
    try {
      const { data, error } = await supabase
        .from('accounts')
        .select('*')
        .eq('is_active', true)
        .order('name', { ascending: true })

      if (error) {
        console.error('Error fetching active accounts:', error)
        return { accounts: null, error: error.message }
      }

      return { accounts: data, error: null }
    } catch (error) {
      console.error('Error fetching active accounts:', error)
      return {
        accounts: null,
        error: error instanceof Error ? error.message : 'Failed to fetch active accounts'
      }
    }
  }

  /**
   * Get account by ID
   */
  static async getAccountById(id: string): Promise<{ account: Account | null; error: string | null }> {
    try {
      const { data, error } = await supabase
        .from('accounts')
        .select('*')
        .eq('id', id)
        .single()

      if (error) {
        console.error('Error fetching account:', error)
        return { account: null, error: error.message }
      }

      return { account: data, error: null }
    } catch (error) {
      console.error('Error fetching account:', error)
      return {
        account: null,
        error: error instanceof Error ? error.message : 'Failed to fetch account'
      }
    }
  }

  /**
   * Get account by slug
   */
  static async getAccountBySlug(slug: string): Promise<{ account: Account | null; error: string | null }> {
    try {
      const { data, error } = await supabase
        .from('accounts')
        .select('*')
        .eq('slug', slug)
        .single()

      if (error) {
        console.error('Error fetching account:', error)
        return { account: null, error: error.message }
      }

      return { account: data, error: null }
    } catch (error) {
      console.error('Error fetching account:', error)
      return {
        account: null,
        error: error instanceof Error ? error.message : 'Failed to fetch account'
      }
    }
  }

  /**
   * Create a new account
   */
  static async createAccount(accountData: CreateAccountData): Promise<{ success: boolean; error?: string; accountId?: string }> {
    try {
      const { data, error } = await supabase
        .from('accounts')
        .insert({
          name: accountData.name,
          slug: accountData.slug,
          description: accountData.description,
          logo_url: accountData.logo_url,
          website: accountData.website,
          contact_email: accountData.contact_email,
          contact_phone: accountData.contact_phone,
          metadata: accountData.metadata || {},
        })
        .select()
        .single()

      if (error) {
        console.error('Error creating account:', error)
        return { success: false, error: error.message }
      }

      return { success: true, accountId: data.id }
    } catch (error) {
      console.error('Error creating account:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create account'
      }
    }
  }

  /**
   * Update an existing account
   */
  static async updateAccount(id: string, accountData: UpdateAccountData): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('accounts')
        .update({
          ...(accountData.name !== undefined && { name: accountData.name }),
          ...(accountData.slug !== undefined && { slug: accountData.slug }),
          ...(accountData.description !== undefined && { description: accountData.description }),
          ...(accountData.logo_url !== undefined && { logo_url: accountData.logo_url }),
          ...(accountData.website !== undefined && { website: accountData.website }),
          ...(accountData.contact_email !== undefined && { contact_email: accountData.contact_email }),
          ...(accountData.contact_phone !== undefined && { contact_phone: accountData.contact_phone }),
          ...(accountData.is_active !== undefined && { is_active: accountData.is_active }),
          ...(accountData.metadata !== undefined && { metadata: accountData.metadata }),
          updated_at: new Date().toISOString()
        })
        .eq('id', id)

      if (error) {
        console.error('Error updating account:', error)
        return { success: false, error: error.message }
      }

      return { success: true }
    } catch (error) {
      console.error('Error updating account:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update account'
      }
    }
  }

  /**
   * Deactivate an account (soft delete)
   */
  static async deactivateAccount(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('accounts')
        .update({
          is_active: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)

      if (error) {
        console.error('Error deactivating account:', error)
        return { success: false, error: error.message }
      }

      return { success: true }
    } catch (error) {
      console.error('Error deactivating account:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to deactivate account'
      }
    }
  }

  /**
   * Get all members of an account
   */
  static async getAccountMembers(accountId: string): Promise<{ members: AccountMemberDetail[] | null; error: string | null }> {
    try {
      const { data, error } = await supabase
        .rpc('accounts_get_members', { account_uuid: accountId })

      if (error) {
        console.error('Error fetching account members:', error)
        return { members: null, error: error.message }
      }

      return { members: data, error: null }
    } catch (error) {
      console.error('Error fetching account members:', error)
      return {
        members: null,
        error: error instanceof Error ? error.message : 'Failed to fetch account members'
      }
    }
  }

  /**
   * Add a user to an account
   */
  static async addAccountUser(userData: AddAccountUserData): Promise<{ success: boolean; error?: string; accountUserId?: string }> {
    try {
      const { data, error } = await supabase
        .from('accounts_users')
        .insert({
          account_id: userData.account_id,
          admin_profile_id: userData.admin_profile_id,
          role: userData.role,
        })
        .select()
        .single()

      if (error) {
        console.error('Error adding account user:', error)
        return { success: false, error: error.message }
      }

      return { success: true, accountUserId: data.id }
    } catch (error) {
      console.error('Error adding account user:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add account user'
      }
    }
  }

  /**
   * Update an account user's role
   */
  static async updateAccountUserRole(accountUserId: string, role: 'owner' | 'admin' | 'member' | 'viewer'): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('accounts_users')
        .update({
          role,
          updated_at: new Date().toISOString()
        })
        .eq('id', accountUserId)

      if (error) {
        console.error('Error updating account user role:', error)
        return { success: false, error: error.message }
      }

      return { success: true }
    } catch (error) {
      console.error('Error updating account user role:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update account user role'
      }
    }
  }

  /**
   * Remove a user from an account (soft delete)
   */
  static async removeAccountUser(accountUserId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('accounts_users')
        .update({
          is_active: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', accountUserId)

      if (error) {
        console.error('Error removing account user:', error)
        return { success: false, error: error.message }
      }

      return { success: true }
    } catch (error) {
      console.error('Error removing account user:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to remove account user'
      }
    }
  }

  /**
   * Get accounts for the current user
   */
  static async getMyAccounts(): Promise<{ accounts: Account[] | null; error: string | null }> {
    try {
      // Get current user's admin profile
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        return { accounts: null, error: 'Not authenticated' }
      }

      // Get admin profile
      const { data: adminProfile, error: profileError } = await supabase
        .from('admin_profiles')
        .select('id')
        .eq('user_id', user.id)
        .single()

      if (profileError || !adminProfile) {
        return { accounts: null, error: 'Admin profile not found' }
      }

      // Get accounts through account_users junction
      const { data, error } = await supabase
        .from('accounts_users')
        .select('accounts(*)')
        .eq('admin_profile_id', adminProfile.id)
        .eq('is_active', true)

      if (error) {
        console.error('Error fetching user accounts:', error)
        return { accounts: null, error: error.message }
      }

      // Extract accounts from the nested structure
      const accounts = data.map((item: any) => item.accounts).filter(Boolean)

      return { accounts, error: null }
    } catch (error) {
      console.error('Error fetching user accounts:', error)
      return {
        accounts: null,
        error: error instanceof Error ? error.message : 'Failed to fetch user accounts'
      }
    }
  }
}
