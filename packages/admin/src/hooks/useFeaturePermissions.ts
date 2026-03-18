import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/app/contexts/auth/useAuth';
import { getSupabase } from '@/lib/supabase';
import { isFeatureEnabled } from '@/config/modules';
import type { AdminPermissionsMap } from '@gatewaze/shared';

export function useFeaturePermissions() {
  const { user } = useAuth();
  const [permissions, setPermissions] = useState<AdminPermissionsMap>({});
  const [isLoading, setIsLoading] = useState(true);

  const isSuperAdmin = user?.role === 'super_admin';

  const fetchPermissions = useCallback(async () => {
    if (!user) {
      setPermissions({});
      setIsLoading(false);
      return;
    }

    if (isSuperAdmin) {
      setPermissions({});
      setIsLoading(false);
      return;
    }

    try {
      const supabase = getSupabase();
      const { data } = await supabase.rpc('get_admin_features', {
        p_admin_id: user.id,
      });

      const map: AdminPermissionsMap = {};
      if (data) {
        for (const feature of data) {
          map[feature] = true;
        }
      }
      setPermissions(map);
    } catch (error) {
      console.error('Failed to fetch permissions:', error);
    } finally {
      setIsLoading(false);
    }
  }, [user, isSuperAdmin]);

  useEffect(() => {
    fetchPermissions();
  }, [fetchPermissions]);

  const hasFeature = useCallback(
    (feature: string): boolean => {
      if (!isFeatureEnabled(feature)) return false;
      if (isSuperAdmin) return true;
      return permissions[feature] === true;
    },
    [permissions, isSuperAdmin],
  );

  const hasAnyFeature = useCallback(
    (features: string[]): boolean => features.some(hasFeature),
    [hasFeature],
  );

  const hasAllFeatures = useCallback(
    (features: string[]): boolean => features.every(hasFeature),
    [hasFeature],
  );

  return useMemo(
    () => ({
      permissions,
      isLoading,
      isSuperAdmin,
      hasFeature,
      hasAnyFeature,
      hasAllFeatures,
      refetch: fetchPermissions,
    }),
    [permissions, isLoading, isSuperAdmin, hasFeature, hasAnyFeature, hasAllFeatures, fetchPermissions],
  );
}
