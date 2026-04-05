import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router';
import {
  ArrowLeftIcon,
  UserCircleIcon,
  TagIcon,
  ClockIcon,
  LinkIcon,
  CalendarIcon,
  PhotoIcon,
  TrashIcon,
  TrophyIcon,
  CheckCircleIcon,
  XCircleIcon,
  MinusCircleIcon,
  EnvelopeIcon,
  PencilIcon,
  CheckIcon,
  XMarkIcon,
  MapPinIcon,
  Cog6ToothIcon,
  BuildingOfficeIcon,
  BriefcaseIcon,
  Square3Stack3DIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'sonner';
import { Card, Button, Input, Badge, Avatar, Table, THead, TBody, Tr, Th, Td, Tabs } from '@/components/ui';
import type { Tab } from '@/components/ui/Tabs';
import { Spinner } from '@/components/ui/Spinner';
import { Page } from '@/components/shared/Page';
import { PeopleService, Person } from '@/utils/peopleService';
import { PeopleAvatarService } from '@/utils/peopleAvatarService';
import { CompetitionWinnerService, CompetitionWinner } from '@/utils/competitionWinnerService';
import { supabase } from '@/lib/supabase';
import { EmailHistorySection } from '@/components/emails/EmailHistorySection';
import { useHasModule } from '@/hooks/useModuleFeature';
import { ModuleSlot } from '@/components/ModuleSlot';

// Helper function to get avatar URL with fallback
function getAvatarUrl(person: Person, size: number = 80): string {
  // Priority 1: Check if person has stored avatar (uploaded, linkedin, or gravatar)
  const storedAvatar = PeopleService.getAvatarUrl(person, size);
  if (storedAvatar) return storedAvatar;

  // Priority 2: Fallback to live Gravatar (for people that haven't been synced yet)
  if (person.email) {
    return PeopleService.getGravatarFallbackUrl(person.email, size);
  }

  return '';
}

interface Segment {
  id: number;
  cio_segment_id: number;
  name: string;
  description?: string;
  type?: string;
  joined_at?: string;
}

interface EmailSubscription {
  id: string;
  list_id: string;
  subscribed: boolean;
  subscribed_at?: string;
  unsubscribed_at?: string;
  isDefault?: boolean; // True if this is a synthetic subscription based on default status
}

interface TopicLabelInfo {
  label: string;
  default_subscribed: boolean;
}

interface Activity {
  id?: number;
  activity_type: string;
  activity_name?: string;
  activity_data?: Record<string, any>;
  timestamp: string;
}

interface PersonEvent {
  id: number;
  event_name: string;
  event_data?: Record<string, any>;
  timestamp: string;
}

interface Relationship {
  id: number;
  object_type_id: string;
  object_id: string;
  relationship_attributes?: Record<string, any>;
  created_at: string;
}

interface CompetitionEvent {
  event_id?: string;
  event_title?: string;
  event_city?: string;
  event_start?: string;
  [key: string]: any;
}

interface CompetitionWin {
  winner: CompetitionWinner;
  competition: CompetitionEvent | null;
}

interface EventDetails {
  event_id: string;
  event_title: string;
  event_city?: string;
  event_country_code?: string;
  event_start?: string;
  event_end?: string;
  event_logo?: string;
}

interface EventRegistration {
  id: string;
  event_id: string;
  status: string;
  registered_at?: string;
  ticket_type?: string;
  registration_type?: string;
  event?: EventDetails;
}

interface EventAttendance {
  id: string;
  event_id: string;
  checked_in_at?: string;
  checked_out_at?: string;
  event?: EventDetails;
}

interface SpeakerSubmission {
  id: string;
  event_uuid: string;
  status: string;
  talk_title?: string;
  submitted_at?: string;
  event?: EventDetails;
}

interface CompetitionActivity {
  offerId: string;
  statuses: {
    [status: string]: {
      timestamp: string;
      activityTimestamp?: number;
    };
  };
  lastActivityTimestamp: string;
  event?: CompetitionEvent;
}

interface OfferActivity {
  offerId: string;
  statuses: {
    [status: string]: {
      timestamp: string;
      activityTimestamp?: number;
    };
  };
  lastActivityTimestamp: string;
  event?: CompetitionEvent;
}

type TabType = 'profile' | 'attributes' | 'segments' | 'activities' | 'events' | 'relationships' | 'wins' | 'emails' | 'competitions' | 'offers';

const validTabs: TabType[] = ['profile', 'attributes', 'segments', 'activities', 'events', 'relationships', 'wins', 'emails', 'competitions', 'offers'];

export default function MemberDetailPage() {
  const { id, tab: tabFromUrl } = useParams<{ id: string; tab?: string }>();
  const navigate = useNavigate();
  const hasCIO = useHasModule('customerio');
  const hasCompetitions = useHasModule('competitions');
  const hasBulkEmailing = useHasModule('bulk-emailing');
  const hasEvents = useHasModule('events');
  const [person, setPerson] = useState<Person | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [events, setEvents] = useState<PersonEvent[]>([]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [competitionWins, setCompetitionWins] = useState<CompetitionWin[]>([]);
  const [competitions, setCompetitions] = useState<CompetitionActivity[]>([]);
  const [offers, setOffers] = useState<OfferActivity[]>([]);
  const [eventRegistrations, setEventRegistrations] = useState<EventRegistration[]>([]);
  const [eventAttendances, setEventAttendances] = useState<EventAttendance[]>([]);
  const [speakerSubmissions, setSpeakerSubmissions] = useState<SpeakerSubmission[]>([]);
  const [emailSubscriptions, setEmailSubscriptions] = useState<EmailSubscription[]>([]);
  const [topicLabels, setTopicLabels] = useState<Record<string, TopicLabelInfo>>({});
  const [togglingSubscription, setTogglingSubscription] = useState<string | null>(null);
  const [unsubscribingAll, setUnsubscribingAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // Edit mode state
  const [isEditMode, setIsEditMode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editFormData, setEditFormData] = useState({
    email: '',
    first_name: '',
    last_name: '',
    job_title: '',
    company: '',
    linkedin_url: '',
    city: '',
    country: '',
  });

  // Determine active tab from URL path or default to 'profile'
  const activeTab: TabType = validTabs.includes(tabFromUrl as TabType) ? (tabFromUrl as TabType) : 'profile';

  // Navigate to a new tab using path-based URLs
  const handleTabChange = (tab: TabType) => {
    navigate(`/people/${id}/${tab}`);
  };

  // Initialize edit form when person loads
  useEffect(() => {
    if (person) {
      setEditFormData({
        email: person.email || '',
        first_name: person.attributes?.first_name || '',
        last_name: person.attributes?.last_name || '',
        job_title: person.attributes?.job_title || '',
        company: person.attributes?.company || '',
        linkedin_url: person.attributes?.linkedin_url || '',
        city: person.attributes?.city || '',
        country: person.attributes?.country || '',
      });
    }
  }, [person]);

  const handleEditToggle = () => {
    if (isEditMode) {
      // Reset form data when cancelling
      if (person) {
        setEditFormData({
          email: person.email || '',
          first_name: person.attributes?.first_name || '',
          last_name: person.attributes?.last_name || '',
          job_title: person.attributes?.job_title || '',
          company: person.attributes?.company || '',
          linkedin_url: person.attributes?.linkedin_url || '',
          city: person.attributes?.city || '',
          country: person.attributes?.country || '',
        });
      }
    }
    setIsEditMode(!isEditMode);
  };

  const handleSaveEdit = async () => {
    if (!person?.id) return;

    setIsSaving(true);
    try {
      const result = await PeopleService.updatePerson(
        Number(person.id),
        {
          email: editFormData.email,
          attributes: {
            ...person.attributes,
            first_name: editFormData.first_name,
            last_name: editFormData.last_name,
            job_title: editFormData.job_title,
            company: editFormData.company,
            linkedin_url: editFormData.linkedin_url,
            city: editFormData.city,
            country: editFormData.country,
          },
        }
      );

      if (result.success) {
        toast.success('Person updated successfully');
        setIsEditMode(false);
        loadPersonDetails();
      } else {
        toast.error(`Failed to update person: ${result.error}`);
      }
    } catch (error) {
      console.error('Error updating person:', error);
      toast.error('Error updating person');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleSubscription = async (subscription: EmailSubscription) => {
    if (!person?.id || !person?.email) return;

    setTogglingSubscription(subscription.id);
    try {
      const newSubscribed = !subscription.subscribed;
      const now = new Date().toISOString();

      // Call the track-subscription edge function which updates Supabase AND syncs to Customer.io
      const { data, error } = await supabase.functions.invoke('people-track-subscription', {
        body: {
          email: person.email,
          list_id: subscription.list_id,
          subscribed: newSubscribed,
          source: 'admin',
        },
      });

      if (error) throw error;

      // Update local state
      setEmailSubscriptions(prev =>
        prev.map(sub =>
          sub.id === subscription.id
            ? {
                id: data?.subscription_id || sub.id,
                list_id: subscription.list_id,
                subscribed: newSubscribed,
                subscribed_at: newSubscribed ? now : sub.subscribed_at,
                unsubscribed_at: newSubscribed ? undefined : now,
                isDefault: false, // No longer a default subscription
              }
            : sub
        )
      );

      toast.success(newSubscribed ? 'Subscribed successfully' : 'Unsubscribed successfully');
    } catch (error) {
      console.error('Error toggling subscription:', error);
      toast.error('Failed to update subscription');
    } finally {
      setTogglingSubscription(null);
    }
  };

  const handleUnsubscribeAll = async () => {
    if (!person?.id || !person?.email || emailSubscriptions.length === 0) return;

    // Get all subscribed topics (both real and default)
    const subscribedTopics = emailSubscriptions.filter(sub => sub.subscribed);

    if (subscribedTopics.length === 0) {
      toast.info('No active subscriptions to unsubscribe from');
      return;
    }

    setUnsubscribingAll(true);
    try {
      const now = new Date().toISOString();

      // Call the track-subscription edge function for each subscription
      // This updates Supabase AND syncs to Customer.io
      const results = await Promise.allSettled(
        subscribedTopics.map(sub =>
          supabase.functions.invoke('people-track-subscription', {
            body: {
              email: person.email,
              list_id: sub.list_id,
              subscribed: false,
              source: 'admin',
            },
          })
        )
      );

      // Count successful and failed
      const successful = results.filter(r => r.status === 'fulfilled' && !r.value.error).length;
      const failed = results.filter(r => r.status === 'rejected' || r.value?.error).length;

      if (failed > 0) {
        console.error('Some unsubscribe operations failed:', results.filter(r => r.status === 'rejected' || r.value?.error));
      }

      // Update local state for all subscriptions
      setEmailSubscriptions(prev =>
        prev.map(sub => {
          if (!sub.subscribed) return sub;
          return {
            ...sub,
            subscribed: false,
            unsubscribed_at: now,
            isDefault: false,
          };
        })
      );

      if (failed === 0) {
        toast.success(`Unsubscribed from ${successful} list${successful > 1 ? 's' : ''}`);
      } else if (successful > 0) {
        toast.warning(`Unsubscribed from ${successful} list${successful > 1 ? 's' : ''}, ${failed} failed`);
      } else {
        toast.error('Failed to unsubscribe from all lists');
      }
    } catch (error) {
      console.error('Error unsubscribing from all:', error);
      toast.error('Failed to unsubscribe from all lists');
    } finally {
      setUnsubscribingAll(false);
    }
  };

  const [activeActivityTab, setActiveActivityTab] = useState<string>('all');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (id) {
      loadPersonDetails();
    }
  }, [id]);

  const loadPersonDetails = async () => {
    try {
      setLoading(true);

      // Fetch person by ID
      const { data: customerData, error: customerError } = await supabase
        .from('people')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (customerError) throw customerError;
      if (!customerData) {
        toast.error('Person not found');
        navigate('/people');
        return;
      }

      setPerson(customerData);

      if (hasCIO && customerData?.cio_id) {
        // Fetch segments
        const { data: segmentsData } = await supabase
          .from('segments_memberships')
          .select(`
            id,
            joined_at,
            last_verified_at,
            segment:customer_segments!inner(
              id,
              cio_segment_id,
              name,
              description,
              type
            )
          `)
          .eq('customer_cio_id', customerData.cio_id);

        if (segmentsData) {
          setSegments(
            segmentsData.map((item: any) => ({
              id: item.id,
              cio_segment_id: item.segment.cio_segment_id,
              name: item.segment.name,
              description: item.segment.description,
              type: item.segment.type,
              joined_at: item.joined_at,
            }))
          );
        }

        // Fetch activities
        const activitiesData = await PeopleService.getPersonActivities(customerData.cio_id);
        setActivities(activitiesData);

        // Fetch competition interactions from new table
        const { data: competitionInteractionsData, error: compError } = await supabase
          .from('events_competition_interactions')
          .select('*')
          .eq('customer_cio_id', customerData.cio_id)
          .order('timestamp', { ascending: true });

        if (compError) {
          console.error('Error loading competition interactions:', compError);
        }

        // Fetch offer interactions from new table
        const { data: offerInteractionsData, error: offerError } = await supabase
          .from('integrations_offer_interactions')
          .select('*')
          .eq('customer_cio_id', customerData.cio_id)
          .order('timestamp', { ascending: true });

        if (offerError) {
          console.error('Error loading offer interactions:', offerError);
        }

        // Group competition interactions by offer_id
        const fetchedEvents: any[] = []; // TODO: load events data
        const competitionActivities: CompetitionActivity[] = [];
        const compMap = new Map<string, CompetitionActivity>();

        (competitionInteractionsData || []).forEach(interaction => {
          if (!compMap.has(interaction.offer_id)) {
            const event = fetchedEvents.find(e => e.offerSlug === interaction.offer_id);
            compMap.set(interaction.offer_id, {
              offerId: interaction.offer_id,
              statuses: {},
              lastActivityTimestamp: interaction.timestamp,
              event
            });
          }

          const comp = compMap.get(interaction.offer_id)!;
          comp.statuses[interaction.offer_status] = {
            timestamp: interaction.timestamp,
            activityTimestamp: undefined
          };

          // Update last activity if this is newer
          if (new Date(interaction.timestamp).getTime() > new Date(comp.lastActivityTimestamp).getTime()) {
            comp.lastActivityTimestamp = interaction.timestamp;
          }
        });

        competitionActivities.push(...compMap.values());

        // Group offer interactions by offer_id
        const offerActivities: OfferActivity[] = [];
        const offerMap = new Map<string, OfferActivity>();

        (offerInteractionsData || []).forEach(interaction => {
          if (!offerMap.has(interaction.offer_id)) {
            const event = fetchedEvents.find(e => e.offerSlug === interaction.offer_id);
            offerMap.set(interaction.offer_id, {
              offerId: interaction.offer_id,
              statuses: {},
              lastActivityTimestamp: interaction.timestamp,
              event
            });
          }

          const offer = offerMap.get(interaction.offer_id)!;
          offer.statuses[interaction.offer_status] = {
            timestamp: interaction.timestamp,
            activityTimestamp: undefined
          };

          // Update last activity if this is newer
          if (new Date(interaction.timestamp).getTime() > new Date(offer.lastActivityTimestamp).getTime()) {
            offer.lastActivityTimestamp = interaction.timestamp;
          }
        });

        offerActivities.push(...offerMap.values());

        // Already sorted by timestamp ascending due to SQL query
        setCompetitions(competitionActivities);
        setOffers(offerActivities);

        // Fetch events
        const { data: eventsData } = await supabase
          .from('people_events')
          .select('*')
          .eq('customer_cio_id', customerData.cio_id)
          .order('timestamp', { ascending: false })
          .limit(100);

        if (eventsData) {
          setEvents(eventsData);
        }

        // Fetch relationships
        const { data: relationshipsData } = await supabase
          .from('people_relationships')
          .select('*')
          .eq('customer_cio_id', customerData.cio_id)
          .order('created_at', { ascending: false });

        if (relationshipsData) {
          setRelationships(relationshipsData);
        }
      }

      // Fetch competition wins by email (only if competitions module is enabled)
      if (hasCompetitions && customerData?.email) {
        const { data: winnersData } = await supabase
          .from('events_competition_winners')
          .select('*')
          .eq('email', customerData.email)
          .order('created_at', { ascending: false });

        if (winnersData && winnersData.length > 0) {
          const fetchedEvents: any[] = []; // TODO: load events data
          const wins: CompetitionWin[] = winnersData.map(winner => ({
            winner,
            competition: fetchedEvents.find((e: any) => e.eventId === winner.event_id) || null
          }));

          setCompetitionWins(wins);
        }
      }

      // Subscriptions are now handled by the lists module's PersonSubscriptions slot component.
      // Legacy email_subscriptions/email_topic_labels tables are no longer queried here.

      // Fetch event registrations, attendance, and speaker submissions via member_profiles
      // Only when events module is installed
      if (hasEvents) {
        const { data: profileData } = await supabase
          .from('people_profiles')
          .select('id')
          .eq('person_id', id!);

        const memberProfileIds = (profileData || []).map((p: any) => p.id);

        if (memberProfileIds.length > 0) {
          const [regResult, attendResult, speakerResult] = await Promise.all([
            supabase
              .from('events_registrations')
              .select('id, event_id, status, registered_at, ticket_type, registration_type')
              .in('people_profile_id', memberProfileIds)
              .order('registered_at', { ascending: false }),
            supabase
              .from('events_attendance')
              .select('id, event_id, checked_in_at, checked_out_at')
              .in('people_profile_id', memberProfileIds)
              .order('checked_in_at', { ascending: false }),
            supabase
              .from('events_speakers')
              .select('id, event_uuid, status, talk_title, submitted_at')
              .in('people_profile_id', memberProfileIds)
              .order('submitted_at', { ascending: false }),
          ]);

          const regData = regResult.data || [];
          const attendData = attendResult.data || [];
          const speakerData = speakerResult.data || [];

          // Collect all event IDs to fetch titles in one query
          const allEventIds = [
            ...new Set([
              ...regData.map((r: any) => r.event_id),
              ...attendData.map((a: any) => a.event_id),
              ...speakerData.map((s: any) => s.event_uuid?.toString()),
            ].filter(Boolean)),
          ];

          const eventsMap = new Map<string, EventDetails>();
          if (allEventIds.length > 0) {
            const { data: eventDetails } = await supabase
              .from('events')
              .select('event_id, event_title, event_city, event_country_code, event_start, event_end, event_logo')
              .in('event_id', allEventIds);
            (eventDetails || []).forEach((e: any) => eventsMap.set(e.event_id, e));
          }

          setEventRegistrations(regData.map((r: any) => ({ ...r, event: eventsMap.get(r.event_id) })));
          setEventAttendances(attendData.map((a: any) => ({ ...a, event: eventsMap.get(a.event_id) })));
          setSpeakerSubmissions(speakerData.map((s: any) => ({ ...s, event: eventsMap.get(s.event_uuid?.toString()) })));
        }
      }
    } catch (error) {
      console.error('Error loading person details:', error);
      toast.error('Failed to load person details');
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    navigate('/people');
  };

  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !person?.id) return;

    setUploadingAvatar(true);
    try {
      const result = await PeopleAvatarService.uploadAvatar(person.id, file);
      if (result.success) {
        toast.success('Avatar uploaded successfully');
        // Reload person data
        loadPersonDetails();
      } else {
        toast.error(result.error || 'Failed to upload avatar');
      }
    } catch (error) {
      toast.error('Failed to upload avatar');
      console.error('Avatar upload error:', error);
    } finally {
      setUploadingAvatar(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDeleteAvatar = async () => {
    if (!person?.id || !person?.avatar_storage_path) return;

    if (!confirm('Are you sure you want to delete this avatar?')) return;

    try {
      const result = await PeopleAvatarService.deleteAvatar(
        person.id,
        person.avatar_storage_path
      );
      if (result.success) {
        toast.success('Avatar deleted successfully');
        // Reload person data
        loadPersonDetails();
      } else {
        toast.error(result.error || 'Failed to delete avatar');
      }
    } catch (error) {
      toast.error('Failed to delete avatar');
      console.error('Avatar delete error:', error);
    }
  };

  const formatTimestamp = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    const intervals = {
      year: 31536000,
      month: 2592000,
      week: 604800,
      day: 86400,
      hour: 3600,
      minute: 60,
    };

    for (const [unit, secondsInUnit] of Object.entries(intervals)) {
      const interval = Math.floor(seconds / secondsInUnit);
      if (interval >= 1) {
        return `${interval} ${unit}${interval === 1 ? '' : 's'} ago`;
      }
    }

    return 'just now';
  };

  // Format unix timestamp for attribute updates
  const formatUnixTimestamp = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  // Get attribute timestamp if available
  const getAttributeTimestamp = (attributeName: string): number | undefined => {
    return person?.attribute_timestamps?.[attributeName];
  };

  // Component for showing attribute with optional timestamp
  const AttributeField = ({ label, value, attributeName }: { label: string; value: string | null | undefined; attributeName: string }) => {
    const timestamp = getAttributeTimestamp(attributeName);
    // Use Boolean() to ensure we get true/false, not 0 (which React would render as "0")
    const hasValidTimestamp = Boolean(timestamp && timestamp > 0);
    return (
      <div>
        <label className="block text-sm font-medium text-[var(--gray-11)]">
          {label}
          {hasValidTimestamp && (
            <span className="ml-2 text-[10px] font-normal text-[var(--gray-a8)]" title={formatUnixTimestamp(timestamp!)}>
              {formatTimeAgo(new Date(timestamp! * 1000).toISOString())}
            </span>
          )}
        </label>
        <p className="mt-1 text-sm text-[var(--gray-12)]">
          {value || '-'}
        </p>
      </div>
    );
  };

  if (loading) {
    return (
      <Page title="Person Details">
        <div className="flex items-center justify-center h-96">
          <Spinner className="size-8" />
        </div>
      </Page>
    );
  }

  if (!person) {
    return (
      <Page title="Person Details">
        <div className="flex items-center justify-center h-96">
          <div className="text-center">
            <UserCircleIcon className="size-12 text-gray-400 mx-auto" />
            <h3 className="mt-2 text-sm font-medium text-[var(--gray-12)]">
              Person not found
            </h3>
            <div className="mt-6">
              <Button onClick={handleBack}>Back to People</Button>
            </div>
          </div>
        </div>
      </Page>
    );
  }

  // Check if we have valid location coordinates for the map background
  const hasMapLocation = (() => {
    const location = person.attributes?.location;
    if (location) {
      const [lat, lng] = location.split(',').map((coord: string) => parseFloat(coord.trim()));
      return !isNaN(lat) && !isNaN(lng);
    }
    return false;
  })();

  return (
    <Page>
      {/* Hero Section */}
      <div className="relative h-48 md:h-56 lg:h-64 overflow-hidden bg-gray-900 -mx-(--margin-x) -mt-(--margin-x)">
        {/* Background - map if location available, otherwise gradient */}
        {hasMapLocation ? (
          <iframe
            className="absolute inset-0 w-full h-full scale-110 pointer-events-none"
            src={(() => {
              const location = person.attributes?.location;
              if (location) {
                const [lat, lng] = location.split(',').map((coord: string) => parseFloat(coord.trim()));
                // Use a wider bounding box for the hero background view, with marker
                return `https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.15},${lat - 0.08},${lng + 0.15},${lat + 0.08}&layer=mapnik&marker=${lat},${lng}`;
              }
              return '';
            })()}
            style={{ border: 0, filter: 'saturate(0.7)' }}
            scrolling="no"
            frameBorder="0"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-primary-600 to-primary-800 dark:from-primary-800 dark:to-primary-950" />
        )}

        {/* Gradient Overlay for text readability */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/20" />

        {/* Back Button - aligned with content padding */}
        <div className="absolute top-6 z-10" style={{ left: 'calc(var(--margin-x) + 1.5rem)' }}>
          <button
            onClick={handleBack}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md bg-white/90 backdrop-blur-md border border-white/40 text-gray-900 shadow-sm hover:bg-white transition-colors"
          >
            <ArrowLeftIcon className="size-4" />
            Back
          </button>
        </div>

        {/* Member Info - aligned with content padding */}
        <div className="absolute bottom-0 left-0 right-0" style={{ padding: '0 calc(var(--margin-x) + 1.5rem) 1.5rem' }}>
          <div className="flex items-end gap-4">
            {/* Avatar */}
            <div className="relative group flex-shrink-0">
              <Avatar
                src={getAvatarUrl(person, 96) || undefined}
                name={person.attributes?.first_name && person.attributes?.last_name
                  ? `${person.attributes.first_name} ${person.attributes.last_name}`
                  : person.email}
                size={24}
                initialColor="auto"
                className="rounded-full overflow-hidden border-4 border-white/20 shadow-lg"
              />
              <div className="absolute inset-0 bg-black bg-opacity-50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                <Button
                  variant="solid"
                  color="gray"
                  isIcon
                  className="size-8 bg-white hover:bg-gray-100"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingAvatar}
                  title="Upload new avatar"
                >
                  <PhotoIcon className="size-4 text-gray-700" />
                </Button>
                {person.avatar_storage_path && person.avatar_source === 'uploaded' && (
                  <Button
                    variant="solid"
                    color="gray"
                    isIcon
                    className="size-8 bg-white hover:bg-gray-100"
                    onClick={handleDeleteAvatar}
                    title="Delete avatar"
                  >
                    <TrashIcon className="size-4 text-red-600" />
                  </Button>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={handleAvatarUpload}
                className="hidden"
              />
              {person.avatar_source && (
                <Badge
                  variant="solid"
                  color="blue"
                  className="absolute -bottom-1 -right-1"
                >
                  {person.avatar_source}
                </Badge>
              )}
            </div>

            {/* Name and Info */}
            <div className="flex-1 pb-1">
              <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold text-white mb-2 drop-shadow-lg">
                {person.attributes?.first_name || person.attributes?.last_name
                  ? `${person.attributes?.first_name || ''} ${person.attributes?.last_name || ''}`.trim()
                  : person.email || 'Person Details'}
              </h1>
              <div className="flex items-center gap-4 text-sm text-white/90 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <EnvelopeIcon className="w-4 h-4" />
                  <span>{person.email}</span>
                </div>
                {(person.attributes?.city || person.attributes?.country) && (
                  <div className="flex items-center gap-1.5">
                    <MapPinIcon className="w-4 h-4" />
                    <span>
                      {person.attributes?.city && person.attributes?.country
                        ? `${person.attributes.city}, ${person.attributes.country}`
                        : person.attributes?.city || person.attributes?.country}
                    </span>
                  </div>
                )}
                {person.attributes?.company && (
                  <div className="flex items-center gap-1.5">
                    <BuildingOfficeIcon className="w-4 h-4" />
                    <span>{person.attributes.company}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="-mx-(--margin-x)">
        <Tabs
          fullWidth
          value={activeTab}
          onChange={(tab) => handleTabChange(tab as TabType)}
          tabs={[
            { id: 'profile', label: 'Profile', icon: <Cog6ToothIcon className="size-4" /> },
            { id: 'attributes', label: 'Attributes', icon: <Square3Stack3DIcon className="size-4" /> },
            hasCIO && { id: 'segments', label: 'Segments', icon: <TagIcon className="size-4" />, count: segments.length },
            competitions.length > 0 && { id: 'competitions', label: 'Competitions', icon: <TrophyIcon className="size-4" />, count: competitions.length },
            offers.length > 0 && { id: 'offers', label: 'Offers', icon: <CalendarIcon className="size-4" />, count: offers.length },
            hasCIO && { id: 'activities', label: 'Activities', icon: <ClockIcon className="size-4" />, count: activities.length },
            hasEvents && { id: 'events', label: 'Events', icon: <CalendarIcon className="size-4" /> },
            hasCIO && { id: 'relationships', label: 'Relationships', icon: <LinkIcon className="size-4" />, count: relationships.length },
            competitionWins.length > 0 && { id: 'wins', label: 'Wins', icon: <TrophyIcon className="size-4" />, count: competitionWins.length },
            { id: 'emails', label: 'Emails', icon: <EnvelopeIcon className="size-4" /> },
          ].filter(Boolean) as Tab[]}
        />
      </div>

      <div className="p-6 space-y-6">

        {/* Tab Content */}
        {/* Profile Tab */}
        {activeTab === 'profile' && (
          <div>
            {/* Module extension point: subscription badges, etc. */}
            <ModuleSlot name="person-detail:subscriptions" props={{ person, personId: id }} />

            {/* Edit/Save Controls */}
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-[var(--gray-12)]">
                Profile
              </h3>
              <div className="flex items-center gap-2">
                {isEditMode ? (
                  <>
                    <Button
                      variant="soft"
                      size="1"
                      onClick={handleEditToggle}
                      disabled={isSaving}
                    >
                      <XMarkIcon className="w-4 h-4 mr-2" />
                      Cancel
                    </Button>
                    <Button
                      variant="solid"
                      size="1"
                      onClick={handleSaveEdit}
                      disabled={isSaving}
                    >
                      {isSaving ? (
                        <>Saving...</>
                      ) : (
                        <>
                          <CheckIcon className="w-4 h-4 mr-2" />
                          Save Changes
                        </>
                      )}
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="solid"
                    size="1"
                    onClick={handleEditToggle}
                  >
                    <PencilIcon className="w-4 h-4 mr-2" />
                    Edit
                  </Button>
                )}
              </div>
            </div>

            {/* Email Subscriptions */}
            {emailSubscriptions.length > 0 && (
              <Card variant="surface" className="mb-6 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-medium text-[var(--gray-11)] flex items-center gap-2">
                    <EnvelopeIcon className="w-4 h-4" />
                    Email Subscriptions
                    <span className="text-xs text-[var(--gray-11)] font-normal">
                      (click to toggle)
                    </span>
                  </h4>
                  {emailSubscriptions.some(sub => sub.subscribed) && (
                    <Button
                      variant="ghost"
                      color="red"
                      size="1"
                      onClick={handleUnsubscribeAll}
                      disabled={unsubscribingAll}
                      className="gap-1.5"
                    >
                      {unsubscribingAll ? (
                        <Spinner className="w-3 h-3" />
                      ) : (
                        <XCircleIcon className="w-3.5 h-3.5" />
                      )}
                      Unsubscribe All
                    </Button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {emailSubscriptions.map((sub) => {
                    // Use friendly label if available, otherwise format list_id
                    const displayName = topicLabels[sub.list_id]?.label || sub.list_id
                      .replace(/_/g, ' ')
                      .replace(/\b\w/g, l => l.toUpperCase());
                    const isToggling = togglingSubscription === sub.id;
                    const defaultLabel = sub.isDefault ? ' (default)' : '';
                    return (
                      <Badge
                        key={sub.id}
                        variant={sub.isDefault ? 'outline' : 'soft'}
                        color={sub.subscribed ? 'green' : 'gray'}
                        className={`gap-1.5 cursor-pointer hover:opacity-70 transition-opacity${isToggling || unsubscribingAll ? ' pointer-events-none opacity-50' : ''}`}
                        onClick={() => handleToggleSubscription(sub)}
                        title={sub.subscribed
                          ? `${sub.list_id} - Click to unsubscribe${sub.isDefault ? ' (using default status)' : sub.subscribed_at ? ` (subscribed on ${formatTimestamp(sub.subscribed_at)})` : ''}`
                          : `${sub.list_id} - Click to subscribe${sub.isDefault ? ' (using default status)' : sub.unsubscribed_at ? ` (unsubscribed on ${formatTimestamp(sub.unsubscribed_at)})` : ''}`
                        }
                      >
                        {isToggling ? (
                          <Spinner className="w-3.5 h-3.5" />
                        ) : sub.subscribed ? (
                          <CheckCircleIcon className="w-3.5 h-3.5" />
                        ) : (
                          <XCircleIcon className="w-3.5 h-3.5" />
                        )}
                        {displayName}{defaultLabel}
                      </Badge>
                    );
                  })}
                </div>
              </Card>
            )}

            {/* Person Info and Location Map Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Person Information */}
              <Card variant="surface" className="p-6">
                <h2 className="text-lg font-semibold mb-4">Person Information</h2>
                <div className="space-y-4">
                  {isEditMode ? (
                    <>
                      <Input
                        label="Email"
                        value={editFormData.email}
                        onChange={(e) => setEditFormData({ ...editFormData, email: e.target.value })}
                      />
                      <div className="grid grid-cols-2 gap-4">
                        <Input
                          label="First Name"
                          value={editFormData.first_name}
                          onChange={(e) => setEditFormData({ ...editFormData, first_name: e.target.value })}
                        />
                        <Input
                          label="Last Name"
                          value={editFormData.last_name}
                          onChange={(e) => setEditFormData({ ...editFormData, last_name: e.target.value })}
                        />
                      </div>
                      <Input
                        label="Job Title"
                        value={editFormData.job_title}
                        onChange={(e) => setEditFormData({ ...editFormData, job_title: e.target.value })}
                      />
                      <Input
                        label="Company"
                        value={editFormData.company}
                        onChange={(e) => setEditFormData({ ...editFormData, company: e.target.value })}
                      />
                      <Input
                        label="LinkedIn URL"
                        value={editFormData.linkedin_url}
                        onChange={(e) => setEditFormData({ ...editFormData, linkedin_url: e.target.value })}
                      />
                    </>
                  ) : (
                    <>
                      <AttributeField label="Email" value={person.email} attributeName="email" />
                      {hasCIO && person.cio_id && (
                        <div>
                          <label className="block text-sm font-medium text-[var(--gray-11)]">
                            Customer.io ID
                          </label>
                          <p className="mt-1 text-sm text-[var(--gray-12)]">
                            {person.cio_id}
                          </p>
                        </div>
                      )}
                      <AttributeField label="First Name" value={person.attributes?.first_name} attributeName="first_name" />
                      <AttributeField label="Last Name" value={person.attributes?.last_name} attributeName="last_name" />
                      <AttributeField label="Job Title" value={person.attributes?.job_title} attributeName="job_title" />
                      <AttributeField label="Company" value={person.attributes?.company} attributeName="company" />
                      {person.attributes?.linkedin_url && (
                        <div>
                          <label className="block text-sm font-medium text-[var(--gray-11)]">
                            LinkedIn
                            {(() => {
                              const ts = getAttributeTimestamp('linkedin_url');
                              return ts && ts > 0 ? (
                                <span className="ml-2 text-[10px] font-normal text-[var(--gray-a8)]" title={formatUnixTimestamp(ts)}>
                                  {formatTimeAgo(new Date(ts * 1000).toISOString())}
                                </span>
                              ) : null;
                            })()}
                          </label>
                          <a
                            href={person.attributes.linkedin_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1 text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 flex items-center gap-2"
                          >
                            {person.attributes.linkedin_url}
                          </a>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </Card>

              {/* Location Card */}
              <Card variant="surface" className="p-6">
                <h2 className="text-lg font-semibold mb-4">Location</h2>
                {isEditMode ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <Input
                        label="City"
                        value={editFormData.city}
                        onChange={(e) => setEditFormData({ ...editFormData, city: e.target.value })}
                      />
                      <Input
                        label="Country"
                        value={editFormData.country}
                        onChange={(e) => setEditFormData({ ...editFormData, country: e.target.value })}
                      />
                    </div>
                  </div>
                ) : (
                  (() => {
                    const location = person.attributes?.location;
                    const city = person.attributes?.city;
                    const country = person.attributes?.country;

                    if (location) {
                      const [lat, lng] = location.split(',').map((coord: string) => parseFloat(coord.trim()));
                      if (!isNaN(lat) && !isNaN(lng)) {
                        const mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.5},${lat - 0.5},${lng + 0.5},${lat + 0.5}&layer=mapnik&marker=${lat},${lng}`;
                        return (
                          <div className="space-y-3">
                            {(city || country) && (
                              <div className="text-sm text-[var(--gray-11)]">
                                {city && <span className="font-medium">{city}</span>}
                                {city && country && <span>, </span>}
                                {country && <span>{country}</span>}
                              </div>
                            )}
                            <div className="w-full h-64 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
                              <iframe
                                width="100%"
                                height="100%"
                                frameBorder="0"
                                scrolling="no"
                                marginHeight={0}
                                marginWidth={0}
                                src={mapUrl}
                                style={{ border: 0 }}
                              ></iframe>
                            </div>
                            <div className="text-xs text-[var(--gray-11)]">
                              Coordinates: {lat.toFixed(4)}, {lng.toFixed(4)}
                            </div>
                          </div>
                        );
                      }
                    }

                    // Fallback if no location data
                    return (
                      <div className="flex flex-col items-center justify-center h-64 text-[var(--gray-11)]">
                        <svg className="size-12 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                        </svg>
                        <p className="text-sm">No location data available</p>
                        {(city || country) && (
                          <p className="text-sm mt-2">
                            {city && <span>{city}</span>}
                            {city && country && <span>, </span>}
                            {country && <span>{country}</span>}
                          </p>
                        )}
                      </div>
                    );
                  })()
                )}
              </Card>
            </div>
          </div>
        )}

        {/* Attributes Tab */}
        {activeTab === 'attributes' && (
          <Card variant="surface" className="p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Square3Stack3DIcon className="size-5" />
              Attributes
            </h2>
            {person.attributes && Object.keys(person.attributes).length > 0 ? (
              (() => {
                const allAttributes = Object.entries(person.attributes)
                  .filter(([, value]) => {
                    // Exclude if value is empty, null, undefined, or '-'
                    if (!value || value === '-') return false;
                    return true;
                  })
                  .sort(([a], [b]) => a.localeCompare(b));

                return allAttributes.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {allAttributes.map(([key, value]) => {
                      const timestamp = getAttributeTimestamp(key);
                      // Use Boolean() to ensure we get true/false, not 0 (which React would render as "0")
                      const hasValidTimestamp = Boolean(timestamp && timestamp > 0);
                      return (
                        <div key={key} className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                          <label className="block text-sm font-medium text-[var(--gray-11)]">
                            {key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                            {hasValidTimestamp && (
                              <span className="ml-2 text-[10px] font-normal text-[var(--gray-a8)]" title={formatUnixTimestamp(timestamp!)}>
                                {formatTimeAgo(new Date(timestamp! * 1000).toISOString())}
                              </span>
                            )}
                          </label>
                          <p className="mt-1 text-sm text-[var(--gray-12)] break-words">
                            {typeof value === 'object' && value !== null
                              ? JSON.stringify(value, null, 2)
                              : String(value)}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-[var(--gray-11)]">
                    No attributes found.
                  </p>
                );
              })()
            ) : (
              <p className="text-sm text-[var(--gray-11)]">
                No attributes found for this person.
              </p>
            )}
          </Card>
        )}

        {/* Competitions Tab */}
        {activeTab === 'competitions' && (
          <Card variant="surface" className="p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <TrophyIcon className="size-5" />
              Competitions ({competitions.length})
            </h2>
            {competitions.length === 0 ? (
              <p className="text-sm text-[var(--gray-11)]">
                No competition activity found for this person.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <THead>
                    <Tr>
                      <Th>Competition</Th>
                      <Th className="text-center">Viewed</Th>
                      <Th className="text-center">Accepted</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {competitions.map((comp, idx) => {
                      const viewedStatus = comp.statuses['viewed'];
                      const acceptedStatus = comp.statuses['accepted'];

                      return (
                        <Tr key={`${comp.offerId}-${idx}`}>
                          <Td>
                            <div className="flex flex-col">
                              <span className="font-medium text-[var(--gray-12)]">
                                {comp.event?.eventTitle || comp.offerId}
                              </span>
                              {comp.event && (
                                <span className="text-sm text-[var(--gray-11)]">
                                  {comp.event.eventCity}, {comp.event.eventCountryCode}
                                  {comp.event.eventStart && (
                                    <> • {new Date(comp.event.eventStart).toLocaleDateString('en-US', {
                                      month: 'short',
                                      day: 'numeric',
                                      year: 'numeric'
                                    })}</>
                                  )}
                                </span>
                              )}
                            </div>
                          </Td>
                          <Td className="text-center">
                            {viewedStatus ? (
                              <Badge variant="soft" color="green" title={formatTimestamp(viewedStatus.timestamp)}>
                                <CheckCircleIcon className="size-4" />
                              </Badge>
                            ) : (
                              <span className="text-gray-300 dark:text-gray-600">—</span>
                            )}
                          </Td>
                          <Td className="text-center">
                            {acceptedStatus ? (
                              <Badge variant="soft" color="green" title={formatTimestamp(acceptedStatus.timestamp)}>
                                <CheckCircleIcon className="size-4" />
                              </Badge>
                            ) : (
                              <span className="text-gray-300 dark:text-gray-600">—</span>
                            )}
                          </Td>
                        </Tr>
                      );
                    })}
                  </TBody>
                </Table>
              </div>
            )}
          </Card>
        )}

        {/* Offers Tab */}
        {activeTab === 'offers' && (
          <Card variant="surface" className="p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <CalendarIcon className="size-5" />
              Offers ({offers.length})
            </h2>
            {offers.length === 0 ? (
              <p className="text-sm text-[var(--gray-11)]">
                No offer activity found for this person.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <THead>
                    <Tr>
                      <Th>Offer</Th>
                      <Th className="text-center">Viewed</Th>
                      <Th className="text-center">Accepted</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {offers.map((offer, idx) => {
                      const viewedStatus = offer.statuses['viewed'];
                      const acceptedStatus = offer.statuses['accepted'];

                      return (
                        <Tr key={`${offer.offerId}-${idx}`}>
                          <Td>
                            <div className="flex flex-col">
                              <span className="font-medium text-[var(--gray-12)]">
                                {offer.event?.eventTitle || offer.offerId}
                              </span>
                              {offer.event && (
                                <span className="text-sm text-[var(--gray-11)]">
                                  {offer.event.eventCity}, {offer.event.eventCountryCode}
                                  {offer.event.eventStart && (
                                    <> • {new Date(offer.event.eventStart).toLocaleDateString('en-US', {
                                      month: 'short',
                                      day: 'numeric',
                                      year: 'numeric'
                                    })}</>
                                  )}
                                </span>
                              )}
                            </div>
                          </Td>
                          <Td className="text-center">
                            {viewedStatus ? (
                              <Badge variant="soft" color="green" title={formatTimestamp(viewedStatus.timestamp)}>
                                <CheckCircleIcon className="size-4" />
                              </Badge>
                            ) : (
                              <span className="text-gray-300 dark:text-gray-600">—</span>
                            )}
                          </Td>
                          <Td className="text-center">
                            {acceptedStatus ? (
                              <Badge variant="soft" color="green" title={formatTimestamp(acceptedStatus.timestamp)}>
                                <CheckCircleIcon className="size-4" />
                              </Badge>
                            ) : (
                              <span className="text-gray-300 dark:text-gray-600">—</span>
                            )}
                          </Td>
                        </Tr>
                      );
                    })}
                  </TBody>
                </Table>
              </div>
            )}
          </Card>
        )}

        {/* Segments Tab (Customer.io module) */}
        {hasCIO && activeTab === 'segments' && (
          <Card variant="surface" className="p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <TagIcon className="size-5" />
              Segments ({segments.length})
            </h2>
            {segments.length === 0 ? (
              <p className="text-sm text-[var(--gray-11)]">
                No segments found for this person.
              </p>
            ) : (
              <div className="space-y-3">
                {segments.map((segment) => (
                  <div
                    key={segment.id}
                    className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-medium text-[var(--gray-12)]">
                          {segment.name}
                        </h3>
                        {segment.description && (
                          <p className="mt-1 text-sm text-[var(--gray-11)]">
                            {segment.description}
                          </p>
                        )}
                        {segment.type && (
                          <Badge variant="soft" color="blue" className="mt-2">
                            {segment.type}
                          </Badge>
                        )}
                      </div>
                      {segment.joined_at && (
                        <div className="text-sm text-[var(--gray-11)]">
                          Joined {formatTimeAgo(segment.joined_at)}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* Activities Tab (Customer.io module) */}
        {hasCIO && activeTab === 'activities' && (
          <Card variant="surface" className="p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <ClockIcon className="size-5" />
              Activities ({activities.length})
            </h2>
            {activities.length === 0 ? (
              <p className="text-sm text-[var(--gray-11)]">
                No activities found for this person.
              </p>
            ) : (
              <>
                {/* Activity Type Tabs */}
                {(() => {
                  // Get unique activity types
                  const activityTypes = Array.from(
                    new Set(activities.map(a => a.activity_type))
                  ).sort();

                  const filteredActivities = activeActivityTab === 'all'
                    ? activities
                    : activities.filter(a => a.activity_type === activeActivityTab);

                  return (
                    <>
                      <div className="flex gap-2 mb-4 flex-wrap border-b border-gray-200 dark:border-gray-700">
                        <Button
                          variant={activeActivityTab === 'all' ? 'soft' : 'ghost'}
                          size="1"
                          onClick={() => setActiveActivityTab('all')}
                        >
                          All ({activities.length})
                        </Button>
                        {activityTypes.map(type => {
                          const count = activities.filter(a => a.activity_type === type).length;
                          return (
                            <Button
                              key={type}
                              variant={activeActivityTab === type ? 'soft' : 'ghost'}
                              size="1"
                              onClick={() => setActiveActivityTab(type)}
                            >
                              {type.replace(/_/g, ' ')} ({count})
                            </Button>
                          );
                        })}
                      </div>

                      {/* Activity List */}
                      <div className="space-y-3 max-h-96 overflow-y-auto">
                        {filteredActivities.map((activity) => (
                          <div
                            key={activity.id}
                            className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700"
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-[var(--gray-12)]">
                                    {activity.activity_name || activity.activity_type}
                                  </span>
                                  <Badge variant="soft" color="gray" className="capitalize">
                                    {activity.activity_type.replace(/_/g, ' ')}
                                  </Badge>
                                </div>
                                {activity.activity_data &&
                                  Object.keys(activity.activity_data).length > 0 && (
                                    <pre className="mt-2 text-xs text-[var(--gray-11)] overflow-x-auto">
                                      {JSON.stringify(activity.activity_data, null, 2)}
                                    </pre>
                                  )}
                              </div>
                              <div className="text-sm text-[var(--gray-11)] whitespace-nowrap ml-4">
                                {formatTimeAgo(activity.timestamp)}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  );
                })()}
              </>
            )}
          </Card>
        )}

        {/* Events Tab */}
        {activeTab === 'events' && (
          <ModuleSlot name="person-detail:events" props={{ person, personId: id }} />
        )}

        {/* Relationships Tab (Customer.io module) */}
        {hasCIO && activeTab === 'relationships' && (
          <Card variant="surface" className="p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <LinkIcon className="size-5" />
              Relationships ({relationships.length})
            </h2>
            {relationships.length === 0 ? (
              <p className="text-sm text-[var(--gray-11)]">
                No relationships found for this person.
              </p>
            ) : (
              <div className="space-y-3">
                {relationships.map((relationship) => (
                  <div
                    key={relationship.id}
                    className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-[var(--gray-12)]">
                            {relationship.object_type_id}
                          </span>
                          <span className="text-sm text-[var(--gray-11)]">
                            #{relationship.object_id}
                          </span>
                        </div>
                        {relationship.relationship_attributes &&
                          Object.keys(relationship.relationship_attributes).length > 0 && (
                            <pre className="mt-2 text-xs text-[var(--gray-11)] overflow-x-auto">
                              {JSON.stringify(
                                relationship.relationship_attributes,
                                null,
                                2
                              )}
                            </pre>
                          )}
                      </div>
                      <div className="text-sm text-[var(--gray-11)] whitespace-nowrap ml-4">
                        {formatTimeAgo(relationship.created_at)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* Competition Wins Tab */}
        {activeTab === 'wins' && (
          <Card variant="surface" className="p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <TrophyIcon className="size-5" />
              Competition Wins ({competitionWins.length})
            </h2>
            {competitionWins.length === 0 ? (
              <p className="text-sm text-[var(--gray-11)]">
                No competition wins found for this person.
              </p>
            ) : (
              <div className="space-y-3">
                {competitionWins.map((win, idx) => (
                  <div
                    key={`${win.winner.id || win.winner.email}-${idx}`}
                    className="p-4 bg-gradient-to-r from-yellow-50 to-orange-50 dark:from-yellow-900/20 dark:to-orange-900/20 rounded-lg border border-yellow-200 dark:border-yellow-700"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <TrophyIcon className="size-5 text-yellow-600 dark:text-yellow-400" />
                          <h3 className="font-medium text-[var(--gray-12)]">
                            {win.competition?.eventTitle || 'Unknown Competition'}
                          </h3>
                        </div>
                        {win.competition && (
                          <div className="mt-2 text-sm text-[var(--gray-11)]">
                            <div className="flex items-center gap-2">
                              <CalendarIcon className="size-4" />
                              {win.competition.eventCity}, {win.competition.eventCountryCode}
                              {win.competition.eventStart && (
                                <span className="ml-1">
                                  • {new Date(win.competition.eventStart).toLocaleDateString('en-US', {
                                    month: 'short',
                                    day: 'numeric',
                                    year: 'numeric'
                                  })}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          {win.winner.notified_at && (
                            <div className="flex items-center gap-1 text-xs">
                              <CheckCircleIcon className="size-4 text-green-600 dark:text-green-400" />
                              <span className="text-[var(--gray-11)]">
                                Notified {formatTimeAgo(win.winner.notified_at)}
                              </span>
                            </div>
                          )}
                          {win.winner.accepted_at && (
                            <div className="flex items-center gap-1 text-xs">
                              <CheckCircleIcon className="size-4 text-green-600 dark:text-green-400" />
                              <span className="text-[var(--gray-11)]">
                                Accepted {formatTimeAgo(win.winner.accepted_at)}
                              </span>
                            </div>
                          )}
                          {win.winner.declined_at && (
                            <div className="flex items-center gap-1 text-xs">
                              <XCircleIcon className="size-4 text-red-600 dark:text-red-400" />
                              <span className="text-[var(--gray-11)]">
                                Declined {formatTimeAgo(win.winner.declined_at)}
                              </span>
                            </div>
                          )}
                          {win.winner.not_replied_at && (
                            <div className="flex items-center gap-1 text-xs">
                              <MinusCircleIcon className="size-4 text-yellow-600 dark:text-yellow-400" />
                              <span className="text-[var(--gray-11)]">
                                No reply {formatTimeAgo(win.winner.not_replied_at)}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                      {win.winner.created_at && (
                        <div className="text-xs text-[var(--gray-11)]">
                          Won {formatTimeAgo(win.winner.created_at)}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* Emails Tab */}
        {activeTab === 'emails' && person && (
          <Card variant="surface" className="p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <EnvelopeIcon className="size-5" />
              Email History
            </h2>
            <EmailHistorySection
              customerEmail={person.email || ''}
              customerId={person.id ? Number(person.id) : undefined}
            />
          </Card>
        )}
      </div>
    </Page>
  );
}
