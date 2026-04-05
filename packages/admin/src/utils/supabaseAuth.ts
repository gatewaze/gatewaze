import { supabase } from '@/lib/supabase'
import { getSupabaseConfig } from '@/config/brands'

export interface AdminUser {
  id: string
  email: string
  name: string
  role: 'super_admin' | 'admin' | 'editor'
  avatar_url?: string
  permissions?: any
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface AuthResponse {
  user: AdminUser | null
  error: string | null
}

export interface MagicLinkResponse {
  success: boolean
  error?: string
  message?: string
  magicLink?: string
}

export class SupabaseAuthService {
  /**
   * Send magic link for admin authentication
   */
  static async sendMagicLink(email: string): Promise<MagicLinkResponse> {
    try {
      console.log('SupabaseAuthService - Sending magic link for:', email)

      // Edge function verifies admin + sends magic link email via platform email service
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

      const res = await fetch(`${supabaseUrl}/functions/v1/admin-send-magic-link`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: anonKey,
        },
        body: JSON.stringify({ email, redirectTo: window.location.origin }),
      })

      const data = await res.json()

      if (!res.ok) {
        return {
          success: false,
          error: data.error || 'Failed to send magic link',
        }
      }

      // Fallback: if edge function couldn't send email (no SMTP configured),
      // it returns verifyOnly — try client-side OTP via GoTrue
      if (data.verifyOnly) {
        const { error: otpError } = await supabase.auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo: window.location.origin,
            shouldCreateUser: false,
          },
        })
        if (otpError) {
          return { success: false, error: otpError.message }
        }
      }

      console.log('SupabaseAuthService - Magic link sent successfully')
      return {
        success: true,
        message: 'Magic link sent! Check your email for the login link.',
        magicLink: data.magicLink,
      }
    } catch (error) {
      console.error('Send magic link error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to send magic link',
      }
    }
  }

  /**
   * Update admin's customer record in Customer.io
   */
  static async updateAdminCustomer(
    adminProfileId: string,
    updates: {
      first_name?: string;
      last_name?: string;
      full_name?: string;
    }
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Get admin profile to find user_id
      const { data: adminProfile } = await supabase
        .from('admin_profiles')
        .select('user_id, email')
        .eq('id', adminProfileId)
        .single()

      if (!adminProfile) {
        return { success: false, error: 'Admin profile not found' }
      }

      // Find customer by auth_user_id
      const { data: customer } = await supabase
        .from('people')
        .select('id, cio_id, attributes')
        .eq('auth_user_id', adminProfile.user_id)
        .maybeSingle()

      if (!customer) {
        console.warn('No customer record found for admin user')
        return { success: false, error: 'Customer record not found' }
      }

      // Update customer attributes
      const updatedAttributes = {
        ...customer.attributes,
        ...(updates.first_name && { first_name: updates.first_name }),
        ...(updates.last_name && { last_name: updates.last_name }),
        ...(updates.full_name && { full_name: updates.full_name })
      }

      // Update in Supabase
      const { error: updateError } = await supabase
        .from('people')
        .update({ attributes: updatedAttributes })
        .eq('id', customer.id)

      if (updateError) {
        return { success: false, error: updateError.message }
      }

      // Update in Customer.io
      const supabaseConfig = getSupabaseConfig()
      const supabaseUrl = supabaseConfig.url

      const { data: { session } } = await supabase.auth.getSession()

      try {
        const response = await fetch(`${supabaseUrl}/functions/v1/people-signup`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token || ''}`
          },
          body: JSON.stringify({
            email: adminProfile.email,
            source: 'admin_profile_update',
            app: 'admin',
            user_metadata: updatedAttributes
          })
        })

        if (!response.ok) {
          console.warn('Failed to update Customer.io via people-signup')
        }
      } catch (error) {
        console.warn('Error updating Customer.io:', error)
      }

      return { success: true }
    } catch (error) {
      console.error('Error updating admin customer:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update customer'
      }
    }
  }

  /**
   * Create new admin account (only for authenticated super admins)
   */
  static async createAdminAccount(
    email: string,
    name: string,
    role: 'super_admin' | 'admin' | 'editor' = 'admin',
    options?: {
      first_name?: string;
      last_name?: string;
    }
  ): Promise<MagicLinkResponse & { userId?: string }> {
    try {
      // Note: This method is now only used within the admin panel
      // Permission checks are handled at the UI level (only super admins see the create user button)
      console.log('Creating admin account for:', email, 'with role:', role)

      // Check if admin profile already exists
      try {
        const { data: existingProfile } = await supabase
          .from('admin_profiles')
          .select('id, email')
          .eq('email', email)
          .maybeSingle()

        if (existingProfile) {
          return {
            success: false,
            error: 'An admin account with this email already exists'
          }
        }
      } catch (error) {
        console.warn('Could not check existing email, proceeding with creation:', error)
      }

      // Call people-signup edge function to create/ensure user exists
      // This will handle creating auth user, customer record in Customer.io and Supabase
      console.log('Calling people-signup edge function...')

      // Get the current session to pass the JWT token
      const { data: { session } } = await supabase.auth.getSession()

      // Get the Supabase URL from config
      const supabaseConfig = getSupabaseConfig()
      const supabaseUrl = supabaseConfig.url

      let authUserId: string | null = null

      try {
        const response = await fetch(`${supabaseUrl}/functions/v1/people-signup`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token || ''}`
          },
          body: JSON.stringify({
            email,
            source: 'admin_team_invite',
            app: 'admin',
            user_metadata: {
              first_name: options?.first_name || name.split(' ')[0] || name,
              last_name: options?.last_name || name.split(' ').slice(1).join(' ') || '',
              full_name: name
            }
          })
        })

        const result = await response.json()

        if (!response.ok || !result.success) {
          console.error('people-signup failed:', result)
          return {
            success: false,
            error: result.error || 'Failed to create user via people-signup'
          }
        }

        authUserId = result.user_id
        console.log('User created/updated via people-signup with auth ID:', authUserId)
      } catch (error) {
        console.error('Error calling people-signup:', error)
        return {
          success: false,
          error: 'Failed to create user account: ' + (error instanceof Error ? error.message : 'Unknown error')
        }
      }

      if (!authUserId) {
        return {
          success: false,
          error: 'Failed to get or create auth user ID'
        }
      }

      // Check if admin profile already exists for this auth user
      const { data: existingAdminProfile } = await supabase
        .from('admin_profiles')
        .select('id, is_active')
        .eq('user_id', authUserId)
        .maybeSingle()

      let profileId: string

      if (existingAdminProfile) {
        // Admin profile already exists
        if (!existingAdminProfile.is_active) {
          // Reactivate the profile
          const { error: updateError } = await supabase
            .from('admin_profiles')
            .update({ is_active: true, role: role })
            .eq('id', existingAdminProfile.id)

          if (updateError) {
            console.error('Failed to reactivate admin profile:', updateError)
            return {
              success: false,
              error: 'Failed to reactivate admin profile: ' + updateError.message
            }
          }
        }
        profileId = existingAdminProfile.id
        console.log('Admin profile already exists, using existing ID:', profileId)
      } else {
        // Create new admin profile
        const { data: profileData, error: profileError } = await supabase
          .from('admin_profiles')
          .insert({
            user_id: authUserId,
            email,
            name,
            role: role,
            is_active: true
          })
          .select('id')
          .single()

        if (profileError) {
          console.error('Failed to create admin profile:', profileError)
          return {
            success: false,
            error: 'Failed to create admin profile: ' + profileError.message
          }
        }

        profileId = profileData.id
        console.log('Created new admin profile with ID:', profileId)
      }

      // Send magic link for passwordless login
      const { error: magicLinkError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: window.location.origin
        }
      })

      if (magicLinkError) {
        console.warn('Magic link sending failed:', magicLinkError)
      }

      return {
        success: true,
        userId: profileId,
        message: `Admin account created successfully! ${magicLinkError ? 'Please contact an administrator for login assistance.' : 'A magic link has been sent to their email.'}`
      }
    } catch (error) {
      console.error('Create admin account error:', error)

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create admin account'
      }
    }
  }

  /**
   * Get current session from storage
   */
  static async getSession() {
    return await supabase.auth.getSession()
  }

  /**
   * Get current authenticated admin user
   */
  static async getCurrentUser(): Promise<AuthResponse> {
    try {
      console.log('SupabaseAuthService - Getting current user...')

      // Get current Supabase Auth user
      const { data: { user: authUser }, error: authError } = await supabase.auth.getUser()

      if (authError || !authUser) {
        console.log('SupabaseAuthService - No auth user found')
        return { user: null, error: null }
      }

      console.log('SupabaseAuthService - Auth user found:', authUser.email)

      // Get admin profile for this user (with timeout but proper validation)
      const { data: adminProfile, error: profileError } = await supabase
        .from('admin_profiles')
        .select('*')
        .eq('user_id', authUser.id)
        .eq('is_active', true)
        .maybeSingle()

      console.log('SupabaseAuthService - Admin profile query result:', {
        found: !!adminProfile,
        email: adminProfile?.email,
        error: profileError?.message
      })

      if (profileError || !adminProfile) {
        console.warn('SupabaseAuthService - No admin profile found for user')
        return {
          user: null,
          error: 'You do not have admin access. Please contact your administrator.'
        }
      }

      const user: AdminUser = {
        id: adminProfile.id,
        email: adminProfile.email,
        name: adminProfile.name,
        role: adminProfile.role,
        avatar_url: adminProfile.avatar_url,
        permissions: adminProfile.permissions,
        is_active: adminProfile.is_active,
        created_at: adminProfile.created_at,
        updated_at: adminProfile.updated_at
      }

      return { user, error: null }
    } catch (error) {
      console.error('Get current user error:', error)
      return {
        user: null,
        error: error instanceof Error ? error.message : 'Failed to get user'
      }
    }
  }

  /**
   * Sign out current user
   */
  static async signOut(): Promise<void> {
    try {
      await supabase.auth.signOut()
    } catch (error) {
      console.error('Sign out error:', error)
    }
  }

  /**
   * Listen to auth state changes
   */
  static onAuthStateChange(callback: (user: AdminUser | null) => void) {
    return supabase.auth.onAuthStateChange(async (event, session) => {
      try {
        console.log('SupabaseAuthService - Auth state change:', {
          event,
          hasSession: !!session,
          userEmail: session?.user?.email
        })

        if (event === 'SIGNED_IN' && session?.user) {
          console.log('SupabaseAuthService - SIGNED_IN event, getting current user...')

          // Add timeout to prevent hanging during initialization
          try {
            const timeoutPromise = new Promise<never>((_, reject) => {
              setTimeout(() => reject(new Error('Auth state getCurrentUser timeout')), 1500)
            })

            const userPromise = this.getCurrentUser()
            const { user } = await Promise.race([userPromise, timeoutPromise])

            console.log('SupabaseAuthService - getCurrentUser result:', {
              hasUser: !!user,
              email: user?.email
            })
            callback(user)
          } catch (timeoutError) {
            console.warn('SupabaseAuthService - getCurrentUser timed out during auth state change, skipping')
            // Don't call callback to avoid logout during initialization
            return
          }
        } else if (event === 'SIGNED_OUT') {
          console.log('SupabaseAuthService - SIGNED_OUT event')
          callback(null)
        } else {
          console.log('SupabaseAuthService - Other auth event:', event)
          // Don't call callback for other events to avoid unnecessary state changes
        }
      } catch (error) {
        console.error('SupabaseAuthService - Auth state change error:', error)
        // Don't automatically logout on errors during potential initialization
        console.log('SupabaseAuthService - Skipping callback due to error to avoid logout during init')
      }
    })
  }

  /**
   * Check if current user is authenticated as admin
   */
  static async isAuthenticated(): Promise<boolean> {
    const { user } = await this.getCurrentUser()
    return !!user && user.is_active
  }

  /**
   * Check if current user has specific admin role
   */
  static async hasRole(requiredRole: AdminUser['role']): Promise<boolean> {
    const { user } = await this.getCurrentUser()
    return !!user && user.is_active && user.role === requiredRole
  }

  /**
   * Check if current user is super admin
   */
  static async isSuperAdmin(): Promise<boolean> {
    return this.hasRole('super_admin')
  }

  /**
   * Get current auth user ID (for use with RLS policies)
   */
  static async getAuthUserId(): Promise<string | null> {
    try {
      const { data: { user }, error } = await supabase.auth.getUser()
      return error ? null : user?.id || null
    } catch {
      return null
    }
  }

  // =================================================================
  // TEAM-BASED PERMISSION FUNCTIONS
  // =================================================================

  /**
   * Check if current user is member of a specific team
   */
  static async isTeamMember(teamSlug: string): Promise<boolean> {
    try {
      const { data, error } = await supabase.rpc('admin_is_team_member', {
        team_slug_param: teamSlug
      })
      return error ? false : !!data
    } catch {
      return false
    }
  }

  /**
   * Check if current user has specific permission on a resource
   */
  static async hasResourcePermission(
    resourceType: 'events' | 'blog_posts' | 'blog_categories' | 'blog_tags' | 'scrapers' | 'scraper_jobs',
    permission: 'read' | 'update' | 'delete',
    resourceId?: string,
    resourceData?: Record<string, any>
  ): Promise<boolean> {
    try {
      const { data, error } = await supabase.rpc('admin_has_resource_permission', {
        resource_type_param: resourceType,
        permission_param: permission,
        resource_id_param: resourceId || null,
        resource_data: resourceData ? JSON.parse(JSON.stringify(resourceData)) : {}
      })
      return error ? false : !!data
    } catch {
      return false
    }
  }

  /**
   * Get current user's teams
   */
  static async getUserTeams(): Promise<Array<{
    team_id: string;
    team_name: string;
    team_slug: string;
    team_role: 'owner' | 'admin' | 'member';
  }>> {
    try {
      const { data, error } = await supabase.rpc('admin_get_user_teams')
      return error ? [] : data || []
    } catch {
      return []
    }
  }

  /**
   * Check if user has permission on a specific event (using new dual-level system)
   * Priority: Individual assignments > Scraper permissions > General team permissions
   */
  static async hasEventPermission(eventId: string, permission: 'read' | 'update' | 'delete'): Promise<boolean> {
    try {
      const { data, error } = await supabase.rpc('has_event_permission', {
        event_id_param: eventId,
        permission_param: permission
      })
      return error ? false : !!data
    } catch {
      return false
    }
  }

  /**
   * Check if user can delete a specific event (uses dual-level permission system)
   */
  static async canDeleteEvent(event: { id: string }): Promise<boolean> {
    return this.hasEventPermission(event.id, 'delete')
  }

  /**
   * Check if user can update a specific event (uses dual-level permission system)
   */
  static async canUpdateEvent(event: { id: string }): Promise<boolean> {
    return this.hasEventPermission(event.id, 'update')
  }

  /**
   * Check if user can read a specific event (uses dual-level permission system)
   */
  static async canReadEvent(event: { id: string }): Promise<boolean> {
    return this.hasEventPermission(event.id, 'read')
  }

  /**
   * Get permissions for multiple events at once (for performance)
   */
  static async getEventsPermissions(
    eventIds: string[],
    permissions: ('read' | 'update' | 'delete')[] = ['read', 'update', 'delete']
  ): Promise<Record<string, Record<string, boolean>>> {
    try {
      const { data, error } = await supabase.rpc('admin_get_events_permissions', {
        event_ids: eventIds,
        permissions_to_check: permissions
      })

      if (error || !data) return {}

      // Transform the result into a nested object structure
      const result: Record<string, Record<string, boolean>> = {}

      data.forEach((row: { event_id: string; permission: string; has_permission: boolean }) => {
        if (!result[row.event_id]) {
          result[row.event_id] = {}
        }
        result[row.event_id][row.permission] = row.has_permission
      })

      return result
    } catch {
      return {}
    }
  }

  /**
   * Get all events assigned to current user
   */
  static async getMyAssignedEvents(): Promise<Array<{
    event_id: string;
    assignment_type: 'individual' | 'team' | 'scraper';
    assignment_source: string;
    permissions: string[];
    expires_at: string | null;
  }>> {
    try {
      const { data, error } = await supabase.rpc('admin_get_my_assigned_events')
      return error ? [] : data || []
    } catch {
      return []
    }
  }

  // =================================================================
  // DUAL-LEVEL PERMISSION MANAGEMENT
  // =================================================================

  /**
   * Assign scraper permissions to team or individual user
   */
  static async assignScraperPermissions(
    scraperId: string,
    assignee: { teamId?: string; adminProfileId?: string },
    permissions: ('read' | 'update' | 'delete')[]
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('scrapers_permissions')
        .insert({
          scraper_id: scraperId,
          team_id: assignee.teamId || null,
          admin_profile_id: assignee.adminProfileId || null,
          permissions: permissions
        })

      if (error) {
        return { success: false, error: error.message }
      }

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to assign scraper permissions'
      }
    }
  }

  /**
   * Assign individual event permissions to team or user
   */
  static async assignEventPermissions(
    eventId: string,
    assignee: { teamId?: string; adminProfileId?: string },
    permissions: ('read' | 'update' | 'delete')[],
    options?: {
      expiresAt?: string; // ISO date string
      notes?: string;
    }
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('events_assignments')
        .insert({
          event_id: eventId,
          team_id: assignee.teamId || null,
          admin_profile_id: assignee.adminProfileId || null,
          permissions: permissions,
          expires_at: options?.expiresAt || null,
          notes: options?.notes || null
        })

      if (error) {
        return { success: false, error: error.message }
      }

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to assign event permissions'
      }
    }
  }

  /**
   * Remove scraper permissions
   */
  static async removeScraperPermissions(
    scraperId: string,
    assignee: { teamId?: string; adminProfileId?: string }
  ): Promise<{ success: boolean; error?: string }> {
    try {
      let query = supabase
        .from('scrapers_permissions')
        .delete()
        .eq('scraper_id', scraperId)

      if (assignee.teamId) {
        query = query.eq('team_id', assignee.teamId)
      } else if (assignee.adminProfileId) {
        query = query.eq('admin_profile_id', assignee.adminProfileId)
      }

      const { error } = await query

      if (error) {
        return { success: false, error: error.message }
      }

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to remove scraper permissions'
      }
    }
  }

  /**
   * Remove event assignment
   */
  static async removeEventAssignment(
    eventId: string,
    assignee: { teamId?: string; adminProfileId?: string }
  ): Promise<{ success: boolean; error?: string }> {
    try {
      let query = supabase
        .from('events_assignments')
        .delete()
        .eq('event_id', eventId)

      if (assignee.teamId) {
        query = query.eq('team_id', assignee.teamId)
      } else if (assignee.adminProfileId) {
        query = query.eq('admin_profile_id', assignee.adminProfileId)
      }

      const { error } = await query

      if (error) {
        return { success: false, error: error.message }
      }

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to remove event assignment'
      }
    }
  }

  /**
   * Get permission overview for admin UI
   */
  static async getPermissionOverview(): Promise<Array<{
    assignment_type: 'scraper' | 'individual';
    source_name: string;
    assignee: string;
    permissions: string[];
    expires_at: string | null;
    created_at: string;
    affected_events_count: number;
  }>> {
    try {
      const { data, error } = await supabase
        .from('admin_permission_overview')
        .select('*')
        .order('created_at', { ascending: false })

      return error ? [] : data || []
    } catch {
      return []
    }
  }

  /**
   * Update event with scraper information
   */
  static async updateEventScraperInfo(
    eventId: string,
    scraperInfo: {
      scraper_id?: string;
      event_source_url?: string;
      event_source_name?: string;
    }
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('events')
        .update(scraperInfo)
        .eq('id', eventId)

      if (error) {
        return { success: false, error: error.message }
      }

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update event scraper info'
      }
    }
  }

  // =================================================================
  // ADMIN MANAGEMENT FUNCTIONS (for super admins)
  // =================================================================

  /**
   * Create new admin user (requires super admin)
   */
  static async createAdminUser(
    email: string,
    name: string,
    role: AdminUser['role'] = 'admin'
  ): Promise<{ success: boolean; error?: string; userId?: string }> {
    try {
      // Check if current user is super admin
      if (!(await this.isSuperAdmin())) {
        return { success: false, error: 'Only super admins can create admin users' }
      }

      // Create auth user (they'll need to verify email and set password)
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email,
        email_confirm: false // They need to verify their email
      })

      if (authError || !authData.user) {
        return { success: false, error: authError?.message || 'Failed to create auth user' }
      }

      // Create admin profile
      const { data: profileData, error: profileError } = await supabase
        .from('admin_profiles')
        .insert({
          user_id: authData.user.id,
          email,
          name,
          role,
          is_active: true
        })
        .select()
        .single()

      if (profileError) {
        // Clean up auth user if profile creation failed
        await supabase.auth.admin.deleteUser(authData.user.id)
        return { success: false, error: profileError.message }
      }

      return { success: true, userId: profileData.id }
    } catch (error) {
      console.error('Create admin user error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create admin user'
      }
    }
  }

  /**
   * Update admin user (requires super admin or editing own profile)
   */
  static async updateAdminUser(
    adminId: string,
    updates: Partial<Pick<AdminUser, 'name' | 'role' | 'avatar_url' | 'is_active'>>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { user: currentUser } = await this.getCurrentUser()

      if (!currentUser) {
        return { success: false, error: 'Not authenticated' }
      }

      // Check permissions: super admin can edit anyone, others can only edit themselves
      const isSuperAdmin = currentUser.role === 'super_admin'
      const isEditingSelf = currentUser.id === adminId

      if (!isSuperAdmin && !isEditingSelf) {
        return { success: false, error: 'Insufficient permissions' }
      }

      // Don't allow non-super admins to change role or active status
      if (!isSuperAdmin) {
        delete updates.role
        delete updates.is_active
      }

      const { error } = await supabase
        .from('admin_profiles')
        .update(updates)
        .eq('id', adminId)

      if (error) {
        return { success: false, error: error.message }
      }

      return { success: true }
    } catch (error) {
      console.error('Update admin user error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update admin user'
      }
    }
  }

  /**
   * List all admin users (requires super admin)
   */
  static async listAdminUsers(): Promise<{ success: boolean; users?: AdminUser[]; error?: string }> {
    try {
      if (!(await this.isSuperAdmin())) {
        return { success: false, error: 'Only super admins can list admin users' }
      }

      const { data, error } = await supabase
        .from('admin_profiles')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) {
        return { success: false, error: error.message }
      }

      return { success: true, users: data || [] }
    } catch (error) {
      console.error('List admin users error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list admin users'
      }
    }
  }
}