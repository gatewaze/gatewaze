/**
 * Navigation Permission Utilities
 * Filter navigation items based on user permissions and brand features
 */

import type { NavigationTree } from '@/@types/navigation';
import type { AdminFeature, AdminPermissionsMap } from '@/lib/permissions/types';
import { isFeatureEnabled } from '@/config/brands';
import type { BrandFeatures } from '@/config/brands';

/**
 * Map navigation paths to required features
 * This defines which permission is needed to see each navigation item
 */
export const NAVIGATION_PERMISSIONS: Record<string, AdminFeature> = {
  // Root-level routes (formerly dashboard routes)
  '/home': 'dashboard_home',
  '/people': 'dashboard_people',
  '/events': 'events',

  // Admin routes
  '/admin/users': 'users',
  '/admin/accounts': 'accounts',
  '/admin/events': 'events',
  '/admin/scrapers': 'scrapers',

  // Blog routes (now root level)
  '/blog': 'blog',
  '/blog/posts': 'blog',

  // Account-specific routes
  '/competitions': 'competitions',
  '/discounts': 'discounts',
  '/offers': 'offers',
  '/cohorts': 'cohorts',

  // Settings
  '/admin/settings': 'settings',
};

/**
 * Map admin features to brand features
 * This connects user permissions to brand-level feature flags
 * Only features that have a brand-level toggle are included
 */
export const ADMIN_TO_BRAND_FEATURE: Partial<Record<AdminFeature, keyof BrandFeatures>> = {
  'competitions': 'competitions',
  'discounts': 'discounts',
  'offers': 'offers',
  'cohorts': 'cohorts',
  'blog': 'blog',
  'scrapers': 'scrapers',
  'events': 'events',
  'dashboard_people': 'members',
  'slack': 'slack',
};

/**
 * Check if a brand feature is enabled for the given admin feature
 * Returns true if there's no brand feature mapping (feature is always available)
 */
export function isBrandFeatureEnabledForAdmin(adminFeature: AdminFeature): boolean {
  const brandFeature = ADMIN_TO_BRAND_FEATURE[adminFeature];
  if (!brandFeature) {
    // No brand feature mapping, so it's always available
    return true;
  }
  return isFeatureEnabled(brandFeature);
}

/**
 * Check if a navigation item should be visible based on permissions
 */
export function hasNavigationPermission(
  path: string,
  permissionsMap: AdminPermissionsMap,
  isSuperAdmin: boolean = false
): boolean {
  // Super admins can see everything
  if (isSuperAdmin) {
    return true;
  }

  // If no permission mapping exists, allow by default (for backwards compatibility)
  const requiredFeature = NAVIGATION_PERMISSIONS[path];
  if (!requiredFeature) {
    return true;
  }

  // Check if user has the required permission
  return permissionsMap[requiredFeature] === true;
}

/**
 * Filter navigation tree based on user permissions and brand features
 * Recursively filters out items the user doesn't have permission to see
 * or that are disabled for the current brand
 */
export function filterNavigationByPermissions(
  navigation: NavigationTree[],
  permissionsMap: AdminPermissionsMap,
  isSuperAdmin: boolean = false,
  isModuleFeatureEnabled?: (feature: string) => boolean,
  /**
   * Set of all feature strings owned by any module in the DB.
   * Used to distinguish module features from core features.
   * When omitted, every feature with a truthy `isModuleFeatureEnabled`
   * callback is treated as module-owned (safe fallback).
   */
  allModuleFeatures?: Set<string>,
): NavigationTree[] {
  return navigation
    .map((item) => {
      // First, check brand feature - this applies to everyone, even super admins
      // If the brand doesn't support this feature, hide it completely
      if ('requiredFeature' in item && item.requiredFeature) {
        const brandFeatureEnabled = isBrandFeatureEnabledForAdmin(item.requiredFeature as AdminFeature);
        if (!brandFeatureEnabled) {
          return null;
        }

        // Check if the feature's module is enabled in the DB.
        // Module features are checked against the set of all features from enabled modules.
        // Core features (not owned by any module) won't be in the set, so we only
        // hide items whose feature is known to the module system but not enabled.
        if (isModuleFeatureEnabled) {
          const isModuleOwned = allModuleFeatures
            ? allModuleFeatures.has(item.requiredFeature)
            : true; // conservative: treat as module-owned when set unavailable
          if (isModuleOwned && !isModuleFeatureEnabled(item.requiredFeature)) {
            return null;
          }
        }
      }

      // Super admins can see everything that's available for the brand
      if (isSuperAdmin) {
        // Still need to recursively filter children for super admins
        if (item.childs && item.childs.length > 0) {
          return {
            ...item,
            childs: filterNavigationByPermissions(item.childs, permissionsMap, isSuperAdmin, isModuleFeatureEnabled, allModuleFeatures),
          };
        }
        return item;
      }

      // For non-super-admins, also check user permissions
      if ('requiredFeature' in item && item.requiredFeature) {
        const hasPermission = permissionsMap[item.requiredFeature as AdminFeature] === true;
        if (!hasPermission) {
          return null;
        }
      }
      // Fallback to path-based check for items without requiredFeature
      else if (item.path && item.type === 'item') {
        const hasPermission = hasNavigationPermission(item.path, permissionsMap, isSuperAdmin);
        if (!hasPermission) {
          return null;
        }
      }

      // If item has children, filter them recursively
      if (item.childs && item.childs.length > 0) {
        const filteredChildren = filterNavigationByPermissions(
          item.childs,
          permissionsMap,
          isSuperAdmin,
          isModuleFeatureEnabled,
          allModuleFeatures,
        );

        // If all children are filtered out, hide the parent too
        if (filteredChildren.length === 0) {
          return null;
        }

        return {
          ...item,
          childs: filteredChildren,
        };
      }

      return item;
    })
    .filter((item): item is NavigationTree => item !== null);
}

/**
 * Get navigation items for a specific user
 * This is a convenience function that combines permission loading and filtering
 */
export async function getUserNavigation(
  navigation: NavigationTree[],
  permissionsMap: AdminPermissionsMap,
  userRole?: string
): Promise<NavigationTree[]> {
  const isSuperAdmin = userRole === 'super_admin';
  return filterNavigationByPermissions(navigation, permissionsMap, isSuperAdmin);
}

/**
 * Check if any child navigation items are visible
 * Useful for determining if a parent/collapse item should be shown
 */
export function hasVisibleChildren(
  children: NavigationTree[] | undefined,
  permissionsMap: AdminPermissionsMap,
  isSuperAdmin: boolean = false
): boolean {
  if (!children || children.length === 0) {
    return false;
  }

  return children.some((child) => {
    if (child.path) {
      return hasNavigationPermission(child.path, permissionsMap, isSuperAdmin);
    }

    if (child.childs) {
      return hasVisibleChildren(child.childs, permissionsMap, isSuperAdmin);
    }

    return true;
  });
}

/**
 * Get the first available route for a user based on their permissions
 * This is useful for redirecting users to their default landing page
 */
export function getFirstAvailableRoute(
  navigation: NavigationTree[],
  permissionsMap: AdminPermissionsMap,
  isSuperAdmin: boolean = false
): string | null {
  for (const item of navigation) {
    // Check children first
    if (item.childs && item.childs.length > 0) {
      const childRoute = getFirstAvailableRoute(item.childs, permissionsMap, isSuperAdmin);
      if (childRoute) {
        return childRoute;
      }
    }

    // Check if this item is accessible
    if (item.path && item.type === 'item') {
      // Check requiredFeature first
      if ('requiredFeature' in item && item.requiredFeature) {
        if (isSuperAdmin || permissionsMap[item.requiredFeature as AdminFeature] === true) {
          return item.path;
        }
      }
      // Fallback to path-based check
      else if (hasNavigationPermission(item.path, permissionsMap, isSuperAdmin)) {
        return item.path;
      }
    }
  }

  return null;
}
