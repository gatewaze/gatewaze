// Import Dependencies
import { useState, useEffect, useMemo } from "react";
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  ShieldCheckIcon,
  ArrowRightOnRectangleIcon,
  MagnifyingGlassIcon,
  UserGroupIcon,
  UserPlusIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { useForm } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import * as Yup from 'yup';
import { toast } from "sonner";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  createColumnHelper,
} from '@tanstack/react-table';

// Local Imports
import {
  Button,
  Card,
  Input,
  Select,
  Badge,
  Avatar,
  Modal,
  ConfirmModal,
  Spinner,
  WorkspaceLayout,
} from "@/components/ui";
import { Page } from "@/components/shared/Page";
import { DataTable } from "@/components/shared/table/DataTable";
import { RowActions } from "@/components/shared/table/RowActions";
import { AdminUserService, CreateUserData, UpdateUserData } from "@/utils/adminUserService";
import { PeopleService, Person } from "@/utils/peopleService";
import { supabase, AdminUser } from "@/lib/supabase";
import { useAuthContext } from "@/app/contexts/auth/context";
import { FeatureSelectionDialog } from "@/components/permissions/FeatureSelectionDialog";
import { useTeamMemberPermissions } from "@/hooks/useTeamMemberPermissions";
import { PermissionsService } from "@/lib/permissions/service";
import { useAdminPermissionCatalog, selectedModuleIds } from "@/lib/permissions/catalog";
import type { AdminFeature } from "@/lib/permissions/types";

// Types
interface UserFormData {
  first_name: string;
  last_name: string;
  email: string;
  role: string;
}

const userSchema = Yup.object().shape({
  first_name: Yup.string().required('First name is required'),
  last_name: Yup.string().required('Last name is required'),
  email: Yup.string().email('Invalid email').required('Email is required'),
  role: Yup.string().required('Role is required'),
});

const roleOptions = [
  { value: 'admin', label: 'Admin' },
  { value: 'super_admin', label: 'Super Admin' },
  { value: 'editor', label: 'Editor' },
];

// Extend AdminUser type to carry the member's granted features (mapped to a
// module count for display).
type AdminUserWithFeatures = AdminUser & { grantedFeatures?: string[] };

type AddUserMode = 'existing' | 'new';

const columnHelper = createColumnHelper<AdminUserWithFeatures>();

function getRoleBadgeColor(role: string): "red" | "cyan" | "orange" | "gray" {
  switch (role) {
    case 'super_admin':
      return 'red';
    case 'admin':
      return 'cyan';
    case 'editor':
      return 'orange';
    default:
      return 'gray';
  }
}

function personDisplayName(person: Person): string {
  const first = person.attributes?.first_name || '';
  const last = person.attributes?.last_name || '';
  const name = `${first} ${last}`.trim();
  return name || person.email || 'Unknown';
}

// Search the platform's people for the existing-person picker.
//
// This goes through the same SECURITY DEFINER listing RPC the People dashboard
// uses, NOT a direct `.from('people')` query. The admin session does not
// satisfy the is_admin() RLS check on `people` (people_select_v1), so a direct
// select silently returns zero rows even for people who clearly exist. The RPC
// is RLS-exempt and indexed (migrations 00044/00045) and matches email / name /
// company. It returns authenticated people (auth_user_id set) — brand-new
// contacts are added via the "Create New User" tab instead.
async function searchPeopleByNameOrEmail(term: string): Promise<Person[]> {
  const q = term.trim();
  if (q.length < 2) return [];
  const { data, error } = await supabase.rpc('people_get_authenticated_sorted', {
    p_offset: 0,
    p_limit: 20,
    p_sort_by: 'created_at',
    p_sort_order: 'desc',
    p_search_term: q,
  });

  if (error) {
    console.error('Error searching people:', error);
    return [];
  }
  // The RPC tacks a total_count onto every row — drop it before returning.
  return ((data as (Person & { total_count?: number })[]) || []).map(
    ({ total_count: _total, ...person }) => person as Person,
  );
}

export default function AdminUsers() {
  const { user: currentUser, startImpersonation } = useAuthContext();
  const catalog = useAdminPermissionCatalog();
  const [users, setUsers] = useState<AdminUserWithFeatures[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [deleteUser, setDeleteUser] = useState<AdminUser | null>(null);
  const [impersonating, setImpersonating] = useState<string | null>(null);

  // Feature permissions state
  const [showFeatureDialog, setShowFeatureDialog] = useState(false);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [selectedFeatures, setSelectedFeatures] = useState<AdminFeature[]>([]);
  const [loadingFeatures, setLoadingFeatures] = useState(false);

  const isSuperAdmin = currentUser?.role === 'super_admin';

  // Permission management hook
  const { syncPermissions, loading: savingPermissions } = useTeamMemberPermissions({
    onSuccess: () => {
      toast.success('Permissions updated successfully!');
      setShowFeatureDialog(false);
      setPendingUserId(null);
      loadUsers();
    },
    onError: (error) => {
      toast.error(`Failed to update permissions: ${error.message}`);
    },
  });

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const { users: fetchedUsers, error } = await AdminUserService.getAllUsers();
      if (error) {
        toast.error(error);
      } else {
        // Filter to only show active users
        const activeUsers = (fetchedUsers || []).filter(user => user.is_active !== false);

        // Load each user's granted features (rendered as a module count).
        const usersWithFeatureCounts = await Promise.all(
          activeUsers.map(async (user) => {
            if (user.role === 'super_admin') {
              return { ...user, grantedFeatures: [] as string[] };
            }

            try {
              const features = await PermissionsService.getAdminFeatures(user.id);
              return { ...user, grantedFeatures: features };
            } catch {
              return { ...user, grantedFeatures: [] as string[] };
            }
          })
        );

        setUsers(usersWithFeatureCounts);
      }
    } catch {
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingUser(null);
  };

  // Load user's current features and open feature dialog
  const loadUserFeatures = async (userId: string) => {
    setLoadingFeatures(true);
    setPendingUserId(userId);

    try {
      const features = await PermissionsService.getAdminFeatures(userId);
      setSelectedFeatures(features);
    } catch (error) {
      console.error('Error loading features:', error);
      setSelectedFeatures([]);
    } finally {
      setLoadingFeatures(false);
      setShowFeatureDialog(true);
    }
  };

  // Handle saving feature permissions
  const handleSaveFeatures = async (features: AdminFeature[]) => {
    if (!pendingUserId) return;
    await syncPermissions(pendingUserId, features);
  };

  const handleSaved = async (savedUser: AdminUser | undefined, role: string) => {
    handleCloseModal();
    // Open feature dialog for non-super admins
    if (savedUser && role !== 'super_admin') {
      await loadUserFeatures(savedUser.id);
    } else {
      loadUsers();
    }
  };

  const handleDeleteUser = async () => {
    if (!deleteUser) return;

    try {
      const { success, error } = await AdminUserService.deleteUser(deleteUser.id);

      if (success) {
        toast.success('User deactivated successfully');
        setDeleteUser(null);
        loadUsers();
      } else {
        toast.error(error || 'Failed to deactivate user');
      }
    } catch {
      toast.error('An error occurred while deactivating user');
    }
  };

  const handleImpersonate = async (user: AdminUser) => {
    if (!currentUser?.id) {
      toast.error('No authenticated user');
      return;
    }

    if (currentUser.id === user.id) {
      toast.error('Cannot impersonate yourself');
      return;
    }

    setImpersonating(user.id);

    try {
      const success = await startImpersonation(user.id);

      if (success) {
        toast.success(`Now viewing as ${user.name}`);
      } else {
        toast.error('Failed to start impersonation');
      }
    } catch {
      toast.error('An error occurred while starting impersonation');
    } finally {
      setImpersonating(null);
    }
  };

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((user) =>
      [user.name, user.email, user.role]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q))
    );
  }, [users, search]);

  const columns = useMemo(
    () => [
      columnHelper.accessor('name', {
        header: 'User',
        cell: (info) => (
          <div className="flex items-center gap-3">
            <Avatar name={info.getValue() || 'U'} size={9} initialColor="auto" className="flex-shrink-0" />
            <div className="text-sm font-medium text-[var(--gray-12)]">
              {info.getValue()}
            </div>
          </div>
        ),
      }),
      columnHelper.accessor('email', {
        header: 'Email',
        cell: (info) => (
          <span className="text-sm text-[var(--gray-12)]">{info.getValue()}</span>
        ),
      }),
      columnHelper.accessor('role', {
        header: 'Role',
        cell: (info) => (
          <Badge color={getRoleBadgeColor(info.getValue() || 'admin')}>
            {info.getValue() || 'admin'}
          </Badge>
        ),
      }),
      columnHelper.display({
        id: 'features',
        header: 'Modules',
        cell: (info) => {
          const user = info.row.original;
          if (user.role === 'super_admin') {
            return <Badge color="green">All Modules</Badge>;
          }
          const granted = selectedModuleIds(user.grantedFeatures ?? [], catalog).size;
          return (
            <span className="text-sm text-[var(--gray-12)]">
              <span className="font-medium">{granted}</span>
              <span className="text-[var(--gray-a11)]"> / {catalog.moduleCount} modules</span>
            </span>
          );
        },
      }),
      columnHelper.accessor('created_at', {
        header: 'Created',
        cell: (info) => (
          <span className="text-sm text-[var(--gray-11)] whitespace-nowrap">
            {new Date(info.getValue()).toLocaleDateString()}
          </span>
        ),
      }),
      columnHelper.display({
        id: 'actions',
        header: '',
        cell: (info) => {
          const user = info.row.original;
          if (!isSuperAdmin) {
            return <span className="text-[var(--gray-a9)] text-sm">View Only</span>;
          }
          return (
            <RowActions actions={[
              ...(user.id !== currentUser?.id ? [{
                label: "Login As",
                icon: <ArrowRightOnRectangleIcon className="size-4" />,
                onClick: () => handleImpersonate(user),
                disabled: impersonating === user.id,
              }] : []),
              {
                label: "Permissions",
                icon: <ShieldCheckIcon className="size-4" />,
                onClick: () => loadUserFeatures(user.id),
              },
              {
                label: "Edit",
                icon: <PencilIcon className="size-4" />,
                onClick: () => {
                  setEditingUser(user);
                  setShowModal(true);
                },
              },
              {
                label: "Deactivate",
                icon: <TrashIcon className="size-4" />,
                onClick: () => setDeleteUser(user),
                color: "red" as const,
              },
            ]} />
          );
        },
      }),
    ],
    [isSuperAdmin, currentUser?.id, impersonating, catalog],
  );

  const table = useReactTable({
    data: filteredUsers,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <Page title="Admin Users">
      <WorkspaceLayout
        title="Admin Users"
        actions={
          isSuperAdmin ? (
            <Button variant="solid" onClick={() => { setEditingUser(null); setShowModal(true); }}>
              <PlusIcon className="size-4 mr-1" />
              Add User
            </Button>
          ) : undefined
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-[var(--gray-11)] max-w-2xl">
            Admin users can sign in to this dashboard. Roles and per-feature permissions
            control what each user can see and manage.
          </p>

          <Card className="overflow-hidden">
            <div className="p-4 border-b border-[var(--gray-a5)]">
              <div className="relative max-w-md">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-[var(--gray-a8)]" />
                <input
                  type="text"
                  placeholder="Search by name, email, or role..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-[var(--color-background)] border border-[var(--gray-a6)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent-9)] text-[var(--gray-12)]"
                />
              </div>
            </div>
            <DataTable
              table={table}
              loading={loading}
              emptyState={
                <div className="py-4 text-center">
                  <UserGroupIcon className="mx-auto size-10 text-[var(--gray-a8)]" />
                  <p className="mt-3 text-[var(--gray-11)]">
                    {search ? 'No users match your search.' : 'No admin users found.'}
                  </p>
                </div>
              }
            />
          </Card>
        </div>

        {/* Add / Edit User Modal */}
        {showModal && (
          <UserEditModal
            editingUser={editingUser}
            existingUsers={users}
            onClose={handleCloseModal}
            onSaved={handleSaved}
          />
        )}

        {/* Deactivate Confirmation Modal */}
        <ConfirmModal
          isOpen={!!deleteUser}
          onClose={() => setDeleteUser(null)}
          onConfirm={handleDeleteUser}
          title="Deactivate User"
          message={`Are you sure you want to deactivate ${deleteUser?.name}? They will no longer be able to access the admin panel, but their auth account will be preserved.`}
          confirmText="Deactivate"
          cancelText="Cancel"
        />

        {/* Feature Selection Dialog */}
        <FeatureSelectionDialog
          isOpen={showFeatureDialog}
          onClose={() => {
            setShowFeatureDialog(false);
            setPendingUserId(null);
            loadUsers(); // Reload to show any changes
          }}
          onSave={handleSaveFeatures}
          initialFeatures={selectedFeatures}
          userName={users.find(u => u.id === pendingUserId)?.name || ''}
          userRole={users.find(u => u.id === pendingUserId)?.role || 'admin'}
          loading={loadingFeatures || savingPermissions}
        />
      </WorkspaceLayout>
    </Page>
  );
}

interface UserEditModalProps {
  editingUser: AdminUser | null;
  existingUsers: AdminUser[];
  onClose: () => void;
  onSaved: (user: AdminUser | undefined, role: string) => void;
}

function UserEditModal({ editingUser, existingUsers, onClose, onSaved }: UserEditModalProps) {
  const isEditing = !!editingUser;
  const [mode, setMode] = useState<AddUserMode>(isEditing ? 'new' : 'existing');
  const [submitting, setSubmitting] = useState(false);

  // Existing-person picker state
  const [personSearch, setPersonSearch] = useState('');
  const [personResults, setPersonResults] = useState<Person[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [selectedRole, setSelectedRole] = useState('admin');

  const form = useForm<UserFormData>({
    resolver: yupResolver(userSchema) as any,
    defaultValues: (() => {
      if (editingUser) {
        const nameParts = editingUser.name.split(' ');
        return {
          first_name: nameParts[0] || '',
          last_name: nameParts.slice(1).join(' ') || '',
          email: editingUser.email,
          role: editingUser.role || 'admin',
        };
      }
      return { first_name: '', last_name: '', email: '', role: 'admin' };
    })(),
  });

  const adminEmails = useMemo(
    () => new Set(existingUsers.map((u) => u.email?.toLowerCase()).filter(Boolean)),
    [existingUsers],
  );

  // Debounced people search
  useEffect(() => {
    if (mode !== 'existing') return;
    const term = personSearch.trim();
    if (term.length < 2) {
      setPersonResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      const results = await searchPeopleByNameOrEmail(term);
      setPersonResults(results);
      setSearching(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [personSearch, mode]);

  const createUser = async (data: CreateUserData) => {
    setSubmitting(true);
    try {
      const { success, error, user: newUser } = await AdminUserService.createUser(data);
      if (success) {
        toast.success('User created successfully');
        onSaved(newUser, data.role || 'admin');
      } else {
        toast.error(error || 'Failed to create user');
      }
    } catch {
      toast.error('An error occurred');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddExisting = async () => {
    if (!selectedPerson?.email) return;
    const first = selectedPerson.attributes?.first_name || '';
    const last = selectedPerson.attributes?.last_name || '';
    await createUser({
      name: personDisplayName(selectedPerson),
      email: selectedPerson.email,
      role: selectedRole,
      first_name: first || undefined,
      last_name: last || undefined,
    });
  };

  const onSubmitForm = async (data: UserFormData) => {
    const fullName = `${data.first_name} ${data.last_name}`.trim();

    if (isEditing) {
      setSubmitting(true);
      try {
        const updateData: UpdateUserData = {
          name: fullName,
          email: data.email,
          role: data.role,
          first_name: data.first_name,
          last_name: data.last_name,
        };
        const { success, error } = await AdminUserService.updateUser(editingUser!.id, updateData);

        if (success) {
          toast.success('User updated successfully');
          onSaved({ ...editingUser!, name: fullName, email: data.email, role: data.role }, data.role);
        } else {
          toast.error(error || 'Failed to update user');
        }
      } catch {
        toast.error('An error occurred');
      } finally {
        setSubmitting(false);
      }
    } else {
      await createUser({
        name: fullName,
        email: data.email,
        role: data.role,
        first_name: data.first_name,
        last_name: data.last_name,
      });
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={isEditing ? 'Edit User' : 'Add User'}
      size="lg"
      resizable={false}
    >
      <div className="space-y-4">
        {/* Mode toggle — only when adding */}
        {!isEditing && (
          <div className="grid grid-cols-2 gap-2 p-1 bg-[var(--gray-a3)] rounded-lg">
            {([
              { id: 'existing', label: 'Select Existing Person', icon: UserGroupIcon },
              { id: 'new', label: 'Create New User', icon: UserPlusIcon },
            ] as const).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setMode(id)}
                className={`flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  mode === id
                    ? 'bg-[var(--color-panel-solid)] text-[var(--gray-12)] shadow-sm'
                    : 'text-[var(--gray-11)] hover:text-[var(--gray-12)]'
                }`}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </div>
        )}

        {!isEditing && mode === 'existing' ? (
          <div className="space-y-4">
            {selectedPerson ? (
              <div className="flex items-center gap-3 p-3 border border-[var(--gray-a6)] rounded-lg bg-[var(--gray-a2)]">
                <Avatar
                  src={PeopleService.getAvatarUrl(selectedPerson as any, 80) || undefined}
                  name={personDisplayName(selectedPerson)}
                  size={10}
                  initialColor="auto"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--gray-12)] truncate">
                    {personDisplayName(selectedPerson)}
                  </div>
                  <div className="text-sm text-[var(--gray-11)] truncate">{selectedPerson.email}</div>
                </div>
                <Button
                  variant="ghost"
                  size="1"
                  onClick={() => setSelectedPerson(null)}
                  aria-label="Clear selection"
                >
                  <XMarkIcon className="size-4" />
                </Button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-[var(--gray-a8)]" />
                  <input
                    type="text"
                    autoFocus
                    placeholder="Search people by name or email..."
                    value={personSearch}
                    onChange={(e) => setPersonSearch(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-[var(--color-background)] border border-[var(--gray-a6)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent-9)] text-[var(--gray-12)]"
                  />
                </div>

                <div className="border border-[var(--gray-a6)] rounded-lg max-h-64 overflow-y-auto divide-y divide-[var(--gray-a4)]">
                  {searching ? (
                    <div className="flex items-center justify-center gap-2 py-6 text-sm text-[var(--gray-11)]">
                      <Spinner className="size-4" /> Searching…
                    </div>
                  ) : personResults.length === 0 ? (
                    <div className="py-6 text-center text-sm text-[var(--gray-11)]">
                      {personSearch.trim().length < 2
                        ? 'Type at least two characters to search existing people.'
                        : 'No matching people found.'}
                    </div>
                  ) : (
                    personResults.map((person) => {
                      const alreadyAdmin = adminEmails.has(person.email?.toLowerCase() || '');
                      return (
                        <button
                          key={person.id || person.cio_id}
                          type="button"
                          disabled={alreadyAdmin}
                          onClick={() => setSelectedPerson(person)}
                          className={`w-full flex items-center gap-3 px-3 py-2 text-left ${
                            alreadyAdmin
                              ? 'opacity-60 cursor-not-allowed'
                              : 'hover:bg-[var(--gray-a3)] cursor-pointer'
                          }`}
                        >
                          <Avatar
                            src={PeopleService.getAvatarUrl(person as any, 80) || undefined}
                            name={personDisplayName(person)}
                            size={9}
                            initialColor="auto"
                            className="flex-shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-[var(--gray-12)] truncate">
                              {personDisplayName(person)}
                            </div>
                            <div className="text-xs text-[var(--gray-11)] truncate">
                              {person.email}
                              {person.attributes?.company ? ` · ${person.attributes.company}` : ''}
                            </div>
                          </div>
                          {alreadyAdmin && <Badge color="gray">Already admin</Badge>}
                        </button>
                      );
                    })
                  )}
                </div>
              </>
            )}

            {selectedPerson && (
              <Select
                label="Role"
                data={roleOptions}
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value)}
              />
            )}

            <div className="bg-[var(--accent-a3)] p-3 rounded-lg border border-[var(--accent-a6)]">
              <p className="text-sm text-[var(--accent-11)]">
                🔗 <strong>Magic Link Authentication:</strong> A secure login link will be sent to the
                person's email address. No password required.
              </p>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleAddExisting}
                disabled={!selectedPerson || submitting}
              >
                {submitting ? 'Adding…' : 'Add as Admin'}
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={form.handleSubmit(onSubmitForm as any)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="First Name"
                placeholder="John"
                {...form.register('first_name')}
                error={form.formState.errors.first_name?.message}
              />
              <Input
                label="Last Name"
                placeholder="Doe"
                {...form.register('last_name')}
                error={form.formState.errors.last_name?.message}
              />
            </div>

            <Input
              label="Email"
              type="email"
              placeholder="Enter email address"
              {...form.register('email')}
              error={form.formState.errors.email?.message}
            />

            <Select
              label="Role"
              data={roleOptions}
              value={form.watch('role')}
              onChange={(e) => form.setValue('role', e.target.value)}
              error={form.formState.errors.role?.message}
            />

            {!isEditing && (
              <div className="bg-[var(--accent-a3)] p-3 rounded-lg border border-[var(--accent-a6)]">
                <p className="text-sm text-[var(--accent-11)]">
                  🔗 <strong>Magic Link Authentication:</strong> A secure login link will be sent to the
                  user's email address. No password required.
                </p>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting
                  ? (isEditing ? 'Updating…' : 'Creating…')
                  : (isEditing ? 'Update User' : 'Create User')}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
