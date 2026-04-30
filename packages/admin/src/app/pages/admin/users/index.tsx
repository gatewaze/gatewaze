// Import Dependencies
import { useState, useEffect } from "react";
import { PlusIcon, PencilIcon, TrashIcon, ShieldCheckIcon, ArrowRightOnRectangleIcon } from "@heroicons/react/24/outline";
import { useForm } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import * as Yup from 'yup';
import { toast } from "sonner";

// Local Imports
import {
  Button,
  Card,
  Input,
  Badge,
  Avatar,
  Modal,
  ConfirmModal,
  Table,
  THead,
  TBody,
  Tr,
  Th,
  Td,
} from "@/components/ui";
import { Page } from "@/components/shared/Page";
import { RowActions } from "@/components/shared/table/RowActions";
import { ScrollableTable } from "@/components/shared/table/ScrollableTable";
import { AdminUserService, CreateUserData, UpdateUserData } from "@/utils/adminUserService";
import { AdminUser } from "@/lib/supabase";
import { useAuthContext } from "@/app/contexts/auth/context";
import { FeatureSelectionDialog } from "@/components/permissions/FeatureSelectionDialog";
import { useTeamMemberPermissions } from "@/hooks/useTeamMemberPermissions";
import { PermissionsService } from "@/lib/permissions/service";
import { FEATURE_METADATA } from "@/lib/permissions/types";
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

// Extend AdminUser type to include feature count
type AdminUserWithFeatures = AdminUser & { featureCount?: number };

export default function AdminUsers() {
  const { user: currentUser, startImpersonation } = useAuthContext();
  const [users, setUsers] = useState<AdminUserWithFeatures[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [deleteUser, setDeleteUser] = useState<AdminUser | null>(null);
  const [submitting, setSubmitting] = useState(false);
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

  const form = useForm<UserFormData>({
    resolver: yupResolver(userSchema) as any,
    defaultValues: {
      first_name: '',
      last_name: '',
      email: '',
      role: 'admin',
    },
  });

  const isEditing = !!editingUser;

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

        // Load feature counts for each user
        const usersWithFeatureCounts = await Promise.all(
          activeUsers.map(async (user) => {
            if (user.role === 'super_admin') {
              return { ...user, featureCount: Object.keys(FEATURE_METADATA).length };
            }

            try {
              const features = await PermissionsService.getAdminFeatures(user.id);
              return { ...user, featureCount: features.length };
            } catch {
              return { ...user, featureCount: 0 };
            }
          })
        );

        setUsers(usersWithFeatureCounts);
      }
    } catch (error) {
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = (user?: AdminUser) => {
    if (user) {
      setEditingUser(user);
      // Split name into first and last name
      const nameParts = user.name.split(' ');
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';

      form.reset({
        first_name: firstName,
        last_name: lastName,
        email: user.email,
        role: user.role || 'admin',
      });
    } else {
      setEditingUser(null);
      form.reset({
        first_name: '',
        last_name: '',
        email: '',
        role: 'admin',
      });
    }
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingUser(null);
    form.reset();
  };

  // Load user's current features and open feature dialog
  const loadUserFeatures = async (userId: string, userName: string, userRole: string) => {
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

  // Handle opening feature dialog for existing user
  const handleManagePermissions = async (user: AdminUser) => {
    await loadUserFeatures(user.id, user.name, user.role || 'admin');
  };

  const onSubmit = async (data: UserFormData) => {
    setSubmitting(true);
    try {
      const fullName = `${data.first_name} ${data.last_name}`.trim();

      if (isEditing) {
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
          handleCloseModal();

          // Open feature dialog for non-super admins
          if (data.role !== 'super_admin') {
            await loadUserFeatures(editingUser!.id, fullName, data.role);
          } else {
            loadUsers();
          }
        } else {
          toast.error(error || 'Failed to update user');
        }
      } else {
        const createData: CreateUserData = {
          name: fullName,
          email: data.email,
          role: data.role,
          first_name: data.first_name,
          last_name: data.last_name,
        };
        const { success, error, user: newUser } = await AdminUserService.createUser(createData);

        if (success && newUser) {
          toast.success('User created successfully');
          handleCloseModal();

          // Open feature dialog for non-super admins
          if (data.role !== 'super_admin') {
            await loadUserFeatures(newUser.id, fullName, data.role);
          } else {
            loadUsers();
          }
        } else {
          toast.error(error || 'Failed to create user');
        }
      }
    } catch (error) {
      toast.error('An error occurred');
    } finally {
      setSubmitting(false);
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
    } catch (error) {
      toast.error('An error occurred while deactivating user');
    }
  };

  const getRoleBadgeColor = (role: string): "red" | "cyan" | "orange" | "gray" => {
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
        // Optionally navigate to a different page or refresh
      } else {
        toast.error('Failed to start impersonation');
      }
    } catch (error) {
      toast.error('An error occurred while starting impersonation');
    } finally {
      setImpersonating(null);
    }
  };

  return (
    <Page title="Admin Users">
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--gray-12)]">
              Admin Users
            </h1>
            <p className="text-[var(--gray-11)] mt-1">
              Manage admin users and their permissions
            </p>
          </div>
          {isSuperAdmin && (
            <Button
              onClick={() => handleOpenModal()}
              color="cyan"
              className="gap-2"
            >
              <PlusIcon className="size-4" />
              Add User
            </Button>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="size-6 border-2 border-[var(--accent-9)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <Card className="overflow-hidden">
            <ScrollableTable>
              <Table>
                <THead>
                  <Tr>
                    <Th data-sticky-left style={{ position: 'sticky', left: 0, zIndex: 20, background: 'var(--color-panel-solid)' }}>User</Th>
                    <Th>Email</Th>
                    <Th>Role</Th>
                    <Th>Features</Th>
                    <Th>Created</Th>
                    <Th data-sticky-right style={{ position: 'sticky', right: 0, background: 'var(--color-panel-solid)', zIndex: 2 }} />
                  </Tr>
                </THead>
                <TBody>
                  {users.map((user) => (
                    <Tr key={user.id}>
                      <Td data-sticky-left style={{ position: 'sticky', left: 0, zIndex: 10, background: 'var(--color-panel-solid)' }}>
                        <div className="flex items-center">
                          <Avatar size={10} className="mr-3">
                            {user.name?.charAt(0).toUpperCase() || 'U'}
                          </Avatar>
                          <div>
                            <div className="text-sm font-medium text-[var(--gray-12)]">
                              {user.name}
                            </div>
                          </div>
                        </div>
                      </Td>
                      <Td>
                        <div className="text-sm text-[var(--gray-12)]">
                          {user.email}
                        </div>
                      </Td>
                      <Td>
                        <Badge color={getRoleBadgeColor(user.role || 'admin')}>
                          {user.role || 'admin'}
                        </Badge>
                      </Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          {user.role === 'super_admin' ? (
                            <Badge color="green">All Features</Badge>
                          ) : (
                            <span className="text-sm text-[var(--gray-12)]">
                              {user.featureCount !== undefined ? (
                                <>
                                  <span className="font-medium">{user.featureCount}</span>
                                  <span className="text-[var(--gray-a11)]"> / {Object.keys(FEATURE_METADATA).length}</span>
                                </>
                              ) : (
                                <span className="text-[var(--gray-a9)]">Loading...</span>
                              )}
                            </span>
                          )}
                        </div>
                      </Td>
                      <Td>
                        <div className="text-sm text-[var(--gray-12)]">
                          {new Date(user.created_at).toLocaleDateString()}
                        </div>
                      </Td>
                      <Td data-sticky-right style={{ position: 'sticky', right: 0, background: 'var(--color-panel-solid)', zIndex: 1 }}>
                        {isSuperAdmin && (
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
                              onClick: () => handleManagePermissions(user),
                            },
                            {
                              label: "Edit",
                              icon: <PencilIcon className="size-4" />,
                              onClick: () => handleOpenModal(user),
                            },
                            {
                              label: "Deactivate",
                              icon: <TrashIcon className="size-4" />,
                              onClick: () => setDeleteUser(user),
                              color: "red" as const,
                            },
                          ]} />
                        )}
                        {!isSuperAdmin && (
                          <span className="text-[var(--gray-a9)] text-sm">View Only</span>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>

              {users.length === 0 && (
                <div className="text-center py-12">
                  <p className="text-[var(--gray-11)]">No users found</p>
                </div>
              )}
            </ScrollableTable>
          </Card>
        )}

        {/* User Modal */}
        <Modal
          isOpen={showModal}
          onClose={handleCloseModal}
          title={isEditing ? 'Edit User' : 'Add User'}
        >
          <form onSubmit={form.handleSubmit(onSubmit as any)} className="space-y-4">
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

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Role
              </label>
              <select
                {...form.register('role')}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
              {roleOptions.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
              </select>
              {form.formState.errors.role && (
                <p className="text-red-500 text-sm mt-1">{form.formState.errors.role.message}</p>
              )}
            </div>

            {!isEditing && (
              <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
                <p className="text-sm text-blue-700">
                  🔗 <strong>Magic Link Authentication:</strong> A secure login link will be sent to the user's email address. No password required.
                </p>
              </div>
            )}

            <div className="flex justify-end space-x-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={handleCloseModal}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                color="cyan"
                disabled={submitting}
              >
                {isEditing ? 'Update User' : 'Create User'}
              </Button>
            </div>
          </form>
        </Modal>

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
      </div>
    </Page>
  );
}