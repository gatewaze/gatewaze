# Feature-Based Permission System - Integration Guide

This guide shows how to integrate the feature-based permission system into your application.

## Overview

The permission system adds granular access control on top of the existing role-based and brand feature flags. It allows you to restrict specific admin users to specific features.

## Components Created

### 1. Database Layer
- **Migration**: `supabase/migrations/20250117_create_admin_permissions.sql`
- Creates tables: `admin_permissions`, `admin_permission_groups`, etc.
- Adds database functions: `has_feature_permission()`, `get_admin_features()`

### 2. Service Layer
- **Types**: `src/lib/permissions/types.ts`
- **Service**: `src/lib/permissions/service.ts`

### 3. React Layer
- **Hooks**: `src/hooks/usePermissions.ts`
- **Guards**: `src/middleware/FeatureGuard.tsx`
- **Pages**: `src/app/pages/Unauthorized.tsx`

## How to Update Routes

### Method 1: Wrap Route Components with FeatureGuard

```tsx
// In protected.tsx
{
  path: "blog",
  lazy: async () => {
    const module = await import("@/app/pages/admin/blog/posts");
    return {
      Component: () => (
        <FeatureGuard feature="blog">
          <module.default />
        </FeatureGuard>
      ),
    };
  },
}
```

### Method 2: Use FeatureGuard in the Page Component

```tsx
// In the page component itself
import { FeatureGuard } from "@/middleware/FeatureGuard";

export default function BlogPage() {
  return (
    <FeatureGuard feature="blog">
      {/* Your page content */}
    </FeatureGuard>
  );
}
```

### Method 3: Account-Specific Features

```tsx
// For features that are account-specific
{
  path: "competitions",
  lazy: async () => {
    const module = await import("@/app/pages/dashboards/competitions");
    return {
      Component: () => {
        const { currentAccountId } = useAccount();
        return (
          <FeatureGuard feature="competitions" accountId={currentAccountId}>
            <module.default />
          </FeatureGuard>
        );
      },
    };
  },
}
```

## Recommended Route Updates

Here's how to update each route in `protected.tsx`:

### Dashboard Routes

```tsx
{
  path: "home",
  lazy: async () => {
    const module = await import("@/app/pages/dashboards/home");
    return {
      Component: () => (
        <FeatureGuard feature="dashboard_home">
          <module.default />
        </FeatureGuard>
      ),
    };
  },
}

{
  path: "members",
  children: [
    {
      index: true,
      lazy: async () => {
        const module = await import("@/app/pages/dashboards/members");
        return {
          Component: () => (
            <FeatureGuard feature="dashboard_members">
              <module.default />
            </FeatureGuard>
          ),
        };
      },
    },
    // ... other member routes
  ],
}
```

### Admin Routes

```tsx
{
  path: "admin",
  Component: AdminGuard,
  children: [
    {
      path: "users",
      lazy: async () => {
        const module = await import("@/app/pages/admin/users");
        return {
          Component: () => (
            <FeatureGuard feature="users">
              <module.default />
            </FeatureGuard>
          ),
        };
      },
    },
    {
      path: "accounts",
      lazy: async () => {
        const module = await import("@/app/pages/admin/accounts");
        return {
          Component: () => (
            <FeatureGuard feature="accounts">
              <module.default />
            </FeatureGuard>
          ),
        };
      },
    },
    {
      path: "events",
      children: [
        {
          index: true,
          lazy: async () => {
            const module = await import("@/app/pages/admin/events");
            return {
              Component: () => (
                <FeatureGuard feature="events">
                  <module.default />
                </FeatureGuard>
              ),
            };
          },
        },
        // ... event detail routes also wrapped
      ],
    },
    {
      path: "blog",
      children: [
        {
          path: "posts",
          lazy: async () => {
            const module = await import("@/app/pages/admin/blog/posts");
            return {
              Component: () => (
                <FeatureGuard feature="blog">
                  <module.default />
                </FeatureGuard>
              ),
            };
          },
        },
      ],
    },
    {
      path: "scrapers",
      lazy: async () => {
        const module = await import("@/app/pages/admin/scrapers");
        return {
          Component: () => (
            <BrandFeatureGuard feature="scrapers">
              <FeatureGuard feature="scrapers">
                <module.default />
              </FeatureGuard>
            </BrandFeatureGuard>
          ),
        };
      },
    },
  ],
}
```

### Settings Routes

```tsx
{
  path: "settings",
  Component: AdminGuard,
  lazy: async () => {
    const module = await import("@/app/pages/settings/Layout");
    return {
      Component: () => (
        <FeatureGuard feature="settings">
          <module.default />
        </FeatureGuard>
      ),
    };
  },
  children: [
    // ... settings children
  ],
}
```

## Using Permission Hooks in Components

### Check Single Permission

```tsx
import { useHasPermission } from "@/hooks/usePermissions";

function BlogActions() {
  const { hasPermission, loading } = useHasPermission("blog");

  if (loading) return <Spinner />;

  if (!hasPermission) return null;

  return <button>Create Post</button>;
}
```

### Get All Permissions

```tsx
import { usePermissions } from "@/hooks/usePermissions";

function FeatureMenu() {
  const { permissions, permissionsMap, loading } = usePermissions();

  if (loading) return <Spinner />;

  return (
    <nav>
      {permissionsMap.blog && <Link to="/admin/blog">Blog</Link>}
      {permissionsMap.events && <Link to="/admin/events">Events</Link>}
      {permissionsMap.users && <Link to="/admin/users">Users</Link>}
    </nav>
  );
}
```

### Conditional Rendering

```tsx
import { RequirePermission } from "@/middleware/FeatureGuard";

function Toolbar() {
  return (
    <div>
      <RequirePermission feature="blog">
        <button>New Post</button>
      </RequirePermission>

      <RequirePermission feature="events">
        <button>Add Event</button>
      </RequirePermission>
    </div>
  );
}
```

## Navigation Integration

Update your navigation components to hide links to features users don't have access to:

```tsx
import { usePermissions } from "@/hooks/usePermissions";

function Sidebar() {
  const { permissionsMap, loading } = usePermissions();

  if (loading) return <SidebarSkeleton />;

  return (
    <nav>
      {permissionsMap.dashboard_home && (
        <NavLink to="/dashboard/home">Dashboard</NavLink>
      )}

      {permissionsMap.blog && (
        <NavLink to="/admin/blog">Blog</NavLink>
      )}

      {permissionsMap.events && (
        <NavLink to="/admin/events">Events</NavLink>
      )}

      {permissionsMap.users && (
        <NavLink to="/admin/users">Users</NavLink>
      )}

      {permissionsMap.settings && (
        <NavLink to="/settings">Settings</NavLink>
      )}
    </nav>
  );
}
```

## Permission Management

### Grant Permission to User

```tsx
import { usePermissionManagement } from "@/hooks/usePermissions";

function UserPermissions({ userId }) {
  const { grantPermission } = usePermissionManagement();

  const handleGrant = async () => {
    await grantPermission(userId, "blog");
    // Permission granted
  };

  return <button onClick={handleGrant}>Grant Blog Access</button>;
}
```

### Assign Permission Group

```tsx
import { usePermissionManagement } from "@/hooks/usePermissions";

function UserGroups({ userId }) {
  const { assignGroup } = usePermissionManagement();

  const handleAssign = async (groupId) => {
    await assignGroup(userId, groupId);
    // Group assigned
  };

  return <button onClick={() => handleAssign(groupId)}>Assign Group</button>;
}
```

## Migration Steps

1. **Run the database migration**:
   ```bash
   npx supabase db push
   ```

2. **Update your router** with FeatureGuard components

3. **Update navigation** to use permission hooks

4. **Create admin UI** for managing permissions (optional but recommended)

5. **Test**: Log in as different users and verify access control works

## Default Permission Groups

The migration creates these default groups:

- **super_admin**: Full access to all features
- **account_manager**: Account-specific features (competitions, discounts, offers, cohorts)
- **content_editor**: Content features (blog, events, scrapers)
- **viewer**: Read-only dashboard access

## Best Practices

1. **Layered Security**: Keep the existing role and brand feature checks. The permission system adds another layer.

2. **Super Admin Override**: Super admins always have access to everything.

3. **Loading States**: Always show loading states when checking permissions.

4. **Fallbacks**: Provide appropriate fallbacks or redirects when users lack permission.

5. **Navigation**: Hide links to features users can't access to avoid confusion.

6. **Audit Trail**: Use the built-in audit logging to track permission changes.

## Example: Complete Feature Protection

```tsx
// Route definition
{
  path: "blog",
  lazy: async () => {
    const module = await import("@/app/pages/admin/blog/posts");
    return {
      Component: () => (
        <FeatureGuard feature="blog">
          <module.default />
        </FeatureGuard>
      ),
    };
  },
}

// Navigation item
{permissionsMap.blog && (
  <NavLink to="/admin/blog">
    <FileText className="h-5 w-5" />
    <span>Blog</span>
  </NavLink>
)}

// Action button in page
<RequirePermission feature="blog">
  <button onClick={handleCreatePost}>
    Create New Post
  </button>
</RequirePermission>
```

This ensures the feature is protected at every level:
1. Route level (redirect if no access)
2. Navigation level (hide if no access)
3. Component level (hide actions if no access)
