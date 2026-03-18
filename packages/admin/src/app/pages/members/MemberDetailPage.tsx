import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Mail,
  Building2,
  Briefcase,
  MapPin,
  Calendar,
  Globe,
  Linkedin,
  Twitter,
  Edit,
} from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import type { Member } from '@gatewaze/shared';

interface RegistrationWithEvent {
  id: string;
  status: string;
  registered_at: string;
  event_id: string;
  event_title: string;
  event_start_date: string;
}

function getInitials(name?: string, email?: string): string {
  if (name) {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }
  return (email ?? '?')[0].toUpperCase();
}

function registrationStatusVariant(
  status: string,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'confirmed':
    case 'attended':
      return 'default';
    case 'pending':
      return 'secondary';
    case 'cancelled':
    case 'no_show':
      return 'destructive';
    default:
      return 'outline';
  }
}

export default function MemberDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [member, setMember] = useState<Member | null>(null);
  const [registrations, setRegistrations] = useState<RegistrationWithEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    async function fetchMember() {
      if (!id) return;

      try {
        const supabase = getSupabase();

        // Fetch member details
        const { data: memberData, error: memberError } = await supabase
          .from('customers')
          .select('*')
          .eq('id', id)
          .single();

        if (memberError) throw memberError;
        setMember(memberData);

        // Fetch registration history with event details
        const { data: regData, error: regError } = await supabase
          .from('event_registrations')
          .select('id, status, registered_at, event_id, events(event_title, event_start)')
          .eq('member_id', id)
          .order('registered_at', { ascending: false });

        if (regError) throw regError;

        const mapped: RegistrationWithEvent[] = (regData ?? []).map(
          (row: Record<string, unknown>) => {
            const event = row.events as { event_title: string; event_start: string } | null;
            return {
              id: row.id as string,
              status: row.status as string,
              registered_at: row.registered_at as string,
              event_id: row.event_id as string,
              event_title: event?.event_title ?? 'Unknown Event',
              event_start_date: event?.event_start ?? '',
            };
          },
        );

        setRegistrations(mapped);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load member');
      } finally {
        setLoading(false);
      }
    }

    fetchMember();
  }, [id]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-64" />
          <Skeleton className="col-span-2 h-64" />
        </div>
      </div>
    );
  }

  if (error || !member) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-medium text-destructive">
            {error ?? 'Member not found'}
          </p>
          <Button asChild variant="outline" className="mt-4">
            <Link to="/members">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Members
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
            <Link to="/members">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <h1 className="text-3xl font-bold tracking-tight">
            {member.full_name || member.email}
          </h1>
        </div>
        <Button onClick={() => setIsEditing(!isEditing)} variant={isEditing ? 'default' : 'outline'}>
          <Edit className="mr-2 h-4 w-4" />
          {isEditing ? 'Save Changes' : 'Edit'}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Profile Card */}
        <Card>
          <CardContent className="flex flex-col items-center p-6">
            <Avatar className="h-24 w-24">
              <AvatarImage
                src={member.avatar_url ?? undefined}
                alt={member.full_name ?? member.email}
              />
              <AvatarFallback className="text-2xl">
                {getInitials(member.full_name ?? undefined, member.email)}
              </AvatarFallback>
            </Avatar>

            <h2 className="mt-4 text-xl font-semibold">
              {member.full_name || 'No Name'}
            </h2>

            <div className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
              <Mail className="h-4 w-4" />
              {member.email}
            </div>

            {member.company && (
              <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                <Building2 className="h-4 w-4" />
                {member.company}
              </div>
            )}

            {member.job_title && (
              <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                <Briefcase className="h-4 w-4" />
                {member.job_title}
              </div>
            )}

            {member.location && (
              <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                <MapPin className="h-4 w-4" />
                {member.location}
              </div>
            )}

            {member.bio && (
              <>
                <Separator className="my-4" />
                <p className="text-center text-sm text-muted-foreground">{member.bio}</p>
              </>
            )}

            <Separator className="my-4" />

            {/* Social Links */}
            <div className="flex items-center gap-2">
              {member.linkedin_url && (
                <Button asChild variant="ghost" size="icon">
                  <a href={member.linkedin_url} target="_blank" rel="noopener noreferrer">
                    <Linkedin className="h-4 w-4" />
                  </a>
                </Button>
              )}
              {member.twitter_url && (
                <Button asChild variant="ghost" size="icon">
                  <a href={member.twitter_url} target="_blank" rel="noopener noreferrer">
                    <Twitter className="h-4 w-4" />
                  </a>
                </Button>
              )}
              {member.website_url && (
                <Button asChild variant="ghost" size="icon">
                  <a href={member.website_url} target="_blank" rel="noopener noreferrer">
                    <Globe className="h-4 w-4" />
                  </a>
                </Button>
              )}
            </div>

            <div className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3" />
              Joined {new Date(member.created_at).toLocaleDateString()}
            </div>
          </CardContent>
        </Card>

        {/* Registrations */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Event Registrations ({registrations.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {registrations.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                This member has not registered for any events.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event</TableHead>
                    <TableHead>Event Date</TableHead>
                    <TableHead>Registered</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {registrations.map((reg) => (
                    <TableRow key={reg.id}>
                      <TableCell>
                        <Link
                          to={`/events/${reg.event_id}`}
                          className="font-medium hover:underline"
                        >
                          {reg.event_title}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {reg.event_start_date
                          ? new Date(reg.event_start_date).toLocaleDateString()
                          : '--'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(reg.registered_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <Badge variant={registrationStatusVariant(reg.status)}>
                          {reg.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
