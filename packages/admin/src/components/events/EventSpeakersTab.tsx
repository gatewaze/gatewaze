// @ts-nocheck
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  MagnifyingGlassIcon,
  StarIcon,
  UserIcon,
  UserPlusIcon,
  PhotoIcon,
  ExclamationTriangleIcon,
  CheckIcon,
  XMarkIcon,
  ClockIcon,
  BuildingOfficeIcon,
  LinkIcon,
  ChartBarIcon,
  ClipboardDocumentListIcon as ClipboardDocumentListIconOutline,
  ChevronUpIcon,
  ChevronDownIcon,
  CalendarDaysIcon,
  DocumentTextIcon,
  EnvelopeIcon,
} from '@heroicons/react/24/outline';
import { StarIcon as StarIconSolid, CheckCircleIcon, XCircleIcon, ClipboardDocumentListIcon, UserGroupIcon } from '@heroicons/react/24/solid';
import { Button, Card, Input, Modal, ConfirmModal } from '@/components/ui-legacy';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { SpeakerService, EventSpeakerWithDetails, SpeakerStatus } from '@/utils/speakerService';
import { trimTransparentPadding } from '@/utils/trimTransparentPadding';
import { TalkService, EventTalkWithSpeakers, TalkStatus } from '@/utils/talkService';
import { SpeakerEmailService } from '@/utils/speakerEmailService';
import { BulkRegistrationService } from '@/utils/bulkRegistrationService';
import { CustomerAvatarService } from '@/utils/customerAvatarService';
import { EventQrService, EventSponsor } from '@/utils/eventQrService';
import { SpeakerLinkService, SpeakerTrackingLink } from '@/utils/speakerLinkService';
import { supabase, supabaseUrl } from '@/lib/supabase';
import { SendSpeakerEmailModal } from '@/components/emails/SendSpeakerEmailModal';

interface TalkDurationOption {
  duration: number;  // minutes
  capacity: number;  // max number of talks
}

interface EventSpeakersTabProps {
  eventUuid: string;
  eventId: string; // The short event ID (e.g., 'kgbw63') used by event_sponsors
  eventLink: string; // The event registration URL
  eventTitle: string; // The event title
  talkDurationOptions?: TalkDurationOption[] | null;
}

interface Customer {
  id: number;
  email: string;
  cio_id: string;
  attributes: {
    first_name?: string;
    last_name?: string;
    company?: string;
    job_title?: string;
    avatar_url?: string;
  };
}

interface SpeakerFormData {
  speaker_title: string;
  speaker_bio: string;
  speaker_topic: string;
  talk_title: string;
  talk_synopsis: string;
  talk_duration_minutes: number | '';
  is_featured: boolean;
  event_sponsor_id: string;
}

interface NewSpeakerFormData {
  email: string;
  first_name: string;
  last_name: string;
  job_title: string;
  company: string;
  linkedin_url: string;
  speaker_title: string;
  speaker_bio: string;
  speaker_topic: string;
  talk_title: string;
  talk_synopsis: string;
  talk_duration_minutes: number | '';
  is_featured: boolean;
  event_sponsor_id: string;
}

type AddMode = 'search' | 'new';
type ViewMode = 'confirmed' | 'approved' | 'pending' | 'reserve' | 'rejected' | 'placeholder';
type GroupMode = 'talks' | 'speakers' | 'progress';

interface SpeakerDetailsFormData {
  first_name: string;
  last_name: string;
  job_title: string;
  company: string;
  linkedin_url: string;
}

interface SpeakerWithTalks {
  speakerId: string;
  memberProfileId: string;
  speakerName: string;
  speakerTitle?: string;
  jobTitle?: string;
  company?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  linkedinUrl?: string;
  companyLogoStoragePath?: string;
  avatarUrl?: string;
  isFeatured: boolean;
  sortOrder: number;
  talks: EventTalkWithSpeakers[];
}

export function EventSpeakersTab({ eventUuid, eventId, eventLink, eventTitle, talkDurationOptions }: EventSpeakersTabProps) {
  const navigate = useNavigate();
  // Talk-centric state: each talk submission is managed independently
  const [approvedTalks, setApprovedTalks] = useState<EventTalkWithSpeakers[]>([]);
  const [confirmedTalks, setConfirmedTalks] = useState<EventTalkWithSpeakers[]>([]);
  const [pendingTalks, setPendingTalks] = useState<EventTalkWithSpeakers[]>([]);
  const [reserveTalks, setReserveTalks] = useState<EventTalkWithSpeakers[]>([]);
  const [rejectedTalks, setRejectedTalks] = useState<EventTalkWithSpeakers[]>([]);
  const [placeholderTalks, setPlaceholderTalks] = useState<EventTalkWithSpeakers[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingTalk, setEditingTalk] = useState<EventTalkWithSpeakers | null>(null);
  const [deletingTalk, setDeletingTalk] = useState<EventTalkWithSpeakers | null>(null);
  const [viewingTalk, setViewingTalk] = useState<EventTalkWithSpeakers | null>(null);
  const [emailingTalk, setEmailingTalk] = useState<EventTalkWithSpeakers | null>(null);

  // Speaker details editing
  const [showEditSpeakerModal, setShowEditSpeakerModal] = useState(false);
  const [editingSpeaker, setEditingSpeaker] = useState<SpeakerWithTalks | null>(null);
  const [speakerDetailsForm, setSpeakerDetailsForm] = useState<SpeakerDetailsFormData>({
    first_name: '',
    last_name: '',
    job_title: '',
    company: '',
    linkedin_url: '',
  });
  const [companyLogoFile, setCompanyLogoFile] = useState<File | null>(null);
  const [companyLogoPreview, setCompanyLogoPreview] = useState<string | null>(null);
  const [savingSpeakerDetails, setSavingSpeakerDetails] = useState(false);
  const companyLogoInputRef = useRef<HTMLInputElement>(null);

  // View mode for tabs (confirmed, approved, pending, reserve, rejected)
  const [viewMode, setViewMode] = useState<ViewMode>('confirmed');
  // Group mode for displaying talks vs speakers
  const [groupMode, setGroupMode] = useState<GroupMode>('talks');

  // Add mode toggle
  const [addMode, setAddMode] = useState<AddMode>('search');

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [adding, setAdding] = useState(false);

  // Avatar upload state
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Event sponsors for speaker association
  const [eventSponsors, setEventSponsors] = useState<EventSponsor[]>([]);

  // Speaker tracking links state
  const [speakerLinks, setSpeakerLinks] = useState<Record<string, SpeakerTrackingLink>>({});
  const [copyingLinkFor, setCopyingLinkFor] = useState<string | null>(null);

  // Form state for existing customer
  const [speakerForm, setSpeakerForm] = useState<SpeakerFormData>({
    speaker_title: '',
    speaker_bio: '',
    speaker_topic: '',
    talk_title: '',
    talk_synopsis: '',
    talk_duration_minutes: '',
    is_featured: false,
    event_sponsor_id: '',
  });

  // Form state for new speaker
  const [newSpeakerForm, setNewSpeakerForm] = useState<NewSpeakerFormData>({
    email: '',
    first_name: '',
    last_name: '',
    job_title: '',
    company: '',
    linkedin_url: '',
    speaker_title: '',
    speaker_bio: '',
    speaker_topic: '',
    talk_title: '',
    talk_synopsis: '',
    talk_duration_minutes: '',
    is_featured: false,
    event_sponsor_id: '',
  });

  useEffect(() => {
    loadTalks();
    loadEventSponsors();
  }, [eventUuid]);

  const loadTalks = async () => {
    try {
      setLoading(true);
      // Load all talks by status - each talk submission is managed independently
      const [confirmed, approved, pending, reserve, rejected, placeholder] = await Promise.all([
        TalkService.getTalksByEvent(eventUuid, 'confirmed'),
        TalkService.getTalksByEvent(eventUuid, 'approved'),
        TalkService.getTalksByEvent(eventUuid, 'pending'),
        TalkService.getTalksByEvent(eventUuid, 'reserve'),
        TalkService.getTalksByEvent(eventUuid, 'rejected'),
        TalkService.getTalksByEvent(eventUuid, 'placeholder'),
      ]);
      setConfirmedTalks(confirmed);
      setApprovedTalks(approved);
      setPendingTalks(pending);
      setReserveTalks(reserve);
      setRejectedTalks(rejected);
      setPlaceholderTalks(placeholder);
    } catch (error) {
      console.error('Error loading talks:', error);
      toast.error('Failed to load talk submissions');
    } finally {
      setLoading(false);
    }
  };

  // Helper to get primary speaker from a talk (the one with is_primary=true or first speaker)
  const getPrimarySpeaker = (talk: EventTalkWithSpeakers) => {
    if (!talk.speakers || talk.speakers.length === 0) return null;
    return talk.speakers.find(s => s.is_primary) || talk.speakers[0];
  };

  // Helper to get speaker display name from a talk
  const getSpeakerDisplayName = (talk: EventTalkWithSpeakers) => {
    const speaker = getPrimarySpeaker(talk);
    if (!speaker) return 'Unknown Speaker';
    return speaker.full_name || speaker.email || 'Unknown Speaker';
  };

  // Helper to group talks by speaker
  const groupTalksBySpeaker = (talks: EventTalkWithSpeakers[]): SpeakerWithTalks[] => {
    const speakerMap = new Map<string, SpeakerWithTalks>();

    talks.forEach(talk => {
      // Get all speakers from this talk
      const talkSpeakers = talk.speakers || [];
      talkSpeakers.forEach(speaker => {
        const existing = speakerMap.get(speaker.speaker_id);
        if (existing) {
          existing.talks.push(talk);
        } else {
          speakerMap.set(speaker.speaker_id, {
            speakerId: speaker.speaker_id,
            memberProfileId: speaker.member_profile_id,
            speakerName: speaker.full_name || speaker.email || 'Unknown Speaker',
            speakerTitle: speaker.speaker_title,
            jobTitle: speaker.job_title,
            company: speaker.company,
            email: speaker.email,
            firstName: speaker.first_name,
            lastName: speaker.last_name,
            linkedinUrl: speaker.linkedin_url,
            avatarUrl: speaker.avatar_url,
            companyLogoStoragePath: speaker.company_logo_storage_path,
            isFeatured: speaker.is_featured || false,
            sortOrder: speaker.sort_order ?? 999,
            talks: [talk],
          });
        }
      });
    });

    // Sort by sort_order first, then by speaker name
    return Array.from(speakerMap.values()).sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) {
        return a.sortOrder - b.sortOrder;
      }
      return a.speakerName.localeCompare(b.speakerName);
    });
  };

  const loadEventSponsors = async () => {
    try {
      const sponsors = await EventQrService.getEventSponsors(eventId);
      setEventSponsors(sponsors.filter(s => s.is_active));
    } catch (error) {
      console.error('Error loading event sponsors:', error);
    }
  };

  // Load speaker tracking links when confirmed/approved talks change
  useEffect(() => {
    if (confirmedTalks.length > 0 || approvedTalks.length > 0) {
      loadSpeakerLinks();
    }
  }, [confirmedTalks, approvedTalks]);

  const loadSpeakerLinks = async () => {
    try {
      // Include both confirmed and approved talks for tracking links
      const allActiveTalks = [...confirmedTalks, ...approvedTalks];
      // Get unique speaker IDs from all talks
      const speakerIds = allActiveTalks.flatMap(t => t.speakers?.map(s => s.speaker_id) || []);
      const uniqueSpeakerIds = [...new Set(speakerIds)];
      const links = await SpeakerLinkService.getSpeakerLinksForEvent(eventId, uniqueSpeakerIds);
      setSpeakerLinks(links);
    } catch (error) {
      console.error('Error loading speaker links:', error);
    }
  };

  const handleCopyTrackingLink = async (speakerId: string, speakerName?: string) => {
    if (!eventLink) {
      toast.error('Event link is required to generate tracking links');
      return;
    }

    setCopyingLinkFor(speakerId);

    try {
      const name = speakerName || 'speaker';
      const link = await SpeakerLinkService.getOrCreateSpeakerLink(
        speakerId,
        eventId,
        eventLink,
        name
      );

      await navigator.clipboard.writeText(link.shortUrl);
      toast.success('Tracking link copied to clipboard!');

      // Update local state with the new link
      setSpeakerLinks(prev => ({
        ...prev,
        [speakerId]: link
      }));
    } catch (error) {
      console.error('Error copying tracking link:', error);
      toast.error('Failed to generate tracking link');
    } finally {
      setCopyingLinkFor(null);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      toast.error('Please enter an email address to search');
      return;
    }

    setSearching(true);
    setCustomers([]);
    setSelectedCustomer(null);
    clearAvatarUpload();

    try {
      const { data, error } = await supabase
        .from('customers')
        .select('id, email, cio_id, attributes')
        .ilike('email', `%${searchQuery.trim()}%`)
        .limit(10);

      if (error) {
        console.error('Error searching customers:', error);
        toast.error('Failed to search for users');
        return;
      }

      if (!data || data.length === 0) {
        toast.info('No users found with that email. You can create a new speaker instead.');
      } else {
        setCustomers(data);
      }
    } catch (error) {
      console.error('Error searching customers:', error);
      toast.error('Failed to search for users');
    } finally {
      setSearching(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be less than 5MB');
      return;
    }

    setAvatarFile(file);

    // Create preview
    const reader = new FileReader();
    reader.onloadend = () => {
      setAvatarPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const clearAvatarUpload = () => {
    setAvatarFile(null);
    setAvatarPreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const uploadAvatarForCustomer = async (customerId: number): Promise<boolean> => {
    if (!avatarFile) return true; // No file to upload

    setUploadingAvatar(true);
    try {
      const result = await CustomerAvatarService.uploadAvatar(customerId, avatarFile);
      if (!result.success) {
        toast.error(result.error || 'Failed to upload avatar');
        return false;
      }
      return true;
    } catch (error) {
      console.error('Error uploading avatar:', error);
      toast.error('Failed to upload avatar');
      return false;
    } finally {
      setUploadingAvatar(false);
    }
  };

  const customerHasAvatar = (customer: Customer | null): boolean => {
    return Boolean(customer?.attributes?.avatar_url);
  };

  const handleAddExistingSpeaker = async (asPending = false) => {
    if (!selectedCustomer) {
      toast.error('Please select a user');
      return;
    }

    // Validate required talk fields
    if (!speakerForm.talk_title.trim()) {
      toast.error('Talk title is required');
      return;
    }

    if (!speakerForm.talk_synopsis.trim()) {
      toast.error('Talk synopsis is required');
      return;
    }

    // Check if avatar is required
    if (!customerHasAvatar(selectedCustomer) && !avatarFile) {
      toast.error('Speaker photo is required. Please upload an image.');
      return;
    }

    setAdding(true);

    try {
      // Upload avatar if provided
      if (avatarFile) {
        const uploaded = await uploadAvatarForCustomer(selectedCustomer.id);
        if (!uploaded) {
          setAdding(false);
          return;
        }
      }

      // Get or create member profile
      const memberProfile = await BulkRegistrationService.getOrCreateMemberProfile(selectedCustomer.id);

      if (!memberProfile) {
        toast.error('Failed to create member profile');
        return;
      }

      // Check if already has a talk submission (in any status)
      const allTalks = [...confirmedTalks, ...approvedTalks, ...pendingTalks, ...reserveTalks, ...rejectedTalks];
      const existingTalk = allTalks.find(t =>
        t.speakers?.some(s => s.member_profile_id === memberProfile.id)
      );
      if (existingTalk) {
        toast.error('This person already has a talk submission for this event');
        return;
      }

      // Create speaker
      // Admin-added speakers default to 'confirmed' status (unless added as pending)
      const newSpeaker = await SpeakerService.createSpeaker({
        event_uuid: eventUuid,
        member_profile_id: memberProfile.id,
        speaker_title: speakerForm.speaker_title || undefined,
        speaker_bio: speakerForm.speaker_bio || undefined,
        speaker_topic: speakerForm.speaker_topic || undefined,
        talk_title: speakerForm.talk_title,
        talk_synopsis: speakerForm.talk_synopsis,
        talk_duration_minutes: speakerForm.talk_duration_minutes || undefined,
        is_featured: speakerForm.is_featured,
        sort_order: confirmedTalks.length + approvedTalks.length,
        status: asPending ? 'pending' : 'confirmed',
        submitted_at: asPending ? new Date().toISOString() : undefined,
        event_sponsor_id: speakerForm.event_sponsor_id || undefined,
      });

      toast.success(asPending ? 'Speaker application submitted' : 'Speaker added successfully');
      handleCloseAddModal();
      loadTalks();

      // Note: No automated email is sent when admins add speakers through the UI.
      // Automated emails are only sent for public call-for-speakers submissions.
    } catch (error: any) {
      console.error('Error adding speaker:', error);
      if (error.code === '23505') {
        toast.error('This person is already a speaker for this event');
      } else {
        toast.error('Failed to add speaker');
      }
    } finally {
      setAdding(false);
    }
  };

  const handleAddNewSpeaker = async (asPending = false) => {
    // Validate required fields
    if (!newSpeakerForm.email.trim()) {
      toast.error('Email is required');
      return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newSpeakerForm.email)) {
      toast.error('Please enter a valid email address');
      return;
    }

    if (!newSpeakerForm.first_name.trim()) {
      toast.error('First name is required');
      return;
    }

    if (!newSpeakerForm.last_name.trim()) {
      toast.error('Last name is required');
      return;
    }

    // Validate required talk fields
    if (!newSpeakerForm.talk_title.trim()) {
      toast.error('Talk title is required');
      return;
    }

    if (!newSpeakerForm.talk_synopsis.trim()) {
      toast.error('Talk synopsis is required');
      return;
    }

    // Avatar is required for new speakers
    if (!avatarFile) {
      toast.error('Speaker photo is required. Please upload an image.');
      return;
    }

    setAdding(true);

    try {
      // Check if customer already exists
      let { data: customer } = await supabase
        .from('customers')
        .select('*')
        .eq('email', newSpeakerForm.email.trim().toLowerCase())
        .maybeSingle();

      if (!customer) {
        // Create customer via user-signup edge function
        customer = await BulkRegistrationService.createCustomerViaSignup(
          newSpeakerForm.email.trim().toLowerCase(),
          {
            first_name: newSpeakerForm.first_name,
            last_name: newSpeakerForm.last_name,
            company: newSpeakerForm.company,
            job_title: newSpeakerForm.job_title,
          }
        );
        if (!customer) {
          toast.error('Failed to create customer');
          return;
        }
      }

      // Update customer attributes
      const attributes = {
        first_name: newSpeakerForm.first_name,
        last_name: newSpeakerForm.last_name,
        company: newSpeakerForm.company,
        job_title: newSpeakerForm.job_title,
        linkedin_url: newSpeakerForm.linkedin_url || undefined,
      };

      await Promise.all([
        BulkRegistrationService.updateCustomerInCIO(customer.cio_id, attributes),
        BulkRegistrationService.updateCustomerAttributes(customer.id, attributes),
      ]);

      // Upload avatar
      const uploaded = await uploadAvatarForCustomer(customer.id);
      if (!uploaded) {
        setAdding(false);
        return;
      }

      // Get or create member profile
      const memberProfile = await BulkRegistrationService.getOrCreateMemberProfile(customer.id);

      if (!memberProfile) {
        toast.error('Failed to create member profile');
        return;
      }

      // Check if already has a talk submission (in any status)
      const allTalks = [...confirmedTalks, ...approvedTalks, ...pendingTalks, ...reserveTalks, ...rejectedTalks];
      const existingTalk = allTalks.find(t =>
        t.speakers?.some(s => s.member_profile_id === memberProfile.id)
      );
      if (existingTalk) {
        toast.error('This person already has a talk submission for this event');
        return;
      }

      // Create speaker
      // Admin-added speakers default to 'confirmed' status (unless added as pending)
      const createdSpeaker = await SpeakerService.createSpeaker({
        event_uuid: eventUuid,
        member_profile_id: memberProfile.id,
        speaker_title: newSpeakerForm.speaker_title || undefined,
        speaker_bio: newSpeakerForm.speaker_bio || undefined,
        speaker_topic: newSpeakerForm.speaker_topic || undefined,
        talk_title: newSpeakerForm.talk_title,
        talk_synopsis: newSpeakerForm.talk_synopsis,
        talk_duration_minutes: newSpeakerForm.talk_duration_minutes || undefined,
        is_featured: newSpeakerForm.is_featured,
        sort_order: confirmedTalks.length + approvedTalks.length,
        status: asPending ? 'pending' : 'confirmed',
        submitted_at: asPending ? new Date().toISOString() : undefined,
        event_sponsor_id: newSpeakerForm.event_sponsor_id || undefined,
      });

      toast.success(asPending ? 'Speaker application submitted' : 'Speaker added successfully');
      handleCloseAddModal();
      loadTalks();

      // Note: No automated email is sent when admins add speakers through the UI.
      // Automated emails are only sent for public call-for-speakers submissions.
    } catch (error: any) {
      console.error('Error adding new speaker:', error);
      if (error.code === '23505') {
        toast.error('This person is already a speaker for this event');
      } else {
        toast.error('Failed to add speaker');
      }
    } finally {
      setAdding(false);
    }
  };

  const handleEditTalk = (talk: EventTalkWithSpeakers) => {
    const speaker = getPrimarySpeaker(talk);
    setEditingTalk(talk);
    setSpeakerForm({
      speaker_title: speaker?.speaker_title || '',
      speaker_bio: speaker?.speaker_bio || '',
      speaker_topic: '', // Not available in TalkSpeaker, may need to be fetched
      talk_title: talk.title || '',
      talk_synopsis: talk.synopsis || '',
      talk_duration_minutes: talk.duration_minutes || '',
      is_featured: talk.is_featured,
      event_sponsor_id: talk.event_sponsor_id || '',
    });
    setShowEditModal(true);
  };

  const handleSaveEdit = async () => {
    if (!editingTalk) return;

    // Get the speaker ID from the primary speaker
    const speaker = getPrimarySpeaker(editingTalk);
    if (!speaker) {
      toast.error('No speaker found for this talk');
      return;
    }

    // Validate required talk fields
    if (!speakerForm.talk_title.trim()) {
      toast.error('Talk title is required');
      return;
    }

    if (!speakerForm.talk_synopsis.trim()) {
      toast.error('Talk synopsis is required');
      return;
    }

    try {
      await SpeakerService.updateSpeaker(speaker.speaker_id, {
        talk_id: editingTalk.id,
        speaker_title: speakerForm.speaker_title || undefined,
        speaker_bio: speakerForm.speaker_bio || undefined,
        speaker_topic: speakerForm.speaker_topic || undefined,
        talk_title: speakerForm.talk_title,
        talk_synopsis: speakerForm.talk_synopsis,
        talk_duration_minutes: speakerForm.talk_duration_minutes || null,
        is_featured: speakerForm.is_featured,
        event_sponsor_id: speakerForm.event_sponsor_id || null,
      });

      toast.success('Speaker updated successfully');
      setShowEditModal(false);
      setEditingTalk(null);
      loadTalks();
    } catch (error) {
      console.error('Error updating speaker:', error);
      toast.error('Failed to update speaker');
    }
  };

  const handleDeleteTalk = async () => {
    if (!deletingTalk) return;

    try {
      await TalkService.deleteTalk(deletingTalk.id);
      toast.success('Talk submission removed successfully');
      setDeletingTalk(null);
      loadTalks();
    } catch (error) {
      console.error('Error deleting talk:', error);
      toast.error('Failed to remove talk submission');
    }
  };

  const handleToggleFeatured = async (speakerId: string, currentlyFeatured: boolean) => {
    try {
      await SpeakerService.updateSpeaker(speakerId, {
        is_featured: !currentlyFeatured,
      });
      loadTalks();
      toast.success(currentlyFeatured ? 'Speaker removed from featured' : 'Speaker marked as featured');
    } catch (error) {
      console.error('Error toggling featured:', error);
      toast.error('Failed to update speaker');
    }
  };

  const handleMoveSpeaker = async (speakers: SpeakerWithTalks[], index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;

    // Bounds check
    if (targetIndex < 0 || targetIndex >= speakers.length) return;

    const currentSpeaker = speakers[index];
    const targetSpeaker = speakers[targetIndex];

    try {
      // Swap sort orders using array indices to ensure unique values
      // This works even when all speakers start with sort_order = 0
      await Promise.all([
        SpeakerService.updateSpeaker(currentSpeaker.speakerId, { sort_order: targetIndex }),
        SpeakerService.updateSpeaker(targetSpeaker.speakerId, { sort_order: index }),
      ]);
      loadTalks();
    } catch (error) {
      console.error('Error reordering speakers:', error);
      toast.error('Failed to reorder speakers');
    }
  };

  // Speaker details editing handlers
  const handleEditSpeakerDetails = (speaker: SpeakerWithTalks) => {
    setEditingSpeaker(speaker);
    setSpeakerDetailsForm({
      first_name: speaker.firstName || '',
      last_name: speaker.lastName || '',
      job_title: speaker.jobTitle || '',
      company: speaker.company || '',
      linkedin_url: speaker.linkedinUrl || '',
    });
    // Construct the company logo URL from storage path
    const logoPreviewUrl = speaker.companyLogoStoragePath
      ? `${supabaseUrl}/storage/v1/object/public/speaker-logos/${speaker.companyLogoStoragePath}`
      : null;
    setCompanyLogoPreview(logoPreviewUrl);
    setCompanyLogoFile(null);
    setShowEditSpeakerModal(true);
  };

  const handleCompanyLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setCompanyLogoFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setCompanyLogoPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRemoveCompanyLogo = () => {
    setCompanyLogoFile(null);
    setCompanyLogoPreview(null);
    if (companyLogoInputRef.current) {
      companyLogoInputRef.current.value = '';
    }
  };

  const handleSaveSpeakerDetails = async () => {
    if (!editingSpeaker) return;

    setSavingSpeakerDetails(true);
    try {
      // Update customer attributes via member profile
      const { data: memberProfile, error: mpError } = await supabase
        .from('member_profiles')
        .select('customer_id')
        .eq('id', editingSpeaker.memberProfileId)
        .single();

      if (mpError) throw mpError;

      // Fetch current attributes and merge with new values
      const { data: customer, error: fetchError } = await supabase
        .from('customers')
        .select('attributes')
        .eq('id', memberProfile.customer_id)
        .single();

      if (fetchError) throw fetchError;

      const updatedAttributes = {
        ...(customer?.attributes || {}),
        first_name: speakerDetailsForm.first_name,
        last_name: speakerDetailsForm.last_name,
        job_title: speakerDetailsForm.job_title,
        company: speakerDetailsForm.company,
        linkedin_url: speakerDetailsForm.linkedin_url,
      };

      const { error: updateError } = await supabase
        .from('customers')
        .update({ attributes: updatedAttributes })
        .eq('id', memberProfile.customer_id);

      if (updateError) throw updateError;

      // Upload company logo if a new one was selected
      let logoPath = editingSpeaker.companyLogoStoragePath || null;
      if (companyLogoFile) {
        // Trim transparent padding from logo before upload
        const trimmedFile = await trimTransparentPadding(companyLogoFile);
        const fileExt = trimmedFile.name.split('.').pop();
        const fileName = `${editingSpeaker.speakerId}-${Date.now()}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from('speaker-logos')
          .upload(fileName, trimmedFile, { upsert: true });

        if (uploadError) throw uploadError;
        logoPath = fileName;
      } else if (companyLogoPreview === null && editingSpeaker.companyLogoStoragePath) {
        // Logo was removed
        logoPath = null;
      }

      // Update speaker's company logo path
      await SpeakerService.updateSpeaker(editingSpeaker.speakerId, {
        company_logo_storage_path: logoPath,
      });

      toast.success('Speaker details updated');
      setShowEditSpeakerModal(false);
      setEditingSpeaker(null);
      loadTalks();
    } catch (error) {
      console.error('Error updating speaker details:', error);
      toast.error('Failed to update speaker details');
    } finally {
      setSavingSpeakerDetails(false);
    }
  };

  const handleCloseEditSpeakerModal = () => {
    setShowEditSpeakerModal(false);
    setEditingSpeaker(null);
    setCompanyLogoFile(null);
    setCompanyLogoPreview(null);
    setSpeakerDetailsForm({
      first_name: '',
      last_name: '',
      job_title: '',
      company: '',
      linkedin_url: '',
    });
  };

  const handleCloseAddModal = () => {
    setShowAddModal(false);
    setAddMode('search');
    setSearchQuery('');
    setCustomers([]);
    setSelectedCustomer(null);
    clearAvatarUpload();
    setSpeakerForm({
      speaker_title: '',
      speaker_bio: '',
      speaker_topic: '',
      talk_title: '',
      talk_synopsis: '',
      talk_duration_minutes: '',
      is_featured: false,
      event_sponsor_id: '',
    });
    setNewSpeakerForm({
      email: '',
      first_name: '',
      last_name: '',
      job_title: '',
      company: '',
      linkedin_url: '',
      speaker_title: '',
      speaker_bio: '',
      speaker_topic: '',
      talk_title: '',
      talk_synopsis: '',
      talk_duration_minutes: '',
      is_featured: false,
      event_sponsor_id: '',
    });
  };

  // Helper to convert talk speaker to format needed by email service
  const buildSpeakerForEmail = (talk: EventTalkWithSpeakers, confirmationToken?: string) => {
    const speaker = getPrimarySpeaker(talk);
    if (!speaker) return null;
    return {
      id: speaker.speaker_id,
      email: speaker.email || '',
      full_name: speaker.full_name || '',
      first_name: speaker.first_name || '',
      last_name: speaker.last_name || '',
      company: speaker.company || '',
      job_title: speaker.job_title || '',
      talk_title: talk.title,
      talk_synopsis: talk.synopsis || '',
      confirmation_token: confirmationToken,
      edit_token: talk.edit_token,
    } as EventSpeakerWithDetails & { confirmation_token?: string; edit_token?: string };
  };

  const handleApproveTalk = async (talk: EventTalkWithSpeakers) => {
    try {
      // Approve the talk
      await TalkService.approveTalk(talk.id);

      // Generate a confirmation token for the approval email
      const confirmationToken = await TalkService.generateConfirmationToken(talk.id);

      toast.success(`"${talk.title}" has been approved`);
      loadTalks();

      // Send automated approval email with confirmation link
      const speakerForEmail = buildSpeakerForEmail(talk, confirmationToken);
      if (speakerForEmail) {
        const emailResult = await SpeakerEmailService.sendApprovedEmail(speakerForEmail, eventId);
        if (emailResult.error) {
          console.warn('Speaker approval email not sent:', emailResult.error);
        }
      }
    } catch (error) {
      console.error('Error approving talk:', error);
      toast.error('Failed to approve talk');
    }
  };

  const handleRejectTalk = async (talk: EventTalkWithSpeakers) => {
    try {
      await TalkService.rejectTalk(talk.id);
      toast.success(`"${talk.title}" has been rejected`);
      loadTalks();

      // Send automated rejection email
      const speakerForEmail = buildSpeakerForEmail(talk);
      if (speakerForEmail) {
        const emailResult = await SpeakerEmailService.sendRejectedEmail(speakerForEmail, eventId);
        if (emailResult.error) {
          console.warn('Speaker rejection email not sent:', emailResult.error);
        }
      }
    } catch (error) {
      console.error('Error rejecting talk:', error);
      toast.error('Failed to reject talk');
    }
  };

  const handleReserveTalk = async (talk: EventTalkWithSpeakers) => {
    try {
      await TalkService.reserveTalk(talk.id);
      toast.success(`"${talk.title}" has been added to the reserve list`);
      loadTalks();

      // Generate a confirmation token for the reserve email
      const confirmationToken = await TalkService.generateConfirmationToken(talk.id);

      // Send automated reserve email with confirmation token
      const speakerForEmail = buildSpeakerForEmail(talk, confirmationToken);
      if (speakerForEmail) {
        const emailResult = await SpeakerEmailService.sendReserveEmail(speakerForEmail, eventId);
        if (emailResult.error) {
          console.warn('Speaker reserve email not sent:', emailResult.error);
        }
      }
    } catch (error) {
      console.error('Error adding talk to reserve:', error);
      toast.error('Failed to add talk to reserve list');
    }
  };

  const handleConfirmTalk = async (talk: EventTalkWithSpeakers) => {
    try {
      await TalkService.confirmTalk(talk.id);
      toast.success(`"${talk.title}" has been confirmed`);
      loadTalks();

      // Send automated confirmed email with edit link
      const speakerForEmail = buildSpeakerForEmail(talk);
      if (speakerForEmail) {
        const emailResult = await SpeakerEmailService.sendConfirmedEmail(speakerForEmail, eventId);
        if (emailResult.error) {
          console.warn('Speaker confirmed email not sent:', emailResult.error);
        }
      }
    } catch (error) {
      console.error('Error confirming talk:', error);
      toast.error('Failed to confirm talk');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !searching) {
      handleSearch();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="medium" />
      </div>
    );
  }

  // Determine if the add button should be disabled
  const isAddDisabledForExisting = !selectedCustomer || adding || uploadingAvatar ||
    (!customerHasAvatar(selectedCustomer) && !avatarFile);
  const isAddDisabledForNew = adding || uploadingAvatar || !avatarFile;

  // Get the current list based on view mode
  const getCurrentTalks = () => {
    switch (viewMode) {
      case 'confirmed': return confirmedTalks;
      case 'approved': return approvedTalks;
      case 'pending': return pendingTalks;
      case 'reserve': return reserveTalks;
      case 'rejected': return rejectedTalks;
      case 'placeholder': return placeholderTalks;
      default: return [];
    }
  };
  const currentTalks = getCurrentTalks();

  // Render talk submission card - extracted for reuse
  const renderTalkCard = (talk: EventTalkWithSpeakers, showApprovalActions = false) => {
    const speaker = getPrimarySpeaker(talk);
    const speakerId = speaker?.speaker_id;
    return (
    <Card key={talk.id} className="p-4 cursor-pointer hover:shadow-md transition-shadow h-full flex flex-col" onClick={() => setViewingTalk(talk)}>
      {/* Content area - grows to fill available space */}
      <div className="flex items-start gap-4 flex-1">
        {/* Avatar */}
        <div className="shrink-0 relative">
          {speaker?.avatar_url ? (
            <img
              src={speaker.avatar_url}
              alt={speaker.full_name || 'Speaker'}
              className="w-16 h-16 rounded-full object-cover"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
              <UserIcon className="w-8 h-8 text-gray-400" />
            </div>
          )}
          {talk.sponsor_name && (
            <div className="absolute -bottom-1 -right-1 bg-purple-500 rounded-full p-1" title={`Sponsor: ${talk.sponsor_name}`}>
              <BuildingOfficeIcon className="w-3 h-3 text-white" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-sm font-medium text-gray-900 dark:text-white truncate">
                {speaker?.full_name || speaker?.email || 'Unknown Speaker'}
              </h3>
              {speaker?.speaker_title && (
                <p className="text-xs text-primary-600 dark:text-primary-400 font-medium">
                  {speaker.speaker_title}
                </p>
              )}
              {speaker?.job_title && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {speaker.job_title}
                </p>
              )}
              {speaker?.company && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {speaker.company}
                </p>
              )}
              {talk.sponsor_name && (
                <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">
                  Sponsor: {talk.sponsor_name}
                </p>
              )}
            </div>
          </div>

          {/* Talk info */}
          {talk.title && (
            <div className="mt-2 p-2 bg-gray-50 dark:bg-gray-800 rounded">
              <p className="text-xs font-medium text-gray-900 dark:text-white">
                {talk.title}
              </p>
              {talk.synopsis && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
                  {talk.synopsis}
                </p>
              )}
            </div>
          )}

          {/* Speaker link stats (for confirmed/approved talks with links) */}
          {(viewMode === 'confirmed' || viewMode === 'approved') && speakerId && speakerLinks[speakerId] && (
            <div className="flex items-center gap-2 mt-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200">
                <ChartBarIcon className="w-3 h-3 mr-1" />
                {speakerLinks[speakerId].humanClicks} clicks
              </span>
              {speakerLinks[speakerId].registrationCount > 0 && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200">
                  {speakerLinks[speakerId].registrationCount} registrations
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Actions - always at bottom */}
      <div className="flex items-center gap-1 mt-3 pt-3 border-t border-gray-100 dark:border-gray-800" onClick={(e) => e.stopPropagation()}>
            {showApprovalActions ? (
              // Pending applications - show Approve, Reserve, Reject buttons together, then Delete
              <>
                <button
                  onClick={() => handleApproveTalk(talk)}
                  className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded-md bg-primary-600 text-white hover:bg-primary-700 transition-colors"
                  title="Approve talk"
                >
                  <CheckIcon className="w-4 h-4 sm:mr-1" />
                  <span className="hidden sm:inline">Approve</span>
                </button>
                <button
                  onClick={() => handleReserveTalk(talk)}
                  className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 transition-colors"
                  title="Add to reserve list"
                >
                  <ClipboardDocumentListIconOutline className="w-4 h-4 sm:mr-1" />
                  <span className="hidden sm:inline">Reserve</span>
                </button>
                <button
                  onClick={() => handleRejectTalk(talk)}
                  className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  title="Reject talk"
                >
                  <XMarkIcon className="w-4 h-4 sm:mr-1" />
                  <span className="hidden sm:inline">Reject</span>
                </button>
                <div className="flex items-center gap-1 ml-auto">
                  {speaker?.email && (
                    <button
                      onClick={() => setEmailingTalk(talk)}
                      className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                      title="Email speaker"
                    >
                      <EnvelopeIcon className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => setDeletingTalk(talk)}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded shrink-0"
                    title="Delete submission (removes speaker from event, keeps member)"
                  >
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </div>
              </>
            ) : viewMode === 'approved' ? (
              // Approved speakers: Confirm/Reject buttons on left, Edit/Delete/Link icons on right
              <>
                <button
                  onClick={() => handleConfirmTalk(talk)}
                  className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded-md bg-green-600 text-white hover:bg-green-700 transition-colors"
                  title="Confirm talk"
                >
                  <CheckIcon className="w-4 h-4 sm:mr-1" />
                  <span className="hidden sm:inline">Confirm</span>
                </button>
                <button
                  onClick={() => handleRejectTalk(talk)}
                  className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  title="Reject talk"
                >
                  <XMarkIcon className="w-4 h-4 sm:mr-1" />
                  <span className="hidden sm:inline">Reject</span>
                </button>
                <div className="flex items-center gap-1 ml-auto">
                  {speaker?.email && (
                    <button
                      onClick={() => setEmailingTalk(talk)}
                      className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                      title="Email speaker"
                    >
                      <EnvelopeIcon className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => handleEditTalk(talk)}
                    className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                    title="Edit speaker"
                  >
                    <PencilIcon className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setDeletingTalk(talk)}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                    title="Remove speaker"
                  >
                    <TrashIcon className="w-4 h-4" />
                  </button>
                  {eventLink && (
                    <button
                      onClick={() => speakerId && handleCopyTrackingLink(speakerId, speaker?.full_name || speaker?.email)}
                      disabled={copyingLinkFor === speakerId}
                      className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded disabled:opacity-50"
                      title="Copy tracking link"
                    >
                      {copyingLinkFor === speakerId ? (
                        <LoadingSpinner size="xs" />
                      ) : (
                        <LinkIcon className="w-4 h-4" />
                      )}
                    </button>
                  )}
                </div>
              </>
            ) : (
              // Other views: Confirmed, Reserve, Rejected
              <>
                {/* Confirmed speakers: Reserve/Reject buttons, Email, Edit, Delete, Copy Link */}
                {viewMode === 'confirmed' && (
                  <>
                    <button
                      onClick={() => handleReserveTalk(talk)}
                      className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 transition-colors"
                      title="Move to reserve list"
                    >
                      <ClipboardDocumentListIconOutline className="w-4 h-4 sm:mr-1" />
                      <span className="hidden sm:inline">Reserve</span>
                    </button>
                    <button
                      onClick={() => handleRejectTalk(talk)}
                      className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                      title="Reject talk"
                    >
                      <XMarkIcon className="w-4 h-4 sm:mr-1" />
                      <span className="hidden sm:inline">Reject</span>
                    </button>
                    <div className="flex items-center gap-1 ml-auto">
                      {speaker?.email && (
                        <button
                          onClick={() => setEmailingTalk(talk)}
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                          title="Email speaker"
                        >
                          <EnvelopeIcon className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => handleEditTalk(talk)}
                        className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                        title="Edit speaker"
                      >
                        <PencilIcon className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setDeletingTalk(talk)}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                        title="Remove speaker"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                      {eventLink && (
                        <button
                          onClick={() => speakerId && handleCopyTrackingLink(speakerId, speaker?.full_name || speaker?.email)}
                          disabled={copyingLinkFor === speakerId}
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded disabled:opacity-50"
                          title="Copy tracking link"
                        >
                          {copyingLinkFor === speakerId ? (
                            <LoadingSpinner size="xs" />
                          ) : (
                            <LinkIcon className="w-4 h-4" />
                          )}
                        </button>
                      )}
                    </div>
                  </>
                )}
                {/* Reserve speakers: Approve/Reject buttons, Email, Edit, Delete */}
                {viewMode === 'reserve' && (
                  <>
                    <button
                      onClick={() => handleApproveTalk(talk)}
                      className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded-md bg-primary-600 text-white hover:bg-primary-700 transition-colors"
                      title="Approve talk"
                    >
                      <CheckIcon className="w-4 h-4 sm:mr-1" />
                      <span className="hidden sm:inline">Approve</span>
                    </button>
                    <button
                      onClick={() => handleRejectTalk(talk)}
                      className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                      title="Reject talk"
                    >
                      <XMarkIcon className="w-4 h-4 sm:mr-1" />
                      <span className="hidden sm:inline">Reject</span>
                    </button>
                    <div className="flex items-center gap-1 ml-auto">
                      {speaker?.email && (
                        <button
                          onClick={() => setEmailingTalk(talk)}
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                          title="Email speaker"
                        >
                          <EnvelopeIcon className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => handleEditTalk(talk)}
                        className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                        title="Edit speaker"
                      >
                        <PencilIcon className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setDeletingTalk(talk)}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                        title="Remove speaker"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </div>
                  </>
                )}
                {/* Rejected speakers: Re-approve button, Email, Edit, Delete */}
                {viewMode === 'rejected' && (
                  <>
                    <button
                      onClick={() => handleApproveTalk(talk)}
                      className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded-md bg-primary-600 text-white hover:bg-primary-700 transition-colors"
                      title="Re-approve speaker"
                    >
                      <CheckIcon className="w-4 h-4 sm:mr-1" />
                      <span className="hidden sm:inline">Approve</span>
                    </button>
                    <div className="flex items-center gap-1 ml-auto">
                      {speaker?.email && (
                        <button
                          onClick={() => setEmailingTalk(talk)}
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                          title="Email speaker"
                        >
                          <EnvelopeIcon className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => handleEditTalk(talk)}
                        className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                        title="Edit speaker"
                      >
                        <PencilIcon className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setDeletingTalk(talk)}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                        title="Remove speaker"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
    </Card>
  );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium text-gray-900 dark:text-white">Event Speakers</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Manage speakers for this event
          </p>
        </div>
        <Button onClick={() => setShowAddModal(true)} size="sm">
          <PlusIcon className="w-4 h-4 mr-2" />
          Add Speaker
        </Button>
      </div>

      {/* View Mode Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="-mb-px flex gap-4 overflow-x-auto">
          <button
            onClick={() => setViewMode('confirmed')}
            className={`flex items-center gap-2 py-2 px-1 border-b-2 text-sm font-medium whitespace-nowrap ${
              viewMode === 'confirmed'
                ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400'
            }`}
          >
            <UserGroupIcon className="w-5 h-5" />
            Confirmed ({confirmedTalks.length})
          </button>
          <button
            onClick={() => setViewMode('approved')}
            className={`flex items-center gap-2 py-2 px-1 border-b-2 text-sm font-medium whitespace-nowrap ${
              viewMode === 'approved'
                ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400'
            }`}
          >
            <CheckCircleIcon className="w-5 h-5" />
            Approved ({approvedTalks.length})
          </button>
          <button
            onClick={() => setViewMode('pending')}
            className={`flex items-center gap-2 py-2 px-1 border-b-2 text-sm font-medium whitespace-nowrap ${
              viewMode === 'pending'
                ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400'
            }`}
          >
            <ClockIcon className="w-5 h-5" />
            Pending ({pendingTalks.length})
            {pendingTalks.length > 0 && (
              <span className="ml-1 inline-flex items-center justify-center px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200 rounded-full">
                {pendingTalks.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setViewMode('reserve')}
            className={`flex items-center gap-2 py-2 px-1 border-b-2 text-sm font-medium whitespace-nowrap ${
              viewMode === 'reserve'
                ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400'
            }`}
          >
            <ClipboardDocumentListIcon className="w-5 h-5" />
            Reserve ({reserveTalks.length})
          </button>
          <button
            onClick={() => setViewMode('rejected')}
            className={`flex items-center gap-2 py-2 px-1 border-b-2 text-sm font-medium whitespace-nowrap ${
              viewMode === 'rejected'
                ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400'
            }`}
          >
            <XCircleIcon className="w-5 h-5" />
            Rejected ({rejectedTalks.length})
          </button>
          <button
            onClick={() => setViewMode('placeholder')}
            className={`flex items-center gap-2 py-2 px-1 border-b-2 text-sm font-medium whitespace-nowrap ${
              viewMode === 'placeholder'
                ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400'
            }`}
          >
            <UserPlusIcon className="w-5 h-5" />
            Placeholder ({placeholderTalks.length})
            {placeholderTalks.length > 0 && (
              <span className="ml-1 inline-flex items-center justify-center px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-200 rounded-full">
                {placeholderTalks.length}
              </span>
            )}
          </button>
        </nav>
      </div>

      {/* Group Mode Toggle */}
      <div className="flex justify-end">
        <div className="inline-flex rounded-lg bg-gray-100 dark:bg-gray-800 p-1">
          <button
            onClick={() => setGroupMode('talks')}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              groupMode === 'talks'
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            By Talk
          </button>
          <button
            onClick={() => setGroupMode('speakers')}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              groupMode === 'speakers'
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            By Speaker
          </button>
          {(viewMode === 'confirmed' || viewMode === 'approved') && (
            <button
              onClick={() => setGroupMode('progress')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                groupMode === 'progress'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              Progress
            </button>
          )}
        </div>
      </div>

      {/* Speakers Grid */}
      {currentTalks.length === 0 ? (
        <Card className="p-12 text-center">
          <UserIcon className="w-12 h-12 mx-auto text-gray-400 mb-4" />
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            {viewMode === 'confirmed' && 'No confirmed speakers yet. Add speakers or wait for approved speakers to confirm their attendance.'}
            {viewMode === 'approved' && 'No approved speakers awaiting confirmation.'}
            {viewMode === 'pending' && 'No pending speaker applications.'}
            {viewMode === 'reserve' && 'No speakers on the reserve list.'}
            {viewMode === 'rejected' && 'No rejected speaker applications.'}
            {viewMode === 'placeholder' && 'No placeholder speakers. Placeholder speakers are automatically created from AI-extracted event descriptions.'}
          </p>
          {viewMode === 'confirmed' && (
            <Button onClick={() => setShowAddModal(true)}>
              <PlusIcon className="w-4 h-4 mr-2" />
              Add Your First Speaker
            </Button>
          )}
        </Card>
      ) : groupMode === 'progress' && (viewMode === 'confirmed' || viewMode === 'approved') ? (
        /* Progress table view */
        (() => {
          const speakers = groupTalksBySpeaker(currentTalks);
          // Sort by completion: speakers with fewer completed tasks first
          const sorted = [...speakers].sort((a, b) => {
            const countCompleted = (s: typeof a) => {
              let count = 0;
              if (s.talks.some(t => t.calendar_added_at)) count++;
              if (s.talks.some(t => t.presentation_url || t.presentation_storage_path)) count++;
              if (s.talks.some(t => t.tracking_link_copied_at)) count++;
              return count;
            };
            return countCompleted(a) - countCompleted(b);
          });
          return (
            <Card className="overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Speaker</th>
                    <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Calendar</th>
                    <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Presentation</th>
                    <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Tracking Link</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {sorted.map((speakerGroup) => {
                    const hasCalendar = speakerGroup.talks.some(t => t.calendar_added_at);
                    const hasPresentation = speakerGroup.talks.some(t => t.presentation_url || t.presentation_storage_path);
                    const hasTrackingLink = speakerGroup.talks.some(t => t.tracking_link_copied_at);
                    return (
                      <tr key={speakerGroup.speakerId} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            {speakerGroup.avatarUrl ? (
                              <img src={speakerGroup.avatarUrl} alt={speakerGroup.speakerName} className="w-8 h-8 rounded-full object-cover" />
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                                <UserIcon className="w-4 h-4 text-gray-400" />
                              </div>
                            )}
                            <div>
                              <p className="text-sm font-medium text-gray-900 dark:text-white">{speakerGroup.speakerName}</p>
                              {speakerGroup.email && (
                                <p className="text-xs text-gray-500 dark:text-gray-400">{speakerGroup.email}</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {hasCalendar ? (
                            <CheckCircleIcon className="w-5 h-5 text-green-500 mx-auto" />
                          ) : (
                            <XCircleIcon className="w-5 h-5 text-red-400 mx-auto" />
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {hasPresentation ? (
                            <CheckCircleIcon className="w-5 h-5 text-green-500 mx-auto" />
                          ) : (
                            <XCircleIcon className="w-5 h-5 text-red-400 mx-auto" />
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {hasTrackingLink ? (
                            <CheckCircleIcon className="w-5 h-5 text-green-500 mx-auto" />
                          ) : (
                            <XCircleIcon className="w-5 h-5 text-red-400 mx-auto" />
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {speakerGroup.email && speakerGroup.talks.length > 0 && (
                            <button
                              onClick={() => setEmailingTalk(speakerGroup.talks[0])}
                              className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded inline-flex"
                              title="Email speaker"
                            >
                              <EnvelopeIcon className="w-4 h-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          );
        })()
      ) : groupMode === 'talks' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {currentTalks.map((talk) => renderTalkCard(talk, viewMode === 'pending'))}
        </div>
      ) : groupMode === 'speakers' ? (
        /* Speaker-centric view */
        <div className="space-y-4">
          {(() => {
            const speakers = groupTalksBySpeaker(currentTalks);
            return speakers.map((speakerGroup, index) => (
            <Card key={speakerGroup.speakerId} className="p-4">
              <div className="flex items-start gap-4">
                {/* Speaker Avatar */}
                <div className="shrink-0">
                  {speakerGroup.avatarUrl ? (
                    <img
                      src={speakerGroup.avatarUrl}
                      alt={speakerGroup.speakerName}
                      className="w-16 h-16 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                      <UserIcon className="w-8 h-8 text-gray-400" />
                    </div>
                  )}
                </div>

                {/* Speaker Info and Talks */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between">
                    <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                      {speakerGroup.speakerName}
                    </h3>
                    {!(viewMode === 'confirmed' || viewMode === 'approved') && speakerGroup.email && speakerGroup.talks.length > 0 && (
                      <div className="flex items-center gap-1 ml-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); setEmailingTalk(speakerGroup.talks[0]); }}
                          className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                          title="Email speaker"
                        >
                          <EnvelopeIcon className="w-5 h-5 text-gray-400 hover:text-blue-600" />
                        </button>
                      </div>
                    )}
                    {(viewMode === 'confirmed' || viewMode === 'approved') && (
                      <div className="flex items-center gap-1 ml-2">
                        {/* Reorder buttons */}
                        <div className="flex flex-col">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleMoveSpeaker(speakers, index, 'up'); }}
                            disabled={index === 0}
                            className={`p-0.5 rounded ${index === 0 ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                            title="Move up"
                          >
                            <ChevronUpIcon className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleMoveSpeaker(speakers, index, 'down'); }}
                            disabled={index === speakers.length - 1}
                            className={`p-0.5 rounded ${index === speakers.length - 1 ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                            title="Move down"
                          >
                            <ChevronDownIcon className="w-4 h-4" />
                          </button>
                        </div>
                        {/* Email speaker button */}
                        {speakerGroup.email && speakerGroup.talks.length > 0 && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setEmailingTalk(speakerGroup.talks[0]); }}
                            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                            title="Email speaker"
                          >
                            <EnvelopeIcon className="w-5 h-5 text-gray-400 hover:text-blue-600" />
                          </button>
                        )}
                        {/* Edit speaker details button */}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleEditSpeakerDetails(speakerGroup); }}
                          className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                          title="Edit speaker details"
                        >
                          <PencilIcon className="w-5 h-5 text-gray-400 hover:text-gray-600" />
                        </button>
                        {/* Featured button */}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleToggleFeatured(speakerGroup.speakerId, speakerGroup.isFeatured); }}
                          className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                          title={speakerGroup.isFeatured ? 'Remove from featured' : 'Mark as featured'}
                        >
                          {speakerGroup.isFeatured ? (
                            <StarIconSolid className="w-5 h-5 text-yellow-500" />
                          ) : (
                            <StarIcon className="w-5 h-5 text-gray-400 hover:text-yellow-500" />
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                  {speakerGroup.speakerTitle && (
                    <p className="text-sm text-primary-600 dark:text-primary-400 font-medium">
                      {speakerGroup.speakerTitle}
                    </p>
                  )}
                  {speakerGroup.jobTitle && (
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {speakerGroup.jobTitle}
                    </p>
                  )}
                  {speakerGroup.company && (
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {speakerGroup.company}
                      </p>
                      {speakerGroup.companyLogoStoragePath && (
                        <img
                          src={`${supabaseUrl}/storage/v1/object/public/speaker-logos/${speakerGroup.companyLogoStoragePath}`}
                          alt={`${speakerGroup.company} logo`}
                          className="h-5 max-w-20 object-contain [filter:brightness(0)] dark:[filter:brightness(0)_invert(1)]"
                        />
                      )}
                    </div>
                  )}
                  {!speakerGroup.company && speakerGroup.companyLogoStoragePath && (
                    <img
                      src={`${supabaseUrl}/storage/v1/object/public/speaker-logos/${speakerGroup.companyLogoStoragePath}`}
                      alt="Company logo"
                      className="h-6 max-w-24 object-contain [filter:brightness(0)] dark:[filter:brightness(0)_invert(1)]"
                    />
                  )}

                  {/* Talks list */}
                  <div className="mt-3 space-y-2">
                    <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide font-medium">
                      {speakerGroup.talks.length} {speakerGroup.talks.length === 1 ? 'Talk' : 'Talks'}
                    </p>
                    {speakerGroup.talks.map((talk) => (
                      <div
                        key={talk.id}
                        className="p-2 bg-gray-50 dark:bg-gray-800 rounded cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-750"
                        onClick={() => setViewingTalk(talk)}
                      >
                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                          {talk.title || 'Untitled Talk'}
                        </p>
                        {talk.synopsis && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
                            {talk.synopsis}
                          </p>
                        )}
                        {talk.duration_minutes && (
                          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                            {talk.duration_minutes} minutes
                          </p>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Speaker Tasks Checklist */}
                  {(viewMode === 'confirmed' || viewMode === 'approved') && (
                    <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                      <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide font-medium mb-2">
                        Speaker Tasks
                      </p>
                      <div className="space-y-1.5">
                        {/* Calendar task - check if any talk has calendar_added_at */}
                        <div className="flex items-center gap-2">
                          {speakerGroup.talks.some(t => t.calendar_added_at) ? (
                            <CheckCircleIcon className="w-4 h-4 text-green-500" />
                          ) : (
                            <div className="w-4 h-4 rounded-full border-2 border-gray-300 dark:border-gray-600" />
                          )}
                          <CalendarDaysIcon className="w-4 h-4 text-gray-400" />
                          <span className={`text-xs ${speakerGroup.talks.some(t => t.calendar_added_at) ? 'text-gray-600 dark:text-gray-300' : 'text-gray-400 dark:text-gray-500'}`}>
                            Added to calendar
                          </span>
                        </div>
                        {/* Presentation task - check if any talk has presentation */}
                        <div className="flex items-center gap-2">
                          {speakerGroup.talks.some(t => t.presentation_url || t.presentation_storage_path) ? (
                            <CheckCircleIcon className="w-4 h-4 text-green-500" />
                          ) : (
                            <div className="w-4 h-4 rounded-full border-2 border-gray-300 dark:border-gray-600" />
                          )}
                          <DocumentTextIcon className="w-4 h-4 text-gray-400" />
                          <span className={`text-xs ${speakerGroup.talks.some(t => t.presentation_url || t.presentation_storage_path) ? 'text-gray-600 dark:text-gray-300' : 'text-gray-400 dark:text-gray-500'}`}>
                            Presentation uploaded
                          </span>
                        </div>
                        {/* Tracking link task - check if any talk has tracking_link_copied_at */}
                        <div className="flex items-center gap-2">
                          {speakerGroup.talks.some(t => t.tracking_link_copied_at) ? (
                            <CheckCircleIcon className="w-4 h-4 text-green-500" />
                          ) : (
                            <div className="w-4 h-4 rounded-full border-2 border-gray-300 dark:border-gray-600" />
                          )}
                          <LinkIcon className="w-4 h-4 text-gray-400" />
                          <span className={`text-xs ${speakerGroup.talks.some(t => t.tracking_link_copied_at) ? 'text-gray-600 dark:text-gray-300' : 'text-gray-400 dark:text-gray-500'}`}>
                            Tracking link shared
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Tracking link stats */}
                  {(viewMode === 'confirmed' || viewMode === 'approved') && speakerLinks[speakerGroup.speakerId] && (
                    <div className="flex items-center gap-2 mt-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200">
                        <ChartBarIcon className="w-3 h-3 mr-1" />
                        {speakerLinks[speakerGroup.speakerId].humanClicks} clicks
                      </span>
                      {speakerLinks[speakerGroup.speakerId].registrationCount > 0 && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200">
                          {speakerLinks[speakerGroup.speakerId].registrationCount} registrations
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Actions */}
                {(viewMode === 'confirmed' || viewMode === 'approved') && eventLink && (
                  <div className="shrink-0">
                    <button
                      onClick={() => handleCopyTrackingLink(speakerGroup.speakerId, speakerGroup.speakerName)}
                      disabled={copyingLinkFor === speakerGroup.speakerId}
                      className="p-2 text-gray-400 hover:text-blue-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded disabled:opacity-50"
                      title="Copy tracking link"
                    >
                      {copyingLinkFor === speakerGroup.speakerId ? (
                        <LoadingSpinner size="xs" />
                      ) : (
                        <LinkIcon className="w-5 h-5" />
                      )}
                    </button>
                  </div>
                )}
              </div>
            </Card>
          ));
          })()}
        </div>
      ) : null}

      {/* Add Speaker Modal */}
      <Modal
        isOpen={showAddModal}
        onClose={handleCloseAddModal}
        title="Add Speaker"
        size="lg"
        footer={
          <div className="flex justify-between items-center gap-3 p-4">
            <Button
              variant="outline"
              onClick={handleCloseAddModal}
              disabled={adding || uploadingAvatar}
            >
              Cancel
            </Button>
            <div className="flex gap-2">
              {addMode === 'search' ? (
                <>
                  <Button
                    variant="outline"
                    onClick={() => handleAddExistingSpeaker(true)}
                    disabled={isAddDisabledForExisting || !speakerForm.talk_title.trim() || !speakerForm.talk_synopsis.trim()}
                  >
                    <ClockIcon className="w-4 h-4 mr-1" />
                    {uploadingAvatar ? 'Uploading...' : adding ? 'Adding...' : 'Add as Pending'}
                  </Button>
                  <Button
                    onClick={() => handleAddExistingSpeaker(false)}
                    disabled={isAddDisabledForExisting || !speakerForm.talk_title.trim() || !speakerForm.talk_synopsis.trim()}
                  >
                    {uploadingAvatar ? 'Uploading...' : adding ? 'Adding...' : 'Add Speaker'}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="outline"
                    onClick={() => handleAddNewSpeaker(true)}
                    disabled={isAddDisabledForNew || !newSpeakerForm.talk_title.trim() || !newSpeakerForm.talk_synopsis.trim()}
                  >
                    <ClockIcon className="w-4 h-4 mr-1" />
                    {uploadingAvatar ? 'Uploading...' : adding ? 'Creating...' : 'Add as Pending'}
                  </Button>
                  <Button
                    onClick={() => handleAddNewSpeaker(false)}
                    disabled={isAddDisabledForNew || !newSpeakerForm.talk_title.trim() || !newSpeakerForm.talk_synopsis.trim()}
                  >
                    {uploadingAvatar ? 'Uploading...' : adding ? 'Creating...' : 'Create Speaker'}
                  </Button>
                </>
              )}
            </div>
          </div>
        }
      >
        <div className="space-y-6">
          {/* Mode Toggle */}
          <div className="flex gap-2 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg">
            <button
              onClick={() => {
                setAddMode('search');
                clearAvatarUpload();
              }}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                addMode === 'search'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              <MagnifyingGlassIcon className="w-4 h-4" />
              Search Existing Member
            </button>
            <button
              onClick={() => {
                setAddMode('new');
                clearAvatarUpload();
              }}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                addMode === 'new'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              <UserPlusIcon className="w-4 h-4" />
              Create New Speaker
            </button>
          </div>

          {addMode === 'search' ? (
            <>
              {/* Search Section */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Search Member by Email
                </label>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Input
                      type="email"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyPress={handleKeyPress}
                      placeholder="Enter email address..."
                      disabled={searching || adding}
                    />
                  </div>
                  <Button
                    variant="secondary"
                    onClick={handleSearch}
                    disabled={searching || adding || !searchQuery.trim()}
                  >
                    <MagnifyingGlassIcon className="w-4 h-4 mr-2" />
                    {searching ? 'Searching...' : 'Search'}
                  </Button>
                </div>
              </div>

              {/* Search Results */}
              {customers.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Select User ({customers.length} found)
                  </label>
                  <div className="border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-200 dark:divide-gray-700 max-h-48 overflow-y-auto">
                    {customers.map((customer) => {
                      const firstName = customer.attributes?.first_name || '';
                      const lastName = customer.attributes?.last_name || '';
                      const fullName = firstName && lastName
                        ? `${firstName} ${lastName}`
                        : firstName || lastName || 'No name';
                      const company = customer.attributes?.company || 'No company';
                      const jobTitle = customer.attributes?.job_title || 'No title';
                      const hasAvatar = customerHasAvatar(customer);

                      return (
                        <button
                          key={customer.id}
                          onClick={() => {
                            setSelectedCustomer(customer);
                            clearAvatarUpload();
                          }}
                          disabled={adding}
                          className={`w-full text-left p-3 transition-colors ${
                            selectedCustomer?.id === customer.id
                              ? 'bg-primary-50 dark:bg-primary-900/20 border-l-4 border-primary-600'
                              : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                          } ${adding ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                        >
                          <div className="flex items-center gap-3">
                            {/* Avatar indicator */}
                            <div className="shrink-0">
                              {hasAvatar ? (
                                <img
                                  src={customer.attributes.avatar_url}
                                  alt={fullName}
                                  className="w-10 h-10 rounded-full object-cover"
                                />
                              ) : (
                                <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                                  <ExclamationTriangleIcon className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                                </div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <p className="font-medium text-gray-900 dark:text-white truncate">
                                  {fullName}
                                </p>
                                {selectedCustomer?.id === customer.id && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary-100 text-primary-800 dark:bg-primary-900/50 dark:text-primary-200">
                                    Selected
                                  </span>
                                )}
                                {!hasAvatar && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
                                    No photo
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-gray-600 dark:text-gray-400 truncate">
                                {customer.email}
                              </p>
                              <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                                <span>{jobTitle}</span>
                                <span>•</span>
                                <span>{company}</span>
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Speaker Details Form - Show when customer is selected */}
              {selectedCustomer && (
                <div className="space-y-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                  {/* Avatar Upload Section */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Speaker Photo *
                    </label>
                    {customerHasAvatar(selectedCustomer) ? (
                      <div className="flex items-center gap-4">
                        <img
                          src={selectedCustomer.attributes.avatar_url}
                          alt="Current avatar"
                          className="w-20 h-20 rounded-full object-cover border-2 border-green-500"
                        />
                        <div className="text-sm text-green-600 dark:text-green-400">
                          This member already has a photo
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-center gap-4 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
                          <ExclamationTriangleIcon className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
                          <p className="text-sm text-amber-800 dark:text-amber-200">
                            This member doesn't have a photo. Please upload one to continue.
                          </p>
                        </div>
                        <div className="flex items-center gap-4">
                          {avatarPreview ? (
                            <div className="relative">
                              <img
                                src={avatarPreview}
                                alt="Avatar preview"
                                className="w-20 h-20 rounded-full object-cover border-2 border-primary-500"
                              />
                              <button
                                type="button"
                                onClick={clearAvatarUpload}
                                className="absolute -top-1 -right-1 p-1 bg-red-500 text-white rounded-full hover:bg-red-600"
                              >
                                <TrashIcon className="w-3 h-3" />
                              </button>
                            </div>
                          ) : (
                            <div
                              onClick={() => fileInputRef.current?.click()}
                              className="w-20 h-20 rounded-full border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center cursor-pointer hover:border-primary-500 transition-colors"
                            >
                              <PhotoIcon className="w-8 h-8 text-gray-400" />
                            </div>
                          )}
                          <div className="flex-1">
                            <input
                              ref={fileInputRef}
                              type="file"
                              accept="image/*"
                              onChange={handleFileSelect}
                              className="hidden"
                            />
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => fileInputRef.current?.click()}
                              disabled={adding || uploadingAvatar}
                            >
                              {avatarPreview ? 'Change Photo' : 'Upload Photo'}
                            </Button>
                            <p className="text-xs text-gray-500 mt-1">
                              JPG, PNG, WebP, GIF up to 5MB
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <h4 className="text-sm font-medium text-gray-900 dark:text-white">
                    Talk Details *
                  </h4>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Talk Title *
                    </label>
                    <Input
                      value={speakerForm.talk_title}
                      onChange={(e) => setSpeakerForm({ ...speakerForm, talk_title: e.target.value })}
                      placeholder="The title of the talk/presentation"
                      disabled={adding}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Talk Synopsis *
                    </label>
                    <textarea
                      value={speakerForm.talk_synopsis}
                      onChange={(e) => setSpeakerForm({ ...speakerForm, talk_synopsis: e.target.value })}
                      placeholder="Describe the talk/presentation in detail..."
                      rows={4}
                      disabled={adding}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                    />
                  </div>
                  {talkDurationOptions && talkDurationOptions.length > 0 && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Talk Duration
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {talkDurationOptions.map((option) => (
                          <button
                            key={option.duration}
                            type="button"
                            onClick={() => setSpeakerForm({ ...speakerForm, talk_duration_minutes: option.duration })}
                            disabled={adding}
                            className={`px-3 py-1.5 rounded-md border text-sm transition-colors ${
                              speakerForm.talk_duration_minutes === option.duration
                                ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                                : 'border-gray-300 dark:border-gray-600 hover:border-gray-400'
                            }`}
                          >
                            {option.duration} min
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <h4 className="text-sm font-medium text-gray-900 dark:text-white pt-2">
                    Speaker Bio (Optional)
                  </h4>
                  <div>
                    <textarea
                      value={speakerForm.speaker_bio}
                      onChange={(e) => setSpeakerForm({ ...speakerForm, speaker_bio: e.target.value })}
                      placeholder="Speaker bio for this event"
                      rows={3}
                      disabled={adding}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="is_featured"
                      checked={speakerForm.is_featured}
                      onChange={(e) => setSpeakerForm({ ...speakerForm, is_featured: e.target.checked })}
                      disabled={adding}
                      className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                    />
                    <label htmlFor="is_featured" className="text-sm text-gray-700 dark:text-gray-300">
                      Featured speaker (displayed prominently)
                    </label>
                  </div>

                  {/* Sponsor Association */}
                  {eventSponsors.length > 0 && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Associated Sponsor (Optional)
                      </label>
                      <select
                        value={speakerForm.event_sponsor_id}
                        onChange={(e) => setSpeakerForm({ ...speakerForm, event_sponsor_id: e.target.value })}
                        disabled={adding}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                      >
                        <option value="">No sponsor association</option>
                        {eventSponsors.map((es) => (
                          <option key={es.id} value={es.id}>
                            {es.sponsor?.name || 'Unknown Sponsor'} {es.sponsorship_tier ? `(${es.sponsorship_tier})` : ''}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-gray-500 mt-1">
                        Link this speaker to an event sponsor if they are representing that sponsor
                      </p>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              {/* New Speaker Form */}
              <div className="space-y-4">
                {/* Avatar Upload - Required for new speakers */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Speaker Photo *
                  </label>
                  <div className="flex items-center gap-4">
                    {avatarPreview ? (
                      <div className="relative">
                        <img
                          src={avatarPreview}
                          alt="Avatar preview"
                          className="w-20 h-20 rounded-full object-cover border-2 border-primary-500"
                        />
                        <button
                          type="button"
                          onClick={clearAvatarUpload}
                          className="absolute -top-1 -right-1 p-1 bg-red-500 text-white rounded-full hover:bg-red-600"
                        >
                          <TrashIcon className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <div
                        onClick={() => fileInputRef.current?.click()}
                        className="w-20 h-20 rounded-full border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center cursor-pointer hover:border-primary-500 transition-colors"
                      >
                        <PhotoIcon className="w-8 h-8 text-gray-400" />
                      </div>
                    )}
                    <div className="flex-1">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleFileSelect}
                        className="hidden"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={adding || uploadingAvatar}
                      >
                        {avatarPreview ? 'Change Photo' : 'Upload Photo'}
                      </Button>
                      <p className="text-xs text-gray-500 mt-1">
                        JPG, PNG, WebP, GIF up to 5MB
                      </p>
                    </div>
                  </div>
                  {!avatarPreview && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                      A photo is required for all speakers
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      First Name *
                    </label>
                    <Input
                      value={newSpeakerForm.first_name}
                      onChange={(e) => setNewSpeakerForm({ ...newSpeakerForm, first_name: e.target.value })}
                      placeholder="First name"
                      disabled={adding}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Last Name *
                    </label>
                    <Input
                      value={newSpeakerForm.last_name}
                      onChange={(e) => setNewSpeakerForm({ ...newSpeakerForm, last_name: e.target.value })}
                      placeholder="Last name"
                      disabled={adding}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Email Address *
                  </label>
                  <Input
                    type="email"
                    value={newSpeakerForm.email}
                    onChange={(e) => setNewSpeakerForm({ ...newSpeakerForm, email: e.target.value })}
                    placeholder="speaker@example.com"
                    disabled={adding}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Job Title
                    </label>
                    <Input
                      value={newSpeakerForm.job_title}
                      onChange={(e) => setNewSpeakerForm({ ...newSpeakerForm, job_title: e.target.value })}
                      placeholder="e.g., CTO, VP Engineering"
                      disabled={adding}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Company
                    </label>
                    <Input
                      value={newSpeakerForm.company}
                      onChange={(e) => setNewSpeakerForm({ ...newSpeakerForm, company: e.target.value })}
                      placeholder="Company name"
                      disabled={adding}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    LinkedIn URL
                  </label>
                  <Input
                    type="url"
                    value={newSpeakerForm.linkedin_url}
                    onChange={(e) => setNewSpeakerForm({ ...newSpeakerForm, linkedin_url: e.target.value })}
                    placeholder="https://linkedin.com/in/username"
                    disabled={adding}
                  />
                </div>

                <hr className="border-gray-200 dark:border-gray-700" />

                <h4 className="text-sm font-medium text-gray-900 dark:text-white">
                  Talk Details *
                </h4>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Talk Title *
                  </label>
                  <Input
                    value={newSpeakerForm.talk_title}
                    onChange={(e) => setNewSpeakerForm({ ...newSpeakerForm, talk_title: e.target.value })}
                    placeholder="The title of the talk/presentation"
                    disabled={adding}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Talk Synopsis *
                  </label>
                  <textarea
                    value={newSpeakerForm.talk_synopsis}
                    onChange={(e) => setNewSpeakerForm({ ...newSpeakerForm, talk_synopsis: e.target.value })}
                    placeholder="Describe the talk/presentation in detail..."
                    rows={4}
                    disabled={adding}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  />
                </div>
                {talkDurationOptions && talkDurationOptions.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Talk Duration
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {talkDurationOptions.map((option) => (
                        <button
                          key={option.duration}
                          type="button"
                          onClick={() => setNewSpeakerForm({ ...newSpeakerForm, talk_duration_minutes: option.duration })}
                          disabled={adding}
                          className={`px-3 py-1.5 rounded-md border text-sm transition-colors ${
                            newSpeakerForm.talk_duration_minutes === option.duration
                              ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                              : 'border-gray-300 dark:border-gray-600 hover:border-gray-400'
                          }`}
                        >
                          {option.duration} min
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <h4 className="text-sm font-medium text-gray-900 dark:text-white pt-2">
                  Speaker Bio (Optional)
                </h4>
                <div>
                  <textarea
                    value={newSpeakerForm.speaker_bio}
                    onChange={(e) => setNewSpeakerForm({ ...newSpeakerForm, speaker_bio: e.target.value })}
                    placeholder="Speaker bio for this event"
                    rows={3}
                    disabled={adding}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="new_is_featured"
                    checked={newSpeakerForm.is_featured}
                    onChange={(e) => setNewSpeakerForm({ ...newSpeakerForm, is_featured: e.target.checked })}
                    disabled={adding}
                    className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                  />
                  <label htmlFor="new_is_featured" className="text-sm text-gray-700 dark:text-gray-300">
                    Featured speaker (displayed prominently)
                  </label>
                </div>

                {/* Sponsor Association */}
                {eventSponsors.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Associated Sponsor (Optional)
                    </label>
                    <select
                      value={newSpeakerForm.event_sponsor_id}
                      onChange={(e) => setNewSpeakerForm({ ...newSpeakerForm, event_sponsor_id: e.target.value })}
                      disabled={adding}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                    >
                      <option value="">No sponsor association</option>
                      {eventSponsors.map((es) => (
                        <option key={es.id} value={es.id}>
                          {es.sponsor?.name || 'Unknown Sponsor'} {es.sponsorship_tier ? `(${es.sponsorship_tier})` : ''}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      Link this speaker to an event sponsor if they are representing that sponsor
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* Edit Speaker Modal */}
      <Modal
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setEditingTalk(null);
        }}
        title="Edit Speaker"
        footer={
          <div className="flex justify-between items-center gap-3 p-4">
            <Button variant="outline" onClick={() => {
              setShowEditModal(false);
              setEditingTalk(null);
            }}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={!speakerForm.talk_title.trim() || !speakerForm.talk_synopsis.trim()}
            >
              Save Changes
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {editingTalk && (() => {
            const speaker = getPrimarySpeaker(editingTalk);
            return (
            <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg mb-4">
              {speaker?.avatar_url ? (
                <img
                  src={speaker.avatar_url}
                  alt={speaker.full_name || 'Speaker'}
                  className="w-10 h-10 rounded-full object-cover"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                  <UserIcon className="w-5 h-5 text-gray-400" />
                </div>
              )}
              <div>
                <p className="font-medium text-gray-900 dark:text-white">
                  {speaker?.full_name || speaker?.email || 'Unknown Speaker'}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {speaker?.email}
                </p>
              </div>
            </div>
            );
          })()}

          <h4 className="text-sm font-medium text-gray-900 dark:text-white">
            Talk Details *
          </h4>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Talk Title *
            </label>
            <Input
              value={speakerForm.talk_title}
              onChange={(e) => setSpeakerForm({ ...speakerForm, talk_title: e.target.value })}
              placeholder="The title of the talk/presentation"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Talk Synopsis *
            </label>
            <textarea
              value={speakerForm.talk_synopsis}
              onChange={(e) => setSpeakerForm({ ...speakerForm, talk_synopsis: e.target.value })}
              placeholder="Describe the talk/presentation in detail..."
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            />
          </div>
          {talkDurationOptions && talkDurationOptions.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Talk Duration
              </label>
              <div className="flex flex-wrap gap-2">
                {talkDurationOptions.map((option) => (
                  <button
                    key={option.duration}
                    type="button"
                    onClick={() => setSpeakerForm({ ...speakerForm, talk_duration_minutes: option.duration })}
                    className={`px-3 py-1.5 rounded-md border text-sm transition-colors ${
                      speakerForm.talk_duration_minutes === option.duration
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                        : 'border-gray-300 dark:border-gray-600 hover:border-gray-400'
                    }`}
                  >
                    {option.duration} min
                  </button>
                ))}
              </div>
            </div>
          )}

          <h4 className="text-sm font-medium text-gray-900 dark:text-white pt-2">
            Speaker Bio (Optional)
          </h4>
          <div>
            <textarea
              value={speakerForm.speaker_bio}
              onChange={(e) => setSpeakerForm({ ...speakerForm, speaker_bio: e.target.value })}
              placeholder="Speaker bio for this event"
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="edit_is_featured"
              checked={speakerForm.is_featured}
              onChange={(e) => setSpeakerForm({ ...speakerForm, is_featured: e.target.checked })}
              className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
            />
            <label htmlFor="edit_is_featured" className="text-sm text-gray-700 dark:text-gray-300">
              Featured speaker (displayed prominently)
            </label>
          </div>

          {/* Sponsor Association */}
          {eventSponsors.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Associated Sponsor (Optional)
              </label>
              <select
                value={speakerForm.event_sponsor_id}
                onChange={(e) => setSpeakerForm({ ...speakerForm, event_sponsor_id: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              >
                <option value="">No sponsor association</option>
                {eventSponsors.map((es) => (
                  <option key={es.id} value={es.id}>
                    {es.sponsor?.name || 'Unknown Sponsor'} {es.sponsorship_tier ? `(${es.sponsorship_tier})` : ''}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Link this speaker to an event sponsor if they are representing that sponsor
              </p>
            </div>
          )}
        </div>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmModal
        isOpen={!!deletingTalk}
        onClose={() => setDeletingTalk(null)}
        onConfirm={handleDeleteTalk}
        title="Remove Talk Submission"
        message={`Are you sure you want to remove "${deletingTalk?.title || 'this talk'}" by ${deletingTalk ? getSpeakerDisplayName(deletingTalk) : 'this speaker'}? This will remove the talk submission and any agenda entries, but the speaker's member profile will be preserved.`}
        confirmText="Remove"
        confirmVariant="error"
      />

      {/* Talk Submission Details Modal */}
      <Modal
        isOpen={!!viewingTalk}
        onClose={() => setViewingTalk(null)}
        title="Talk Submission"
        size="lg"
        footer={
          <div className="flex flex-col gap-3 p-4">
            {/* Status-specific action buttons */}
            {viewingTalk && (
              <div className="flex items-center gap-2">
                {/* Pending: Approve, Reserve, Reject */}
                {viewingTalk.status === 'pending' && (
                  <>
                    <button
                      onClick={() => {
                        handleApproveTalk(viewingTalk);
                        setViewingTalk(null);
                      }}
                      className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded-md bg-primary-600 text-white hover:bg-primary-700 transition-colors"
                      title="Approve talk"
                    >
                      <CheckIcon className="w-4 h-4 sm:mr-1" />
                      <span className="hidden sm:inline">Approve</span>
                    </button>
                    <button
                      onClick={() => {
                        handleReserveTalk(viewingTalk);
                        setViewingTalk(null);
                      }}
                      className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 transition-colors"
                      title="Add to reserve list"
                    >
                      <ClipboardDocumentListIconOutline className="w-4 h-4 sm:mr-1" />
                      <span className="hidden sm:inline">Reserve</span>
                    </button>
                    <button
                      onClick={() => {
                        handleRejectTalk(viewingTalk);
                        setViewingTalk(null);
                      }}
                      className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                      title="Reject talk"
                    >
                      <XMarkIcon className="w-4 h-4 sm:mr-1" />
                      <span className="hidden sm:inline">Reject</span>
                    </button>
                  </>
                )}
                {/* Approved: Confirm, Reject */}
                {viewingTalk.status === 'approved' && (
                  <>
                    <button
                      onClick={() => {
                        handleConfirmTalk(viewingTalk);
                        setViewingTalk(null);
                      }}
                      className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded-md bg-green-600 text-white hover:bg-green-700 transition-colors"
                      title="Confirm talk"
                    >
                      <CheckIcon className="w-4 h-4 sm:mr-1" />
                      <span className="hidden sm:inline">Confirm</span>
                    </button>
                    <button
                      onClick={() => {
                        handleRejectTalk(viewingTalk);
                        setViewingTalk(null);
                      }}
                      className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                      title="Reject talk"
                    >
                      <XMarkIcon className="w-4 h-4 sm:mr-1" />
                      <span className="hidden sm:inline">Reject</span>
                    </button>
                  </>
                )}
                {/* Confirmed: Reserve, Reject */}
                {viewingTalk.status === 'confirmed' && (
                  <>
                    <button
                      onClick={() => {
                        handleReserveTalk(viewingTalk);
                        setViewingTalk(null);
                      }}
                      className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 transition-colors"
                      title="Move to reserve list"
                    >
                      <ClipboardDocumentListIconOutline className="w-4 h-4 sm:mr-1" />
                      <span className="hidden sm:inline">Reserve</span>
                    </button>
                    <button
                      onClick={() => {
                        handleRejectTalk(viewingTalk);
                        setViewingTalk(null);
                      }}
                      className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                      title="Reject talk"
                    >
                      <XMarkIcon className="w-4 h-4 sm:mr-1" />
                      <span className="hidden sm:inline">Reject</span>
                    </button>
                  </>
                )}
                {/* Reserve: Approve, Reject */}
                {viewingTalk.status === 'reserve' && (
                  <>
                    <button
                      onClick={() => {
                        handleApproveTalk(viewingTalk);
                        setViewingTalk(null);
                      }}
                      className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded-md bg-primary-600 text-white hover:bg-primary-700 transition-colors"
                      title="Approve talk"
                    >
                      <CheckIcon className="w-4 h-4 sm:mr-1" />
                      <span className="hidden sm:inline">Approve</span>
                    </button>
                    <button
                      onClick={() => {
                        handleRejectTalk(viewingTalk);
                        setViewingTalk(null);
                      }}
                      className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                      title="Reject talk"
                    >
                      <XMarkIcon className="w-4 h-4 sm:mr-1" />
                      <span className="hidden sm:inline">Reject</span>
                    </button>
                  </>
                )}
                {/* Rejected: Approve */}
                {viewingTalk.status === 'rejected' && (
                  <button
                    onClick={() => {
                      handleApproveTalk(viewingTalk);
                      setViewingTalk(null);
                    }}
                    className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded-md bg-primary-600 text-white hover:bg-primary-700 transition-colors"
                    title="Approve talk"
                  >
                    <CheckIcon className="w-4 h-4 sm:mr-1" />
                    <span className="hidden sm:inline">Approve</span>
                  </button>
                )}
                {/* Icon buttons on the right */}
                <div className="flex items-center gap-1 ml-auto">
                  {(() => {
                    const detailSpeaker = viewingTalk.speakers?.find(s => s.is_primary) || viewingTalk.speakers?.[0];
                    return detailSpeaker?.email ? (
                      <button
                        onClick={() => {
                          if (viewingTalk) {
                            setEmailingTalk(viewingTalk);
                            setViewingTalk(null);
                          }
                        }}
                        className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                        title="Email speaker"
                      >
                        <EnvelopeIcon className="w-4 h-4" />
                      </button>
                    ) : null;
                  })()}
                  <button
                    onClick={() => {
                      if (viewingTalk) {
                        handleEditTalk(viewingTalk);
                        setViewingTalk(null);
                      }
                    }}
                    className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                    title="Edit speaker"
                  >
                    <PencilIcon className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => {
                      if (viewingTalk) {
                        setDeletingTalk(viewingTalk);
                        setViewingTalk(null);
                      }
                    }}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                    title="Delete talk submission"
                  >
                    <TrashIcon className="w-4 h-4" />
                  </button>
                  {/* View Profile button - needs customer_id which is not available on the talk view
                  TODO: Add customer_id to event_talks_with_speakers view or use member_profile_id lookup */}
                </div>
              </div>
            )}
          </div>
        }
      >
        {viewingTalk && (() => {
          const primarySpeaker = getPrimarySpeaker(viewingTalk);
          return (
          <div className="space-y-6">
            {/* Speaker Header */}
            <div className="flex items-start gap-4">
              {primarySpeaker?.avatar_url ? (
                <img
                  src={primarySpeaker.avatar_url}
                  alt={primarySpeaker.full_name || 'Speaker'}
                  className="w-24 h-24 rounded-full object-cover"
                />
              ) : (
                <div className="w-24 h-24 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                  <UserIcon className="w-12 h-12 text-gray-400" />
                </div>
              )}
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
                    {primarySpeaker?.full_name || primarySpeaker?.email || 'Unknown Speaker'}
                  </h3>
                  {viewingTalk.is_featured && (
                    <StarIconSolid className="w-5 h-5 text-yellow-500" title="Featured speaker" />
                  )}
                </div>
                {primarySpeaker?.speaker_title && (
                  <p className="text-sm text-primary-600 dark:text-primary-400 font-medium mt-1">
                    {primarySpeaker.speaker_title}
                  </p>
                )}
                {primarySpeaker?.job_title && (
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    {primarySpeaker.job_title}
                  </p>
                )}
                {primarySpeaker?.company && (
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {primarySpeaker.company}
                  </p>
                )}
                {primarySpeaker?.email && (
                  <p className="text-sm text-gray-500 dark:text-gray-500 mt-2">
                    {primarySpeaker.email}
                  </p>
                )}
                {viewingTalk.sponsor_name && (
                  <div className="flex items-center gap-1 mt-2">
                    <BuildingOfficeIcon className="w-4 h-4 text-purple-500" />
                    <span className="text-sm text-purple-600 dark:text-purple-400">
                      Sponsor: {viewingTalk.sponsor_name}
                    </span>
                  </div>
                )}
                {/* Status Badge */}
                <div className="mt-3">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    viewingTalk.status === 'confirmed' ? 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200' :
                    viewingTalk.status === 'approved' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200' :
                    viewingTalk.status === 'pending' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200' :
                    viewingTalk.status === 'reserve' ? 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200' :
                    'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200'
                  }`}>
                    {viewingTalk.status === 'confirmed' && <CheckCircleIcon className="w-3.5 h-3.5 mr-1" />}
                    {viewingTalk.status === 'approved' && <CheckIcon className="w-3.5 h-3.5 mr-1" />}
                    {viewingTalk.status === 'pending' && <ClockIcon className="w-3.5 h-3.5 mr-1" />}
                    {viewingTalk.status === 'reserve' && <ClipboardDocumentListIcon className="w-3.5 h-3.5 mr-1" />}
                    {viewingTalk.status === 'rejected' && <XCircleIcon className="w-3.5 h-3.5 mr-1" />}
                    {viewingTalk.status.charAt(0).toUpperCase() + viewingTalk.status.slice(1)}
                  </span>
                </div>
              </div>
            </div>

            {/* Talk Information */}
            {(viewingTalk.title || viewingTalk.synopsis) && (
              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                  <svg className="w-5 h-5 text-primary-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5m.75-9l3-3 2.148 2.148A12.061 12.061 0 0116.5 7.605" />
                  </svg>
                  Talk Details
                </h4>
                {viewingTalk.title && (
                  <div className="mb-3">
                    <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Title</p>
                    <p className="text-base font-medium text-gray-900 dark:text-white">
                      {viewingTalk.title}
                    </p>
                  </div>
                )}
                {viewingTalk.synopsis && (
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Synopsis</p>
                    <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                      {viewingTalk.synopsis}
                    </p>
                  </div>
                )}
                {viewingTalk.duration_minutes && (
                  <div className="mt-3">
                    <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Duration</p>
                    <p className="text-sm text-gray-700 dark:text-gray-300">
                      {viewingTalk.duration_minutes} minutes
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Speaker Bio */}
            {primarySpeaker?.speaker_bio && (
              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                  <UserIcon className="w-5 h-5 text-primary-500" />
                  Speaker Bio
                </h4>
                <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                  {primarySpeaker.speaker_bio}
                </p>
              </div>
            )}

            {/* Tracking Link Stats (for confirmed/approved speakers) */}
            {(viewingTalk.status === 'confirmed' || viewingTalk.status === 'approved') && primarySpeaker?.speaker_id && speakerLinks[primarySpeaker.speaker_id] && (
              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                  <ChartBarIcon className="w-5 h-5 text-primary-500" />
                  Tracking Link Performance
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                    <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                      {speakerLinks[primarySpeaker.speaker_id].humanClicks}
                    </p>
                    <p className="text-xs text-blue-600/70 dark:text-blue-400/70">Link Clicks</p>
                  </div>
                  <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                    <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                      {speakerLinks[primarySpeaker.speaker_id].registrationCount}
                    </p>
                    <p className="text-xs text-green-600/70 dark:text-green-400/70">Registrations</p>
                  </div>
                </div>
              </div>
            )}

            {/* Submission Timestamp */}
            {viewingTalk.submitted_at && (
              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Submitted: {new Date(viewingTalk.submitted_at).toLocaleString()}
                </p>
              </div>
            )}
          </div>
          );
        })()}
      </Modal>

      {/* Edit Speaker Details Modal */}
      <Modal
        isOpen={showEditSpeakerModal}
        onClose={handleCloseEditSpeakerModal}
        title="Edit Speaker Details"
        size="lg"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={handleCloseEditSpeakerModal}>
              Cancel
            </Button>
            <Button onClick={handleSaveSpeakerDetails} disabled={savingSpeakerDetails}>
              {savingSpeakerDetails ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        }
      >
        {editingSpeaker && (
          <div className="space-y-4">
            {/* Speaker info header */}
            <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
              {editingSpeaker.avatarUrl ? (
                <img
                  src={editingSpeaker.avatarUrl}
                  alt={editingSpeaker.speakerName}
                  className="w-12 h-12 rounded-full object-cover"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                  <UserIcon className="w-6 h-6 text-gray-400" />
                </div>
              )}
              <div>
                <p className="font-medium text-gray-900 dark:text-white">{editingSpeaker.speakerName}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">{editingSpeaker.email}</p>
              </div>
            </div>

            {/* Name fields */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  First Name
                </label>
                <Input
                  value={speakerDetailsForm.first_name}
                  onChange={(e) => setSpeakerDetailsForm({ ...speakerDetailsForm, first_name: e.target.value })}
                  placeholder="First name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Last Name
                </label>
                <Input
                  value={speakerDetailsForm.last_name}
                  onChange={(e) => setSpeakerDetailsForm({ ...speakerDetailsForm, last_name: e.target.value })}
                  placeholder="Last name"
                />
              </div>
            </div>

            {/* Job title and company */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Job Title
                </label>
                <Input
                  value={speakerDetailsForm.job_title}
                  onChange={(e) => setSpeakerDetailsForm({ ...speakerDetailsForm, job_title: e.target.value })}
                  placeholder="e.g. Senior Engineer"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Company
                </label>
                <Input
                  value={speakerDetailsForm.company}
                  onChange={(e) => setSpeakerDetailsForm({ ...speakerDetailsForm, company: e.target.value })}
                  placeholder="e.g. Acme Inc"
                />
              </div>
            </div>

            {/* LinkedIn URL */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                LinkedIn Profile URL
              </label>
              <Input
                value={speakerDetailsForm.linkedin_url}
                onChange={(e) => setSpeakerDetailsForm({ ...speakerDetailsForm, linkedin_url: e.target.value })}
                placeholder="https://linkedin.com/in/username"
              />
            </div>

            {/* Company Logo */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Company Logo
              </label>
              <div className="flex items-center gap-4">
                {companyLogoPreview ? (
                  <div className="relative">
                    <img
                      src={companyLogoPreview}
                      alt="Company logo"
                      className="w-20 h-20 object-contain border border-gray-200 dark:border-gray-700 rounded-lg"
                    />
                    <button
                      type="button"
                      onClick={handleRemoveCompanyLogo}
                      className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600"
                    >
                      <XMarkIcon className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="w-20 h-20 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg flex items-center justify-center">
                    <BuildingOfficeIcon className="w-8 h-8 text-gray-400" />
                  </div>
                )}
                <div>
                  <input
                    ref={companyLogoInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleCompanyLogoChange}
                    className="hidden"
                    id="company-logo-upload"
                  />
                  <Button
                    variant="secondary"
                    onClick={() => companyLogoInputRef.current?.click()}
                    className="text-sm"
                  >
                    <PhotoIcon className="w-4 h-4 mr-2" />
                    {companyLogoPreview ? 'Change Logo' : 'Upload Logo'}
                  </Button>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    PNG, JPG up to 2MB
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Email Speaker Modal */}
      {emailingTalk && (
        <SendSpeakerEmailModal
          isOpen={!!emailingTalk}
          onClose={() => setEmailingTalk(null)}
          talk={emailingTalk}
          eventId={eventId}
          eventTitle={eventTitle}
        />
      )}
    </div>
  );
}
