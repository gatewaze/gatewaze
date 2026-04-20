import { useState, useEffect, useCallback, useRef, Fragment, Suspense, lazy, useMemo, type ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router';
import ReactApexChart from 'react-apexcharts';
import { ApexOptions } from 'apexcharts';
import {
  PencilIcon,
  TrashIcon,
  CalendarIcon,
  MapPinIcon,
  ClockIcon,
  GlobeAltIcon,
  TagIcon,
  CodeBracketIcon,
  PhotoIcon,
  ArrowLeftIcon,
  CheckIcon,
  XMarkIcon,
  PlusIcon,
  UsersIcon,
  UserGroupIcon,
  BuildingOfficeIcon,
  QrCodeIcon,
  MagnifyingGlassIcon,
  EyeIcon,
  ArrowDownTrayIcon,
  EnvelopeIcon,
  BellIcon,
  Cog6ToothIcon,
  SwatchIcon,
  StarIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  MicrophoneIcon,
  ClipboardDocumentCheckIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'sonner';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';

import {
  Button,
  Card,
  Input,
  Select,
  Badge,
  ConfirmModal,
  ImageUpload,
  Modal,
  Tabs,
  Table,
  THead,
  TBody,
  Tr,
  Th,
  Td,
} from '@/components/ui';
import { RowActions } from '@/components/shared/table/RowActions';
import { ScrollableTable } from '@/components/shared/table/ScrollableTable';
import { DataTable } from '@/components/shared/table/DataTable';
import { Page } from '@/components/shared/Page';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { TopicSelector } from '@/components/shared/TopicSelector';
import { TimezoneSelector } from '@/components/events/TimezoneSelector';
import { EventService, ScreenshotManagementService, Event } from '@/utils/eventService';
import { EventQrService, EventRegistration, EventAttendance } from '@/utils/eventQrService';
import { useAuthContext } from '@/app/contexts/auth/context';
import { ModuleSlot } from '@/components/ModuleSlot';
import { getBrandId } from '@/utils/brandUtils';
import { AddPersonModal } from '@/components/events/AddPersonModal';
import { BulkRegistrationUpload } from '@/components/events/BulkRegistrationUpload';
import { BulkAttendanceUpload } from '@/components/events/BulkAttendanceUpload';
import { EventImageUpload } from '@/components/events/EventImageUpload';
import { AccountService } from '@/utils/accountService';
import { supabase, Account } from '@/lib/supabase';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { QRCodeService } from '@/utils/qrCodeService';
import { analyzeGradientColors } from '@/utils/colorUtils';
import { RichTextEditor } from '@/components/ui/RichTextEditor';
import { RegistrationFieldMappings } from '@/components/events/RegistrationFieldMappings';
import { useEventTypes } from '@/hooks/useEventTypes';
import { useContentCategories } from '@/hooks/useContentCategories';
import { useModuleSlots, type ResolvedSlot } from '@/hooks/useModuleSlots';
import { useModulesContext } from '@/app/contexts/modules/context';
import { resolveHeroIcon } from '@/utils/heroIconResolver';

const ITEMS_PER_PAGE = 25;

// Form validation schema
const eventSchema = yup.object({
  eventTitle: yup.string().required('Event title is required').min(3, 'Title must be at least 3 characters'),
  eventCity: yup.string().required(),
  eventCountryCode: yup.string().required().max(5, 'Country code must be 5 characters or less'),
  eventLink: yup.string().url('Must be a valid URL').optional().nullable(),
  eventStart: yup.string().optional(),
  eventEnd: yup.string().optional(),
  rsvpDeadline: yup.string().optional().nullable(),
  eventTimezone: yup.string().optional(),
  eventType: yup.string().optional(),
  contentCategory: yup.string().optional(),
  eventRegion: yup.string().optional(),
  eventDescription: yup.string().optional(),
  listingIntro: yup.string().optional(),
  eventTopics: yup.array().of(yup.string().required()).optional(),
  isLiveInProduction: yup.boolean().optional(),
  enableRegistration: yup.boolean().optional(),
  enableNativeRegistration: yup.boolean().optional(),
  walkinsAllowed: yup.boolean().optional(),
  enableCallForSpeakers: yup.boolean().optional(),
  enableAgenda: yup.boolean().optional(),
  registerButtonText: yup.string().optional().nullable(),
  pageContent: yup.string().optional().nullable(),
  venueContent: yup.string().optional().nullable(),
  venueMapImage: yup.string().optional().nullable(),
  addedpageContent: yup.string().optional().nullable(),
  addedpageTitle: yup.string().optional().nullable(),
  lumaEventId: yup.string().optional().nullable(),
  customDomain: yup.string().optional().nullable()
    .test('valid-domain', 'Must be a valid domain (e.g., myconference.com)', function(value) {
      if (!value || value.trim() === '') return true;
      return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(value.toLowerCase());
    }),
  sourceEventId: yup.string().optional().nullable(),
  eventLogo: yup.string().optional().test('valid-url-or-path', 'Must be a valid URL or path', function(value) {
    if (!value || value.trim() === '') return true;
    if (value.startsWith('/')) return true;
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  }),
  badgeLogo: yup.string().optional().test('valid-url-or-path', 'Must be a valid URL or path', function(value) {
    if (!value || value.trim() === '') return true;
    if (value.startsWith('/')) return true;
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  }),
  eventSlug: yup.string().optional().nullable().test('valid-slug', 'Slug must be lowercase letters, numbers, and hyphens only', function(value) {
    if (!value || value.trim() === '') return true;
    return /^[a-z0-9-]+$/.test(value);
  }),
  eventLocation: yup.string().optional(),
  venueAddress: yup.string().optional(),
  eventLatitude: yup.number().optional().nullable(),
  eventLongitude: yup.number().optional().nullable(),
  eventSource: yup.string().optional(),
  eventFeaturedImage: yup.string().optional().nullable().test('valid-url-or-empty', 'Must be a valid URL', function(value) {
    if (!value || value.trim() === '') return true;
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  }),
  screenshotUrl: yup.string().optional().nullable().test('valid-url-or-empty', 'Must be a valid URL', function(value) {
    if (!value || value.trim() === '') return true;
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  }),
  accountId: yup.string().optional().nullable(),
  recommendedEventId: yup.string().optional().nullable(),
  gradientColor1: yup.string().optional().nullable().test('valid-hex', 'Must be a valid hex color', function(value) {
    if (!value || value.trim() === '') return true;
    return /^#[0-9A-Fa-f]{6}$/.test(value);
  }),
  gradientColor2: yup.string().optional().nullable().test('valid-hex', 'Must be a valid hex color', function(value) {
    if (!value || value.trim() === '') return true;
    return /^#[0-9A-Fa-f]{6}$/.test(value);
  }),
  gradientColor3: yup.string().optional().nullable().test('valid-hex', 'Must be a valid hex color', function(value) {
    if (!value || value.trim() === '') return true;
    return /^#[0-9A-Fa-f]{6}$/.test(value);
  }),
});

type EventFormData = yup.InferType<typeof eventSchema>;

const EventDetailPage = () => {
  const { eventId, tab } = useParams<{ eventId: string; tab?: string }>();
  const navigate = useNavigate();
  const { adminProfile, isAdmin } = useAuthContext();
  const { eventTypes } = useEventTypes();
  const { contentCategories } = useContentCategories();
  const moduleTabSlots = useModuleSlots('event-detail:tab');

  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEditMode, setIsEditMode] = useState(false);
  const [isSaving, setSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isGeneratingQr, setIsGeneratingQr] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [allEvents, setAllEvents] = useState<Event[]>([]);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);

  // Build tab list dynamically from core tabs + module slots.
  // Memoised so the Radix Tabs component keeps a stable trigger collection
  // and doesn't drop click events during unrelated parent re-renders.
  const allTabs = useMemo(() => {
    const ic = "size-4";
    const core = [
      { id: 'settings', label: 'Settings', icon: <Cog6ToothIcon className={ic} />, order: 0 },
      { id: 'registrations', label: 'Registrations', icon: <ClipboardDocumentCheckIcon className={ic} />, order: 70 },
      { id: 'attendance', label: 'Attendance', icon: <UsersIcon className={ic} />, order: 80 },
    ];
    const moduleTabs = moduleTabSlots.map(s => {
      const Icon = resolveHeroIcon(s.registration.meta?.icon as string);
      return {
        id: s.registration.meta?.tabId as string,
        label: s.registration.meta?.label as string,
        icon: <Icon className={ic} />,
        order: s.registration.order ?? 100,
      };
    });
    return [...core, ...moduleTabs].sort((a, b) => a.order - b.order);
  }, [moduleTabSlots]);

  // Derive active tab from URL, default to 'settings'
  const validTabIds = allTabs.map(t => t.id);
  type TabType = string;
  const activeTab: TabType = (tab && validTabIds.includes(tab)) ? tab : 'settings';

  // Stable callback so the Tabs onChange prop doesn't change on every render
  const navigateToTab = useCallback((newTab: string) => {
    navigate(`/events/${eventId}/${newTab}`);
  }, [navigate, eventId]);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<EventFormData>({
    resolver: yupResolver(eventSchema) as any,
  });

  // Load accounts and all events for selectors
  useEffect(() => {
    loadAccounts();
    loadAllEvents();
  }, []);

  // Load event data
  useEffect(() => {
    if (!eventId) {
      toast.error('No event ID provided');
      navigate('/events');
      return;
    }

    loadEvent();
  }, [eventId]);

  // Generate QR code when event loads
  useEffect(() => {
    if (event?.checkinQrCode) {
      QRCodeService.generateEventQRCode(event.checkinQrCode, { size: 200 })
        .then(setQrCodeDataUrl)
        .catch(error => {
          console.error('Error generating QR code:', error);
          setQrCodeDataUrl(null);
        });
    } else {
      setQrCodeDataUrl(null);
    }
  }, [event?.checkinQrCode]);

  const loadAccounts = async () => {
    try {
      const { accounts: accountsData, error } = await AccountService.getActiveAccounts();
      if (error) {
        console.error('Error loading accounts:', error);
        return;
      }
      setAccounts(accountsData || []);
    } catch (error) {
      console.error('Error loading accounts:', error);
    }
  };

  const loadAllEvents = async () => {
    try {
      const result = await EventService.getAllEvents();
      if (result.success && result.data) {
        setAllEvents(result.data);
      }
    } catch (error) {
      console.error('Error loading events for selector:', error);
    }
  };

  const loadEvent = async () => {
    if (!eventId) return;

    setLoading(true);
    try {
      const response = await EventService.getEventById(eventId);
      if (!response.success || !response.data) {
        toast.error(response.error || 'Event not found');
        navigate('/events');
        return;
      }
      setEvent(response.data);
      populateForm(response.data);
    } catch (error) {
      console.error('Error loading event:', error);
      toast.error('Failed to load event');
      navigate('/events');
    } finally {
      setLoading(false);
    }
  };

  // Helper to convert ISO/UTC date to datetime-local format (YYYY-MM-DDTHH:mm)
  // Displays the time in the event's timezone so the admin edits in local event time
  const toDatetimeLocal = (isoString: string | null | undefined, timezone?: string | null): string => {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      const tz = timezone || 'UTC';
      // Use Intl to get the date parts in the target timezone
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(date);
      const get = (type: string) => parts.find(p => p.type === type)?.value || '00';
      return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
    } catch {
      return '';
    }
  };

  // Reverse of toDatetimeLocal: convert datetime-local string (in event timezone) back to ISO UTC
  const fromDatetimeLocal = (localString: string | null | undefined, timezone?: string | null): string | null => {
    if (!localString) return null;
    try {
      const tz = timezone || 'UTC';
      // Parse the datetime-local components
      const [datePart, timePart] = localString.split('T');
      if (!datePart || !timePart) return null;
      const [year, month, day] = datePart.split('-').map(Number);
      const [hours, minutes] = timePart.split(':').map(Number);

      // Create a date in UTC and then adjust for the timezone offset
      // First, get the offset of the target timezone at roughly this date
      const roughDate = new Date(Date.UTC(year, month - 1, day, hours, minutes));
      const utcStr = roughDate.toLocaleString('en-US', { timeZone: 'UTC' });
      const tzStr = roughDate.toLocaleString('en-US', { timeZone: tz });
      const utcMs = new Date(utcStr).getTime();
      const tzMs = new Date(tzStr).getTime();
      const offsetMs = tzMs - utcMs;

      // Subtract offset: if timezone is UTC-8, tzMs is 8h behind, so offset is negative,
      // and we need to add 8h to get UTC
      const utcDate = new Date(roughDate.getTime() - offsetMs);
      if (isNaN(utcDate.getTime())) return null;
      return utcDate.toISOString();
    } catch {
      return null;
    }
  };

  const populateForm = (eventData: Event) => {
    // Use reset instead of setValue to properly update all form values at once
    reset({
      eventTitle: eventData.eventTitle || '',
      eventCity: eventData.eventCity || '',
      eventCountryCode: eventData.eventCountryCode || '',
      eventLink: eventData.eventLink || '',
      eventStart: toDatetimeLocal(eventData.eventStart, eventData.eventTimezone),
      eventEnd: toDatetimeLocal(eventData.eventEnd, eventData.eventTimezone),
      rsvpDeadline: toDatetimeLocal((eventData as Event & { rsvpDeadline?: string | null }).rsvpDeadline ?? null, eventData.eventTimezone),
      eventTimezone: eventData.eventTimezone || 'UTC',
      eventType: eventData.eventType || '',
      contentCategory: eventData.contentCategory || '',
      eventRegion: eventData.eventRegion || '',
      eventDescription: eventData.eventDescription || '',
      listingIntro: eventData.listingIntro || '',
      eventTopics: eventData.eventTopics || [],
      isLiveInProduction: true,
      enableRegistration: eventData.enableRegistration !== undefined ? eventData.enableRegistration : true,
      enableNativeRegistration: eventData.enableNativeRegistration || false,
      walkinsAllowed: eventData.walkinsAllowed !== undefined ? eventData.walkinsAllowed : false,
      enableCallForSpeakers: eventData.enableCallForSpeakers || false,
      enableAgenda: eventData.enableAgenda || false,
      registerButtonText: eventData.registerButtonText || '',
      pageContent: eventData.pageContent || '',
      venueContent: eventData.venueContent || '',
      venueMapImage: eventData.venueMapImage || '',
      addedpageContent: eventData.addedpageContent || '',
      addedpageTitle: eventData.addedpageTitle || '',
      lumaEventId: eventData.lumaEventId || '',
      customDomain: eventData.customDomain || '',
      sourceEventId: eventData.sourceEventId || '',
      eventLogo: eventData.eventLogo || '',
      badgeLogo: eventData.badgeLogo || '',
      eventSlug: eventData.eventSlug || '',
      eventLocation: eventData.eventLocation || '',
      venueAddress: eventData.venueAddress || '',
      eventLatitude: eventData.eventLatitude || null,
      eventLongitude: eventData.eventLongitude || null,
      eventSource: eventData.eventSource || '',
      eventFeaturedImage: eventData.eventFeaturedImage || '',
      screenshotUrl: eventData.screenshotUrl || '',
      accountId: eventData.accountId || null,
      recommendedEventId: eventData.recommendedEventId || null,
      gradientColor1: eventData.gradientColor1 || '',
      gradientColor2: eventData.gradientColor2 || '',
      gradientColor3: eventData.gradientColor3 || '',
    });
  };

  const handleEditToggle = () => {
    if (isEditMode && event) {
      // Cancel - revert to original data
      populateForm(event);
    }
    setIsEditMode(!isEditMode);
  };

  const onSubmit = async (data: EventFormData) => {
    if (!event || !eventId) return;

    setSaving(true);
    try {
      const updates: Partial<Event> = ({
        eventTitle: data.eventTitle,
        eventCity: data.eventCity,
        eventCountryCode: data.eventCountryCode,
        eventLink: data.eventLink,
        eventStart: fromDatetimeLocal(data.eventStart, data.eventTimezone),
        eventEnd: fromDatetimeLocal(data.eventEnd, data.eventTimezone),
        rsvpDeadline: data.rsvpDeadline ? fromDatetimeLocal(data.rsvpDeadline, data.eventTimezone) : null,
        eventTimezone: data.eventTimezone || 'UTC',
        eventType: data.eventType || null,
        contentCategory: data.contentCategory || null,
        eventRegion: data.eventRegion || null,
        eventDescription: data.eventDescription || null,
        listingIntro: data.listingIntro || null,
        eventTopics: data.eventTopics || [],
        isLiveInProduction: true,
        enableRegistration: data.enableRegistration !== undefined ? data.enableRegistration : true,
        enableNativeRegistration: data.enableNativeRegistration || false,
        walkinsAllowed: data.walkinsAllowed !== undefined ? data.walkinsAllowed : false,
        enableCallForSpeakers: data.enableCallForSpeakers || false,
        enableAgenda: data.enableAgenda || false,
        registerButtonText: data.registerButtonText || null,
        pageContent: data.pageContent || null,
        venueContent: data.venueContent || null,
        venueMapImage: data.venueMapImage || null,
        addedpageContent: data.addedpageContent || null,
        addedpageTitle: data.addedpageTitle || null,
        lumaEventId: data.lumaEventId || null,
        customDomain: data.customDomain || null,
        customDomainStatus: (data.customDomain || null) !== (event?.customDomain || null) ? 'pending' : undefined,
        sourceEventId: data.sourceEventId || null,
        eventLogo: data.eventLogo || null,
        badgeLogo: data.badgeLogo || null,
        eventSlug: data.eventSlug || null,
        eventLocation: data.eventLocation || null,
        venueAddress: data.venueAddress || null,
        eventLatitude: data.eventLatitude || null,
        eventLongitude: data.eventLongitude || null,
        eventSource: data.eventSource || null,
        eventFeaturedImage: data.eventFeaturedImage || null,
        // Only update screenshotUrl if the value changed from the original
        // This prevents wiping existing screenshots when the form field wasn't touched
        ...(data.screenshotUrl !== (event.screenshotUrl || '') ? { screenshotUrl: data.screenshotUrl || null } : {}),
        accountId: data.accountId || null,
        recommendedEventId: data.recommendedEventId || null,
        gradientColor1: data.gradientColor1 || null,
        gradientColor2: data.gradientColor2 || null,
        gradientColor3: data.gradientColor3 || null,
      }) as Partial<Event>;

      // Use event.id (UUID) instead of eventId (event_id string)
      // Pass original event so geocoding only triggers when city/country actually changes
      const result = await EventService.updateEvent(event.id!, updates, event);
      if (!result.success) {
        throw new Error(result.error || 'Failed to update event');
      }
      toast.success('Event updated successfully');
      setIsEditMode(false);
      await loadEvent(); // Reload to get fresh data
    } catch (error: any) {
      console.error('Error updating event:', error);
      toast.error(error?.message || 'Failed to update event');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!eventId) return;

    setIsDeleting(true);
    try {
      await EventService.deleteEvent(eventId);
      toast.success('Event deleted successfully');
      navigate('/events');
    } catch (error) {
      console.error('Error deleting event:', error);
      toast.error('Failed to delete event');
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleTalkDurationOptionsChange = async (options: Array<{ duration: number; capacity: number }>) => {
    if (!event?.id) return;

    try {
      await EventService.updateEvent(event.id, { talkDurationOptions: options });
      // Update local state
      setEvent(prev => prev ? { ...prev, talkDurationOptions: options } : prev);
    } catch (error) {
      console.error('Error updating talk duration options:', error);
      toast.error('Failed to update talk duration options');
    }
  };

  const handleGenerateQrCode = async () => {
    if (!eventId) return;

    setIsGeneratingQr(true);
    try {
      const response = await ScreenshotManagementService.generateCheckinQrCode(eventId!);
      if (response.success && response.data) {
        toast.success('Check-in QR code generated successfully');
        await loadEvent(); // Reload to show the new QR code
      } else {
        toast.error(response.error || 'Failed to generate QR code');
      }
    } catch (error) {
      console.error('Error generating QR code:', error);
      toast.error('Failed to generate QR code');
    } finally {
      setIsGeneratingQr(false);
    }
  };

  if (loading) {
    return (
      <Page>
        <div className="flex flex-col items-center justify-center h-80 gap-4">
          <div className="relative">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-100 to-primary-200 dark:from-primary-900/40 dark:to-primary-800/40 flex items-center justify-center">
              <CalendarIcon className="w-8 h-8 text-primary-600 dark:text-primary-400 animate-pulse" />
            </div>
            <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-primary-500 flex items-center justify-center">
              <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
            </div>
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-[var(--gray-12)]">Loading event details</p>
            <p className="text-xs text-[var(--gray-a11)] mt-1">Please wait...</p>
          </div>
        </div>
      </Page>
    );
  }

  if (!event) {
    return (
      <Page>
        <div className="flex flex-col items-center justify-center h-80 gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-700 flex items-center justify-center">
            <CalendarIcon className="w-8 h-8 text-[var(--gray-a9)]" />
          </div>
          <div className="text-center">
            <h3 className="text-lg font-semibold text-[var(--gray-12)] mb-2">Event not found</h3>
            <p className="text-[var(--gray-a11)] max-w-md mb-4">
              The event you're looking for doesn't exist or may have been deleted.
            </p>
            <Button onClick={() => navigate('/events')} color="cyan" className="gap-2">
              <ArrowLeftIcon className="size-4" />
              Back to Events
            </Button>
          </div>
        </div>
      </Page>
    );
  }

  return (
    <Page>
      {/* Hero Section - Enhanced with depth and polish */}
      <div className="relative h-52 md:h-60 lg:h-72 overflow-hidden bg-gray-900 -mx-(--margin-x) -mt-(--margin-x)">
        {/* Background Image with enhanced blur */}
        {event.screenshotUrl ? (
          <img
            src={getAbsoluteImageUrl(event.screenshotUrl)}
            alt=""
            className="absolute inset-0 w-full h-full object-cover object-center blur-[12px] scale-110 opacity-80"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-primary-600 via-primary-700 to-primary-900 dark:from-primary-700 dark:via-primary-800 dark:to-gray-900" />
        )}

        {/* Gradient Overlay - Enhanced for better depth */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-black/20" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/30 to-transparent" />

        {/* Decorative elements */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-bl from-primary-500/10 to-transparent rounded-full blur-3xl" />

        {/* Back Button - Enhanced with glass effect */}
        <div className="absolute top-6 z-10" style={{ left: 'calc(var(--margin-x) + 1.5rem)' }}>
          <button
            onClick={() => navigate('/events')}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md bg-white/90 backdrop-blur-md border border-white/40 text-gray-900 shadow-sm hover:bg-white transition-colors"
          >
            <ArrowLeftIcon className="size-4" />
            Back
          </button>
        </div>

        {/* Event Title and Info - Enhanced typography */}
        <div className="absolute bottom-0 left-0 right-0" style={{ padding: '0 calc(var(--margin-x) + 1.5rem) 1.75rem' }}>
          {/* Event type pill */}
          {event.eventType && (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white/10 backdrop-blur-sm rounded-lg text-xs font-medium text-white/80 mb-3">
              {event.eventType === 'conference' && <MicrophoneIcon className="size-3.5" />}
              {event.eventType === 'workshop' && <Cog6ToothIcon className="size-3.5" />}
              {event.eventType === 'meetup' && <UsersIcon className="size-3.5" />}
              {event.eventType === 'webinar' && <GlobeAltIcon className="size-3.5" />}
              {!['conference', 'workshop', 'meetup', 'webinar'].includes(event.eventType) && <CalendarIcon className="size-3.5" />}
              <span className="capitalize">{event.eventType}</span>
            </div>
          )}

          <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold text-white mb-3 drop-shadow-lg tracking-tight">
            {event.eventTitle}
          </h1>

          <div className="flex items-center gap-4 text-sm flex-wrap">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-white/10 backdrop-blur-sm rounded-lg text-white/90">
              <MapPinIcon className="w-4 h-4 text-white/70" />
              <span className="font-medium">{event.eventCity}, {event.eventCountryCode}</span>
            </div>
            {event.eventStart && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-white/10 backdrop-blur-sm rounded-lg text-white/90">
                <CalendarIcon className="w-4 h-4 text-white/70" />
                {event.eventTimezone && event.eventTimezone !== 'UTC' ? (
                  <span className="font-medium">
                    {new Date(event.eventStart).toLocaleString('en-US', {
                      timeZone: event.eventTimezone,
                      dateStyle: 'medium',
                      timeStyle: 'short'
                    })}
                    <span className="text-white/60 ml-1.5 text-xs">({event.eventTimezone})</span>
                  </span>
                ) : (
                  <span className="font-medium">{new Date(event.eventStart).toLocaleDateString()}</span>
                )}
              </div>
            )}
            {event.eventLink && (
              <a
                href={event.eventLink}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-2 px-3 py-1.5 bg-white/10 backdrop-blur-sm rounded-lg text-white/90 hover:bg-white/20 transition-colors"
              >
                <GlobeAltIcon className="w-4 h-4 text-white/70" />
                <span className="font-medium">Visit Website</span>
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Tab Navigation - Full-width directly under hero */}
      <div className="-mx-(--margin-x)">
        <Tabs
          fullWidth
          value={activeTab}
          onChange={navigateToTab}
          tabs={allTabs}
        />
      </div>

      <div className="p-6 space-y-6">

        {/* Tab Content */}
        {activeTab === 'settings' && (
          <div>
            {/* Settings Header - Enhanced with visual polish */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-700 rounded-xl">
                  <Cog6ToothIcon className="w-5 h-5 text-[var(--gray-a11)]" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-[var(--gray-12)] tracking-tight">
                    Event Settings
                  </h3>
                  <p className="text-sm text-[var(--gray-a11)]">
                    {isEditMode ? 'Edit your event details below' : 'Manage event configuration and details'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {isEditMode ? (
                  <>
                    <Button variant="soft" color="gray" onClick={handleEditToggle} disabled={isSaving}>
                      <XMarkIcon className="w-4 h-4" />
                      Cancel
                    </Button>
                    <Button variant="solid" onClick={handleSubmit(onSubmit as any, (validationErrors) => {
                        const firstError = Object.values(validationErrors)[0];
                        toast.error(firstError?.message || 'Please fix form errors before saving');
                      })} disabled={isSaving}>
                      {isSaving ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <CheckIcon className="w-4 h-4" />
                          Save Changes
                        </>
                      )}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="soft" color="red" onClick={() => setShowDeleteConfirm(true)}>
                      <TrashIcon className="w-4 h-4" />
                      Delete
                    </Button>
                    <Button variant="solid" onClick={handleEditToggle}>
                      <PencilIcon className="w-4 h-4" />
                      Edit Event
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Settings Content */}
            <EventDetailsTab
              event={event}
              isEditMode={isEditMode}
              register={register}
              errors={errors}
              watch={watch}
              setValue={setValue}
              onGenerateQrCode={handleGenerateQrCode}
              isGeneratingQr={isGeneratingQr}
              isSaving={isSaving}
              accounts={accounts}
              allEvents={allEvents}
              qrCodeDataUrl={qrCodeDataUrl}
              eventTypes={eventTypes}
              contentCategories={contentCategories}
            />
          </div>
        )}

        {activeTab === 'registrations' && (
          <div className="space-y-6">
            <RegistrationFieldMappings eventId={eventId!} />
            <EventRegistrationsTab eventId={eventId!} eventUuid={event?.id} />
          </div>
        )}

        {activeTab === 'attendance' && (
          <EventAttendanceTab eventId={eventId!} eventUuid={event?.id} />
        )}

        {/* Module-contributed tab content */}
        <ModuleTabContent
          slots={moduleTabSlots}
          activeTab={activeTab}
          props={{
            eventId: event.id || eventId!,
            eventUuid: event.id,
            event,
            eventTitle: event.eventTitle,
            eventStart: event.eventStart,
            eventEnd: event.eventEnd,
            eventLink: event.eventLink || '',
            talkDurationOptions: event.talkDurationOptions,
            onTalkDurationOptionsChange: handleTalkDurationOptionsChange,
            offerTicketDetails: event.offerTicketDetails,
          }}
        />

        {/* Delete Confirmation Modal */}
        <ConfirmModal
          isOpen={showDeleteConfirm}
          onClose={() => setShowDeleteConfirm(false)}
          onConfirm={handleDelete}
          title="Delete Event"
          message={`Are you sure you want to delete "${event.eventTitle}"? This action cannot be undone.`}
          confirmText="Delete"
          confirmVariant="danger"
          isProcessing={isDeleting}
        />
      </div>
    </Page>
  );
};

/**
 * Renders the active module tab's component via lazy loading.
 * Finds the module slot matching the active tab and suspense-loads it.
 */
const ModuleTabContent = ({ slots, activeTab, props }: {
  slots: ResolvedSlot[];
  activeTab: string;
  props: Record<string, unknown>;
}) => {
  const activeSlot = slots.find(s => s.registration.meta?.tabId === activeTab);

  // Cache lazy wrappers by registration so switching back to a previously
  // visited module tab reuses the same React component identity instead of
  // creating a new one (which would remount + re-trigger Suspense, causing
  // cascading re-renders that destabilise the Tabs trigger collection).
  const lazyCache = useRef(new WeakMap<object, React.LazyExoticComponent<React.ComponentType<any>>>());

  const LazyComponent = useMemo(() => {
    if (!activeSlot) return null;
    const key = activeSlot.registration;
    let cached = lazyCache.current.get(key);
    if (!cached) {
      cached = lazy(key.component as () => Promise<{ default: React.ComponentType<any> }>);
      lazyCache.current.set(key, cached);
    }
    return cached;
  }, [activeSlot]);

  if (!LazyComponent) return null;

  return (
    <Suspense fallback={<LoadingSpinner />}>
      <LazyComponent {...props} />
    </Suspense>
  );
};

// Helper function to convert relative URIs to absolute URLs
const getAbsoluteImageUrl = (url: string | undefined): string | undefined => {
  if (!url) return undefined;

  // If it's already an absolute URL, return as is
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }

  // If it's a relative path, prepend the base URL
  if (url.startsWith('/')) {
    const portalDomain = import.meta.env.VITE_PORTAL_DOMAIN || 'gatewaze.io';
    return `https://${portalDomain}${url}`;
  }

  return url;
};

// Scraped Data Section Component for displaying Luma/Meetup __NEXT_DATA__
const ScrapedDataSection = ({ title, data, colorClass }: { title: string; data: Record<string, any>; colorClass: string }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // Calculate approximate size of JSON data
  const jsonString = JSON.stringify(data, null, 2);
  const sizeKB = (new TextEncoder().encode(jsonString).length / 1024).toFixed(1);

  return (
    <div className="border border-[var(--gray-a6)] rounded-lg overflow-hidden">
      <Button variant="ghost" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 text-xs font-medium rounded ${colorClass}`}>
            {title}
          </span>
          <span className="text-xs text-[var(--gray-a11)]">
            {sizeKB} KB
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--gray-a11)]">
            {isExpanded ? 'Hide' : 'View'} Data
          </span>
          <svg
            className={`w-4 h-4 text-[var(--gray-a9)] transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </Button>
      {isExpanded && (
        <div className="border-t border-[var(--gray-a6)]">
          <pre className="p-4 text-xs font-mono text-[var(--gray-11)] bg-[var(--gray-a2)] overflow-x-auto max-h-96 overflow-y-auto">
            {jsonString}
          </pre>
        </div>
      )}
    </div>
  );
};

// Event Details Tab Component
const EventDetailsTab = ({ event, isEditMode, register, errors, watch, setValue, onGenerateQrCode, isGeneratingQr, isSaving, accounts, allEvents, qrCodeDataUrl, eventTypes, contentCategories }: any) => {
  const { isModuleEnabled } = useModulesContext();
  const hasTopicsModule = isModuleEnabled('event-topics');
  const hasSpeakersModule = isModuleEnabled('event-speakers');
  const hasAgendaModule = isModuleEnabled('event-agenda');
  // Use form value in edit mode, event value in view mode
  const [showLumaPreview, setShowLumaPreview] = useState(false);
  const [showMeetupPreview, setShowMeetupPreview] = useState(false);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Main Content */}
      <div className="lg:col-span-2 space-y-6">
        {/* Basic Information - Enhanced card styling */}
        <Card className="overflow-hidden border-0 shadow-sm hover:shadow-md transition-shadow duration-300">
          <div className="p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                <TagIcon className="w-5 h-5 text-[var(--blue-11)]" />
              </div>
              <h3 className="text-lg font-bold text-[var(--gray-12)]">
                Basic Information
              </h3>
            </div>
            <div className="space-y-4">
              {isEditMode ? (
                <Input
                  label="Event Title"
                  {...register('eventTitle')}
                  error={errors.eventTitle?.message}
                />
              ) : (
                <div>
                  <label className="block text-sm font-medium text-[var(--gray-11)] mb-1">
                    Event Title
                  </label>
                  <p className="text-[var(--gray-12)]">{event.eventTitle || 'N/A'}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                {isEditMode ? (
                  <Input
                    label="City"
                    {...register('eventCity')}
                    error={errors.eventCity?.message}
                  />
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-[var(--gray-11)] mb-1">
                      City
                    </label>
                    <p className="text-[var(--gray-12)]">{event.eventCity || 'N/A'}</p>
                  </div>
                )}

                {isEditMode ? (
                  <Input
                    label="Country Code"
                    {...register('eventCountryCode')}
                    error={errors.eventCountryCode?.message}
                    placeholder="US, UK, etc."
                  />
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-[var(--gray-11)] mb-1">
                      Country Code
                    </label>
                    <p className="text-[var(--gray-12)]">{event.eventCountryCode || 'N/A'}</p>
                  </div>
                )}
              </div>

              {isEditMode ? (
                <Input
                  label="Event URL"
                  type="url"
                  {...register('eventLink')}
                  error={errors.eventLink?.message}
                />
              ) : (
                <div>
                  <label className="block text-sm font-medium text-[var(--gray-11)] mb-1">
                    Event URL
                  </label>
                  {event.eventLink ? (
                    <a href={event.eventLink} target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 break-all">
                      {event.eventLink}
                    </a>
                  ) : (
                    <p className="text-[var(--gray-12)]">N/A</p>
                  )}
                </div>
              )}

              {isEditMode ? (
                <Input
                  label="Event Location"
                  {...register('eventLocation')}
                  error={errors.eventLocation?.message}
                  placeholder="Coordinates or location identifier"
                />
              ) : (
                <div>
                  <label className="block text-sm font-medium text-[var(--gray-11)] mb-1">
                    Event Location
                  </label>
                  <p className="text-[var(--gray-12)]">{event.eventLocation || 'N/A'}</p>
                </div>
              )}

              {isEditMode ? (
                <Input
                  label="Venue Address"
                  {...register('venueAddress')}
                  error={errors.venueAddress?.message}
                  placeholder="e.g. Computer History Museum, 1401 N Shoreline Blvd"
                />
              ) : (
                <div>
                  <label className="block text-sm font-medium text-[var(--gray-11)] mb-1">
                    Venue Address
                  </label>
                  <p className="text-[var(--gray-12)]">{event.venueAddress || 'N/A'}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                {isEditMode ? (
                  <Select
                    label="Event Type"
                    {...register('eventType')}
                    error={errors.eventType?.message}
                  >
                    <option value="">Select type</option>
                    {eventTypes.map((t: any) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </Select>
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-[var(--gray-11)] mb-1">
                      Event Type
                    </label>
                    <p className="text-[var(--gray-12)] capitalize">{event.eventType || 'N/A'}</p>
                  </div>
                )}
                {contentCategories.length > 0 && (
                  isEditMode ? (
                    <Select
                      label="Content Category"
                      {...register('contentCategory')}
                    >
                      <option value="">No category</option>
                      {contentCategories.map((c: any) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </Select>
                  ) : (
                    <div>
                      <label className="block text-sm font-medium text-[var(--gray-11)] mb-1">
                        Content Category
                      </label>
                      <p className="text-[var(--gray-12)] capitalize">{event.contentCategory || 'N/A'}</p>
                    </div>
                  )
                )}
              </div>

              {hasTopicsModule && isEditMode && (
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-[var(--gray-11)]">
                    Event Topics
                  </label>
                  <TopicSelector
                    {...{ value: watch('eventTopics') || [], onChange: (topics: any) => setValue('eventTopics', topics) } as any}
                  />
                </div>
              )}

              {hasTopicsModule && !isEditMode && (
                <div>
                  <label className="block text-sm font-medium text-[var(--gray-11)] mb-2">
                    Event Topics
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {event.eventTopics && event.eventTopics.length > 0 ? (
                      event.eventTopics.map((topic: string) => (
                        <Badge key={topic} variant="soft">{topic}</Badge>
                      ))
                    ) : (
                      <span className="text-sm text-[var(--gray-a11)]">No topics assigned</span>
                    )}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-[var(--gray-11)] mb-2">
                  Event Description
                </label>
                {isEditMode ? (
                  <textarea
                    {...register('eventDescription')}
                    rows={4}
                    className="w-full px-3 py-2 border border-[var(--gray-a6)] rounded-md bg-[var(--color-background)] text-[var(--gray-12)]"
                    placeholder="General event description (used in calendar invites, event details, etc.)"
                  />
                ) : (
                  <p className="text-sm text-[var(--gray-a11)]">
                    {event.eventDescription || 'No description provided'}
                  </p>
                )}
              </div>
            </div>
          </div>
        </Card>

        {/* Dates & Time - Enhanced card styling */}
        <Card className="overflow-hidden border-0 shadow-sm hover:shadow-md transition-shadow duration-300">
          <div className="p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                <ClockIcon className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              </div>
              <h3 className="text-lg font-bold text-[var(--gray-12)]">
                Dates & Time
              </h3>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
  {isEditMode ? (
                  <Input
                    label={`Start Date (${watch('eventTimezone') || 'UTC'})`}
                    type="datetime-local"
                    {...register('eventStart')}
                    error={errors.eventStart?.message}
                  />
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-[var(--gray-11)] mb-1">
                      Start Date
                    </label>
                    <div className="space-y-1">
                      <p className="text-[var(--gray-12)] font-mono text-sm">
                        {event.eventStart ? new Date(event.eventStart).toISOString().replace('T', ' ').replace('.000Z', ' UTC') : 'N/A'}
                      </p>
                      {event.eventStart && event.eventTimezone && event.eventTimezone !== 'UTC' && (
                        <p className="text-sm text-[var(--gray-a11)]">
                          Local: {new Date(event.eventStart).toLocaleString('en-US', {
                            timeZone: event.eventTimezone,
                            dateStyle: 'medium',
                            timeStyle: 'short'
                          })} ({event.eventTimezone})
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {isEditMode ? (
                  <Input
                    label={`End Date (${watch('eventTimezone') || 'UTC'})`}
                    type="datetime-local"
                    {...register('eventEnd')}
                    error={errors.eventEnd?.message}
                  />
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-[var(--gray-11)] mb-1">
                      End Date
                    </label>
                    <div className="space-y-1">
                      <p className="text-[var(--gray-12)] font-mono text-sm">
                        {event.eventEnd ? new Date(event.eventEnd).toISOString().replace('T', ' ').replace('.000Z', ' UTC') : 'N/A'}
                      </p>
                      {event.eventEnd && event.eventTimezone && event.eventTimezone !== 'UTC' && (
                        <p className="text-sm text-[var(--gray-a11)]">
                          Local: {new Date(event.eventEnd).toLocaleString('en-US', {
                            timeZone: event.eventTimezone,
                            dateStyle: 'medium',
                            timeStyle: 'short'
                          })} ({event.eventTimezone})
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* RSVP Deadline — cutoff after which open-RSVP submissions
                  are rejected. Leave blank to accept responses indefinitely.
                  Per-sub-event deadlines live on invite_sub_events. */}
              {isEditMode ? (
                <div>
                  <Input
                    label={`RSVP Deadline (${watch('eventTimezone') || 'UTC'})`}
                    type="datetime-local"
                    {...register('rsvpDeadline')}
                    error={(errors as { rsvpDeadline?: { message?: string } }).rsvpDeadline?.message}
                  />
                  <p className="text-xs text-[var(--gray-a11)] mt-1">
                    Optional. After this time, new open-RSVP submissions are blocked and the page shows &quot;RSVP closed&quot;. Leave blank to keep accepting responses.
                  </p>
                </div>
              ) : (
                (event as Event & { rsvpDeadline?: string | null }).rsvpDeadline && (
                  <div>
                    <label className="block text-sm font-medium text-[var(--gray-11)] mb-1">
                      RSVP Deadline
                    </label>
                    <div className="space-y-1">
                      <p className="text-[var(--gray-12)] font-mono text-sm">
                        {new Date((event as Event & { rsvpDeadline?: string | null }).rsvpDeadline!).toISOString().replace('T', ' ').replace('.000Z', ' UTC')}
                      </p>
                      {event.eventTimezone && event.eventTimezone !== 'UTC' && (
                        <p className="text-sm text-[var(--gray-a11)]">
                          Local: {new Date((event as Event & { rsvpDeadline?: string | null }).rsvpDeadline!).toLocaleString('en-US', {
                            timeZone: event.eventTimezone,
                            dateStyle: 'medium',
                            timeStyle: 'short'
                          })} ({event.eventTimezone})
                        </p>
                      )}
                    </div>
                  </div>
                )
              )}

{isEditMode ? (
                <div>
                  <label className="block text-sm font-medium text-[var(--gray-11)] mb-2">
                    Event Location Timezone
                  </label>
                  <TimezoneSelector
                    value={watch('eventTimezone')}
                    onChange={(value) => setValue('eventTimezone', value)}
                    error={errors.eventTimezone?.message}
                  />
                  <p className="text-xs text-[var(--gray-a11)] mt-1">
                    Times above are shown in this timezone. They are converted to UTC for storage.
                  </p>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-[var(--gray-11)] mb-1">
                    Event Location Timezone
                  </label>
                  <div className="flex items-center gap-2">
                    <GlobeAltIcon className="w-4 h-4 text-[var(--gray-a9)]" />
                    <p className="text-[var(--gray-12)] font-medium">{event.eventTimezone || 'UTC'}</p>
                  </div>
                  <p className="text-xs text-[var(--gray-a11)] mt-1">
                    This is the timezone where the event takes place. All times are stored in UTC in the database.
                  </p>
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* Page Content - Rich Text Editor */}
        <Card className="overflow-hidden border-0 shadow-sm hover:shadow-md transition-shadow duration-300">
          <div className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <h3 className="text-lg font-bold text-[var(--gray-12)]">
                Page Content
              </h3>
              <span className="text-xs text-[var(--gray-a11)]">
                (overrides imported content)
              </span>
            </div>
            {isEditMode ? (
              <RichTextEditor
                content={watch('pageContent') || ''}
                onChange={(content: string) => setValue('pageContent', content, { shouldDirty: true })}
                placeholder="Write custom event page content... (overrides Luma/Meetup imported content)"
              />
            ) : (
              <div>
                {event.pageContent ? (
                  <div
                    className="prose prose-sm max-w-none dark:prose-invert"
                    dangerouslySetInnerHTML={{ __html: event.pageContent }}
                  />
                ) : (
                  <p className="text-sm text-[var(--gray-a11)] italic">
                    No custom page content. Event will display imported content or description.
                  </p>
                )}
              </div>
            )}
          </div>
        </Card>

        {/* Venue Details - Rich Text Editor + Map Image */}
        <Card className="overflow-hidden border-0 shadow-sm hover:shadow-md transition-shadow duration-300">
          <div className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-green-50 dark:bg-green-900/20 rounded-lg">
                <MapPinIcon className="w-5 h-5 text-[var(--green-11)]" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-[var(--gray-12)]">
                  Venue Details
                </h3>
                <span className="text-xs text-[var(--gray-a11)]">
                  Parking, transport, directions — shown on venue page
                </span>
              </div>
            </div>
            {isEditMode ? (
              <>
                <RichTextEditor
                  content={watch('venueContent') || ''}
                  onChange={(content: string) => setValue('venueContent', content, { shouldDirty: true })}
                  placeholder="Write venue details (parking, transport, accessibility info)..."
                />
                <div className="mt-4">
                  <label className="block text-sm font-medium text-[var(--gray-11)] mb-2">
                    Indoor Venue Map / Floor Plan
                  </label>
                  <EventImageUpload
                    value={watch('venueMapImage') || undefined}
                    onChange={(url) => setValue('venueMapImage', url || '', { shouldDirty: true })}
                    eventId={event.eventId}
                    type="logo"
                    label="Upload floor plan image"
                  />
                </div>
              </>
            ) : (
              <div>
                {event.venueContent ? (
                  <div
                    className="prose prose-sm max-w-none dark:prose-invert"
                    dangerouslySetInnerHTML={{ __html: event.venueContent }}
                  />
                ) : (
                  <p className="text-sm text-[var(--gray-a11)] italic">
                    No venue details configured.
                  </p>
                )}
                {event.venueMapImage && (
                  <div className="mt-4">
                    <p className="text-sm font-medium text-[var(--gray-11)] mb-2">Floor Plan</p>
                    <img src={event.venueMapImage} alt="Venue map" className="max-w-full rounded-lg border border-[var(--gray-a6)]" />
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>

        {/* Added Page Content - Rich Text Editor */}
        <Card className="overflow-hidden border-0 shadow-sm hover:shadow-md transition-shadow duration-300">
          <div className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                <CodeBracketIcon className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-[var(--gray-12)]">
                  Added Page
                </h3>
                <span className="text-xs text-[var(--gray-a11)]">
                  Extra page content — shown as a separate page in the event portal sidebar
                </span>
              </div>
            </div>
            {isEditMode ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--gray-11)] mb-1">
                    Page Title
                  </label>
                  <input
                    type="text"
                    {...register('addedpageTitle')}
                    placeholder="Workshops"
                    className="w-full px-3 py-2 border border-[var(--gray-a6)] rounded-lg text-sm bg-[var(--color-background)] text-[var(--gray-12)] focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                  <p className="mt-1 text-xs text-[var(--gray-a11)]">
                    This title appears in the sidebar menu. Defaults to &quot;Workshops&quot; if left empty.
                  </p>
                </div>
                <RichTextEditor
                  content={watch('addedpageContent') || ''}
                  onChange={(content: string) => setValue('addedpageContent', content, { shouldDirty: true })}
                  placeholder="Write page content, links, and details..."
                />
              </div>
            ) : (
              <div>
                {event.addedpageTitle && (
                  <p className="text-sm font-medium text-[var(--gray-11)] mb-2">
                    Title: {event.addedpageTitle}
                  </p>
                )}
                {event.addedpageContent ? (
                  <div
                    className="prose prose-sm max-w-none dark:prose-invert"
                    dangerouslySetInnerHTML={{ __html: event.addedpageContent }}
                  />
                ) : (
                  <p className="text-sm text-[var(--gray-a11)] italic">
                    No added page content configured.
                  </p>
                )}
              </div>
            )}
          </div>
        </Card>

        {/* Imported Content Preview */}
        {(event.lumaProcessedHtml || event.meetupProcessedHtml) && (
          <Card className="overflow-hidden border-0 shadow-sm">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <EyeIcon className="w-5 h-5 text-[var(--gray-a11)]" />
                <h3 className="text-lg font-bold text-[var(--gray-12)]">
                  Imported Content Preview
                </h3>
              </div>
              <div className="flex gap-3">
                {event.lumaProcessedHtml && (
                  <Button
                    variant="outline"
                    size="1"
                    onClick={() => setShowLumaPreview(true)}
                  >
                    <EyeIcon className="w-4 h-4 mr-2" />
                    View Luma Content
                  </Button>
                )}
                {event.meetupProcessedHtml && (
                  <Button
                    variant="outline"
                    size="1"
                    onClick={() => setShowMeetupPreview(true)}
                  >
                    <EyeIcon className="w-4 h-4 mr-2" />
                    View Meetup Content
                  </Button>
                )}
              </div>
            </div>
          </Card>
        )}

        {/* Luma Content Preview Modal */}
        <Modal
          isOpen={showLumaPreview}
          onClose={() => setShowLumaPreview(false)}
          title="Luma Content Preview"
        >
          <div className="bg-gray-900 rounded-lg p-6 max-h-[70vh] overflow-y-auto">
            <div
              className="prose prose-lg max-w-none prose-invert
                [&_p]:mb-5 [&_p]:leading-[1.8] [&_p]:text-[1.0625rem]
                [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:mb-6 [&_h1]:mt-10 [&_h1]:first:mt-0
                [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:mb-5 [&_h2]:mt-10 [&_h2]:first:mt-0
                [&_h3]:text-xl [&_h3]:font-semibold [&_h3]:mb-4 [&_h3]:mt-8 [&_h3]:first:mt-0
                [&_img]:my-8 [&_img]:max-w-full [&_img]:rounded-2xl [&_img]:mx-auto
                [&_a]:text-blue-300 [&_a]:underline
                [&_ul]:list-disc [&_ul]:ml-6 [&_ul]:mb-5 [&_ul]:space-y-2
                [&_ol]:list-decimal [&_ol]:ml-6 [&_ol]:mb-5 [&_ol]:space-y-2
                [&_blockquote]:border-l-4 [&_blockquote]:border-white/30 [&_blockquote]:pl-6 [&_blockquote]:py-4 [&_blockquote]:my-8
              "
              dangerouslySetInnerHTML={{ __html: event.lumaProcessedHtml || '' }}
            />
          </div>
        </Modal>

        {/* Meetup Content Preview Modal */}
        <Modal
          isOpen={showMeetupPreview}
          onClose={() => setShowMeetupPreview(false)}
          title="Meetup Content Preview"
        >
          <div className="bg-gray-900 rounded-lg p-6 max-h-[70vh] overflow-y-auto">
            <div
              className="prose prose-lg max-w-none prose-invert
                [&_p]:mb-5 [&_p]:leading-[1.8] [&_p]:text-[1.0625rem]
                [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:mb-6 [&_h1]:mt-10 [&_h1]:first:mt-0
                [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:mb-5 [&_h2]:mt-10 [&_h2]:first:mt-0
                [&_h3]:text-xl [&_h3]:font-semibold [&_h3]:mb-4 [&_h3]:mt-8 [&_h3]:first:mt-0
                [&_img]:my-8 [&_img]:max-w-full [&_img]:rounded-2xl [&_img]:mx-auto
                [&_a]:text-blue-300 [&_a]:underline
                [&_ul]:list-disc [&_ul]:ml-6 [&_ul]:mb-5 [&_ul]:space-y-2
                [&_ol]:list-decimal [&_ol]:ml-6 [&_ol]:mb-5 [&_ol]:space-y-2
                [&_blockquote]:border-l-4 [&_blockquote]:border-white/30 [&_blockquote]:pl-6 [&_blockquote]:py-4 [&_blockquote]:my-8
              "
              dangerouslySetInnerHTML={{ __html: event.meetupProcessedHtml || '' }}
            />
          </div>
        </Modal>

        {/* Discount-specific fields */}
      </div>

      {/* Sidebar */}
      <div className="space-y-6">
        {/* Status - Enhanced with visual indicators */}
        <Card className="overflow-hidden border-0 shadow-sm">
          <div className="p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="p-2 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-lg">
                <CheckIcon className="w-5 h-5 text-[var(--green-11)]" />
              </div>
              <h3 className="text-lg font-bold text-[var(--gray-12)]">
                Status
              </h3>
            </div>
            <div className="space-y-3">
              {isEditMode ? (
                <>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      {...register('enableRegistration')}
                      className="rounded border-[var(--gray-a6)] text-primary-600 focus:ring-[var(--accent-8)]"
                    />
                    <span className="text-sm text-[var(--gray-11)]">
                      Enable Registration
                    </span>
                  </label>
                  {watch('enableRegistration') && (
                    <label className="flex items-center gap-2 ml-6">
                      <input
                        type="checkbox"
                        {...register('enableNativeRegistration')}
                        className="rounded border-[var(--gray-a6)] text-primary-600 focus:ring-[var(--accent-8)]"
                      />
                      <span className="text-sm text-[var(--gray-11)]">
                        Register on Event Portal
                      </span>
                      <span className="text-xs text-[var(--gray-a11)]">
                        (instead of external link)
                      </span>
                    </label>
                  )}
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      {...register('walkinsAllowed')}
                      className="rounded border-[var(--gray-a6)] text-primary-600 focus:ring-[var(--accent-8)]"
                    />
                    <span className="text-sm text-[var(--gray-11)]">
                      Walk-ins Allowed
                    </span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      {...register('enableCallForSpeakers')}
                      className="rounded border-[var(--gray-a6)] text-primary-600 focus:ring-[var(--accent-8)]"
                    />
                    <span className="text-sm text-[var(--gray-11)]">
                      Enable Call for Speakers
                    </span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      {...register('enableAgenda')}
                      className="rounded border-[var(--gray-a6)] text-primary-600 focus:ring-[var(--accent-8)]"
                    />
                    <span className="text-sm text-[var(--gray-11)]">
                      Enable Agenda
                    </span>
                  </label>
                  {watch('enableRegistration') && (
                    <div className="pt-2">
                      <label className="block text-sm font-medium text-[var(--gray-11)] mb-1">
                        Register Button Text
                      </label>
                      <input
                        type="text"
                        {...register('registerButtonText')}
                        placeholder="Register Now"
                        className="block w-full rounded-md border-[var(--gray-a6)] bg-[var(--color-background)] text-[var(--gray-12)] shadow-sm focus:border-[var(--accent-8)] focus:ring-[var(--accent-8)] sm:text-sm"
                      />
                      <p className="mt-1 text-xs text-[var(--gray-a11)]">
                        Custom text for register buttons (default: "Register Now")
                      </p>
                    </div>
                  )}
                  <div className="pt-2">
                    <label className="block text-sm font-medium text-[var(--gray-11)] mb-1">
                      Luma Event ID
                    </label>
                    <input
                      type="text"
                      {...register('lumaEventId')}
                      placeholder="evt-XXXXX"
                      className="block w-full rounded-md border-[var(--gray-a6)] bg-[var(--color-background)] text-[var(--gray-12)] shadow-sm focus:border-[var(--accent-8)] focus:ring-[var(--accent-8)] sm:text-sm"
                    />
                    <p className="mt-1 text-xs text-[var(--gray-a11)]">
                      Link this event to a Luma event for CSV imports and email notifications
                    </p>
                  </div>
                  <div className="pt-2">
                    <label className="block text-sm font-medium text-[var(--gray-11)] mb-1">
                      Source Event ID
                    </label>
                    <input
                      type="text"
                      {...register('sourceEventId')}
                      placeholder="e.g., eguzf-gg"
                      className="block w-full rounded-md border-[var(--gray-a6)] bg-[var(--color-background)] text-[var(--gray-12)] shadow-sm focus:border-[var(--accent-8)] focus:ring-[var(--accent-8)] sm:text-sm"
                    />
                    <p className="mt-1 text-xs text-[var(--gray-a11)]">
                      Native ID from external source (e.g., dev.events). Used for tracking across URL changes.
                    </p>
                  </div>
                  <div className="pt-4 border-t border-[var(--gray-a6)] mt-4">
                    <label className="block text-sm font-medium text-[var(--gray-11)] mb-1">
                      Custom Domain
                    </label>
                    <input
                      type="text"
                      {...register('customDomain')}
                      placeholder="e.g., myconference.com"
                      className="block w-full rounded-md border-[var(--gray-a6)] bg-[var(--color-background)] text-[var(--gray-12)] shadow-sm focus:border-[var(--accent-8)] focus:ring-[var(--accent-8)] sm:text-sm"
                    />
                    {errors.customDomain && (
                      <p className="mt-1 text-xs text-[var(--red-11)]">{errors.customDomain.message}</p>
                    )}
                    <p className="mt-1 text-xs text-[var(--gray-a11)]">
                      Set up a custom domain for a white-label event website. Enter the bare hostname (no https://).
                    </p>
                    {event?.customDomain && (
                      <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                        <p className="text-xs font-medium text-blue-800 dark:text-blue-300 mb-1">DNS Configuration</p>
                        <p className="text-xs text-blue-700 dark:text-blue-400">
                          Add a CNAME record pointing to:
                        </p>
                        <code className="text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300 px-2 py-0.5 rounded mt-1 inline-block">
                          custom.gatewaze.io
                        </code>
                        {event.customDomainStatus && (
                          <div className="mt-2">
                            <Badge variant="soft" color={event.customDomainStatus === 'active' ? 'green' : event.customDomainStatus === 'error' ? 'red' : 'yellow'}>
                              {event.customDomainStatus}
                            </Badge>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-[var(--gray-a11)]">Registration</span>
                    <Badge variant="soft" color={event.enableRegistration ? 'green' : 'gray'}>
                      {event.enableRegistration ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </div>
                  {event.enableRegistration && (
                    <div className="flex items-center justify-between ml-4">
                      <span className="text-sm text-[var(--gray-a11)]">Registration Location</span>
                      <Badge variant="soft" color={event.enableNativeRegistration ? 'green' : 'gray'}>
                        {event.enableNativeRegistration ? 'Event Portal' : 'External Link'}
                      </Badge>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-[var(--gray-a11)]">Walk-ins</span>
                    <Badge variant="soft" color={event.walkinsAllowed ? 'green' : 'gray'}>
                      {event.walkinsAllowed ? 'Allowed' : 'Not Allowed'}
                    </Badge>
                  </div>
                  {hasSpeakersModule && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-[var(--gray-a11)]">Call for Speakers</span>
                    <Badge variant="soft" color={event.enableCallForSpeakers ? 'green' : 'gray'}>
                      {event.enableCallForSpeakers ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </div>
                  )}
                  {hasAgendaModule && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-[var(--gray-a11)]">Agenda</span>
                    <Badge variant="soft" color={event.enableAgenda ? 'green' : 'gray'}>
                      {event.enableAgenda ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </div>
                  )}
                  {event.lumaEventId && (
                    <div className="flex items-center justify-between pt-2 border-t border-[var(--gray-a6)]">
                      <span className="text-sm text-[var(--gray-a11)]">Luma Event ID</span>
                      <code className="text-sm font-mono text-[var(--gray-12)] bg-[var(--gray-a3)] px-2 py-0.5 rounded">
                        {event.lumaEventId}
                      </code>
                    </div>
                  )}
                  {event.sourceEventId && (
                    <div className="flex items-center justify-between pt-2 border-t border-[var(--gray-a6)]">
                      <span className="text-sm text-[var(--gray-a11)]">Source Event ID</span>
                      <code className="text-sm font-mono text-[var(--gray-12)] bg-[var(--gray-a3)] px-2 py-0.5 rounded">
                        {event.sourceEventId}
                      </code>
                    </div>
                  )}
                  {event.customDomain && (
                    <div className="pt-2 border-t border-[var(--gray-a6)]">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-[var(--gray-a11)]">Custom Domain</span>
                        <div className="flex items-center gap-2">
                          <code className="text-sm font-mono text-[var(--gray-12)] bg-[var(--gray-a3)] px-2 py-0.5 rounded">
                            {event.customDomain}
                          </code>
                          {event.customDomainStatus && (
                            <Badge variant="soft" color={event.customDomainStatus === 'active' ? 'green' : event.customDomainStatus === 'error' ? 'red' : 'yellow'}>
                              {event.customDomainStatus}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

            </div>
          </div>
        </Card>

        {/* Account Association - Enhanced styling */}
        <Card className="overflow-hidden border-0 shadow-sm">
          <div className="p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="p-2 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-lg">
                <BuildingOfficeIcon className="w-5 h-5 text-[var(--blue-11)]" />
              </div>
              <h3 className="text-lg font-bold text-[var(--gray-12)]">
                Account
              </h3>
            </div>
            <div className="space-y-3">
              {isEditMode ? (
                <Select
                  label="Associated Account"
                  {...register('accountId')}
                  error={errors.accountId?.message}
                  disabled={isSaving}
                >
                  <option value="">None</option>
                  {accounts.map((account: Account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-[var(--gray-11)] mb-1">
                    Associated Account
                  </label>
                  <p className="text-[var(--gray-12)]">
                    {event.accountId ? (
                      accounts.find((a: Account) => a.id === event.accountId)?.name || event.accountId
                    ) : (
                      'None'
                    )}
                  </p>
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* Recommended Event */}
        <Card className="overflow-hidden border-0 shadow-sm">
          <div className="p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="p-2 bg-gradient-to-br from-amber-50 to-yellow-50 dark:from-amber-900/20 dark:to-yellow-900/20 rounded-lg">
                <StarIcon className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <h3 className="text-lg font-bold text-[var(--gray-12)]">
                Recommended Event
              </h3>
            </div>
            <div className="space-y-3">
              {isEditMode ? (
                <Select
                  label="Recommended Event"
                  {...register('recommendedEventId')}
                  error={errors.recommendedEventId?.message}
                  disabled={isSaving}
                >
                  <option value="">None</option>
                  {allEvents
                    .filter((e: Event) => e.id !== event.id && e.eventStart && new Date(e.eventStart) > new Date())
                    .sort((a: Event, b: Event) => new Date(a.eventStart || '').getTime() - new Date(b.eventStart || '').getTime())
                    .map((e: Event) => (
                      <option key={e.id} value={e.id}>
                        {e.eventStart ? `${new Date(e.eventStart).toLocaleDateString()} - ` : ''}{e.eventTitle}{e.eventCity ? ` (${e.eventCity})` : ''}
                      </option>
                    ))}
                </Select>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-[var(--gray-11)] mb-1">
                    Recommended Event
                  </label>
                  <p className="text-[var(--gray-12)]">
                    {event.recommendedEventId ? (
                      allEvents.find((e: Event) => e.id === event.recommendedEventId)?.eventTitle || event.recommendedEventId
                    ) : (
                      'None'
                    )}
                  </p>
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* Scraped Page Data - Show Luma and Meetup __NEXT_DATA__ */}
        {(event.lumaPageData || event.meetupPageData) && !isEditMode && (
          <Card className="overflow-hidden border-0 shadow-sm">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-5">
                <div className="p-2 bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-900/20 dark:to-teal-900/20 rounded-lg">
                  <CodeBracketIcon className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <h3 className="text-lg font-bold text-[var(--gray-12)]">
                  Scraped Page Data
                </h3>
              </div>
              <div className="space-y-4">
                {event.lumaPageData && (
                  <ScrapedDataSection
                    title="Luma Page Data"
                    data={event.lumaPageData}
                    colorClass="text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20"
                  />
                )}
                {event.meetupPageData && (
                  <ScrapedDataSection
                    title="Meetup Page Data"
                    data={event.meetupPageData}
                    colorClass="text-[var(--red-11)] bg-red-50 dark:bg-red-900/20"
                  />
                )}
              </div>
            </div>
          </Card>
        )}

        {/* Event Check-In QR Code - Enhanced styling */}
        {event.enableRegistration && (
          <Card className="overflow-hidden border-0 shadow-sm">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-5">
                <div className="p-2 bg-gradient-to-br from-violet-50 to-purple-50 dark:from-violet-900/20 dark:to-purple-900/20 rounded-lg">
                  <QrCodeIcon className="w-5 h-5 text-violet-600 dark:text-violet-400" />
                </div>
                <h3 className="text-lg font-bold text-[var(--gray-12)]">
                  Check-In QR Code
                </h3>
              </div>
              {event.checkinQrCode ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-center bg-white p-4 rounded-lg border border-[var(--gray-a6)]">
                    {qrCodeDataUrl ? (
                      <img
                        src={qrCodeDataUrl}
                        alt="Event Check-in QR Code"
                        className="w-48 h-48"
                      />
                    ) : (
                      <div className="w-48 h-48 flex items-center justify-center">
                        <div className="text-[var(--gray-a9)]">Loading QR Code...</div>
                      </div>
                    )}
                  </div>
                  <div className="text-center">
                    <p className="text-xs font-mono text-[var(--gray-a11)] mb-2">
                      {event.checkinQrCode}
                    </p>
                    <p className="text-xs text-[var(--gray-a11)]">
                      Display this QR code at the event venue for attendee check-in
                    </p>
                  </div>
                  <div className="pt-2">
                    <Button variant="solid" onClick={() => QRCodeService.downloadQRCode(event.checkinQrCode!, `${event.eventId}-checkin-qr`, 1000)}>
                      Download High-Res QR Code
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-center h-48 bg-[var(--gray-a3)] rounded-lg border-2 border-dashed border-[var(--gray-a6)]">
                    <div className="text-center">
                      <QrCodeIcon className="w-12 h-12 mx-auto mb-2 text-[var(--gray-a9)]" />
                      <p className="text-sm text-[var(--gray-a11)]">
                        No check-in QR code generated yet
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="solid"
                    onClick={onGenerateQrCode}
                    disabled={isGeneratingQr}
                    className="w-full"
                  >
                    {isGeneratingQr ? (
                      <>Generating...</>
                    ) : (
                      <>
                        <QrCodeIcon className="w-4 h-4 mr-2" />
                        Generate Check-In QR Code
                      </>
                    )}
                  </Button>
                  <p className="text-xs text-[var(--gray-a11)] text-center">
                    Generate a unique QR code for event attendees to scan and check in
                  </p>
                </div>
              )}
            </div>
          </Card>
        )}

        {/* Images - Enhanced styling */}
        <Card className="overflow-hidden border-0 shadow-sm">
          <div className="p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="p-2 bg-gradient-to-br from-cyan-50 to-sky-50 dark:from-cyan-900/20 dark:to-sky-900/20 rounded-lg">
                <PhotoIcon className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
              </div>
              <h3 className="text-lg font-bold text-[var(--gray-12)]">
                Images
              </h3>
            </div>
            <div className="space-y-4">
              <div>
                {isEditMode ? (
                  <EventImageUpload
                    value={watch('eventLogo') || ''}
                    onChange={(url) => setValue('eventLogo', url || '')}
                    eventId={event?.eventId || ''}
                    type="logo"
                    label="Event Logo"
                    placeholder="Upload logo or enter URL"
                    maxSizeInMB={5}
                    error={errors.eventLogo?.message}
                    disabled={isSaving}
                  />
                ) : (
                  <>
                    <label className="block text-sm font-medium text-[var(--gray-11)] mb-2">
                      Event Logo
                    </label>
                    {event.eventLogo ? (
                      <div className="bg-black rounded-lg border border-[var(--gray-a6)] p-4">
                        <img
                          src={getAbsoluteImageUrl(event.eventLogo)}
                          alt="Event logo"
                          className="w-full h-auto"
                        />
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-32 bg-[var(--gray-a3)] rounded-lg border border-[var(--gray-a6)]">
                        <PhotoIcon className="w-8 h-8 text-[var(--gray-a9)]" />
                      </div>
                    )}
                  </>
                )}
              </div>

              <div>
                {isEditMode ? (
                  <EventImageUpload
                    value={watch('badgeLogo') || ''}
                    onChange={(url) => setValue('badgeLogo', url || '')}
                    eventId={event?.eventId || ''}
                    type="badge"
                    label="Badge Logo"
                    placeholder="Upload badge or enter URL"
                    maxSizeInMB={5}
                    error={errors.badgeLogo?.message}
                    disabled={isSaving}
                  />
                ) : (
                  <>
                    <label className="block text-sm font-medium text-[var(--gray-11)] mb-2">
                      Badge Logo
                    </label>
                    {event.badgeLogo ? (
                      <div className="bg-[var(--color-background)] rounded-lg border border-[var(--gray-a6)] p-4">
                        <img
                          src={getAbsoluteImageUrl(event.badgeLogo)}
                          alt="Badge logo"
                          className="w-full h-auto max-h-32 object-contain"
                        />
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-32 bg-[var(--gray-a3)] rounded-lg border border-[var(--gray-a6)]">
                        <PhotoIcon className="w-8 h-8 text-[var(--gray-a9)]" />
                      </div>
                    )}
                  </>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--gray-11)] mb-2">
                  Screenshot
                  <span className="ml-2 text-xs text-[var(--gray-a11)] font-normal">(Auto-generated or upload custom)</span>
                </label>
                {isEditMode ? (
                  <EventImageUpload
                    value={watch('screenshotUrl') || ''}
                    onChange={(url) => setValue('screenshotUrl', url || '')}
                    eventId={event.eventId}
                    type="screenshot"
                    placeholder="Upload screenshot or enter URL"
                    maxSizeInMB={10}
                    error={errors.screenshotUrl?.message}
                  />
                ) : (
                  event.screenshotUrl ? (
                    <img
                      src={getAbsoluteImageUrl(event.screenshotUrl)}
                      alt="Event screenshot"
                      className="w-full h-auto rounded-lg border border-[var(--gray-a6)]"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-32 bg-[var(--gray-a3)] rounded-lg border border-[var(--gray-a6)]">
                      <PhotoIcon className="w-8 h-8 text-[var(--gray-a9)]" />
                      <span className="ml-2 text-sm text-[var(--gray-a11)]">No screenshot</span>
                    </div>
                  )
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--gray-11)] mb-2">
                  Featured Image
                  <span className="ml-2 text-xs text-[var(--gray-a11)] font-normal">(Used for social sharing & blog posts)</span>
                </label>
                {isEditMode ? (
                  <Input
                    {...register('eventFeaturedImage')}
                    error={errors.eventFeaturedImage?.message}
                    placeholder="Featured image URL"
                  />
                ) : (
                  event.eventFeaturedImage ? (
                    <img
                      src={getAbsoluteImageUrl(event.eventFeaturedImage)}
                      alt="Featured"
                      className="w-full h-auto rounded-lg border border-[var(--gray-a6)]"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-32 bg-[var(--gray-a3)] rounded-lg border border-[var(--gray-a6)]">
                      <PhotoIcon className="w-8 h-8 text-[var(--gray-a9)]" />
                    </div>
                  )
                )}
              </div>
            </div>
          </div>
        </Card>

        {/* Appearance - Gradient Colors */}
        <Card className="overflow-hidden border-0 shadow-sm">
          <div className="p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="p-2 bg-gradient-to-br from-pink-50 to-purple-50 dark:from-pink-900/20 dark:to-purple-900/20 rounded-lg">
                <SwatchIcon className="w-5 h-5 text-pink-600 dark:text-pink-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-[var(--gray-12)]">
                  Appearance
                </h3>
                <p className="text-xs text-[var(--gray-a11)]">
                  Customize the event portal gradient background
                </p>
              </div>
            </div>
            <div className="space-y-4">
              <p className="text-sm text-[var(--gray-a11)]">
                These colors control the animated gradient background on the event portal page.
                Leave empty to use the default brand colors.
              </p>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--gray-11)] mb-2">
                    Color 1 (Primary)
                  </label>
                  {isEditMode ? (
                    <div className="flex gap-2">
                      <input
                        type="color"
                        value={watch('gradientColor1') || '#ca2b7f'}
                        onChange={(e) => setValue('gradientColor1', e.target.value)}
                        className="w-12 h-10 rounded-lg border border-[var(--gray-a6)] cursor-pointer"
                      />
                      <Input
                        {...register('gradientColor1')}
                        error={errors.gradientColor1?.message}
                        placeholder="#ca2b7f"
                        className="flex-1"
                      />
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      {event.gradientColor1 ? (
                        <>
                          <div
                            className="w-8 h-8 rounded-lg border border-[var(--gray-a6)]"
                            style={{ backgroundColor: event.gradientColor1 }}
                          />
                          <span className="font-mono text-sm">{event.gradientColor1}</span>
                        </>
                      ) : (
                        <span className="text-[var(--gray-a11)] text-sm">Default (brand primary)</span>
                      )}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--gray-11)] mb-2">
                    Color 2 (Secondary)
                  </label>
                  {isEditMode ? (
                    <div className="flex gap-2">
                      <input
                        type="color"
                        value={watch('gradientColor2') || '#4086c6'}
                        onChange={(e) => setValue('gradientColor2', e.target.value)}
                        className="w-12 h-10 rounded-lg border border-[var(--gray-a6)] cursor-pointer"
                      />
                      <Input
                        {...register('gradientColor2')}
                        error={errors.gradientColor2?.message}
                        placeholder="#4086c6"
                        className="flex-1"
                      />
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      {event.gradientColor2 ? (
                        <>
                          <div
                            className="w-8 h-8 rounded-lg border border-[var(--gray-a6)]"
                            style={{ backgroundColor: event.gradientColor2 }}
                          />
                          <span className="font-mono text-sm">{event.gradientColor2}</span>
                        </>
                      ) : (
                        <span className="text-[var(--gray-a11)] text-sm">Default (brand secondary)</span>
                      )}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--gray-11)] mb-2">
                    Color 3 (Tertiary)
                  </label>
                  {isEditMode ? (
                    <div className="flex gap-2">
                      <input
                        type="color"
                        value={watch('gradientColor3') || '#1e2837'}
                        onChange={(e) => setValue('gradientColor3', e.target.value)}
                        className="w-12 h-10 rounded-lg border border-[var(--gray-a6)] cursor-pointer"
                      />
                      <Input
                        {...register('gradientColor3')}
                        error={errors.gradientColor3?.message}
                        placeholder="#1e2837"
                        className="flex-1"
                      />
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      {event.gradientColor3 ? (
                        <>
                          <div
                            className="w-8 h-8 rounded-lg border border-[var(--gray-a6)]"
                            style={{ backgroundColor: event.gradientColor3 }}
                          />
                          <span className="font-mono text-sm">{event.gradientColor3}</span>
                        </>
                      ) : (
                        <span className="text-[var(--gray-a11)] text-sm">Default (#1e2837)</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              {/* Preview */}
              {(event.gradientColor1 || event.gradientColor2 || event.gradientColor3 || isEditMode) && (
                <div className="mt-4">
                  <label className="block text-sm font-medium text-[var(--gray-11)] mb-2">
                    Preview
                  </label>
                  <div
                    className="h-24 rounded-lg border border-[var(--gray-a6)] relative overflow-hidden"
                    style={{
                      background: `linear-gradient(135deg, ${
                        isEditMode ? watch('gradientColor1') || '#ca2b7f' : event.gradientColor1 || '#ca2b7f'
                      }, ${
                        isEditMode ? watch('gradientColor2') || '#4086c6' : event.gradientColor2 || '#4086c6'
                      }, ${
                        isEditMode ? watch('gradientColor3') || '#1e2837' : event.gradientColor3 || '#1e2837'
                      })`,
                    }}
                  >
                    <span className="absolute inset-0 flex items-center justify-center text-white font-semibold text-lg drop-shadow-lg">
                      Sample Text
                    </span>
                  </div>
                </div>
              )}
              {/* Contrast Warning */}
              {(() => {
                const color1 = isEditMode ? watch('gradientColor1') : event.gradientColor1;
                const color2 = isEditMode ? watch('gradientColor2') : event.gradientColor2;
                const color3 = isEditMode ? watch('gradientColor3') : event.gradientColor3;
                const { warnings } = analyzeGradientColors(color1, color2, color3);
                if (warnings.length === 0) return null;
                return (
                  <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                    <div className="flex items-start gap-2">
                      <svg className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <div>
                        <p className="text-sm font-medium text-amber-800 dark:text-amber-200">Contrast Warning</p>
                        <ul className="mt-1 text-sm text-amber-700 dark:text-amber-300 list-disc list-inside">
                          {warnings.map((warning, i) => (
                            <li key={i}>{warning}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </Card>

        {/* Metadata - Enhanced with refined styling */}
        <Card className="overflow-hidden border-0 shadow-sm">
          <div className="p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="p-2 bg-gradient-to-br from-gray-100 to-slate-100 dark:from-gray-800 dark:to-slate-800 rounded-lg">
                <CodeBracketIcon className="w-5 h-5 text-[var(--gray-a11)]" />
              </div>
              <h3 className="text-lg font-bold text-[var(--gray-12)]">
                Metadata
              </h3>
            </div>
            <div className="space-y-4">
              {/* Event ID - Special styling */}
              <div className="p-3 bg-[var(--gray-a2)] rounded-xl">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--gray-a11)]">Event ID</span>
                <p className="font-mono text-sm text-[var(--gray-12)] mt-1 break-all select-all">
                  {event.eventId}
                </p>
              </div>

              {/* Event Slug - Editable URL-friendly identifier */}
              <div className="p-3 bg-[var(--gray-a2)] rounded-xl">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--gray-a11)]">Event Slug</span>
                {isEditMode ? (
                  <div className="mt-1">
                    <input
                      type="text"
                      {...register('eventSlug')}
                      placeholder="e.g., my-event-2026"
                      className="w-full px-2 py-1 text-sm font-mono bg-[var(--color-background)] border border-[var(--gray-a6)] rounded-md focus:ring-2 focus:ring-[var(--accent-8)] focus:border-[var(--accent-8)]"
                    />
                    {errors.eventSlug && (
                      <p className="text-xs text-[var(--red-11)] mt-1">{errors.eventSlug.message}</p>
                    )}
                    <p className="text-xs text-[var(--gray-a11)] mt-1">
                      URL-friendly identifier for the event portal (lowercase, numbers, hyphens only)
                    </p>
                  </div>
                ) : (
                  <p className="font-mono text-sm text-[var(--gray-12)] mt-1 break-all select-all">
                    {event.eventSlug || <span className="text-[var(--gray-a9)] italic">Not set</span>}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Entry Method */}
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-[var(--gray-a11)]">Entry Method</span>
                  <p className="text-sm text-[var(--gray-12)] mt-1 flex items-center gap-1.5">
                    {event.sourceType === 'scraper' && <span className="text-base">🤖</span>}
                    {event.sourceType === 'user_submission' && <span className="text-base">👤</span>}
                    {event.sourceType === 'manual' && <span className="text-base">✏️</span>}
                    <span>
                      {event.sourceType === 'scraper' ? 'Scraped' :
                       event.sourceType === 'user_submission' ? 'User' :
                       event.sourceType === 'manual' ? 'Manual' :
                       'Unknown'}
                    </span>
                  </p>
                </div>

                {/* Source */}
                {event.eventSource && (
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wider text-[var(--gray-a11)]">Source</span>
                    <p className="text-sm text-[var(--gray-12)] mt-1">{event.eventSource}</p>
                  </div>
                )}
              </div>

              {event.sourceType === 'scraper' && (event.scrapedBy || event.sourceDetails?.scraper_name) && (
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-[var(--gray-a11)]">Scraper Name</span>
                  <p className="text-sm text-[var(--gray-12)] mt-1 font-mono">
                    {event.sourceDetails?.scraper_name || event.scrapedBy || 'N/A'}
                  </p>
                </div>
              )}

              <div className="pt-3 border-t border-[var(--gray-a6)] grid grid-cols-2 gap-4">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-[var(--gray-a11)]">Created</span>
                  <p className="text-sm text-[var(--gray-12)] mt-1">
                    {event.createdAt ? new Date(event.createdAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric'
                    }) : 'N/A'}
                  </p>
                </div>
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-[var(--gray-a11)]">Updated</span>
                  <p className="text-sm text-[var(--gray-12)] mt-1">
                    {event.updatedAt ? new Date(event.updatedAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric'
                    }) : 'N/A'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};

/** Self-contained inline edit cell — keeps local state so parent columns stay stable */
const InlineEditCell = ({
  value,
  onSave,
  renderDisplay,
}: {
  value: string | null;
  onSave: (newValue: string | null) => Promise<void>;
  renderDisplay: (onClick: () => void) => ReactNode;
}) => {
  const [editing, setEditing] = useState(false);
  const [localValue, setLocalValue] = useState(value || '');

  const save = async () => {
    try {
      await onSave(localValue || null);
      setEditing(false);
    } catch {
      // error handled by caller
    }
  };

  if (editing) {
    return (
      <input
        type="text"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') setEditing(false);
        }}
        autoFocus
        className="px-2 py-1 text-sm border border-[var(--accent-8)] rounded bg-[var(--color-background)] text-[var(--gray-12)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-8)]"
      />
    );
  }

  return <>{renderDisplay(() => { setLocalValue(value || ''); setEditing(true); })}</>;
};

const EventRegistrationsTab = ({ eventId, eventUuid }: { eventId: string; eventUuid?: string }) => {
  const navigate = useNavigate();
  const { isModuleEnabled } = useModulesContext();
  const hasAdConversions = isModuleEnabled('ad-conversions');
  const hasDiscountCodes = isModuleEnabled('discounts');
  const [registrations, setRegistrations] = useState<EventRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  // Luma-reported attendance. Updated on every scrape — we don't have the
  // per-attendee records yet (Luma doesn't expose them publicly) but the
  // totals are a useful signal of event size before we have our own data.
  const [lumaCounts, setLumaCounts] = useState<{ guest: number | null; ticket: number | null; updatedAt: string | null }>({
    guest: null, ticket: null, updatedAt: null,
  });

  useEffect(() => {
    if (!eventUuid) return;
    (async () => {
      const { data } = await supabase
        .from('events')
        .select('luma_guest_count, luma_ticket_count, luma_counts_updated_at')
        .eq('id', eventUuid)
        .single();
      if (data) {
        setLumaCounts({
          guest: data.luma_guest_count ?? null,
          ticket: data.luma_ticket_count ?? null,
          updatedAt: data.luma_counts_updated_at ?? null,
        });
      }
    })();
  }, [eventUuid]);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [amountFilter, setAmountFilter] = useState<'all' | 'above' | 'below'>('all');
  const [amountThreshold, setAmountThreshold] = useState<string>('');
  const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; registrationId: string | null; registrationName: string }>({
    isOpen: false,
    registrationId: null,
    registrationName: '',
  });
  const [qrCodeModal, setQrCodeModal] = useState<{
    isOpen: boolean;
    registration: EventRegistration | null;
    qrCodeDataUrl: string | null;
    qrType: 'member' | 'luma' | null;
  }>({
    isOpen: false,
    registration: null,
    qrCodeDataUrl: null,
    qrType: null,
  });

  // Tracking sessions mapped by registration ID for displaying ad source
  const [trackingByRegistration, setTrackingByRegistration] = useState<Map<string, {
    platform: string | null;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    utm_content: string | null;
    utm_term: string | null;
    status: string | null;
    click_ids: Record<string, string> | null;
  }>>(new Map());

  useEffect(() => {
    loadRegistrations();
  }, [eventId]);

  // Subscribe to real-time changes for event registrations
  useEffect(() => {
    if (!eventUuid) return;

    const channel = supabase
      .channel(`event_registrations_${eventUuid}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'events_registrations',
          filter: `event_id=eq.${eventUuid}`,
        },
        async (payload: RealtimePostgresChangesPayload<EventRegistration>) => {
          if (payload.eventType === 'INSERT') {
            // For INSERTs, fetch the complete registration data from the view
            // because the raw payload doesn't have joined data (full_name, email, etc.)
            const newRegId = (payload.new as EventRegistration).id;

            // Retry fetching from view with a small delay - the view joins with member_profiles
            // which may not be fully committed yet when the realtime event fires
            let fullRegistration = null;
            for (let attempt = 0; attempt < 3; attempt++) {
              const { data } = await supabase
                .from('events_registrations_with_people')
                .select('*')
                .eq('id', newRegId)
                .single();

              if (data) {
                fullRegistration = data;
                break;
              }
              // Wait a bit before retrying
              await new Promise(resolve => setTimeout(resolve, 300));
            }

            if (fullRegistration) {
              setRegistrations((prev) => {
                // Check if registration already exists to avoid duplicates
                const exists = prev.some((r) => r.id === fullRegistration.id);
                if (exists) return prev;
                return [fullRegistration as EventRegistration, ...prev];
              });
            }
          } else if (payload.eventType === 'UPDATE') {
            // For UPDATEs, also fetch the full data
            const updatedRegId = (payload.new as EventRegistration).id;
            const { data: fullRegistration } = await supabase
              .from('events_registrations_with_people')
              .select('*')
              .eq('id', updatedRegId)
              .single();

            if (fullRegistration) {
              setRegistrations((prev) =>
                prev.map((r) =>
                  r.id === fullRegistration.id ? (fullRegistration as EventRegistration) : r
                )
              );
            }
          } else if (payload.eventType === 'DELETE') {
            setRegistrations((prev) =>
              prev.filter((r) => r.id !== (payload.old as EventRegistration).id)
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventUuid]);

  const loadRegistrations = async () => {
    setLoading(true);
    try {
      // Fetch registrations
      const data = await EventQrService.getEventRegistrations(eventId, { hasDiscountCodes });
      setRegistrations(data);

      // Fetch tracking sessions (only when ad-conversions module is enabled)
      if (hasAdConversions) {
      const trackingResult = await supabase
        .from('integrations_ad_tracking_sessions')
        .select('matched_registration_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, status, click_ids')
        .eq('event_id', eventId)
        .not('matched_registration_id', 'is', null);

      // Build a map of registration ID -> tracking info
      if (trackingResult.data) {
        const trackingMap = new Map<string, {
          platform: string | null;
          utm_source: string | null;
          utm_medium: string | null;
          utm_campaign: string | null;
          utm_content: string | null;
          utm_term: string | null;
          status: string | null;
          click_ids: Record<string, string> | null;
        }>();

        for (const session of trackingResult.data) {
          if (session.matched_registration_id) {
            // Determine platform from click_ids or utm_source
            let platform: string | null = null;
            const clickIds = session.click_ids as Record<string, string> | null;
            if (clickIds) {
              if (clickIds.fbclid) platform = 'meta';
              else if (clickIds.gclid) platform = 'google';
              else if (clickIds.rdt_cid) platform = 'reddit';
              else if (clickIds.msclkid) platform = 'bing';
              else if (clickIds.li_fat_id) platform = 'linkedin';
              else if (clickIds.ttclid) platform = 'tiktok';
            }
            // Fallback: check utm_source for platform hints
            if (!platform && session.utm_source) {
              const src = session.utm_source.toLowerCase();
              if (src.includes('facebook') || src.includes('instagram') || src.includes('meta')) platform = 'meta';
              else if (src.includes('google')) platform = 'google';
              else if (src.includes('reddit')) platform = 'reddit';
              else if (src.includes('linkedin')) platform = 'linkedin';
              else if (src.includes('tiktok')) platform = 'tiktok';
              else if (src.includes('bing')) platform = 'bing';
            }

            trackingMap.set(session.matched_registration_id, {
              platform,
              utm_source: session.utm_source,
              utm_medium: session.utm_medium,
              utm_campaign: session.utm_campaign,
              utm_content: session.utm_content,
              utm_term: session.utm_term,
              status: session.status,
              click_ids: clickIds,
            });
          }
        }
        setTrackingByRegistration(trackingMap);
      }
      } // end hasAdConversions
    } catch (error) {
      console.error('Error loading registrations:', error);
      toast.error('Failed to load registrations');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteClick = (registrationId: string, registrationName: string) => {
    setDeleteModal({
      isOpen: true,
      registrationId,
      registrationName,
    });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteModal.registrationId) return;

    try {
      await EventQrService.deleteRegistration(deleteModal.registrationId);

      // Update local state
      setRegistrations(registrations.filter(reg => reg.id !== deleteModal.registrationId));

      toast.success('Registration deleted successfully');
      setDeleteModal({ isOpen: false, registrationId: null, registrationName: '' });
    } catch (error) {
      console.error('Error deleting registration:', error);
      toast.error('Failed to delete registration');
    }
  };

  const handleCheckIn = async (registration: EventRegistration) => {
    try {
      await EventQrService.checkInRegistrant({
        eventId,
        registrationId: registration.id,
        memberProfileId: registration.people_profile_id,
        checkInMethod: 'manual_entry',
      });

      toast.success(`${registration.full_name || registration.email} checked in successfully`);
      // Optionally reload registrations to update any state
      loadRegistrations();
    } catch (error) {
      console.error('Error checking in registrant:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to check in registrant';
      toast.error(errorMessage);
    }
  };

  const handleViewQrCode = async (registration: EventRegistration, qrType: 'member' | 'luma') => {
    let qrData: string;

    if (qrType === 'member') {
      if (!registration.qr_code_id) {
        toast.error('This registration does not have a member QR code');
        return;
      }
      // Generate QR code URL for the member
      const appUrl = import.meta.env.VITE_APP_URL || '';
      qrData = `${appUrl}/m/${registration.qr_code_id}`;
    } else {
      // Luma QR code
      if (!registration.external_qr_code) {
        toast.error('This registration does not have a Luma QR code');
        return;
      }
      qrData = registration.external_qr_code;
    }

    try {
      // Generate QR code image
      const qrDataUrl = await QRCodeService.generateQRCode({
        data: qrData,
        size: 400,
        margin: 20,
        errorCorrectionLevel: 'H',
      });

      setQrCodeModal({
        isOpen: true,
        registration,
        qrCodeDataUrl: qrDataUrl,
        qrType,
      });
    } catch (error) {
      console.error('Error generating QR code:', error);
      toast.error('Failed to generate QR code');
    }
  };

  const filteredRegistrations = registrations.filter((reg) => {
    const query = searchQuery.toLowerCase();
    const matchesSearch = (
      reg.full_name?.toLowerCase().includes(query) ||
      reg.email?.toLowerCase().includes(query) ||
      reg.company?.toLowerCase().includes(query) ||
      reg.registration_type?.toLowerCase().includes(query) ||
      reg.ticket_type?.toLowerCase().includes(query)
    );

    // Amount filter
    const threshold = parseFloat(amountThreshold);
    let matchesAmount = true;
    if (amountFilter !== 'all' && !isNaN(threshold)) {
      const paid = reg.amount_paid ?? 0;
      if (amountFilter === 'above') {
        matchesAmount = paid >= threshold;
      } else if (amountFilter === 'below') {
        matchesAmount = paid < threshold;
      }
    }

    return matchesSearch && matchesAmount;
  });

  const isTemplate = (v: string | null) => v && v.includes('{{');

  const [currentPage, setCurrentPage] = useState(0);
  const totalPages = Math.ceil(filteredRegistrations.length / ITEMS_PER_PAGE);
  const paginatedRegistrations = filteredRegistrations.slice(
    currentPage * ITEMS_PER_PAGE,
    (currentPage + 1) * ITEMS_PER_PAGE,
  );

  // Helper to extract registration answers for display
  const getRegistrationAnswers = (registration: EventRegistration): Array<{ label: string; value: string }> => {
    const answers: Array<{ label: string; value: string }> = [];
    const metadata = registration.registration_metadata;
    if (!metadata) return answers;

    // Webhook/email format
    if (metadata.registration_answers?.length) {
      for (const answer of metadata.registration_answers) {
        let displayValue = answer.answer ?? answer.value;
        if (typeof displayValue === 'object' && displayValue !== null) {
          const parts = [displayValue.company, displayValue.job_title].filter(Boolean);
          displayValue = parts.length > 0 ? parts.join(' — ') : JSON.stringify(displayValue);
        }
        if (typeof displayValue === 'boolean') {
          displayValue = displayValue ? 'Agreed' : 'No';
        }
        answers.push({ label: answer.label, value: String(displayValue ?? '-') });
      }
    }

    // CSV format
    if (metadata.luma_survey_responses) {
      for (const [key, value] of Object.entries(metadata.luma_survey_responses)) {
        answers.push({ label: key, value: String(value) });
      }
    }

    return answers;
  };

  const hasAnswers = (registration: EventRegistration): boolean => {
    const metadata = registration.registration_metadata;
    if (!metadata) return false;
    return !!(metadata.registration_answers?.length || (metadata.luma_survey_responses && Object.keys(metadata.luma_survey_responses).length > 0));
  };

  const handleExportRegistrationsCSV = () => {
    try {
      if (registrations.length === 0) {
        toast.error('No registrations to export');
        return;
      }

      const headers = [
        'Full Name',
        'Email',
        'Company',
        'Job Title',
        'LinkedIn URL',
        'Registration Type',
        'Ticket Type',
        'Ticket Quantity',
        'Amount Paid',
        'Currency',
        'Payment Status',
        'Sponsor Permission',
        'Status',
        'Source',
        'Platform',
        'UTM Source',
        'UTM Medium',
        'UTM Campaign',
        'UTM Content',
        'UTM Term',
        'Registered At',
      ];

      const rows = registrations.map((reg: any) => {
        const tracking = trackingByRegistration.get(reg.id);
        return [
          reg.full_name || '',
          reg.email || '',
          reg.company || '',
          reg.job_title || '',
          reg.linkedin_url || '',
          reg.registration_type || '',
          reg.ticket_type || '',
          reg.ticket_quantity || 1,
          reg.amount_paid != null ? reg.amount_paid : '',
          reg.currency || '',
          reg.payment_status || '',
          reg.sponsor_permission ? 'Yes' : 'No',
          reg.status || '',
          reg.source || '',
          tracking?.platform || '',
          tracking?.utm_source || '',
          tracking?.utm_medium || '',
          tracking?.utm_campaign || '',
          tracking?.utm_content || '',
          tracking?.utm_term || '',
          reg.registered_at ? new Date(reg.registered_at).toISOString() : '',
        ];
      });

      const csvContent = [
        headers.join(','),
        ...rows.map((row: any[]) => row.map((cell: any) => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
      ].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${eventId}_registrations.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast.success(`Exported ${registrations.length} registrations`);
    } catch (error) {
      console.error('Error exporting CSV:', error);
      toast.error('Failed to export CSV');
    }
  };

  const handleDownloadSponsorPermissionCSV = () => {
    const sponsorPermissionCount = registrations.filter((r: any) => r.sponsor_permission === true).length;
    try {
      // Filter registrations with sponsor permission
      const permittedRegistrations = registrations.filter((r: any) => r.sponsor_permission === true);

      if (permittedRegistrations.length === 0) {
        toast.error('No registrations with sponsor permission to export');
        return;
      }

      // Create CSV headers
      const headers = [
        'First Name',
        'Last Name',
        'Email',
        'Company',
        'Job Title',
        'Registration Type',
        'Ticket Type',
        'Status',
        'Registered At'
      ];

      // Create CSV rows
      const rows = permittedRegistrations.map((reg: any) => [
        reg.first_name || '',
        reg.last_name || '',
        reg.email || '',
        reg.company || '',
        reg.job_title || '',
        reg.registration_type || '',
        reg.ticket_type || '',
        reg.status || '',
        reg.created_at ? new Date(reg.created_at).toISOString() : ''
      ]);

      // Combine headers and rows
      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      ].join('\n');

      // Download CSV
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${eventId}_sponsor_permission_registrations.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast.success(`Exported ${permittedRegistrations.length} registrations with sponsor permission`);
    } catch (error) {
      console.error('Error exporting CSV:', error);
      toast.error('Failed to export CSV');
    }
  };

  if (loading) {
    return (
      <Card>
        <div className="p-6 flex justify-center">
          <LoadingSpinner size="medium" />
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold text-[var(--gray-12)]">
              Event Registrations
            </h3>
            <Badge variant="surface" className="text-sm">
              {(() => {
                const totalTickets = registrations.reduce((sum: number, r: any) => sum + (r.ticket_quantity || 1), 0);
                if (totalTickets > registrations.length) {
                  return `${registrations.length} registrations (${totalTickets} tickets)`;
                }
                return `${registrations.length} ${registrations.length === 1 ? 'registration' : 'registrations'}`;
              })()}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <AddPersonModal eventId={eventId} onComplete={loadRegistrations} />
            <BulkRegistrationUpload eventId={eventId} onComplete={loadRegistrations} />
            <ModuleSlot name="event-registrations:actions" props={{ eventId, brandId: getBrandId(), onComplete: loadRegistrations }} />
            <Button variant="soft" size="1" onClick={handleExportRegistrationsCSV} disabled={registrations.length === 0}>
              <ArrowDownTrayIcon className="w-4 h-4 mr-1" />
              Export CSV
            </Button>
          </div>
        </div>

        {/* Luma-reported totals. Tickets hidden because Luma's ticket_count
            mirrors guest_count for ~98% of events, so it adds noise without
            signal. Still fetched and stored in case that changes. */}
        {lumaCounts.guest !== null && (
          <div className="mb-4 grid grid-cols-2 gap-3">
            <div className="p-3 rounded-md bg-[var(--accent-a2)] border border-[var(--accent-a5)]">
              <div className="text-xs text-[var(--gray-10)] uppercase tracking-wide">Luma Guests</div>
              <div className="text-2xl font-semibold text-[var(--gray-12)]">{lumaCounts.guest.toLocaleString()}</div>
            </div>
            {lumaCounts.updatedAt && (
              <div className="p-3 rounded-md bg-[var(--gray-a2)] border border-[var(--gray-a5)]">
                <div className="text-xs text-[var(--gray-10)] uppercase tracking-wide">Last synced</div>
                <div className="text-sm text-[var(--gray-11)]">{new Date(lumaCounts.updatedAt).toLocaleString()}</div>
              </div>
            )}
          </div>
        )}

        {/* Module-contributed status widgets (e.g. Luma upload progress) */}
        <ModuleSlot name="event-registrations:status" props={{ eventId, brandId: getBrandId() }} />

        {registrations.length === 0 ? (
          <div className="text-center py-12 text-[var(--gray-a11)]">
            <UsersIcon className="w-12 h-12 mx-auto mb-3 text-[var(--gray-a9)]" />
            <p>No registrations yet</p>
            <p className="text-sm mt-1">Registrations will appear here once attendees sign up</p>
          </div>
        ) : (
          <>
            {/* Search and Filters */}
            <div className="mb-4 space-y-3">
              <input
                type="text"
                placeholder="Search by name, email, company, registration type, or ticket type..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-4 py-2 border border-[var(--gray-a6)] rounded-md bg-[var(--color-background)] text-[var(--gray-12)]"
              />
              <div className="flex items-center gap-3">
                <span className="text-sm text-[var(--gray-a11)]">Amount Paid:</span>
                <select
                  value={amountFilter}
                  onChange={(e) => setAmountFilter(e.target.value as 'all' | 'above' | 'below')}
                  className="px-3 py-1.5 text-sm border border-[var(--gray-a6)] rounded-md bg-[var(--color-background)] text-[var(--gray-12)]"
                >
                  <option value="all">All</option>
                  <option value="above">At or above</option>
                  <option value="below">Below</option>
                </select>
                {amountFilter !== 'all' && (
                  <div className="flex items-center gap-1">
                    <span className="text-sm text-[var(--gray-a11)]">$</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={amountThreshold}
                      onChange={(e) => setAmountThreshold(e.target.value)}
                      className="w-24 px-2 py-1.5 text-sm border border-[var(--gray-a6)] rounded-md bg-[var(--color-background)] text-[var(--gray-12)]"
                    />
                  </div>
                )}
                {amountFilter !== 'all' && amountThreshold && (
                  <Button variant="ghost" color="gray" onClick={() => {
                      setAmountFilter('all');
                      setAmountThreshold('');
                    }}>
                    Clear filter
                  </Button>
                )}
              </div>
            </div>

            {/* Table */}
            <ScrollableTable>
              <Table>
                <THead>
                  <Tr>
                    <Th data-sticky-left style={{ position: 'sticky', left: 0, zIndex: 20, background: 'var(--color-panel-solid)', minWidth: 220 }}>Attendee</Th>
                    <Th>Company</Th>
                    <Th>Reg. Type</Th>
                    <Th>Ticket Type</Th>
                    <Th>Qty</Th>
                    <Th>Amount Paid</Th>
                    <Th>Sponsor Permission</Th>
                    <Th>Status</Th>
                    <Th>Platform</Th>
                    <Th>UTM Source</Th>
                    <Th>UTM Medium</Th>
                    <Th>UTM Campaign</Th>
                    <Th>UTM Content</Th>
                    <Th>UTM Term</Th>
                    <Th>Registered</Th>
                    <Th>QR Code</Th>
                    <Th data-sticky-right style={{ position: 'sticky', right: 0, zIndex: 20, background: 'var(--color-panel-solid)' }}></Th>
                  </Tr>
                </THead>
                <TBody>
                  {paginatedRegistrations.map((reg) => {
                    const tracking = trackingByRegistration.get(reg.id);
                    const platformBadgeColors: Record<string, string> = {
                      meta: 'blue', google: 'red', reddit: 'orange', linkedin: 'sky', tiktok: 'pink', bing: 'teal',
                    };
                    const utmSource = tracking?.utm_source ?? (reg.source && reg.source !== 'event_portal' ? reg.source : null);
                    return (
                      <Fragment key={reg.id}>
                        <Tr>
                          <Td data-sticky-left style={{ position: 'sticky', left: 0, zIndex: 10, background: 'var(--color-panel-solid)' }}>
                            <div>
                              <div className="text-sm font-medium">
                                {reg.person_id ? (
                                  <Button variant="ghost" onClick={() => navigate(`/people/${reg.person_id}`)}>
                                    {reg.full_name || 'N/A'}
                                  </Button>
                                ) : (
                                  reg.full_name || 'N/A'
                                )}
                              </div>
                              <div className="text-sm text-[var(--gray-a11)]">{reg.email}</div>
                              {reg.job_title && <div className="text-xs text-[var(--gray-a9)]">{reg.job_title}</div>}
                            </div>
                          </Td>
                          <Td>{reg.company || '-'}</Td>
                          <Td>
                            <InlineEditCell
                              value={reg.registration_type}
                              onSave={async (newValue) => {
                                await EventQrService.updateRegistration(reg.id, { registration_type: newValue as any });
                                setRegistrations(prev => prev.map(r => r.id === reg.id ? { ...r, registration_type: newValue as any } : r));
                                toast.success('Registration updated successfully');
                              }}
                              renderDisplay={(onClick: any) => (
                                <div onClick={onClick} className="cursor-pointer hover:bg-[var(--gray-a3)] rounded px-2 py-1 inline-block">
                                  {reg.registration_type ? (
                                    <Badge variant="soft" className="capitalize">{reg.registration_type.replace('_', ' ')}</Badge>
                                  ) : (
                                    <span className="text-sm text-[var(--gray-a11)]">Click to edit</span>
                                  )}
                                </div>
                              )}
                            />
                          </Td>
                          <Td>
                            <InlineEditCell
                              value={reg.ticket_type}
                              onSave={async (newValue) => {
                                await EventQrService.updateRegistration(reg.id, { ticket_type: newValue } as any);
                                setRegistrations(prev => prev.map(r => r.id === reg.id ? { ...r, ticket_type: newValue } : r) as any);
                                toast.success('Registration updated successfully');
                              }}
                              renderDisplay={(onClick) => (
                                <div onClick={onClick} className="cursor-pointer hover:bg-[var(--gray-a3)] rounded px-2 py-1 inline-block">
                                  {reg.ticket_type ? (
                                    <span className="text-sm">{reg.ticket_type}</span>
                                  ) : (
                                    <span className="text-sm text-[var(--gray-a11)]">Click to edit</span>
                                  )}
                                </div>
                              )}
                            />
                          </Td>
                          <Td>{(reg as any).ticket_quantity > 1 ? <span className="font-medium">{(reg as any).ticket_quantity}</span> : <span className="text-[var(--gray-a9)]">1</span>}</Td>
                          <Td>
                            {reg.amount_paid != null ? (
                              <span className="font-medium">
                                {new Intl.NumberFormat('en-US', { style: 'currency', currency: reg.currency || 'USD' }).format(reg.amount_paid)}
                              </span>
                            ) : <span className="text-[var(--gray-a9)]">-</span>}
                          </Td>
                          <Td>
                            {(reg as any).sponsor_permission === true
                              ? <CheckIcon className="w-5 h-5 text-[var(--green-11)] inline-block" title="Permission granted" />
                              : <XMarkIcon className="w-5 h-5 text-[var(--gray-a9)] inline-block" title="No permission" />}
                          </Td>
                          <Td>
                            <Badge variant="soft" color={reg.status === 'confirmed' ? 'green' : reg.status === 'cancelled' ? 'red' : 'yellow'}>
                              {reg.status}
                            </Badge>
                          </Td>
                          <Td>
                            {tracking?.platform ? (
                              <Badge variant="soft" color={(platformBadgeColors[tracking.platform] || 'gray') as any}>{tracking.platform}</Badge>
                            ) : <span className="text-[var(--gray-a9)]">-</span>}
                          </Td>
                          <Td>{utmSource && !isTemplate(utmSource) ? <span className="truncate max-w-[150px] block" title={utmSource}>{utmSource}</span> : <span className="text-[var(--gray-a9)]">-</span>}</Td>
                          <Td>{tracking?.utm_medium && !isTemplate(tracking.utm_medium) ? <span className="truncate max-w-[150px] block" title={tracking.utm_medium}>{tracking.utm_medium}</span> : <span className="text-[var(--gray-a9)]">-</span>}</Td>
                          <Td>{tracking?.utm_campaign && !isTemplate(tracking.utm_campaign) ? <span className="truncate max-w-[150px] block" title={tracking.utm_campaign}>{tracking.utm_campaign}</span> : <span className="text-[var(--gray-a9)]">-</span>}</Td>
                          <Td>{tracking?.utm_content && !isTemplate(tracking.utm_content) ? <span className="truncate max-w-[150px] block" title={tracking.utm_content}>{tracking.utm_content}</span> : <span className="text-[var(--gray-a9)]">-</span>}</Td>
                          <Td>{tracking?.utm_term && !isTemplate(tracking.utm_term) ? <span className="truncate max-w-[150px] block" title={tracking.utm_term}>{tracking.utm_term}</span> : <span className="text-[var(--gray-a9)]">-</span>}</Td>
                          <Td>
                            <span className="text-[var(--gray-a11)]">
                              {new Date(reg.registered_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </Td>
                          <Td>
                            <div className="flex flex-col gap-1">
                              {reg.qr_code_id && (
                                <Button variant="ghost" onClick={() => handleViewQrCode(reg, 'member')} title="View Profile QR Code">
                                  <QrCodeIcon className="w-4 h-4" /><span className="text-xs">Profile</span>
                                </Button>
                              )}
                              {reg.external_qr_code && (
                                <Button variant="ghost" onClick={() => handleViewQrCode(reg, 'luma')} title="View Luma QR Code">
                                  <QrCodeIcon className="w-4 h-4" /><span className="text-xs">Luma</span>
                                </Button>
                              )}
                              {!reg.qr_code_id && !reg.external_qr_code && <span className="text-[var(--gray-a9)]">-</span>}
                            </div>
                          </Td>
                          <Td data-sticky-right style={{ position: 'sticky', right: 0, zIndex: 10, background: 'var(--color-panel-solid)' }}>
                            <RowActions actions={[
                              ...(hasAnswers(reg) ? [{
                                label: expandedRowId === reg.id ? 'Hide details' : 'Show registration answers',
                                icon: expandedRowId === reg.id ? <ChevronUpIcon className="w-4 h-4" /> : <ChevronDownIcon className="w-4 h-4" />,
                                onClick: () => setExpandedRowId(expandedRowId === reg.id ? null : reg.id),
                              }] : []),
                              { label: 'Check in', icon: <CheckIcon className="w-4 h-4" />, onClick: () => handleCheckIn(reg) },
                              { label: 'Delete registration', icon: <TrashIcon className="w-4 h-4" />, onClick: () => handleDeleteClick(reg.id, reg.full_name || reg.email || 'this registration'), color: 'red' as const },
                            ]} />
                          </Td>
                        </Tr>
                        {expandedRowId === reg.id && (
                          <Tr>
                            <Td colSpan={17} className="bg-[var(--gray-a2)]">
                              <div className="space-y-3">
                                {reg.linkedin_url && (
                                  <div className="flex items-center gap-2 text-sm">
                                    <span className="text-[var(--gray-a11)] font-medium">LinkedIn:</span>
                                    <a href={reg.linkedin_url.startsWith('http') ? reg.linkedin_url : `https://${reg.linkedin_url}`} target="_blank" rel="noopener noreferrer" className="text-[var(--accent-11)] hover:underline">{reg.linkedin_url}</a>
                                  </div>
                                )}
                                {(() => {
                                  const answers = getRegistrationAnswers(reg);
                                  if (answers.length === 0) return null;
                                  return (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2">
                                      {answers.map((a, i) => (
                                        <div key={i}>
                                          <dt className="text-xs text-[var(--gray-a11)]">{a.label}</dt>
                                          <dd className="text-sm">{a.value}</dd>
                                        </div>
                                      ))}
                                    </div>
                                  );
                                })()}
                              </div>
                            </Td>
                          </Tr>
                        )}
                      </Fragment>
                    );
                  })}
                </TBody>
              </Table>
            </ScrollableTable>

            {filteredRegistrations.length === 0 && searchQuery && (
              <div className="text-center py-8 text-[var(--gray-a11)]">
                <p>No registrations found matching "{searchQuery}"</p>
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between border-t border-[var(--gray-a6)] pt-4">
                <div className="text-sm text-[var(--gray-a11)]">
                  Showing {currentPage * ITEMS_PER_PAGE + 1}-{Math.min((currentPage + 1) * ITEMS_PER_PAGE, filteredRegistrations.length)} of {filteredRegistrations.length} registrations
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" color="gray" onClick={() => setCurrentPage(0)} disabled={currentPage === 0}>
                    First
                  </Button>
                  <Button variant="outline" color="gray" onClick={() => setCurrentPage(p => p - 1)} disabled={currentPage === 0}>
                    Previous
                  </Button>
                  <span className="px-3 py-1 text-sm text-[var(--gray-11)]">
                    Page {currentPage + 1} of {totalPages}
                  </span>
                  <Button variant="outline" color="gray" onClick={() => setCurrentPage(p => p + 1)} disabled={currentPage >= totalPages - 1}>
                    Next
                  </Button>
                  <Button variant="outline" color="gray" onClick={() => setCurrentPage(totalPages - 1)} disabled={currentPage >= totalPages - 1}>
                    Last
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <ConfirmModal
        isOpen={deleteModal.isOpen}
        onClose={() => setDeleteModal({ isOpen: false, registrationId: null, registrationName: '' })}
        onConfirm={handleDeleteConfirm}
        title="Delete Registration"
        message={`Are you sure you want to delete the registration for ${deleteModal.registrationName}? This action cannot be undone.`}
        confirmText="Delete"
        confirmVariant="danger"
      />

      {/* QR Code Modal */}
      <Modal
        isOpen={qrCodeModal.isOpen}
        onClose={() => setQrCodeModal({ isOpen: false, registration: null, qrCodeDataUrl: null, qrType: null })}
        title={qrCodeModal.qrType === 'luma' ? 'Luma QR Code' : 'Profile QR Code'}
        size="md"
      >
        {qrCodeModal.registration && (
          <div className="space-y-4">
            {/* Member Information */}
            <div className="bg-[var(--gray-a3)] p-4 rounded-lg">
              <h4 className="text-sm font-semibold text-[var(--gray-11)] mb-2">
                Attendee Details
              </h4>
              <div className="space-y-1 text-sm">
                <p className="text-[var(--gray-12)] font-medium">
                  {qrCodeModal.registration.full_name || 'N/A'}
                </p>
                {qrCodeModal.registration.email && (
                  <p className="text-[var(--gray-a11)]">
                    {qrCodeModal.registration.email}
                  </p>
                )}
                {qrCodeModal.registration.company && (
                  <p className="text-[var(--gray-a11)]">
                    {qrCodeModal.registration.company}
                  </p>
                )}
                {qrCodeModal.registration.job_title && (
                  <p className="text-[var(--gray-a11)]">
                    {qrCodeModal.registration.job_title}
                  </p>
                )}
              </div>
            </div>

            {/* QR Code Display */}
            {qrCodeModal.qrCodeDataUrl ? (
              <div className="flex flex-col items-center space-y-4">
                <img
                  src={qrCodeModal.qrCodeDataUrl}
                  alt={qrCodeModal.qrType === 'luma' ? 'Luma QR Code' : 'Profile QR Code'}
                  className="w-80 h-80 border-2 border-[var(--gray-a6)] rounded-lg p-2 bg-white"
                />
                {qrCodeModal.qrType === 'member' && qrCodeModal.registration.qr_code_id && (
                  <p className="text-xs text-[var(--gray-a11)] text-center">
                    QR Code ID: {qrCodeModal.registration.qr_code_id}
                  </p>
                )}
                {qrCodeModal.qrType === 'luma' && (
                  <p className="text-xs text-[var(--gray-a11)] text-center">
                    Luma External QR Code
                  </p>
                )}
                <div className="flex gap-2">
                  <Button
                    onClick={() => {
                      if (qrCodeModal.qrCodeDataUrl) {
                        const a = document.createElement('a');
                        a.href = qrCodeModal.qrCodeDataUrl;
                        const filename = qrCodeModal.qrType === 'luma'
                          ? `luma-qr-${qrCodeModal.registration?.email || 'code'}.png`
                          : `qr-${qrCodeModal.registration?.qr_code_id || 'code'}.png`;
                        a.download = filename;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        toast.success('QR code downloaded');
                      }
                    }}
                    className="gap-2"
                  >
                    <ArrowDownTrayIcon className="w-4 h-4" />
                    Download QR Code
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex justify-center py-8">
                <LoadingSpinner size="medium" />
              </div>
            )}
          </div>
        )}
      </Modal>
    </Card>
  );
};

// Event Attendance Tab Component
interface CheckInData {
  date: string;
  count: number;
  cumulative: number;
}

interface BadgeScanStats {
  totalScans: number;
  uniqueScanners: number;
  uniqueScanned: number;
  avgScansPerScanner: number;
  topScanners: Array<{
    scanner_people_profile_id: string;
    scanner_name: string;
    scanner_email: string;
    scanner_company: string | null;
    scan_count: number;
  }>;
  timeline: Array<{
    date: string;
    count: number;
    cumulative: number;
  }>;
}

const EventAttendanceTab = ({ eventId, eventUuid }: { eventId: string; eventUuid?: string }) => {
  const navigate = useNavigate();
  const { isModuleEnabled } = useModulesContext();
  const hasAdConversions = isModuleEnabled('ad-conversions');
  const hasDiscountCodes = isModuleEnabled('discounts');
  const hasBadgeScanning = isModuleEnabled('badge-scanning');
  const [attendance, setAttendance] = useState<EventAttendance[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [checkInData, setCheckInData] = useState<CheckInData[]>([]);
  const [badgeScanStats, setBadgeScanStats] = useState<BadgeScanStats | null>(null);
  const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; attendanceId: string | null; attendeeName: string }>({
    isOpen: false,
    attendanceId: null,
    attendeeName: '',
  });

  useEffect(() => {
    loadAttendance();
    loadBadgeScanStats();
  }, [eventId]);

  // Subscribe to real-time changes for event attendance
  useEffect(() => {
    if (!eventUuid) return;

    const channel = supabase
      .channel(`event_attendance_${eventUuid}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'events_attendance',
          filter: `event_id=eq.${eventUuid}`,
        },
        () => {
          // Reload all attendance data on any change — the joined data
          // (scan counts, sponsor permissions) makes incremental updates impractical
          loadAttendance();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventUuid]);

  const loadAttendance = async () => {
    setLoading(true);
    try {
      const data = await EventQrService.getAttendanceWithScanCounts(eventId, { hasDiscountCodes, hasBadgeScanning });
      setAttendance(data);
      processCheckInTimeline(data);
    } catch (error) {
      console.error('Error loading attendance:', error);
      toast.error('Failed to load attendance records');
    } finally {
      setLoading(false);
    }
  };

  // Calculate sponsor permission stats
  const sponsorPermissionCount = attendance.filter((a: any) => a.sponsor_permission === true).length;

  // Debug logging
  useEffect(() => {
    if (attendance.length > 0) {
      const withTrue = attendance.filter((a: any) => a.sponsor_permission === true);
      const withFalse = attendance.filter((a: any) => a.sponsor_permission === false);
      const withNull = attendance.filter((a: any) => a.sponsor_permission === null);
      const withUndefined = attendance.filter((a: any) => a.sponsor_permission === undefined);

      console.log('🎫 Attendance sponsor_permission breakdown:', {
        total: attendance.length,
        withTrue: withTrue.length,
        withFalse: withFalse.length,
        withNull: withNull.length,
        withUndefined: withUndefined.length,
        sample: attendance.slice(0, 3).map((a: any) => ({
          name: a.full_name,
          hasRegistration: !!a.event_registration_id,
          sponsor_permission: a.sponsor_permission,
        }))
      });
    }
  }, [attendance]);

  const loadBadgeScanStats = async () => {
    try {
      const stats = await EventQrService.getBadgeScanStats(eventId, { hasBadgeScanning });
      setBadgeScanStats(stats);
    } catch (error) {
      console.error('Error loading badge scan stats:', error);
    }
  };

  const processCheckInTimeline = (attendanceData: EventAttendance[]) => {
    if (!attendanceData || attendanceData.length === 0) {
      setCheckInData([]);
      return;
    }

    // Group by 1-minute intervals
    const groupedByInterval = attendanceData.reduce((acc: { [key: string]: number }, record) => {
      if (record.checked_in_at) {
        const timestamp = new Date(record.checked_in_at);
        // Round down to the nearest 1-minute interval (set seconds and milliseconds to 0)
        timestamp.setSeconds(0, 0);
        const intervalKey = timestamp.toISOString();
        acc[intervalKey] = (acc[intervalKey] || 0) + 1;
      }
      return acc;
    }, {});

    // Convert to timeline array with cumulative count
    const sortedIntervals = Object.keys(groupedByInterval).sort();
    let cumulative = 0;
    const timeline = sortedIntervals.map(interval => {
      cumulative += groupedByInterval[interval];
      return {
        date: interval,
        count: groupedByInterval[interval],
        cumulative
      };
    });

    setCheckInData(timeline);
  };

  const handleExportCSV = async () => {
    try {
      if (attendance.length === 0) {
        toast.error('No attendance records to export');
        return;
      }

      // Fetch UTM tracking data via registration IDs
      const registrationIds = attendance
        .map((a: any) => a.event_registration_id)
        .filter(Boolean);

      let trackingMap = new Map<string, {
        platform: string | null;
        utm_source: string | null;
        utm_medium: string | null;
        utm_campaign: string | null;
        utm_content: string | null;
        utm_term: string | null;
      }>();

      if (hasAdConversions && registrationIds.length > 0) {
        const { data: trackingData } = await supabase
          .from('integrations_ad_tracking_sessions')
          .select('matched_registration_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, click_ids')
          .in('matched_registration_id', registrationIds);

        if (trackingData) {
          for (const session of trackingData) {
            if (session.matched_registration_id) {
              let platform: string | null = null;
              const clickIds = session.click_ids as Record<string, string> | null;
              if (clickIds) {
                if (clickIds.fbclid) platform = 'meta';
                else if (clickIds.gclid) platform = 'google';
                else if (clickIds.rdt_cid) platform = 'reddit';
                else if (clickIds.msclkid) platform = 'bing';
                else if (clickIds.li_fat_id) platform = 'linkedin';
                else if (clickIds.ttclid) platform = 'tiktok';
              }
              if (!platform && session.utm_source) {
                const src = session.utm_source.toLowerCase();
                if (src.includes('facebook') || src.includes('instagram') || src.includes('meta')) platform = 'meta';
                else if (src.includes('google')) platform = 'google';
                else if (src.includes('reddit')) platform = 'reddit';
                else if (src.includes('linkedin')) platform = 'linkedin';
                else if (src.includes('tiktok')) platform = 'tiktok';
                else if (src.includes('bing')) platform = 'bing';
              }
              trackingMap.set(session.matched_registration_id, {
                platform,
                utm_source: session.utm_source,
                utm_medium: session.utm_medium,
                utm_campaign: session.utm_campaign,
                utm_content: session.utm_content,
                utm_term: session.utm_term,
              });
            }
          }
        }
      }

      const headers = [
        'Full Name',
        'Email',
        'Company',
        'Check-in Method',
        'Check-in Time',
        'Badge Printed',
        'Badge Printed At',
        'QR Code ID',
        'Scans Performed',
        'Platform',
        'UTM Source',
        'UTM Medium',
        'UTM Campaign',
        'UTM Content',
        'UTM Term',
      ];

      const rows = attendance.map((record: any) => {
        const tracking = record.event_registration_id ? trackingMap.get(record.event_registration_id) : null;
        return [
          record.full_name || '',
          record.email || '',
          record.company || '',
          record.check_in_method || '',
          record.checked_in_at ? new Date(record.checked_in_at).toLocaleString() : '',
          record.badge_printed_on_site ? 'Yes' : 'No',
          record.badge_printed_at ? new Date(record.badge_printed_at).toLocaleString() : '',
          record.qr_code_id || '',
          record.scan_count || 0,
          tracking?.platform || '',
          tracking?.utm_source || '',
          tracking?.utm_medium || '',
          tracking?.utm_campaign || '',
          tracking?.utm_content || '',
          tracking?.utm_term || '',
        ];
      });

      const csvContent = [
        headers.join(','),
        ...rows.map((row: any[]) => row.map((cell: any) => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
      ].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `event_${eventId}_attendance.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast.success(`Exported ${attendance.length} attendance records`);
    } catch (error) {
      console.error('Error exporting CSV:', error);
      toast.error('Failed to export CSV');
    }
  };

  const handleExportAttendeeScans = async (memberProfileId: string, attendeeName: string) => {
    try {
      const csv = await EventQrService.exportAttendeeScansCSV(eventId, memberProfileId);

      // Download CSV
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const fileName = `${attendeeName.replace(/[^a-z0-9]/gi, '_')}_scans.csv`;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast.success('Scans exported successfully');
    } catch (error) {
      console.error('Error exporting scans:', error);
      toast.error('Failed to export scans');
    }
  };

  const handleDownloadSponsorPermissionCSV = () => {
    try {
      // Filter attendance records with sponsor permission
      const permittedAttendees = attendance.filter((a: any) => a.sponsor_permission === true);

      if (permittedAttendees.length === 0) {
        toast.error('No attendees with sponsor permission to export');
        return;
      }

      // Create CSV headers
      const headers = [
        'Full Name',
        'Email',
        'Company',
        'Job Title',
        'Check-in Method',
        'Check-in Time',
        'Badge Printed',
        'QR Code ID'
      ];

      // Create CSV rows
      const rows = permittedAttendees.map((att: any) => [
        att.full_name || '',
        att.email || '',
        att.company || '',
        att.job_title || '',
        att.check_in_method || '',
        att.checked_in_at ? new Date(att.checked_in_at).toISOString() : '',
        att.badge_printed_on_site ? 'Yes' : 'No',
        att.qr_code_id || ''
      ]);

      // Combine headers and rows
      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      ].join('\n');

      // Download CSV
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${eventId}_attended_sponsor_permission.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast.success(`Exported ${permittedAttendees.length} attendees with sponsor permission`);
    } catch (error) {
      console.error('Error exporting CSV:', error);
      toast.error('Failed to export CSV');
    }
  };

  const handleDeleteClick = (attendanceId: string, attendeeName: string) => {
    setDeleteModal({
      isOpen: true,
      attendanceId,
      attendeeName,
    });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteModal.attendanceId) return;

    try {
      await EventQrService.deleteAttendance(deleteModal.attendanceId);

      // Update local state
      setAttendance(attendance.filter(att => att.id !== deleteModal.attendanceId));

      toast.success('Attendance record deleted successfully');
      setDeleteModal({ isOpen: false, attendanceId: null, attendeeName: '' });
    } catch (error) {
      console.error('Error deleting attendance:', error);
      toast.error('Failed to delete attendance record');
    }
  };

  const filteredAttendance = attendance.filter((att) => {
    const query = searchQuery.toLowerCase();
    return (
      att.full_name?.toLowerCase().includes(query) ||
      att.email?.toLowerCase().includes(query) ||
      att.company?.toLowerCase().includes(query)
    );
  });

  // Pagination calculations
  const totalPages = Math.ceil(filteredAttendance.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedAttendance = filteredAttendance.slice(startIndex, endIndex);

  // Reset to page 1 when search query changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  if (loading) {
    return (
      <Card>
        <div className="p-6 flex justify-center">
          <LoadingSpinner size="medium" />
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-[var(--gray-12)]">
            Event Attendance
          </h3>
          <div className="flex items-center gap-2">
            <BulkAttendanceUpload eventId={eventId} onComplete={loadAttendance} />
            <ModuleSlot name="event-attendance:actions" props={{ eventId, onComplete: loadAttendance }} />
            <Button variant="soft" onClick={handleExportCSV}>
              Export CSV
            </Button>
          </div>
        </div>

        {attendance.length === 0 ? (
          <div className="text-center py-12 text-[var(--gray-a11)]">
            <UserGroupIcon className="w-12 h-12 mx-auto mb-3 text-[var(--gray-a9)]" />
            <p>No attendance records yet</p>
            <p className="text-sm mt-1">Attendance will be tracked when attendees check in at the event</p>
          </div>
        ) : (
          <>
            {/* Search */}
            <div className="mb-4">
              <input
                type="text"
                placeholder="Search by name, email, or company..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-4 py-2 border border-[var(--gray-a6)] rounded-md bg-[var(--color-background)] text-[var(--gray-12)]"
              />
            </div>

            {/* Table */}
            <ScrollableTable>
              <Table>
                <THead>
                  <Tr>
                    <Th data-sticky-left style={{ position: 'sticky', left: 0, zIndex: 20, background: 'var(--color-panel-solid)' }}>Attendee</Th>
                    <Th>Company</Th>
                    <Th>Check-in Method</Th>
                    <Th>Check-in Time</Th>
                    <Th>Badge Printed</Th>
                    <Th>Scans</Th>
                    <Th>QR Code</Th>
                    <Th data-sticky-right style={{ position: 'sticky', right: 0, zIndex: 20, background: 'var(--color-panel-solid)' }}>&nbsp;</Th>
                  </Tr>
                </THead>
                <TBody>
                  {paginatedAttendance.map((record) => (
                    <Tr key={record.id}>
                      <Td data-sticky-left style={{ position: 'sticky', left: 0, zIndex: 10, background: 'var(--color-panel-solid)' }}>
                        <div>
                          <div className="text-sm font-medium">
                            {record.person_id ? (
                              <Button variant="ghost" onClick={() => navigate(`/people/${record.person_id}`)}>
                                {record.full_name || 'N/A'}
                              </Button>
                            ) : (
                              record.full_name || 'N/A'
                            )}
                          </div>
                          <div className="text-sm text-[var(--gray-a11)]">{record.email}</div>
                        </div>
                      </Td>
                      <Td>
                        {record.company || '-'}
                      </Td>
                      <Td>
                        {record.check_in_method ? (
                          <Badge variant="soft" className="capitalize">
                            {record.check_in_method.replace('_', ' ')}
                          </Badge>
                        ) : (
                          <span className="text-sm text-[var(--gray-a11)]">-</span>
                        )}
                      </Td>
                      <Td>
                        <div>{new Date(record.checked_in_at).toLocaleDateString()}</div>
                        <div className="text-xs">{new Date(record.checked_in_at).toLocaleTimeString()}</div>
                      </Td>
                      <Td>
                        {record.badge_printed_on_site ? (
                          <Badge variant="soft" color="green">
                            Yes
                          </Badge>
                        ) : (
                          <Badge variant="soft" color="gray">
                            No
                          </Badge>
                        )}
                      </Td>
                      <Td>
                        <div className="flex items-center gap-3">
                          <span className="text-lg font-semibold text-[var(--blue-11)]">
                            {record.scan_count || 0}
                          </span>
                          {(record.scan_count ?? 0) > 0 && (
                            <Button
                              variant="ghost"
                              size="1"
                              onClick={() => handleExportAttendeeScans(record.people_profile_id, record.full_name || 'attendee')}
                              className="text-xs"
                            >
                              Export
                            </Button>
                          )}
                        </div>
                      </Td>
                      <Td className="text-[var(--gray-a11)]">
                        {record.qr_code_id || '-'}
                      </Td>
                      <Td data-sticky-right style={{ position: 'sticky', right: 0, zIndex: 10, background: 'var(--color-panel-solid)' }}>
                        <RowActions actions={[
                          {
                            label: 'Delete',
                            icon: <TrashIcon className="w-4 h-4" />,
                            onClick: () => handleDeleteClick(record.id, record.full_name || record.email || 'this attendance record'),
                            color: 'red',
                          },
                        ]} />
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </ScrollableTable>

            {filteredAttendance.length === 0 && searchQuery && (
              <div className="text-center py-8 text-[var(--gray-a11)]">
                <p>No attendance records found matching "{searchQuery}"</p>
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between border-t border-[var(--gray-a6)] pt-4">
                <div className="text-sm text-[var(--gray-a11)]">
                  Showing {startIndex + 1}-{Math.min(endIndex, filteredAttendance.length)} of {filteredAttendance.length} attendance records
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" color="gray" onClick={() => setCurrentPage(1)} disabled={currentPage === 1}>
                    First
                  </Button>
                  <Button variant="outline" color="gray" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>
                    Previous
                  </Button>
                  <span className="px-3 py-1 text-sm text-[var(--gray-11)]">
                    Page {currentPage} of {totalPages}
                  </span>
                  <Button variant="outline" color="gray" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>
                    Next
                  </Button>
                  <Button variant="outline" color="gray" onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages}>
                    Last
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <ConfirmModal
        isOpen={deleteModal.isOpen}
        onClose={() => setDeleteModal({ isOpen: false, attendanceId: null, attendeeName: '' })}
        onConfirm={handleDeleteConfirm}
        title="Delete Attendance Record"
        message={`Are you sure you want to delete the attendance record for ${deleteModal.attendeeName}? This action cannot be undone.`}
        confirmText="Delete"
        confirmVariant="danger"
      />
    </Card>
  );
};

export default EventDetailPage;
