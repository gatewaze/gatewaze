# Feature Selection Dialog - Integration Guide

This guide shows how to integrate the `FeatureSelectionDialog` component into your team member management pages.

## Quick Start

### 1. Basic Integration

```tsx
import { useState } from 'react';
import { FeatureSelectionDialog } from '@/components/permissions/FeatureSelectionDialog';
import { useTeamMemberPermissions } from '@/hooks/useTeamMemberPermissions';
import type { AdminFeature } from '@/lib/permissions/types';

function TeamMemberRow({ member }) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [currentFeatures, setCurrentFeatures] = useState<AdminFeature[]>([]);

  const { syncPermissions, loading } = useTeamMemberPermissions({
    onSuccess: () => {
      alert('Permissions updated successfully!');
      setIsDialogOpen(false);
    },
    onError: (error) => {
      alert('Failed to update permissions: ' + error.message);
    },
  });

  const handleOpenDialog = async () => {
    // Load current permissions
    const features = await PermissionsService.getAdminFeatures(member.id);
    setCurrentFeatures(features);
    setIsDialogOpen(true);
  };

  const handleSavePermissions = async (selectedFeatures: AdminFeature[]) => {
    await syncPermissions(member.id, selectedFeatures);
  };

  return (
    <>
      <div className="flex items-center justify-between p-4">
        <div>
          <h3>{member.name}</h3>
          <p>{member.email}</p>
        </div>

        <button onClick={handleOpenDialog}>
          Manage Access
        </button>
      </div>

      <FeatureSelectionDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        onSave={handleSavePermissions}
        initialFeatures={currentFeatures}
        userName={member.name}
        userRole={member.role}
        loading={loading}
      />
    </>
  );
}
```

### 2. Add Team Member with Feature Selection

```tsx
import { useState } from 'react';
import { FeatureSelectionDialog } from '@/components/permissions/FeatureSelectionDialog';
import { useTeamMemberPermissions } from '@/hooks/useTeamMemberPermissions';

function AddTeamMemberFlow() {
  const [step, setStep] = useState<'info' | 'features'>('info');
  const [memberData, setMemberData] = useState({
    email: '',
    name: '',
    role: 'admin',
  });
  const [selectedFeatures, setSelectedFeatures] = useState<AdminFeature[]>([]);

  const { syncPermissions } = useTeamMemberPermissions({
    onSuccess: () => {
      alert('Team member added successfully!');
      resetForm();
    },
  });

  const handleCreateMember = async () => {
    // Step 1: Create the admin user
    const { data: newAdmin, error } = await supabase
      .from('admin_profiles')
      .insert({
        email: memberData.email,
        name: memberData.name,
        role: memberData.role,
      })
      .select()
      .single();

    if (error) throw error;

    // Step 2: Grant permissions
    if (memberData.role !== 'super_admin' && selectedFeatures.length > 0) {
      await syncPermissions(newAdmin.id, selectedFeatures);
    }

    // Step 3: Send invitation email (if needed)
    // ... your email logic
  };

  return (
    <>
      {step === 'info' && (
        <div>
          <h2>Add Team Member</h2>

          <input
            type="email"
            placeholder="Email"
            value={memberData.email}
            onChange={(e) => setMemberData({ ...memberData, email: e.target.value })}
          />

          <input
            type="text"
            placeholder="Name"
            value={memberData.name}
            onChange={(e) => setMemberData({ ...memberData, name: e.target.value })}
          />

          <select
            value={memberData.role}
            onChange={(e) => setMemberData({ ...memberData, role: e.target.value })}
          >
            <option value="admin">Admin</option>
            <option value="editor">Editor</option>
            <option value="super_admin">Super Admin</option>
          </select>

          <button onClick={() => setStep('features')}>
            Next: Select Features
          </button>
        </div>
      )}

      {step === 'features' && (
        <>
          <button onClick={() => setStep('info')}>Back</button>

          <FeatureSelectionDialog
            isOpen={true}
            onClose={() => setStep('info')}
            onSave={async (features) => {
              setSelectedFeatures(features);
              await handleCreateMember();
            }}
            initialFeatures={selectedFeatures}
            userName={memberData.name}
            userRole={memberData.role}
          />
        </>
      )}
    </>
  );
}
```

### 3. Edit Existing Team Member

```tsx
import { useState, useEffect } from 'react';
import { FeatureSelectionDialog } from '@/components/permissions/FeatureSelectionDialog';
import { useTeamMemberPermissions } from '@/hooks/useTeamMemberPermissions';
import { PermissionsService } from '@/lib/permissions/service';

function EditTeamMember({ memberId }: { memberId: string }) {
  const [member, setMember] = useState(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [currentFeatures, setCurrentFeatures] = useState<AdminFeature[]>([]);
  const [loadingFeatures, setLoadingFeatures] = useState(false);

  const { syncPermissions, loading } = useTeamMemberPermissions({
    onSuccess: () => {
      alert('Permissions updated!');
      setIsDialogOpen(false);
      loadFeatures(); // Reload to show updated permissions
    },
  });

  useEffect(() => {
    loadMember();
    loadFeatures();
  }, [memberId]);

  const loadMember = async () => {
    const { data } = await supabase
      .from('admin_profiles')
      .select('*')
      .eq('id', memberId)
      .single();

    setMember(data);
  };

  const loadFeatures = async () => {
    setLoadingFeatures(true);
    const features = await PermissionsService.getAdminFeatures(memberId);
    setCurrentFeatures(features);
    setLoadingFeatures(false);
  };

  const handleSave = async (selectedFeatures: AdminFeature[]) => {
    await syncPermissions(memberId, selectedFeatures);
  };

  if (!member) return <div>Loading...</div>;

  return (
    <div>
      <h1>Edit Team Member</h1>

      <div>
        <h3>{member.name}</h3>
        <p>{member.email}</p>
        <p>Role: {member.role}</p>
      </div>

      <div className="mt-6">
        <h4>Current Feature Access</h4>

        {loadingFeatures ? (
          <p>Loading...</p>
        ) : (
          <div className="flex flex-wrap gap-2 mt-2">
            {currentFeatures.map((feature) => (
              <span
                key={feature}
                className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm"
              >
                {FEATURE_METADATA[feature]?.label || feature}
              </span>
            ))}

            {currentFeatures.length === 0 && (
              <p className="text-gray-500">No features assigned</p>
            )}
          </div>
        )}

        <button
          onClick={() => setIsDialogOpen(true)}
          className="mt-4 px-4 py-2 bg-blue-600 text-white rounded"
        >
          Manage Feature Access
        </button>
      </div>

      <FeatureSelectionDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        onSave={handleSave}
        initialFeatures={currentFeatures}
        userName={member.name}
        userRole={member.role}
        loading={loading}
      />
    </div>
  );
}
```

### 4. Bulk Permission Management

```tsx
import { useState } from 'react';
import { FeatureSelectionDialog } from '@/components/permissions/FeatureSelectionDialog';
import { useTeamMemberPermissions } from '@/hooks/useTeamMemberPermissions';

function BulkPermissionManager({ selectedMembers }: { selectedMembers: any[] }) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const { syncPermissions } = useTeamMemberPermissions({
    onSuccess: () => {
      alert(`Permissions updated for ${selectedMembers.length} members!`);
      setIsDialogOpen(false);
    },
  });

  const handleBulkUpdate = async (selectedFeatures: AdminFeature[]) => {
    // Update permissions for all selected members
    for (const member of selectedMembers) {
      if (member.role !== 'super_admin') {
        await syncPermissions(member.id, selectedFeatures);
      }
    }
  };

  return (
    <>
      <button onClick={() => setIsDialogOpen(true)}>
        Bulk Update Permissions ({selectedMembers.length} selected)
      </button>

      <FeatureSelectionDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        onSave={handleBulkUpdate}
        initialFeatures={[]}
        userName={`${selectedMembers.length} team members`}
      />
    </>
  );
}
```

### 5. Quick Access Templates

```tsx
import { useState } from 'react';
import { FeatureSelectionDialog } from '@/components/permissions/FeatureSelectionDialog';
import { useTeamMemberPermissions } from '@/hooks/useTeamMemberPermissions';
import { usePermissionGroups } from '@/hooks/usePermissions';

function TeamMemberWithTemplates({ member }) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [currentFeatures, setCurrentFeatures] = useState<AdminFeature[]>([]);
  const { groups } = usePermissionGroups();
  const { syncPermissions, assignPermissionGroup } = useTeamMemberPermissions();

  const handleApplyTemplate = async (groupId: string) => {
    // Assign the permission group
    await assignPermissionGroup(member.id, groupId);

    // Reload features to show the updated list
    const features = await PermissionsService.getAdminFeatures(member.id);
    setCurrentFeatures(features);
  };

  return (
    <>
      <div>
        <h3>{member.name}</h3>

        {/* Quick Templates */}
        <div className="mt-2">
          <p className="text-sm font-medium">Quick Templates:</p>
          <div className="flex gap-2 mt-1">
            {groups.map((group) => (
              <button
                key={group.id}
                onClick={() => handleApplyTemplate(group.id)}
                className="text-sm px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded"
              >
                {group.name}
              </button>
            ))}
          </div>
        </div>

        {/* Custom Access */}
        <button
          onClick={() => setIsDialogOpen(true)}
          className="mt-2 text-sm text-blue-600"
        >
          Custom Access...
        </button>
      </div>

      <FeatureSelectionDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        onSave={(features) => syncPermissions(member.id, features)}
        initialFeatures={currentFeatures}
        userName={member.name}
        userRole={member.role}
      />
    </>
  );
}
```

## Complete Example: Team Members Page

Here's a complete example of a team members management page:

```tsx
import React, { useState, useEffect } from 'react';
import { Users, Plus, Settings, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { FeatureSelectionDialog } from '@/components/permissions/FeatureSelectionDialog';
import { useTeamMemberPermissions } from '@/hooks/useTeamMemberPermissions';
import { PermissionsService } from '@/lib/permissions/service';
import { FEATURE_METADATA } from '@/lib/permissions/types';
import type { AdminFeature } from '@/lib/permissions/types';

export default function TeamMembersPage() {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedMember, setSelectedMember] = useState(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [currentFeatures, setCurrentFeatures] = useState<AdminFeature[]>([]);

  const { syncPermissions, loading: savingPermissions } = useTeamMemberPermissions({
    onSuccess: () => {
      alert('Permissions updated successfully!');
      setIsDialogOpen(false);
      loadMembers(); // Reload to show updated badge counts
    },
    onError: (error) => {
      alert('Error: ' + error.message);
    },
  });

  useEffect(() => {
    loadMembers();
  }, []);

  const loadMembers = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('admin_profiles')
        .select('*')
        .eq('is_active', true)
        .order('email');

      if (error) throw error;

      // Load permission counts for each member
      const membersWithCounts = await Promise.all(
        data.map(async (member) => {
          if (member.role === 'super_admin') {
            return { ...member, featureCount: Object.keys(FEATURE_METADATA).length };
          }

          const features = await PermissionsService.getAdminFeatures(member.id);
          return { ...member, featureCount: features.length };
        })
      );

      setMembers(membersWithCounts);
    } catch (error) {
      console.error('Error loading members:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleManageAccess = async (member) => {
    setSelectedMember(member);

    // Load current features
    const features = await PermissionsService.getAdminFeatures(member.id);
    setCurrentFeatures(features);

    setIsDialogOpen(true);
  };

  const handleSavePermissions = async (selectedFeatures: AdminFeature[]) => {
    if (!selectedMember) return;
    await syncPermissions(selectedMember.id, selectedFeatures);
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Team Members</h1>
        <button className="px-4 py-2 bg-blue-600 text-white rounded-md">
          <Plus className="h-4 w-4 inline mr-2" />
          Add Member
        </button>
      </div>

      <div className="bg-white rounded-lg shadow">
        {members.map((member) => (
          <div key={member.id} className="p-4 border-b hover:bg-gray-50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center">
                  <Users className="h-5 w-5 text-blue-600" />
                </div>

                <div>
                  <h3 className="font-medium">{member.name || member.email}</h3>
                  <p className="text-sm text-gray-600">{member.email}</p>
                </div>

                {member.role === 'super_admin' && (
                  <span className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded">
                    Super Admin
                  </span>
                )}
              </div>

              <div className="flex items-center gap-4">
                {/* Feature count badge */}
                <div className="text-sm text-gray-600">
                  <span className="font-medium">{member.featureCount}</span> features
                </div>

                {/* Manage button */}
                <button
                  onClick={() => handleManageAccess(member)}
                  className="px-3 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  <Settings className="h-4 w-4 inline mr-2" />
                  Manage Access
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Feature Selection Dialog */}
      <FeatureSelectionDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        onSave={handleSavePermissions}
        initialFeatures={currentFeatures}
        userName={selectedMember?.name || selectedMember?.email}
        userRole={selectedMember?.role}
        loading={savingPermissions}
      />
    </div>
  );
}
```

## Props Reference

### FeatureSelectionDialog Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `isOpen` | boolean | Yes | Controls dialog visibility |
| `onClose` | () => void | Yes | Called when user closes dialog |
| `onSave` | (features: AdminFeature[]) => void \| Promise<void> | Yes | Called when user saves selections |
| `initialFeatures` | AdminFeature[] | No | Pre-selected features |
| `userRole` | string | No | User's role (shows super admin notice) |
| `userName` | string | No | Displays user's name in header |
| `loading` | boolean | No | Shows loading state |

## Helper Hook Methods

### useTeamMemberPermissions

| Method | Description |
|--------|-------------|
| `syncPermissions(adminId, features, accountId?)` | Sync permissions for a user |
| `grantAllPermissions(adminId, accountId?)` | Grant all features |
| `revokeAllPermissions(adminId, accountId?)` | Remove all features |
| `copyPermissions(fromId, toId, accountId?)` | Copy from one user to another |
| `assignPermissionGroup(adminId, groupId, accountId?)` | Assign a permission group |
| `getPermissions(adminId, accountId?)` | Get current features |

## Styling

The dialog uses Tailwind CSS classes. To customize:

```tsx
// Override default styles by wrapping in a div with custom classes
<div className="custom-dialog-wrapper">
  <FeatureSelectionDialog {...props} />
</div>
```

Or modify the component directly to match your design system.

## Best Practices

1. **Always load current permissions** before opening the dialog
2. **Show loading state** while saving
3. **Provide feedback** on success/error
4. **Handle super admins** - they should see all features but can't modify
5. **Reload member list** after changes to show updated counts
6. **Use the hook** - Don't call PermissionsService directly, use `useTeamMemberPermissions`

## Troubleshooting

**Dialog doesn't open**
- Check that `isOpen` is being set to `true`
- Verify the dialog component is rendered

**Permissions don't save**
- Check that `onSave` function is async and awaits the permission changes
- Verify user has super_admin role to grant permissions
- Check browser console for errors

**Initial features don't show as selected**
- Ensure `initialFeatures` array contains the correct feature identifiers
- Verify features match the `AdminFeature` type exactly

**Super admin shows as editable**
- Pass `userRole="super_admin"` to the dialog props
- Check that the role is exactly matching (case-sensitive)
