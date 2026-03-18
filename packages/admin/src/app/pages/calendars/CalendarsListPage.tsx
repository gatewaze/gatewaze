import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { getSupabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface CalendarRow {
  id: string;
  name: string;
  slug: string;
  description?: string;
  is_public: boolean;
  is_active: boolean;
  event_count: number;
}

export default function CalendarsListPage() {
  const navigate = useNavigate();
  const [calendars, setCalendars] = useState<CalendarRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  // New calendar form state
  const [newName, setNewName] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [newDescription, setNewDescription] = useState('');

  async function fetchCalendars() {
    try {
      setLoading(true);
      const supabase = getSupabase();

      const { data, error: fetchError } = await supabase
        .from('calendars')
        .select('id, name, slug, description, is_public, is_active')
        .order('name', { ascending: true });

      if (fetchError) throw fetchError;

      // Fetch event counts for each calendar
      const calendarsWithCounts: CalendarRow[] = [];
      for (const cal of data ?? []) {
        const { count } = await supabase
          .from('calendar_events')
          .select('*', { count: 'exact', head: true })
          .eq('calendar_id', cal.id);

        calendarsWithCounts.push({
          ...cal,
          event_count: count ?? 0,
        });
      }

      setCalendars(calendarsWithCounts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load calendars');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchCalendars();
  }, []);

  async function handleCreateCalendar() {
    if (!newName.trim()) {
      toast.error('Calendar name is required');
      return;
    }

    try {
      setCreating(true);
      const supabase = getSupabase();

      const slug = newSlug.trim() || newName.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

      const { error: insertError } = await supabase.from('calendars').insert({
        name: newName.trim(),
        slug,
        description: newDescription.trim() || null,
        is_public: true,
        is_active: true,
      });

      if (insertError) throw insertError;

      toast.success('Calendar created successfully');
      setDialogOpen(false);
      setNewName('');
      setNewSlug('');
      setNewDescription('');
      fetchCalendars();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create calendar');
    } finally {
      setCreating(false);
    }
  }

  if (error) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-medium text-destructive">Error loading calendars</p>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Calendars</h1>
          <p className="text-muted-foreground">Manage event calendars and collections.</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Calendar
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Calendar</DialogTitle>
              <DialogDescription>
                Create a new calendar to organize your events.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="cal-name">Name *</Label>
                <Input
                  id="cal-name"
                  placeholder="My Calendar"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cal-slug">Slug</Label>
                <Input
                  id="cal-slug"
                  placeholder="my-calendar (auto-generated if empty)"
                  value={newSlug}
                  onChange={(e) => setNewSlug(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cal-description">Description</Label>
                <Input
                  id="cal-description"
                  placeholder="A brief description of this calendar"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateCalendar} disabled={creating}>
                {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Calendars</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : calendars.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No calendars found. Create your first calendar.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Public</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="text-right">Events</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {calendars.map((cal) => (
                  <TableRow
                    key={cal.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/calendars/${cal.id}`)}
                  >
                    <TableCell className="font-medium">{cal.name}</TableCell>
                    <TableCell className="text-muted-foreground">{cal.slug}</TableCell>
                    <TableCell>
                      <Badge variant={cal.is_public ? 'default' : 'secondary'}>
                        {cal.is_public ? 'Public' : 'Private'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={cal.is_active ? 'default' : 'outline'}>
                        {cal.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{cal.event_count}</TableCell>
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
