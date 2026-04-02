# Navigation Permission Integration Guide

This guide shows how to integrate the permission system with your navigation to automatically hide menu items that users don't have access to.

## Overview

The navigation permission system works by:
1. Mapping navigation paths to required features
2. Filtering navigation items based on user permissions
3. Automatically hiding items users can't access

## Files Created

- `src/utils/navigationPermissions.ts` - Helper functions for filtering navigation
- Navigation mapping configuration in the same file

## Integration Steps

### Step 1: Update Navigation Components

You need to filter navigation items before rendering them. Here's how to update your sidebar/menu components:

#### Option A: Filter in the Sidebar Component

```tsx
// src/app/layouts/MainLayout/Sidebar/PrimePanel/index.tsx
import { usePermissions } from '@/hooks/usePermissions';
import { useAuth } from '@/app/contexts/auth/Provider';
import { filterNavigationByPermissions } from '@/utils/navigationPermissions';

export function PrimePanel() {
  const { user } = useAuth();
  const { permissionsMap, loading } = usePermissions();
  const [filteredNav, setFilteredNav] = useState<NavigationTree[]>([]);

  // Your existing navigation loading logic
  const navigation = useMemo(() => {
    // ... your existing navigation building code
    return buildNavigation();
  }, [/* your deps */]);

  // Filter navigation based on permissions
  useEffect(() => {
    if (!loading && navigation) {
      const filtered = filterNavigationByPermissions(
        navigation,
        permissionsMap,
        user?.role === 'super_admin'
      );
      setFilteredNav(filtered);
    }
  }, [navigation, permissionsMap, loading, user?.role]);

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <div>
      <Menu nav={filteredNav} pathname={pathname} />
    </div>
  );
}
```

#### Option B: Create a Wrapper Hook

```tsx
// src/hooks/useFilteredNavigation.ts
import { useMemo } from 'react';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuth } from '@/app/contexts/auth/Provider';
import { filterNavigationByPermissions } from '@/utils/navigationPermissions';
import type { NavigationTree } from '@/@types/navigation';

export function useFilteredNavigation(navigation: NavigationTree[]) {
  const { user } = useAuth();
  const { permissionsMap, loading } = usePermissions();

  const filteredNavigation = useMemo(() => {
    if (loading || !navigation) {
      return [];
    }

    return filterNavigationByPermissions(
      navigation,
      permissionsMap,
      user?.role === 'super_admin'
    );
  }, [navigation, permissionsMap, loading, user?.role]);

  return {
    navigation: filteredNavigation,
    loading,
  };
}

// Then use it in your component:
const { navigation: filteredNav, loading } = useFilteredNavigation(baseNavigation);
```

### Step 2: Update Navigation Mappings

Make sure all your navigation paths are mapped to features in `navigationPermissions.ts`:

```typescript
export const NAVIGATION_PERMISSIONS: Record<string, AdminFeature> = {
  // Add your navigation paths here
  '/dashboards/new-feature': 'new_feature',
  '/admin/custom-page': 'custom_page',
  // etc...
};
```

### Step 3: Add Permission Routes

Don't forget to add the permission management routes to your router:

```tsx
// In protected.tsx
{
  path: "admin",
  Component: AdminGuard,
  children: [
    // ... existing routes
    {
      path: "permissions",
      children: [
        {
          index: true,
          lazy: async () => ({
            Component: (await import("@/app/pages/admin/permissions")).default,
          }),
        },
        {
          path: "users/:userId",
          lazy: async () => ({
            Component: (await import("@/app/pages/admin/permissions/user-detail")).default,
          }),
        },
        {
          path: "groups",
          lazy: async () => ({
            Component: (await import("@/app/pages/admin/permissions/groups")).default,
          }),
        },
      ],
    },
  ],
}
```

Also add the Unauthorized page route:

```tsx
{
  path: "unauthorized",
  lazy: async () => ({
    Component: (await import("@/app/pages/Unauthorized")).default,
  }),
}
```

## Example: Complete Integration

Here's a complete example of integrating permissions into a sidebar:

```tsx
// src/app/layouts/MainLayout/Sidebar/PrimePanel/index.tsx
import { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuth } from '@/app/contexts/auth/Provider';
import { filterNavigationByPermissions } from '@/utils/navigationPermissions';
import { Menu } from './Menu';
import type { NavigationTree } from '@/@types/navigation';

export function PrimePanel() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const { permissionsMap, loading: permissionsLoading } = usePermissions();

  // Your existing navigation building logic
  const navigation = useMemo<NavigationTree[]>(() => {
    // Build your navigation tree
    return [
      {
        id: 'dashboards',
        type: 'item',
        path: '/dashboards',
        title: 'Dashboard',
        icon: 'home',
      },
      {
        id: 'admin',
        type: 'collapse',
        path: '/admin',
        title: 'Administration',
        icon: 'settings',
        childs: [
          {
            id: 'users',
            type: 'item',
            path: '/admin/users',
            title: 'Users',
          },
          {
            id: 'accounts',
            type: 'item',
            path: '/admin/accounts',
            title: 'Accounts',
          },
          {
            id: 'events',
            type: 'item',
            path: '/admin/events',
            title: 'Events',
          },
          {
            id: 'blog',
            type: 'item',
            path: '/admin/blog/posts',
            title: 'Blog',
          },
        ],
      },
      {
        id: 'settings',
        type: 'item',
        path: '/settings',
        title: 'Settings',
        icon: 'settings',
      },
    ];
  }, [/* your dependencies */]);

  // Filter navigation based on permissions
  const filteredNavigation = useMemo(() => {
    if (permissionsLoading) {
      return [];
    }

    return filterNavigationByPermissions(
      navigation,
      permissionsMap,
      user?.role === 'super_admin'
    );
  }, [navigation, permissionsMap, permissionsLoading, user?.role]);

  if (permissionsLoading) {
    return (
      <div className="flex items-center justify-center p-4">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <Menu nav={filteredNavigation} pathname={pathname} />
    </div>
  );
}
```

## Advanced: Conditional Menu Items

You can also conditionally show menu items inline using the permission hooks:

```tsx
import { RequirePermission } from '@/middleware/FeatureGuard';

function CustomMenu() {
  return (
    <nav>
      <RequirePermission feature="dashboard_home">
        <NavLink to="/dashboard">Dashboard</NavLink>
      </RequirePermission>

      <RequirePermission feature="blog">
        <NavLink to="/admin/blog">Blog</NavLink>
      </RequirePermission>

      <RequirePermission feature="events">
        <NavLink to="/admin/events">Events</NavLink>
      </RequirePermission>

      <RequirePermission feature="users">
        <NavLink to="/admin/users">Users</NavLink>
      </RequirePermission>
    </nav>
  );
}
```

## Testing

To test the navigation filtering:

1. Log in as a super admin - you should see all menu items
2. Create a test user and grant them only specific permissions
3. Log in as the test user - you should only see menu items for granted features
4. Try accessing a restricted route directly - you should be redirected to `/unauthorized`

## Maintenance

When adding new features:

1. Add the feature to the `AdminFeature` type in `src/lib/permissions/types.ts`
2. Add the route to `NAVIGATION_PERMISSIONS` in `src/utils/navigationPermissions.ts`
3. Wrap the route with `FeatureGuard` in your router
4. The navigation will automatically hide for users without permission

## Troubleshooting

### Menu items not hiding

- Check that the path in `NAVIGATION_PERMISSIONS` exactly matches your navigation path
- Verify permissions are loading correctly with `console.log(permissionsMap)`
- Ensure you're calling `filterNavigationByPermissions` before rendering

### Loading state issues

- Make sure to show a loading state while permissions are loading
- Don't render navigation until `permissionsLoading === false`

### Permission checks not working

- Verify the database migration ran successfully
- Check that the user has been granted permissions in the database
- Test with a super admin first to ensure navigation works at all
