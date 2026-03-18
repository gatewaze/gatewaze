// @ts-nocheck
/**
 * Custom hooks for permission management
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/app/contexts/auth/Provider';
import { PermissionsService } from '@/lib/permissions/service';
import type {
  AdminFeature,
  AdminPermission,
  AdminPermissionsMap,
  PermissionCheckResult,
  CalendarPermissionCheckResult,
  EventPermissionCheckResult,
  CalendarPermissionLevel,
} from '@/lib/permissions/types';

/**
 * Hook to check if the current user has a specific permission
 */
export function useHasPermission(
  feature: AdminFeature,
  accountId?: string | null
): PermissionCheckResult & { loading: boolean } {
  const { user } = useAuth();
  const [result, setResult] = useState<PermissionCheckResult>({
    hasPermission: false,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) {
      setResult({ hasPermission: false });
      setLoading(false);
      return;
    }

    let mounted = true;

    const checkPermission = async () => {
      setLoading(true);
      const permissionResult = await PermissionsService.hasPermission(
        user.id,
        feature,
        accountId
      );

      if (mounted) {
        setResult(permissionResult);
        setLoading(false);
      }
    };

    checkPermission();

    return () => {
      mounted = false;
    };
  }, [user?.id, feature, accountId]);

  return { ...result, loading };
}

/**
 * Hook to get all permissions for the current user
 */
export function usePermissions(accountId?: string | null) {
  const { user } = useAuth();
  const [permissions, setPermissions] = useState<AdminFeature[]>([]);
  const [permissionsMap, setPermissionsMap] = useState<AdminPermissionsMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const loadPermissions = useCallback(async () => {
    if (!user?.id) {
      setPermissions([]);
      setPermissionsMap({});
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const [features, map] = await Promise.all([
        PermissionsService.getAdminFeatures(user.id, accountId),
        PermissionsService.getPermissionsMap(user.id, accountId),
      ]);

      setPermissions(features);
      setPermissionsMap(map);
    } catch (err) {
      setError(err as Error);
      console.error('Error loading permissions:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.id, accountId]);

  useEffect(() => {
    loadPermissions();
  }, [loadPermissions]);

  const hasPermission = useCallback(
    (feature: AdminFeature): boolean => {
      return permissionsMap[feature] === true;
    },
    [permissionsMap]
  );

  const hasAnyPermission = useCallback(
    (features: AdminFeature[]): boolean => {
      return features.some(feature => permissionsMap[feature] === true);
    },
    [permissionsMap]
  );

  const hasAllPermissions = useCallback(
    (features: AdminFeature[]): boolean => {
      return features.every(feature => permissionsMap[feature] === true);
    },
    [permissionsMap]
  );

  return {
    permissions,
    permissionsMap,
    loading,
    error,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    reload: loadPermissions,
  };
}

/**
 * Hook to get direct permissions (non-group) for an admin
 */
export function useAdminPermissions(adminId?: string) {
  const { user } = useAuth();
  const [permissions, setPermissions] = useState<AdminPermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const targetAdminId = adminId || user?.id;

  const loadPermissions = useCallback(async () => {
    if (!targetAdminId) {
      setPermissions([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const data = await PermissionsService.getAdminPermissions(targetAdminId);
      setPermissions(data);
    } catch (err) {
      setError(err as Error);
      console.error('Error loading admin permissions:', err);
    } finally {
      setLoading(false);
    }
  }, [targetAdminId]);

  useEffect(() => {
    loadPermissions();
  }, [loadPermissions]);

  return {
    permissions,
    loading,
    error,
    reload: loadPermissions,
  };
}

/**
 * Hook for managing permissions (requires super_admin role)
 */
export function usePermissionManagement() {
  const { user } = useAuth();

  const grantPermission = useCallback(
    async (
      adminId: string,
      feature: AdminFeature,
      accountId?: string | null,
      expiresAt?: string | null
    ) => {
      if (!user?.id) {
        throw new Error('User not authenticated');
      }

      return await PermissionsService.grantPermission(
        {
          admin_id: adminId,
          feature,
          account_id: accountId,
          expires_at: expiresAt,
        },
        user.id
      );
    },
    [user?.id]
  );

  const revokePermission = useCallback(
    async (
      adminId: string,
      feature: AdminFeature,
      accountId?: string | null
    ) => {
      if (!user?.id) {
        throw new Error('User not authenticated');
      }

      return await PermissionsService.revokePermission(
        {
          admin_id: adminId,
          feature,
          account_id: accountId,
        },
        user.id
      );
    },
    [user?.id]
  );

  const assignGroup = useCallback(
    async (
      adminId: string,
      groupId: string,
      accountId?: string | null,
      expiresAt?: string | null
    ) => {
      if (!user?.id) {
        throw new Error('User not authenticated');
      }

      return await PermissionsService.assignGroup(
        {
          admin_id: adminId,
          group_id: groupId,
          account_id: accountId,
          expires_at: expiresAt,
        },
        user.id
      );
    },
    [user?.id]
  );

  const unassignGroup = useCallback(
    async (
      adminId: string,
      groupId: string,
      accountId?: string | null
    ) => {
      if (!user?.id) {
        throw new Error('User not authenticated');
      }

      return await PermissionsService.unassignGroup(
        adminId,
        groupId,
        accountId,
        user.id
      );
    },
    [user?.id]
  );

  return {
    grantPermission,
    revokePermission,
    assignGroup,
    unassignGroup,
  };
}

/**
 * Hook to get permission groups
 */
export function usePermissionGroups() {
  const [groups, setGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const loadGroups = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const data = await PermissionsService.getPermissionGroups();
      setGroups(data);
    } catch (err) {
      setError(err as Error);
      console.error('Error loading permission groups:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  return {
    groups,
    loading,
    error,
    reload: loadGroups,
  };
}

// =========================================================================
// Calendar and Event Permission Hooks
// =========================================================================

/**
 * Hook to check if the current user can access a specific calendar
 */
export function useCalendarPermission(calendarId: string | null | undefined) {
  const { user } = useAuth();
  const [result, setResult] = useState<CalendarPermissionCheckResult>({
    hasPermission: false,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id || !calendarId) {
      setResult({ hasPermission: false });
      setLoading(false);
      return;
    }

    let mounted = true;

    const checkPermission = async () => {
      setLoading(true);
      const permissionResult = await PermissionsService.canAccessCalendar(
        user.id,
        calendarId
      );

      if (mounted) {
        setResult(permissionResult);
        setLoading(false);
      }
    };

    checkPermission();

    return () => {
      mounted = false;
    };
  }, [user?.id, calendarId]);

  return { ...result, loading };
}

/**
 * Hook to check if the current user can access a specific event
 */
export function useEventPermission(eventId: string | null | undefined) {
  const { user } = useAuth();
  const [result, setResult] = useState<EventPermissionCheckResult>({
    hasPermission: false,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id || !eventId) {
      setResult({ hasPermission: false });
      setLoading(false);
      return;
    }

    let mounted = true;

    const checkPermission = async () => {
      setLoading(true);
      const permissionResult = await PermissionsService.canAccessEvent(
        user.id,
        eventId
      );

      if (mounted) {
        setResult(permissionResult);
        setLoading(false);
      }
    };

    checkPermission();

    return () => {
      mounted = false;
    };
  }, [user?.id, eventId]);

  return { ...result, loading };
}

/**
 * Hook to get all calendars the current user can access
 */
export function useAccessibleCalendars() {
  const { user } = useAuth();
  const [calendars, setCalendars] = useState<{ calendar_id: string; permission_level: CalendarPermissionLevel }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const loadCalendars = useCallback(async () => {
    if (!user?.id) {
      setCalendars([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const data = await PermissionsService.getAdminCalendars(user.id);
      setCalendars(data);
    } catch (err) {
      setError(err as Error);
      console.error('Error loading accessible calendars:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadCalendars();
  }, [loadCalendars]);

  return {
    calendars,
    loading,
    error,
    reload: loadCalendars,
  };
}

/**
 * Hook for managing calendar permissions
 */
export function useCalendarPermissionManagement() {
  const { user } = useAuth();

  const grantCalendarPermission = useCallback(
    async (
      adminId: string,
      calendarId: string,
      permissionLevel?: CalendarPermissionLevel,
      expiresAt?: string | null
    ) => {
      if (!user?.id) {
        throw new Error('User not authenticated');
      }

      return await PermissionsService.grantCalendarPermission(
        {
          admin_id: adminId,
          calendar_id: calendarId,
          permission_level: permissionLevel,
          expires_at: expiresAt,
        },
        user.id
      );
    },
    [user?.id]
  );

  const revokeCalendarPermission = useCallback(
    async (adminId: string, calendarId: string) => {
      return await PermissionsService.revokeCalendarPermission(adminId, calendarId);
    },
    []
  );

  const grantEventPermission = useCallback(
    async (
      adminId: string,
      eventId: string,
      permissionLevel?: CalendarPermissionLevel,
      expiresAt?: string | null
    ) => {
      if (!user?.id) {
        throw new Error('User not authenticated');
      }

      return await PermissionsService.grantEventPermission(
        {
          admin_id: adminId,
          event_id: eventId,
          permission_level: permissionLevel,
          expires_at: expiresAt,
        },
        user.id
      );
    },
    [user?.id]
  );

  const revokeEventPermission = useCallback(
    async (adminId: string, eventId: string) => {
      return await PermissionsService.revokeEventPermission(adminId, eventId);
    },
    []
  );

  const getCalendarAdmins = useCallback(
    async (calendarId: string) => {
      return await PermissionsService.getCalendarAdmins(calendarId);
    },
    []
  );

  const getEventAdmins = useCallback(
    async (eventId: string) => {
      return await PermissionsService.getEventAdmins(eventId);
    },
    []
  );

  return {
    grantCalendarPermission,
    revokeCalendarPermission,
    grantEventPermission,
    revokeEventPermission,
    getCalendarAdmins,
    getEventAdmins,
  };
}
