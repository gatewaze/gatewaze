import { useEffect, useState, useMemo, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Copy, Eye, MoreHorizontal, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { EventIdGenerator } from '@/utils/eventService';
import { getApiBaseUrl } from '@/config/brands';

interface EventRow {
  id: string;
  event_id: string;
  event_title: string;
  event_start: string;
  event_link?: string;
  status: string;
  event_location?: string;
  scraped_by?: string;
}

type StatusFilter = 'all' | 'draft' | 'published' | 'cancelled';

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'published':
      return 'default';
    case 'draft':
      return 'secondary';
    case 'cancelled':
      return 'destructive';
    default:
      return 'outline';
  }
}

export default function EventsListPage() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [deleteTarget, setDeleteTarget] = useState<EventRow | null>(null);
  const [refreshingEvents, setRefreshingEvents] = useState<Set<string>>(new Set());

  const fetchEvents = useCallback(async () => {
    try {
      setLoading(true);
      const supabase = getSupabase();
      const { data, error: fetchError } = await supabase
        .from('events')
        .select('id, event_id, event_title, event_start, event_link, status, event_location, scraped_by')
        .order('event_start', { ascending: false });

      if (fetchError) throw fetchError;
      setEvents(data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load events');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const filteredEvents = useMemo(() => {
    let result = events;

    if (statusFilter !== 'all') {
      result = result.filter((e) => e.status === statusFilter);
    }

    if (search.trim()) {
      const query = search.toLowerCase();
      result = result.filter(
        (e) =>
          e.event_title.toLowerCase().includes(query) ||
          (e.event_location && e.event_location.toLowerCase().includes(query)),
      );
    }

    return result;
  }, [events, statusFilter, search]);

  const handleDuplicate = async (event: EventRow) => {
    try {
      const supabase = getSupabase();
      const newEventId = await EventIdGenerator.generateUniqueEventId();

      // Fetch the full event data
      const { data: fullEvent, error: fetchErr } = await supabase
        .from('events')
        .select('*')
        .eq('id', event.id)
        .single();

      if (fetchErr || !fullEvent) {
        toast.error('Failed to fetch event data for duplication');
        return;
      }

      // Remove fields that should not be copied
      const {
        id: _id,
        created_at: _createdAt,
        updated_at: _updatedAt,
        screenshot_generated: _sg,
        screenshot_generated_at: _sga,
        screenshot_url: _su,
        checkin_qr_code: _qr,
        ...rest
      } = fullEvent;

      const { error: insertErr } = await supabase
        .from('events')
        .insert({
          ...rest,
          event_id: newEventId,
          event_title: `${fullEvent.event_title} (Copy)`,
          screenshot_generated: false,
          screenshot_generated_at: null,
          screenshot_url: null,
        });

      if (insertErr) {
        toast.error(`Failed to duplicate: ${insertErr.message}`);
        return;
      }

      toast.success(`Event duplicated as "${fullEvent.event_title} (Copy)"`);
      await fetchEvents();
    } catch (err) {
      toast.error('Unexpected error duplicating event');
      console.error(err);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const supabase = getSupabase();
      const { error: delErr } = await supabase
        .from('events')
        .delete()
        .eq('id', deleteTarget.id);

      if (delErr) {
        toast.error(`Failed to delete: ${delErr.message}`);
        return;
      }

      toast.success(`"${deleteTarget.event_title}" deleted`);
      setDeleteTarget(null);
      await fetchEvents();
    } catch (err) {
      toast.error('Unexpected error deleting event');
      console.error(err);
    }
  };

  const handleRefresh = async (event: EventRow) => {
    if (!event.scraped_by || !event.event_link) return;

    setRefreshingEvents((prev) => new Set(prev).add(event.event_id));
    try {
      const apiBaseUrl = getApiBaseUrl();
      const response = await fetch(`${apiBaseUrl}/api/scrapers/refresh-event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: event.event_id,
          scraperName: event.scraped_by,
          eventLink: event.event_link,
        }),
      });

      const result = await response.json();
      if (response.ok && result.success) {
        toast.success(`"${event.event_title}" refreshed successfully`);
        await fetchEvents();
      } else {
        toast.error(`Failed to refresh: ${result.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      toast.error(`Error refreshing event: ${err.message}`);
    } finally {
      setRefreshingEvents((prev) => {
        const next = new Set(prev);
        next.delete(event.event_id);
        return next;
      });
    }
  };

  if (error) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-medium text-destructive">Error loading events</p>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Events</h1>
          <p className="text-muted-foreground">Manage your events and conferences.</p>
        </div>
        <Button asChild>
          <Link to="/events/new">
            <Plus className="mr-2 h-4 w-4" />
            New Event
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>All Events</CardTitle>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search events..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as StatusFilter)}
            className="mb-4"
          >
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="draft">Draft</TabsTrigger>
              <TabsTrigger value="published">Published</TabsTrigger>
              <TabsTrigger value="cancelled">Cancelled</TabsTrigger>
            </TabsList>
          </Tabs>

          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredEvents.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {search || statusFilter !== 'all'
                ? 'No events match your filters.'
                : 'No events found. Create your first event.'}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEvents.map((event) => (
                  <TableRow
                    key={event.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/events/${event.id}`)}
                  >
                    <TableCell className="font-medium">{event.event_title}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(event.event_start).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(event.status)}>{event.status}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {event.event_location ?? '--'}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">Actions</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                          <DropdownMenuItem onClick={() => navigate(`/events/${event.id}`)}>
                            <Eye className="mr-2 h-4 w-4" />
                            View / Edit
                          </DropdownMenuItem>
                          {event.scraped_by && (
                            <DropdownMenuItem
                              disabled={!event.event_link || refreshingEvents.has(event.event_id)}
                              onClick={() => handleRefresh(event)}
                            >
                              <RefreshCw
                                className={`mr-2 h-4 w-4 ${refreshingEvents.has(event.event_id) ? 'animate-spin' : ''}`}
                              />
                              Re-scrape
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => handleDuplicate(event)}>
                            <Copy className="mr-2 h-4 w-4" />
                            Duplicate
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setDeleteTarget(event)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Event</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &ldquo;{deleteTarget?.event_title}&rdquo;? This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
