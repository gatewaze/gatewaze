import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Calendar, Edit } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';

interface CalendarData {
  id: string;
  calendar_id: string;
  name: string;
  slug: string;
  description?: string;
  image_url?: string;
  is_public: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface LinkedEvent {
  id: string;
  event_id: string;
  event_title: string;
  event_start: string;
  status: string;
  event_location?: string;
}

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

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-4 py-3">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="col-span-2 text-sm">{value ?? <span className="text-muted-foreground">--</span>}</dd>
    </div>
  );
}

export default function CalendarDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [calendar, setCalendar] = useState<CalendarData | null>(null);
  const [events, setEvents] = useState<LinkedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    async function fetchCalendarData() {
      if (!id) return;

      try {
        const supabase = getSupabase();

        // Fetch calendar details
        const { data: calData, error: calError } = await supabase
          .from('calendars')
          .select('*')
          .eq('id', id)
          .single();

        if (calError) throw calError;

        setCalendar(calData);

        // Fetch linked events via junction table
        const { data: linkedEvents, error: eventsError } = await supabase
          .from('calendar_events')
          .select('events(id, event_id, event_title, event_start, status, event_location)')
          .eq('calendar_id', id);

        if (eventsError) throw eventsError;

        const eventsList: LinkedEvent[] = (linkedEvents ?? [])
          .map((row: Record<string, unknown>) => row.events as LinkedEvent)
          .filter(Boolean);

        // Sort by event_start descending
        eventsList.sort(
          (a, b) => new Date(b.event_start).getTime() - new Date(a.event_start).getTime(),
        );

        setEvents(eventsList);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load calendar');
      } finally {
        setLoading(false);
      }
    }

    fetchCalendarData();
  }, [id]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !calendar) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-medium text-destructive">
            {error ?? 'Calendar not found'}
          </p>
          <Button asChild variant="outline" className="mt-4">
            <Link to="/calendars">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Calendars
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button asChild variant="ghost" size="icon">
            <Link to="/calendars">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{calendar.name}</h1>
            <div className="mt-1 flex items-center gap-2">
              <Badge variant={calendar.is_public ? 'default' : 'secondary'}>
                {calendar.is_public ? 'Public' : 'Private'}
              </Badge>
              <Badge variant={calendar.is_active ? 'default' : 'outline'}>
                {calendar.is_active ? 'Active' : 'Inactive'}
              </Badge>
            </div>
          </div>
        </div>
        <Button onClick={() => setIsEditing(!isEditing)} variant={isEditing ? 'default' : 'outline'}>
          <Edit className="mr-2 h-4 w-4" />
          {isEditing ? 'Save Changes' : 'Edit'}
        </Button>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="events">
            Events ({events.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="details">
          <Card>
            <CardHeader>
              <CardTitle>Calendar Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y">
                <DetailRow label="Name" value={calendar.name} />
                <DetailRow label="Calendar ID" value={calendar.calendar_id} />
                <DetailRow label="Slug" value={calendar.slug} />
                <DetailRow
                  label="Description"
                  value={
                    calendar.description ? (
                      <p className="whitespace-pre-wrap">{calendar.description}</p>
                    ) : null
                  }
                />
                <DetailRow label="Public" value={calendar.is_public ? 'Yes' : 'No'} />
                <DetailRow label="Active" value={calendar.is_active ? 'Yes' : 'No'} />
                <DetailRow
                  label="Created"
                  value={new Date(calendar.created_at).toLocaleString()}
                />
                <DetailRow
                  label="Updated"
                  value={new Date(calendar.updated_at).toLocaleString()}
                />
              </dl>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="events">
          <Card>
            <CardHeader>
              <CardTitle>Linked Events</CardTitle>
              <CardDescription>
                Events that belong to this calendar.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {events.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No events linked to this calendar.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {events.map((event) => (
                      <TableRow
                        key={event.id}
                        className="cursor-pointer"
                        onClick={() => navigate(`/events/${event.id}`)}
                      >
                        <TableCell className="font-medium">{event.event_title}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(event.event_start).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {event.event_location ?? '--'}
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(event.status)}>
                            {event.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
