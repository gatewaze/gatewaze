import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, Users, Ticket, TrendingUp } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

interface StatsData {
  totalEvents: number;
  upcomingEvents: number;
  totalMembers: number;
  totalRegistrations: number;
}

interface RecentEvent {
  id: string;
  event_title: string;
  event_start: string;
  status: string;
  event_location?: string;
}

function StatsCardSkeleton() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-4" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-8 w-16" />
        <Skeleton className="mt-1 h-3 w-32" />
      </CardContent>
    </Card>
  );
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

export default function DashboardPage() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [recentEvents, setRecentEvents] = useState<RecentEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDashboardData() {
      try {
        const supabase = getSupabase();

        const [eventsCount, upcomingCount, membersCount, registrationsCount, recentEventsResult] =
          await Promise.all([
            supabase.from('events').select('*', { count: 'exact', head: true }),
            supabase
              .from('events')
              .select('*', { count: 'exact', head: true })
              .gte('event_start', new Date().toISOString())
              .eq('status', 'published'),
            supabase.from('customers').select('*', { count: 'exact', head: true }),
            supabase.from('event_registrations').select('*', { count: 'exact', head: true }),
            supabase
              .from('events')
              .select('id, event_title, event_start, status, event_location')
              .order('event_start', { ascending: false })
              .limit(5),
          ]);

        if (eventsCount.error) throw eventsCount.error;
        if (upcomingCount.error) throw upcomingCount.error;
        if (membersCount.error) throw membersCount.error;
        if (registrationsCount.error) throw registrationsCount.error;
        if (recentEventsResult.error) throw recentEventsResult.error;

        setStats({
          totalEvents: eventsCount.count ?? 0,
          upcomingEvents: upcomingCount.count ?? 0,
          totalMembers: membersCount.count ?? 0,
          totalRegistrations: registrationsCount.count ?? 0,
        });
        setRecentEvents(recentEventsResult.data ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard data');
      } finally {
        setLoading(false);
      }
    }

    fetchDashboardData();
  }, []);

  if (error) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-medium text-destructive">Error loading dashboard</p>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Overview of your events and community.</p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {loading ? (
          <>
            <StatsCardSkeleton />
            <StatsCardSkeleton />
            <StatsCardSkeleton />
            <StatsCardSkeleton />
          </>
        ) : (
          <>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Events</CardTitle>
                <Calendar className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats?.totalEvents ?? 0}</div>
                <p className="text-xs text-muted-foreground">All events in the system</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Upcoming Events</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats?.upcomingEvents ?? 0}</div>
                <p className="text-xs text-muted-foreground">Published and upcoming</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Members</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats?.totalMembers ?? 0}</div>
                <p className="text-xs text-muted-foreground">Registered community members</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Registrations</CardTitle>
                <Ticket className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats?.totalRegistrations ?? 0}</div>
                <p className="text-xs text-muted-foreground">Total event registrations</p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Recent Events */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Events</CardTitle>
          <CardDescription>Latest events added to the platform.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : recentEvents.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No events found.</p>
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
                {recentEvents.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell>
                      <Link
                        to={`/events/${event.id}`}
                        className="font-medium hover:underline"
                      >
                        {event.event_title}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(event.event_start).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {event.event_location ?? '--'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(event.status)}>{event.status}</Badge>
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
