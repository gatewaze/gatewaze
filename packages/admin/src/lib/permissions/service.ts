/**
 * Admin permissions service
 * Handles all permission-related operations
 */

import { supabase } from '@/lib/supabase';
import type {
  AdminFeature,
  AdminPermission,
  PermissionGroup,
  PermissionGroupAssignment,
  GrantPermissionRequest,
  RevokePermissionRequest,
  AssignGroupRequest,
  CreatePermissionGroupRequest,
  UpdatePermissionGroupRequest,
  PermissionCheckResult,
  AdminPermissionsMap,
  PermissionAuditLog,
  AdminCalendarPermission,
  AdminEventPermission,
  CalendarPermissionLevel,
  GrantCalendarPermissionRequest,
  GrantEventPermissionRequest,
  CalendarPermissionCheckResult,
  EventPermissionCheckResult,
} from './types';

export class PermissionsService {
  /**
   * Check if an admin has permission for a specific feature
   */
  static async hasPermission(
    adminId: string,
    feature: AdminFeature,
    accountId?: string | null
  ): Promise<PermissionCheckResult> {
    try {
      const { data, error } = await supabase.rpc('admin_has_feature_permission', {
        p_admin_id: adminId,
        p_feature: feature,
        p_account_id: accountId === null || accountId === undefined || accountId === 'null' ? null : accountId,
      });

      if (error) throw error;

      return {
        hasPermission: data === true,
      };
    } catch (error) {
      console.error('Error checking permission:', error);
      return { hasPermission: false };
    }
  }

  /**
   * Get all features an admin has access to
   */
  static async getAdminFeatures(
    adminId: string,
    accountId?: string | null
  ): Promise<AdminFeature[]> {
    try {
      const { data, error } = await supabase.rpc('admin_get_features', {
        p_admin_id: adminId,
      });

      if (error) throw error;

      return (data || []).map((row: { feature: AdminFeature }) => row.feature);
    } catch (error) {
      console.error('Error getting admin features:', error);
      return [];
    }
  }

  /**
   * Get permissions map for quick lookups
   */
  static async getPermissionsMap(
    adminId: string,
    accountId?: string | null
  ): Promise<AdminPermissionsMap> {
    const features = await this.getAdminFeatures(adminId, accountId);
    const map: AdminPermissionsMap = {};

    features.forEach(feature => {
      map[feature] = true;
    });

    return map;
  }

  /**
   * Get all permissions for an admin
   */
  static async getAdminPermissions(adminId: string): Promise<AdminPermission[]> {
    try {
      const { data, error } = await supabase
        .from('admin_permissions')
        .select('*')
        .eq('admin_id', adminId)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return data || [];
    } catch (error) {
      console.error('Error fetching admin permissions:', error);
      return [];
    }
  }

  /**
   * Grant a permission to an admin
   */
  static async grantPermission(
    request: GrantPermissionRequest,
    grantedBy?: string
  ): Promise<AdminPermission | null> {
    try {
      const { data, error } = await supabase
        .from('admin_permissions')
        .upsert({
          admin_id: request.admin_id,
          feature: request.feature,
          account_id: request.account_id || null,
          granted_by: grantedBy,
          expires_at: request.expires_at || null,
          is_active: true,
        }, {
          onConflict: 'admin_id,feature,account_id',
        })
        .select()
        .single();

      if (error) throw error;

      // Create audit log
      await this.createAuditLog({
        admin_id: request.admin_id,
        action: 'granted',
        feature: request.feature,
        permission_id: data.id,
        account_id: request.account_id || null,
        performed_by: grantedBy || null,
        metadata: { expires_at: request.expires_at },
      });

      return data;
    } catch (error) {
      console.error('Error granting permission:', error);
      return null;
    }
  }

  /**
   * Grant multiple permissions at once
   */
  static async grantPermissions(
    requests: GrantPermissionRequest[],
    grantedBy?: string
  ): Promise<boolean> {
    try {
      const permissions = requests.map(req => ({
        admin_id: req.admin_id,
        feature: req.feature,
        account_id: req.account_id || null,
        granted_by: grantedBy,
        expires_at: req.expires_at || null,
        is_active: true,
      }));

      const { error } = await supabase
        .from('admin_permissions')
        .upsert(permissions, {
          onConflict: 'admin_id,feature,account_id',
        });

      if (error) throw error;

      return true;
    } catch (error) {
      console.error('Error granting permissions:', error);
      return false;
    }
  }

  /**
   * Revoke a permission from an admin
   */
  static async revokePermission(
    request: RevokePermissionRequest,
    revokedBy?: string
  ): Promise<boolean> {
    try {
      // Build query for finding the permission
      let selectQuery = supabase
        .from('admin_permissions')
        .select('id')
        .eq('admin_id', request.admin_id)
        .eq('feature', request.feature);

      // Handle account_id - use .is() for null, .eq() for actual values
      if (request.account_id) {
        selectQuery = selectQuery.eq('account_id', request.account_id);
      } else {
        selectQuery = selectQuery.is('account_id', null);
      }

      const { data: permission } = await selectQuery.single();

      // Build update query
      let updateQuery = supabase
        .from('admin_permissions')
        .update({ is_active: false })
        .eq('admin_id', request.admin_id)
        .eq('feature', request.feature);

      // Handle account_id - use .is() for null, .eq() for actual values
      if (request.account_id) {
        updateQuery = updateQuery.eq('account_id', request.account_id);
      } else {
        updateQuery = updateQuery.is('account_id', null);
      }

      const { error } = await updateQuery;

      if (error) throw error;

      // Create audit log
      await this.createAuditLog({
        admin_id: request.admin_id,
        action: 'revoked',
        feature: request.feature,
        permission_id: permission?.id || null,
        account_id: request.account_id || null,
        performed_by: revokedBy || null,
      });

      return true;
    } catch (error) {
      console.error('Error revoking permission:', error);
      return false;
    }
  }

  /**
   * Get all permission groups
   */
  static async getPermissionGroups(): Promise<PermissionGroup[]> {
    try {
      const { data, error } = await supabase
        .from('admin_permission_groups')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;

      return data || [];
    } catch (error) {
      console.error('Error fetching permission groups:', error);
      return [];
    }
  }

  /**
   * Get a permission group with its features
   */
  static async getPermissionGroup(groupId: string) {
    try {
      const { data: group, error: groupError } = await supabase
        .from('admin_permission_groups')
        .select('*')
        .eq('id', groupId)
        .single();

      if (groupError) throw groupError;

      const { data: features, error: featuresError } = await supabase
        .from('admin_permission_group_features')
        .select('feature')
        .eq('group_id', groupId);

      if (featuresError) throw featuresError;

      return {
        ...group,
        features: features?.map(f => f.feature) || [],
      };
    } catch (error) {
      console.error('Error fetching permission group:', error);
      return null;
    }
  }

  /**
   * Create a permission group
   */
  static async createPermissionGroup(
    request: CreatePermissionGroupRequest
  ): Promise<PermissionGroup | null> {
    try {
      const { data: group, error: groupError } = await supabase
        .from('admin_permission_groups')
        .insert({
          name: request.name,
          description: request.description || null,
        })
        .select()
        .single();

      if (groupError) throw groupError;

      if (request.features.length > 0) {
        const features = request.features.map(feature => ({
          group_id: group.id,
          feature,
        }));

        const { error: featuresError } = await supabase
          .from('admin_permission_group_features')
          .insert(features);

        if (featuresError) throw featuresError;
      }

      return group;
    } catch (error) {
      console.error('Error creating permission group:', error);
      return null;
    }
  }

  /**
   * Update a permission group
   */
  static async updatePermissionGroup(
    groupId: string,
    request: UpdatePermissionGroupRequest
  ): Promise<boolean> {
    try {
      // Update group metadata
      if (request.name || request.description !== undefined || request.is_active !== undefined) {
        const updates: { name?: string; description?: string; is_active?: boolean } = {};
        if (request.name) updates.name = request.name;
        if (request.description !== undefined) updates.description = request.description;
        if (request.is_active !== undefined) updates.is_active = request.is_active;

        const { error } = await supabase
          .from('admin_permission_groups')
          .update(updates)
          .eq('id', groupId);

        if (error) throw error;
      }

      // Update features if provided
      if (request.features) {
        // Delete existing features
        await supabase
          .from('admin_permission_group_features')
          .delete()
          .eq('group_id', groupId);

        // Insert new features
        if (request.features.length > 0) {
          const features = request.features.map(feature => ({
            group_id: groupId,
            feature,
          }));

          const { error } = await supabase
            .from('admin_permission_group_features')
            .insert(features);

          if (error) throw error;
        }
      }

      return true;
    } catch (error) {
      console.error('Error updating permission group:', error);
      return false;
    }
  }

  /**
   * Delete a permission group
   */
  static async deletePermissionGroup(groupId: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('admin_permission_groups')
        .update({ is_active: false })
        .eq('id', groupId);

      if (error) throw error;

      return true;
    } catch (error) {
      console.error('Error deleting permission group:', error);
      return false;
    }
  }

  /**
   * Assign a group to an admin
   */
  static async assignGroup(
    request: AssignGroupRequest,
    assignedBy?: string
  ): Promise<PermissionGroupAssignment | null> {
    try {
      const { data, error } = await supabase
        .from('admin_permission_group_assignments')
        .upsert({
          admin_id: request.admin_id,
          group_id: request.group_id,
          account_id: request.account_id || null,
          assigned_by: assignedBy,
          expires_at: request.expires_at || null,
          is_active: true,
        }, {
          onConflict: 'admin_id,group_id,account_id',
        })
        .select()
        .single();

      if (error) throw error;

      // Create audit log
      await this.createAuditLog({
        admin_id: request.admin_id,
        action: 'granted',
        group_id: request.group_id,
        account_id: request.account_id || null,
        performed_by: assignedBy || null,
        metadata: { expires_at: request.expires_at },
      });

      return data;
    } catch (error) {
      console.error('Error assigning group:', error);
      return null;
    }
  }

  /**
   * Unassign a group from an admin
   */
  static async unassignGroup(
    adminId: string,
    groupId: string,
    accountId?: string | null,
    unassignedBy?: string
  ): Promise<boolean> {
    try {
      // Build update query
      let updateQuery = supabase
        .from('admin_permission_group_assignments')
        .update({ is_active: false })
        .eq('admin_id', adminId)
        .eq('group_id', groupId);

      // Handle account_id - use .is() for null, .eq() for actual values
      if (accountId) {
        updateQuery = updateQuery.eq('account_id', accountId);
      } else {
        updateQuery = updateQuery.is('account_id', null);
      }

      const { error } = await updateQuery;

      if (error) throw error;

      // Create audit log
      await this.createAuditLog({
        admin_id: adminId,
        action: 'revoked',
        group_id: groupId,
        account_id: accountId || null,
        performed_by: unassignedBy || null,
      });

      return true;
    } catch (error) {
      console.error('Error unassigning group:', error);
      return false;
    }
  }

  /**
   * Get admin group assignments
   */
  static async getAdminGroupAssignments(
    adminId: string
  ): Promise<PermissionGroupAssignment[]> {
    try {
      const { data, error } = await supabase
        .from('admin_permission_group_assignments')
        .select('*, admin_permission_groups(*)')
        .eq('admin_id', adminId)
        .eq('is_active', true);

      if (error) throw error;

      return data || [];
    } catch (error) {
      console.error('Error fetching admin group assignments:', error);
      return [];
    }
  }

  /**
   * Create audit log entry
   */
  private static async createAuditLog(
    log: Partial<Omit<PermissionAuditLog, 'id' | 'created_at'>> & { admin_id: string; action: PermissionAuditLog['action'] }
  ): Promise<void> {
    try {
      await supabase.from('admin_permission_audit').insert(log);
    } catch (error) {
      console.error('Error creating audit log:', error);
    }
  }

  /**
   * Get audit logs for an admin
   */
  static async getAuditLogs(
    adminId?: string,
    limit: number = 100
  ): Promise<PermissionAuditLog[]> {
    try {
      let query = supabase
        .from('admin_permission_audit')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (adminId) {
        query = query.eq('admin_id', adminId);
      }

      const { data, error } = await query;

      if (error) throw error;

      return data || [];
    } catch (error) {
      console.error('Error fetching audit logs:', error);
      return [];
    }
  }

  /**
   * Expire permissions that have passed their expiration date
   */
  static async expirePermissions(): Promise<number> {
    try {
      const { data, error } = await supabase
        .from('admin_permissions')
        .update({ is_active: false })
        .lt('expires_at', new Date().toISOString())
        .eq('is_active', true)
        .select('id');

      if (error) throw error;

      return data?.length || 0;
    } catch (error) {
      console.error('Error expiring permissions:', error);
      return 0;
    }
  }

  // =========================================================================
  // Calendar Permission Methods
  // =========================================================================

  /**
   * Check if an admin can access a specific calendar
   */
  static async canAccessCalendar(
    adminId: string,
    calendarId: string
  ): Promise<CalendarPermissionCheckResult> {
    try {
      const { data, error } = await supabase.rpc('can_admin_calendar', {
        p_admin_id: adminId,
        p_calendar_id: calendarId,
      });

      if (error) throw error;

      if (data === true) {
        // Get the permission level
        const { data: permission } = await supabase
          .from('admin_calendar_permissions')
          .select('permission_level, expires_at')
          .eq('admin_id', adminId)
          .eq('calendar_id', calendarId)
          .eq('is_active', true)
          .maybeSingle();

        return {
          hasPermission: true,
          permissionLevel: permission?.permission_level || 'manage',
          source: permission ? 'direct' : 'super_admin',
          expires_at: permission?.expires_at,
        };
      }

      return { hasPermission: false };
    } catch (error) {
      console.error('Error checking calendar permission:', error);
      return { hasPermission: false };
    }
  }

  /**
   * Check if an admin can access a specific event
   */
  static async canAccessEvent(
    adminId: string,
    eventId: string
  ): Promise<EventPermissionCheckResult> {
    try {
      const { data, error } = await supabase.rpc('can_admin_event', {
        p_admin_id: adminId,
        p_event_id: eventId,
      });

      if (error) throw error;

      if (data === true) {
        // Check direct event permission first
        const { data: directPermission } = await supabase
          .from('admin_event_permissions')
          .select('permission_level, expires_at')
          .eq('admin_id', adminId)
          .eq('event_id', eventId)
          .eq('is_active', true)
          .maybeSingle();

        if (directPermission) {
          return {
            hasPermission: true,
            permissionLevel: directPermission.permission_level,
            source: 'direct',
            expires_at: directPermission.expires_at,
          };
        }

        // Check calendar-based permission
        const { data: calendarPermission } = await supabase
          .from('admin_calendar_permissions')
          .select('permission_level, expires_at, calendar_events!inner(event_id)')
          .eq('admin_id', adminId)
          .eq('is_active', true)
          .eq('calendar_events.event_id', eventId)
          .maybeSingle();

        if (calendarPermission) {
          return {
            hasPermission: true,
            permissionLevel: calendarPermission.permission_level,
            source: 'calendar',
            expires_at: calendarPermission.expires_at,
          };
        }

        // Must be super admin
        return {
          hasPermission: true,
          permissionLevel: 'manage',
          source: 'super_admin',
        };
      }

      return { hasPermission: false };
    } catch (error) {
      console.error('Error checking event permission:', error);
      return { hasPermission: false };
    }
  }

  /**
   * Get all calendars an admin can access
   */
  static async getAdminCalendars(adminId: string): Promise<{ calendar_id: string; permission_level: CalendarPermissionLevel }[]> {
    try {
      const { data, error } = await supabase.rpc('admin_get_calendars', {
        p_admin_id: adminId,
      });

      if (error) throw error;

      return data || [];
    } catch (error) {
      console.error('Error getting admin calendars:', error);
      return [];
    }
  }

  /**
   * Get all events an admin can access
   */
  static async getAdminAccessibleEvents(adminId: string): Promise<{ event_id: string; permission_level: CalendarPermissionLevel; permission_source: string }[]> {
    try {
      const { data, error } = await supabase.rpc('admin_get_events', {
        p_admin_id: adminId,
      });

      if (error) throw error;

      return data || [];
    } catch (error) {
      console.error('Error getting admin events:', error);
      return [];
    }
  }

  /**
   * Grant calendar permission to an admin
   */
  static async grantCalendarPermission(
    request: GrantCalendarPermissionRequest,
    grantedBy?: string
  ): Promise<AdminCalendarPermission | null> {
    try {
      const { data, error } = await supabase
        .from('admin_calendar_permissions')
        .upsert({
          admin_id: request.admin_id,
          calendar_id: request.calendar_id,
          permission_level: request.permission_level || 'view',
          granted_by: grantedBy,
          expires_at: request.expires_at || null,
          is_active: true,
        }, {
          onConflict: 'admin_id,calendar_id',
        })
        .select()
        .single();

      if (error) throw error;

      return data;
    } catch (error) {
      console.error('Error granting calendar permission:', error);
      return null;
    }
  }

  /**
   * Revoke calendar permission from an admin
   */
  static async revokeCalendarPermission(
    adminId: string,
    calendarId: string
  ): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('admin_calendar_permissions')
        .update({ is_active: false })
        .eq('admin_id', adminId)
        .eq('calendar_id', calendarId);

      if (error) throw error;

      return true;
    } catch (error) {
      console.error('Error revoking calendar permission:', error);
      return false;
    }
  }

  /**
   * Get all admin permissions for a calendar
   */
  static async getCalendarAdmins(calendarId: string): Promise<AdminCalendarPermission[]> {
    try {
      const { data, error } = await supabase
        .from('admin_calendar_permissions')
        .select('*, admin_profiles!admin_calendar_permissions_admin_id_fkey(id, email, name, role)')
        .eq('calendar_id', calendarId)
        .eq('is_active', true)
        .order('granted_at', { ascending: false });

      if (error) throw error;

      return data || [];
    } catch (error) {
      console.error('Error fetching calendar admins:', error);
      return [];
    }
  }

  /**
   * Grant event permission to an admin
   */
  static async grantEventPermission(
    request: GrantEventPermissionRequest,
    grantedBy?: string
  ): Promise<AdminEventPermission | null> {
    try {
      const { data, error } = await supabase
        .from('admin_event_permissions')
        .upsert({
          admin_id: request.admin_id,
          event_id: request.event_id,
          permission_level: request.permission_level || 'view',
          granted_by: grantedBy,
          expires_at: request.expires_at || null,
          is_active: true,
        }, {
          onConflict: 'admin_id,event_id',
        })
        .select()
        .single();

      if (error) throw error;

      return data;
    } catch (error) {
      console.error('Error granting event permission:', error);
      return null;
    }
  }

  /**
   * Revoke event permission from an admin
   */
  static async revokeEventPermission(
    adminId: string,
    eventId: string
  ): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('admin_event_permissions')
        .update({ is_active: false })
        .eq('admin_id', adminId)
        .eq('event_id', eventId);

      if (error) throw error;

      return true;
    } catch (error) {
      console.error('Error revoking event permission:', error);
      return false;
    }
  }

  /**
   * Get all admin permissions for an event
   */
  static async getEventAdmins(eventId: string): Promise<AdminEventPermission[]> {
    try {
      const { data, error } = await supabase
        .from('admin_event_permissions')
        .select('*, admin_profiles(id, email, name, role)')
        .eq('event_id', eventId)
        .eq('is_active', true)
        .order('granted_at', { ascending: false });

      if (error) throw error;

      return data || [];
    } catch (error) {
      console.error('Error fetching event admins:', error);
      return [];
    }
  }
}

export default PermissionsService;
