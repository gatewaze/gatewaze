import { useEffect, useState } from 'react';
import { Plus, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/app/contexts/auth/useAuth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface AdminProfile {
  id: string;
  name: string;
  email: string;
  role: 'super_admin' | 'admin' | 'editor';
  is_active: boolean;
  created_at: string;
}

function roleVariant(role: string): 'default' | 'secondary' | 'outline' {
  switch (role) {
    case 'super_admin':
      return 'default';
    case 'admin':
      return 'secondary';
    default:
      return 'outline';
  }
}

export default function UsersPage() {
  const { user } = useAuth();
  const [profiles, setProfiles] = useState<AdminProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  // New user form state
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'editor'>('editor');

  // Only super_admin can access this page
  const isSuperAdmin = user?.role === 'super_admin';

  async function fetchProfiles() {
    try {
      setLoading(true);
      const supabase = getSupabase();

      const { data, error: fetchError } = await supabase
        .from('admin_profiles')
        .select('id, name, email, role, is_active, created_at')
        .order('created_at', { ascending: false });

      if (fetchError) throw fetchError;
      setProfiles(data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load admin users');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isSuperAdmin) {
      fetchProfiles();
    }
  }, [isSuperAdmin]);

  async function handleToggleActive(profile: AdminProfile) {
    try {
      const supabase = getSupabase();

      const { error: updateError } = await supabase
        .from('admin_profiles')
        .update({ is_active: !profile.is_active })
        .eq('id', profile.id);

      if (updateError) throw updateError;

      setProfiles((prev) =>
        prev.map((p) =>
          p.id === profile.id ? { ...p, is_active: !p.is_active } : p,
        ),
      );

      toast.success(
        `User ${profile.name} ${profile.is_active ? 'deactivated' : 'activated'}`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update user');
    }
  }

  async function handleAddUser() {
    if (!newEmail.trim() || !newName.trim()) {
      toast.error('Email and name are required');
      return;
    }

    try {
      setCreating(true);
      const supabase = getSupabase();

      const { error: insertError } = await supabase.from('admin_profiles').insert({
        email: newEmail.trim(),
        name: newName.trim(),
        role: newRole,
        is_active: true,
      });

      if (insertError) throw insertError;

      toast.success('User added successfully');
      setDialogOpen(false);
      setNewEmail('');
      setNewName('');
      setNewRole('editor');
      fetchProfiles();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add user');
    } finally {
      setCreating(false);
    }
  }

  if (!isSuperAdmin) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-center">
          <ShieldCheck className="mx-auto h-12 w-12 text-muted-foreground" />
          <p className="mt-4 text-lg font-medium">Access Restricted</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Only super administrators can manage users.
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-medium text-destructive">Error loading users</p>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Admin Users</h1>
          <p className="text-muted-foreground">Manage who has access to the admin panel.</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add User
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Admin User</DialogTitle>
              <DialogDescription>
                Add a new user with admin panel access.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="user-email">Email *</Label>
                <Input
                  id="user-email"
                  type="email"
                  placeholder="admin@example.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="user-name">Name *</Label>
                <Input
                  id="user-name"
                  placeholder="Full name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="user-role">Role</Label>
                <Select value={newRole} onValueChange={(v) => setNewRole(v as 'admin' | 'editor')}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="editor">Editor</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleAddUser} disabled={creating}>
                {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add User
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Users</CardTitle>
          <CardDescription>
            Users with access to the admin panel and their roles.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : profiles.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No admin users found.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {profiles.map((profile) => (
                  <TableRow key={profile.id}>
                    <TableCell className="font-medium">{profile.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {profile.email}
                    </TableCell>
                    <TableCell>
                      <Badge variant={roleVariant(profile.role)}>{profile.role}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={profile.is_active ? 'default' : 'destructive'}>
                        {profile.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(profile.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Switch
                        checked={profile.is_active}
                        onCheckedChange={() => handleToggleActive(profile)}
                        disabled={profile.role === 'super_admin'}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
