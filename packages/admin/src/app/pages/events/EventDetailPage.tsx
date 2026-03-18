// @ts-nocheck
import { useState, useEffect, Fragment } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
  TicketIcon,
  CodeBracketIcon,
  TrophyIcon,
  PhotoIcon,
  ArrowLeftIcon,
  CheckIcon,
  XMarkIcon,
  PlusIcon,
  UsersIcon,
  UserGroupIcon,
  BuildingOfficeIcon,
  QrCodeIcon,
  ListBulletIcon,
  MagnifyingGlassIcon,
  EyeIcon,
  ArrowDownTrayIcon,
  EnvelopeIcon,
  ChartBarIcon,
  BellIcon,
  Cog6ToothIcon,
  CurrencyDollarIcon,
  MicrophoneIcon,
  HeartIcon,
  SwatchIcon,
  StarIcon,
  SignalIcon,
  SparklesIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';
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
} from '@/components/ui-legacy';
import { Page } from '@/components/shared/Page';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { TopicSelector } from '@/components/shared/TopicSelector';
import { TimezoneSelector } from '@/components/events/TimezoneSelector';
import { EventService, Event } from '@/utils/eventService';
import { EventQrService, EventSponsor, EventRegistration, EventAttendance, Sponsor } from '@/utils/eventQrService';
import { getSponsorMediaCounts } from '@/utils/eventMediaService';
import { useAuthContext } from '@/app/contexts/auth/context';
import { BulkRegistrationUpload } from '@/components/events/BulkRegistrationUpload';
import { BulkAttendanceUpload } from '@/components/events/BulkAttendanceUpload';
import { LumaUpload } from '@/components/events/LumaUpload';
import { LumaUploadStatus } from '@/components/events/LumaUploadStatus';
import { getBrandId } from '@/utils/brandUtils';
import { AddMemberModal } from '@/components/events/AddMemberModal';
import { EventImageUpload } from '@/components/events/EventImageUpload';
import { EventAgendaTab } from '@/components/events/EventAgendaTab';
import { EventSpeakersTab } from '@/components/events/EventSpeakersTab';
import { EventMediaTab } from '@/components/events/EventMediaTab';
import { EventCommunicationsTab } from '@/components/events/EventCommunicationsTab';
import { SendSponsorEmailModal } from '@/components/emails/SendSponsorEmailModal';
import { EventBudgetTab } from '@/components/events/EventBudgetTab';
import { EventInterestTab } from '@/components/events/EventInterestTab';
import { AccountService } from '@/utils/accountService';
import { supabase, Account } from '@/lib/supabase';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { QRCodeService } from '@/utils/qrCodeService';
import { analyzeGradientColors } from '@/utils/colorUtils';
import { RichTextEditor } from '@/components/ui-legacy/RichTextEditor';
import { AdPlatformSettings } from '@/components/events/AdPlatformSettings';
import { ConversionLog } from '@/components/events/ConversionLog';
import { RegistrationFieldMappings } from '@/components/events/RegistrationFieldMappings';
import { useGradualSync, GradualSyncButton, GradualSyncStatus } from '@/components/events/GradualSyncButton';
import { EventCompetitionsTab } from '@/components/events/EventCompetitionsTab';
import { EventDiscountsTab } from '@/components/events/EventDiscountsTab';
import { EventMatchingTab } from '@/components/events/EventMatchingTab';
import { CventSettings } from '@/components/events/CventSettings';

// Form validation schema
const eventSchema = yup.object({
  eventTitle: yup.string().required('Event title is required').min(3, 'Title must be at least 3 characters'),
  eventCity: yup.string().required(),
  eventCountryCode: yup.string().required().max(5, 'Country code must be 5 characters or less'),
  eventLink: yup.string().url('Must be a valid URL').required('Event link is required'),
  eventStart: yup.string().optional(),
  eventEnd: yup.string().optional(),
  eventTimezone: yup.string().optional(),
  listingType: yup.string().optional(),
  eventType: yup.string().optional(),
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
  gradualEventslug: yup.string().optional().nullable(),
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
  portalTheme: yup.string().optional().nullable(),
});

type EventFormData = yup.InferType<typeof eventSchema>;

type PortalTheme = 'blobs' | 'gradient_wave' | 'basic';

interface ThemeColorsMap {
  blobs: { background: string; blob1: string; blob2: string; blob3: string };
  gradient_wave: { start: string; middle: string; end: string };
  basic: { background: string };
}

const DEFAULT_THEME_COLORS: ThemeColorsMap = {
  blobs: { background: '#0d1218', blob1: '#ca2b7f', blob2: '#4086c6', blob3: '#1e2837' },
  gradient_wave: { start: '#ca2b7f', middle: '#4086c6', end: '#0d1218' },
  basic: { background: '#0d1218' },
};

const EventDetailPage = () => {
  const { eventId, tab } = useParams<{ eventId: string; tab?: string }>();
  const navigate = useNavigate();
  const { adminProfile, isAdmin } = useAuthContext();

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
  const [eventThemeColors, setEventThemeColors] = useState<ThemeColorsMap>({ ...DEFAULT_THEME_COLORS });

  // Derive active tab from URL, default to 'settings'
  const validTabs = ['settings', 'agenda', 'speakers', 'sponsors', 'competitions', 'discounts', 'interest', 'registrations', 'attendance', 'matching', 'reports', 'budget', 'communications', 'media', 'tracking'] as const;
  type TabType = typeof validTabs[number];
  const activeTab: TabType = (tab && validTabs.includes(tab as TabType)) ? tab as TabType : 'settings';

  // Flat tab list for single-row navigation
  const allTabs: { id: TabType; label: string; icon: typeof Cog6ToothIcon; color: string; conditional?: boolean }[] = [
    { id: 'settings', label: 'Settings', icon: Cog6ToothIcon, color: 'text-primary-600 dark:text-primary-400' },
    { id: 'agenda', label: 'Agenda', icon: ListBulletIcon, color: 'text-primary-600 dark:text-primary-400' },
    { id: 'speakers', label: 'Speakers', icon: MicrophoneIcon, color: 'text-primary-600 dark:text-primary-400' },
    { id: 'sponsors', label: 'Sponsors', icon: BuildingOfficeIcon, color: 'text-primary-600 dark:text-primary-400' },
    { id: 'competitions', label: 'Competitions', icon: TrophyIcon, color: 'text-yellow-500' },
    { id: 'discounts', label: 'Discounts', icon: TicketIcon, color: 'text-amber-500' },
    { id: 'interest', label: 'Interest', icon: HeartIcon, color: 'text-pink-500' },
    { id: 'registrations', label: 'Registrations', icon: UserGroupIcon, color: 'text-blue-500' },
    { id: 'attendance', label: 'Attendance', icon: UsersIcon, color: 'text-green-500' },
    { id: 'matching', label: 'Matching', icon: SparklesIcon, color: 'text-violet-500' },
    { id: 'reports', label: 'Reports', icon: ChartBarIcon, color: 'text-purple-500' },
    { id: 'budget', label: 'Budget', icon: CurrencyDollarIcon, color: 'text-emerald-500' },
    { id: 'communications', label: 'Comms', icon: EnvelopeIcon, color: 'text-orange-500' },
    { id: 'media', label: 'Media', icon: PhotoIcon, color: 'text-cyan-500' },
    { id: 'tracking', label: 'Tracking', icon: SignalIcon, color: 'text-rose-500' },
  ];

  // Helper function to navigate to a tab
  const navigateToTab = (newTab: TabType) => {
    navigate(`/events/${eventId}/${newTab}`);
  };

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<EventFormData>({
    resolver: yupResolver(eventSchema),
  });

  const listingType = watch('listingType');

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
      eventTimezone: eventData.eventTimezone || 'UTC',
      listingType: eventData.listingType || '',
      eventType: eventData.eventType || '',
      eventRegion: eventData.eventRegion || '',
      eventDescription: eventData.eventDescription || '',
      listingIntro: eventData.listingIntro || '',
      eventTopics: eventData.eventTopics || [],
      isLiveInProduction: eventData.isLiveInProduction || false,
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
      gradualEventslug: eventData.gradualEventslug || '',
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
      portalTheme: eventData.portalTheme || '',
    });
    // Populate theme colors from event data (stored as flat colors for the active theme)
    if (eventData.themeColors && eventData.portalTheme) {
      const theme = eventData.portalTheme as PortalTheme;
      setEventThemeColors(prev => ({
        ...prev,
        [theme]: { ...DEFAULT_THEME_COLORS[theme], ...eventData.themeColors },
      }));
    } else {
      setEventThemeColors({ ...DEFAULT_THEME_COLORS });
    }
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
      const updates: Partial<Event> = {
        eventTitle: data.eventTitle,
        eventCity: data.eventCity,
        eventCountryCode: data.eventCountryCode,
        eventLink: data.eventLink,
        eventStart: fromDatetimeLocal(data.eventStart, data.eventTimezone),
        eventEnd: fromDatetimeLocal(data.eventEnd, data.eventTimezone),
        eventTimezone: data.eventTimezone || 'UTC',
        listingType: data.listingType || null,
        eventType: data.eventType || null,
        eventRegion: data.eventRegion || null,
        eventDescription: data.eventDescription || null,
        listingIntro: data.listingIntro || null,
        eventTopics: data.eventTopics || [],
        isLiveInProduction: data.isLiveInProduction || false,
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
        gradualEventslug: data.gradualEventslug || null,
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
        portalTheme: data.portalTheme || null,
        themeColors: data.portalTheme ? eventThemeColors[data.portalTheme as PortalTheme] : null,
      };

      // Use event.id (UUID) instead of eventId (event_id string)
      // Pass original event so geocoding only triggers when city/country actually changes
      const result = await EventService.updateEvent(event.id, updates, event);
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
      const response = await EventService.generateCheckinQrCode(eventId);
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
            <p className="text-sm font-medium text-gray-900 dark:text-white">Loading event details</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Please wait...</p>
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
            <CalendarIcon className="w-8 h-8 text-gray-400 dark:text-gray-500" />
          </div>
          <div className="text-center">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Event not found</h3>
            <p className="text-gray-500 dark:text-gray-400 max-w-md mb-4">
              The event you're looking for doesn't exist or may have been deleted.
            </p>
            <Button onClick={() => navigate('/events')} color="primary" className="gap-2">
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
          <div className="absolute inset-0 bg-gradient-to-br from-primary-600 via-primary-700 to-primary-900 dark:from-primary-800 dark:via-primary-900 dark:to-gray-900" />
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
            className="flex items-center gap-2 px-4 py-2 bg-white/10 backdrop-blur-md border border-white/20 text-white rounded-xl hover:bg-white/20 transition-all duration-200 hover:scale-[1.02] shadow-lg shadow-black/20"
          >
            <ArrowLeftIcon className="size-4" />
            <span className="text-sm font-medium">Back</span>
          </button>
        </div>

        {/* Status badges - Top right */}
        <div className="absolute top-6 z-10 flex gap-2" style={{ right: 'calc(var(--margin-x) + 1.5rem)' }}>
          {event.isLiveInProduction ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-500/20 backdrop-blur-md border border-green-400/30 text-green-300 rounded-full text-xs font-semibold">
              <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
              Live
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/20 backdrop-blur-md border border-amber-400/30 text-amber-300 rounded-full text-xs font-semibold">
              <span className="w-1.5 h-1.5 bg-amber-400 rounded-full" />
              Draft
            </span>
          )}
          {event.listingType && (
            <span className="inline-flex items-center px-3 py-1.5 bg-white/10 backdrop-blur-md border border-white/20 text-white/90 rounded-full text-xs font-medium capitalize">
              {event.listingType}
            </span>
          )}
        </div>

        {/* Event Title and Info - Enhanced typography */}
        <div className="absolute bottom-0 left-0 right-0" style={{ padding: '0 calc(var(--margin-x) + 1.5rem) 1.75rem' }}>
          {/* Event type pill */}
          {event.eventType && (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white/10 backdrop-blur-sm rounded-lg text-xs font-medium text-white/80 mb-3">
              {event.eventType === 'conference' && '🎤'}
              {event.eventType === 'workshop' && '🛠'}
              {event.eventType === 'meetup' && '👥'}
              {event.eventType === 'webinar' && '💻'}
              {!['conference', 'workshop', 'meetup', 'webinar'].includes(event.eventType) && '📅'}
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

      {/* Tab Navigation - Full-width directly under hero, two rows */}
      <nav className="flex flex-wrap bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 -mx-(--margin-x) pr-(--margin-x) pl-[calc(var(--margin-x)+0.5rem)]">
        {allTabs
          .map((tab) => {
            const TabIcon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => navigateToTab(tab.id)}
                className={clsx(
                  'whitespace-nowrap px-4 py-2.5 text-sm font-medium flex items-center gap-1.5 border-b-2 transition-colors',
                  isActive
                    ? 'border-primary-600 text-primary-600 dark:border-primary-400 dark:text-primary-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                )}
              >
                <TabIcon className={clsx('w-4 h-4', isActive && tab.color)} />
                <span>{tab.label}</span>
              </button>
            );
          })}
      </nav>

      <div className="p-6 space-y-6">

        {/* Tab Content */}
        {activeTab === 'settings' && (
          <div>
            {/* Settings Header - Enhanced with visual polish */}
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-700 rounded-xl">
                  <Cog6ToothIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-gray-900 dark:text-white tracking-tight">
                    Event Settings
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {isEditMode ? 'Edit your event details below' : 'Manage event configuration and details'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {isEditMode ? (
                  <>
                    <button
                      onClick={handleEditToggle}
                      disabled={isSaving}
                      className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-xl transition-all duration-200 disabled:opacity-50"
                    >
                      <XMarkIcon className="w-4 h-4" />
                      Cancel
                    </button>
                    <button
                      onClick={handleSubmit(onSubmit, (validationErrors) => {
                        const firstError = Object.values(validationErrors)[0];
                        toast.error(firstError?.message || 'Please fix form errors before saving');
                      })}
                      disabled={isSaving}
                      className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 rounded-xl shadow-lg shadow-primary-500/25 transition-all duration-200 disabled:opacity-50 hover:scale-[1.02]"
                    >
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
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => setShowDeleteConfirm(true)}
                      className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-xl transition-all duration-200"
                    >
                      <TrashIcon className="w-4 h-4" />
                      Delete
                    </button>
                    <button
                      onClick={handleEditToggle}
                      className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 rounded-xl shadow-lg shadow-primary-500/25 transition-all duration-200 hover:scale-[1.02]"
                    >
                      <PencilIcon className="w-4 h-4" />
                      Edit Event
                    </button>
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
            />
          </div>
        )}

        {activeTab === 'agenda' && event?.id && (
          <EventAgendaTab
            eventUuid={event.id}
            eventStart={event.eventStart}
            eventEnd={event.eventEnd}
            talkDurationOptions={event.talkDurationOptions}
            onTalkDurationOptionsChange={handleTalkDurationOptionsChange}
          />
        )}

        {activeTab === 'speakers' && event?.id && (
          <EventSpeakersTab
            eventUuid={event.id}
            eventId={event.eventId}
            eventLink={event.eventLink || ''}
            eventTitle={event.eventTitle}
            talkDurationOptions={event.talkDurationOptions}
          />
        )}

        {activeTab === 'sponsors' && (
          <EventSponsorsTab eventId={eventId!} event={event} />
        )}

        {activeTab === 'interest' && (
          <EventInterestTab eventId={eventId!} />
        )}

        {activeTab === 'registrations' && (
          <div className="space-y-6">
            <RegistrationFieldMappings eventId={eventId!} />
            <EventRegistrationsTab eventId={eventId!} gradualEventslug={event?.gradualEventslug} />
          </div>
        )}

        {activeTab === 'attendance' && (
          <EventAttendanceTab eventId={eventId!} />
        )}

        {activeTab === 'reports' && (
          <EventReportsTab eventId={eventId!} />
        )}

        {activeTab === 'budget' && (
          <EventBudgetTab eventId={eventId!} />
        )}

        {activeTab === 'communications' && eventId && (
          <EventCommunicationsTab
            eventId={eventId}
            eventUuid={event.id}
            eventTitle={event.eventTitle}
          />
        )}

        {activeTab === 'media' && eventId && (
          <EventMediaTab eventId={eventId} />
        )}

        {activeTab === 'competitions' && eventId && (
          <EventCompetitionsTab
            eventId={eventId}
            eventTitle={event.eventTitle}
            eventStart={event.eventStart}
            eventEnd={event.eventEnd}
            offerTicketDetails={event.offerTicketDetails}
          />
        )}

        {activeTab === 'discounts' && eventId && (
          <EventDiscountsTab eventId={eventId} />
        )}

        {activeTab === 'matching' && eventId && (
          <EventMatchingTab eventId={eventId} />
        )}

        {activeTab === 'tracking' && eventId && (
          <div className="space-y-6">
            <AdPlatformSettings eventId={eventId} accountId={event.accountId || undefined} eventSlug={event.eventSlug} />
            <CventSettings eventId={eventId} />
            <ConversionLog eventId={eventId} />
          </div>
        )}

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

// Helper function to convert relative URIs to absolute URLs
const getAbsoluteImageUrl = (url: string | undefined): string | undefined => {
  if (!url) return undefined;

  // If it's already an absolute URL, return as is
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }

  // If it's a relative path, prepend the base URL
  if (url.startsWith('/')) {
    return `https://www.tech.tickets${url}`;
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
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 text-xs font-medium rounded ${colorClass}`}>
            {title}
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {sizeKB} KB
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {isExpanded ? 'Hide' : 'View'} Data
          </span>
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>
      {isExpanded && (
        <div className="border-t border-gray-200 dark:border-gray-700">
          <pre className="p-4 text-xs font-mono text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/50 overflow-x-auto max-h-96 overflow-y-auto">
            {jsonString}
          </pre>
        </div>
      )}
    </div>
  );
};

// Event Details Tab Component
const EventDetailsTab = ({ event, isEditMode, register, errors, watch, setValue, onGenerateQrCode, isGeneratingQr, isSaving, accounts, allEvents, qrCodeDataUrl }: any) => {
  // Use form value in edit mode, event value in view mode
  const listingType = isEditMode ? watch('listingType') : event.listingType;
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
                <TagIcon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">
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
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Event Title
                  </label>
                  <p className="text-gray-900 dark:text-white">{event.eventTitle || 'N/A'}</p>
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
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      City
                    </label>
                    <p className="text-gray-900 dark:text-white">{event.eventCity || 'N/A'}</p>
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
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Country Code
                    </label>
                    <p className="text-gray-900 dark:text-white">{event.eventCountryCode || 'N/A'}</p>
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
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Event URL
                  </label>
                  {event.eventLink ? (
                    <a href={event.eventLink} target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 break-all">
                      {event.eventLink}
                    </a>
                  ) : (
                    <p className="text-gray-900 dark:text-white">N/A</p>
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
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Event Location
                  </label>
                  <p className="text-gray-900 dark:text-white">{event.eventLocation || 'N/A'}</p>
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
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Venue Address
                  </label>
                  <p className="text-gray-900 dark:text-white">{event.venueAddress || 'N/A'}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                {isEditMode ? (
                  <Select
                    label="Listing Type"
                    {...register('listingType')}
                    error={errors.listingType?.message}
                  >
                    <option value="">Select type</option>
                    <option value="active">Active</option>
                    <option value="under construction">Under Construction</option>
                  </Select>
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Listing Type
                    </label>
                    <p className="text-gray-900 dark:text-white capitalize">{event.listingType || 'N/A'}</p>
                  </div>
                )}

                {isEditMode ? (
                  <Select
                    label="Event Type"
                    {...register('eventType')}
                    error={errors.eventType?.message}
                  >
                    <option value="">Select type</option>
                    <option value="conference">Conference</option>
                    <option value="workshop">Workshop</option>
                    <option value="meetup">Meetup</option>
                    <option value="webinar">Webinar</option>
                    <option value="hackathon">Hackathon</option>
                  </Select>
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Event Type
                    </label>
                    <p className="text-gray-900 dark:text-white capitalize">{event.eventType || 'N/A'}</p>
                  </div>
                )}
              </div>

              {isEditMode && (
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Event Topics
                  </label>
                  <TopicSelector
                    value={watch('eventTopics') || []}
                    onChange={(topics) => setValue('eventTopics', topics)}
                  />
                </div>
              )}

              {!isEditMode && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Event Topics
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {event.eventTopics && event.eventTopics.length > 0 ? (
                      event.eventTopics.map((topic: string) => (
                        <Badge key={topic} variant="secondary">{topic}</Badge>
                      ))
                    ) : (
                      <span className="text-sm text-gray-500">No topics assigned</span>
                    )}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Event Description
                </label>
                {isEditMode ? (
                  <textarea
                    {...register('eventDescription')}
                    rows={4}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                    placeholder="General event description (used in calendar invites, event details, etc.)"
                  />
                ) : (
                  <p className="text-sm text-gray-600 dark:text-gray-400">
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
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">
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
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Start Date
                    </label>
                    <div className="space-y-1">
                      <p className="text-gray-900 dark:text-white font-mono text-sm">
                        {event.eventStart ? new Date(event.eventStart).toISOString().replace('T', ' ').replace('.000Z', ' UTC') : 'N/A'}
                      </p>
                      {event.eventStart && event.eventTimezone && event.eventTimezone !== 'UTC' && (
                        <p className="text-sm text-gray-600 dark:text-gray-400">
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
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      End Date
                    </label>
                    <div className="space-y-1">
                      <p className="text-gray-900 dark:text-white font-mono text-sm">
                        {event.eventEnd ? new Date(event.eventEnd).toISOString().replace('T', ' ').replace('.000Z', ' UTC') : 'N/A'}
                      </p>
                      {event.eventEnd && event.eventTimezone && event.eventTimezone !== 'UTC' && (
                        <p className="text-sm text-gray-600 dark:text-gray-400">
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

{isEditMode ? (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Event Location Timezone
                  </label>
                  <TimezoneSelector
                    value={watch('eventTimezone')}
                    onChange={(value) => setValue('eventTimezone', value)}
                    error={errors.eventTimezone?.message}
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Times above are shown in this timezone. They are converted to UTC for storage.
                  </p>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Event Location Timezone
                  </label>
                  <div className="flex items-center gap-2">
                    <GlobeAltIcon className="w-4 h-4 text-gray-400" />
                    <p className="text-gray-900 dark:text-white font-medium">{event.eventTimezone || 'UTC'}</p>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
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
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                Page Content
              </h3>
              <span className="text-xs text-gray-500 dark:text-gray-400">
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
                  <p className="text-sm text-gray-500 dark:text-gray-400 italic">
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
                <MapPinIcon className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                  Venue Details
                </h3>
                <span className="text-xs text-gray-500 dark:text-gray-400">
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
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
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
                  <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                    No venue details configured.
                  </p>
                )}
                {event.venueMapImage && (
                  <div className="mt-4">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Floor Plan</p>
                    <img src={event.venueMapImage} alt="Venue map" className="max-w-full rounded-lg border border-gray-200 dark:border-gray-700" />
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
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                  Added Page
                </h3>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Extra page content — shown as a separate page in the event portal sidebar
                </span>
              </div>
            </div>
            {isEditMode ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Page Title
                  </label>
                  <input
                    type="text"
                    {...register('addedpageTitle')}
                    placeholder="Workshops"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
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
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Title: {event.addedpageTitle}
                  </p>
                )}
                {event.addedpageContent ? (
                  <div
                    className="prose prose-sm max-w-none dark:prose-invert"
                    dangerouslySetInnerHTML={{ __html: event.addedpageContent }}
                  />
                ) : (
                  <p className="text-sm text-gray-500 dark:text-gray-400 italic">
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
                <EyeIcon className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                  Imported Content Preview
                </h3>
              </div>
              <div className="flex gap-3">
                {event.lumaProcessedHtml && (
                  <Button
                    variant="outlined"
                    size="sm"
                    onClick={() => setShowLumaPreview(true)}
                  >
                    <EyeIcon className="w-4 h-4 mr-2" />
                    View Luma Content
                  </Button>
                )}
                {event.meetupProcessedHtml && (
                  <Button
                    variant="outlined"
                    size="sm"
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
                <CheckIcon className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                Status
              </h3>
            </div>
            <div className="space-y-3">
              {isEditMode ? (
                <>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      {...register('isLiveInProduction')}
                      className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      Live in Production
                    </span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      {...register('enableRegistration')}
                      className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      Enable Registration
                    </span>
                  </label>
                  {watch('enableRegistration') && (
                    <label className="flex items-center gap-2 ml-6">
                      <input
                        type="checkbox"
                        {...register('enableNativeRegistration')}
                        className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">
                        Register on Event Portal
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        (instead of external link)
                      </span>
                    </label>
                  )}
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      {...register('walkinsAllowed')}
                      className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      Walk-ins Allowed
                    </span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      {...register('enableCallForSpeakers')}
                      className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      Enable Call for Speakers
                    </span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      {...register('enableAgenda')}
                      className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      Enable Agenda
                    </span>
                  </label>
                  {watch('enableRegistration') && (
                    <div className="pt-2">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Register Button Text
                      </label>
                      <input
                        type="text"
                        {...register('registerButtonText')}
                        placeholder="Register Now"
                        className="block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
                      />
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        Custom text for register buttons (default: "Register Now")
                      </p>
                    </div>
                  )}
                  <div className="pt-2">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Luma Event ID
                    </label>
                    <input
                      type="text"
                      {...register('lumaEventId')}
                      placeholder="evt-XXXXX"
                      className="block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
                    />
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Link this event to a Luma event for CSV imports and email notifications
                    </p>
                  </div>
                  <div className="pt-2">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Gradual Event Slug
                    </label>
                    <input
                      type="text"
                      {...register('gradualEventslug')}
                      placeholder="event-name-xxxxx"
                      className="block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
                    />
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Link this event to a Gradual event for webhook registrations and check-ins
                    </p>
                  </div>
                  <div className="pt-2">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Source Event ID
                    </label>
                    <input
                      type="text"
                      {...register('sourceEventId')}
                      placeholder="e.g., eguzf-gg"
                      className="block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
                    />
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Native ID from external source (e.g., dev.events). Used for tracking across URL changes.
                    </p>
                  </div>
                  <div className="pt-4 border-t border-gray-200 dark:border-gray-600 mt-4">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Custom Domain
                    </label>
                    <input
                      type="text"
                      {...register('customDomain')}
                      placeholder="e.g., myconference.com"
                      className="block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
                    />
                    {errors.customDomain && (
                      <p className="mt-1 text-xs text-red-500">{errors.customDomain.message}</p>
                    )}
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Set up a custom domain for a white-label event website. Enter the bare hostname (no https://).
                    </p>
                    {event?.customDomain && (
                      <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                        <p className="text-xs font-medium text-blue-800 dark:text-blue-300 mb-1">DNS Configuration</p>
                        <p className="text-xs text-blue-700 dark:text-blue-400">
                          Add a CNAME record pointing to:
                        </p>
                        <code className="text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300 px-2 py-0.5 rounded mt-1 inline-block">
                          custom.tech.tickets
                        </code>
                        {event.customDomainStatus && (
                          <div className="mt-2">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                              event.customDomainStatus === 'active'
                                ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                                : event.customDomainStatus === 'error'
                                  ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                                  : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                            }`}>
                              {event.customDomainStatus}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600 dark:text-gray-400">Production Status</span>
                    <Badge variant={event.isLiveInProduction ? 'success' : 'secondary'}>
                      {event.isLiveInProduction ? 'Live' : 'Draft'}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600 dark:text-gray-400">Registration</span>
                    <Badge variant={event.enableRegistration ? 'success' : 'secondary'}>
                      {event.enableRegistration ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </div>
                  {event.enableRegistration && (
                    <div className="flex items-center justify-between ml-4">
                      <span className="text-sm text-gray-600 dark:text-gray-400">Registration Location</span>
                      <Badge variant={event.enableNativeRegistration ? 'success' : 'secondary'}>
                        {event.enableNativeRegistration ? 'Event Portal' : 'External Link'}
                      </Badge>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600 dark:text-gray-400">Walk-ins</span>
                    <Badge variant={event.walkinsAllowed ? 'success' : 'secondary'}>
                      {event.walkinsAllowed ? 'Allowed' : 'Not Allowed'}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600 dark:text-gray-400">Call for Speakers</span>
                    <Badge variant={event.enableCallForSpeakers ? 'success' : 'secondary'}>
                      {event.enableCallForSpeakers ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600 dark:text-gray-400">Agenda</span>
                    <Badge variant={event.enableAgenda ? 'success' : 'secondary'}>
                      {event.enableAgenda ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </div>
                  {event.lumaEventId && (
                    <div className="flex items-center justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
                      <span className="text-sm text-gray-600 dark:text-gray-400">Luma Event ID</span>
                      <code className="text-sm font-mono text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded">
                        {event.lumaEventId}
                      </code>
                    </div>
                  )}
                  {event.gradualEventslug && (
                    <div className="flex items-center justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
                      <span className="text-sm text-gray-600 dark:text-gray-400">Gradual Event Slug</span>
                      <code className="text-sm font-mono text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded">
                        {event.gradualEventslug}
                      </code>
                    </div>
                  )}
                  {event.sourceEventId && (
                    <div className="flex items-center justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
                      <span className="text-sm text-gray-600 dark:text-gray-400">Source Event ID</span>
                      <code className="text-sm font-mono text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded">
                        {event.sourceEventId}
                      </code>
                    </div>
                  )}
                  {event.customDomain && (
                    <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-600 dark:text-gray-400">Custom Domain</span>
                        <div className="flex items-center gap-2">
                          <code className="text-sm font-mono text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded">
                            {event.customDomain}
                          </code>
                          {event.customDomainStatus && (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                              event.customDomainStatus === 'active'
                                ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                                : event.customDomainStatus === 'error'
                                  ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                                  : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                            }`}>
                              {event.customDomainStatus}
                            </span>
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
                <BuildingOfficeIcon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">
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
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Associated Account
                  </label>
                  <p className="text-gray-900 dark:text-white">
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
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">
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
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Recommended Event
                  </label>
                  <p className="text-gray-900 dark:text-white">
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
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
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
                    colorClass="text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20"
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
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                  Check-In QR Code
                </h3>
              </div>
              {event.checkinQrCode ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-center bg-white p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                    {qrCodeDataUrl ? (
                      <img
                        src={qrCodeDataUrl}
                        alt="Event Check-in QR Code"
                        className="w-48 h-48"
                      />
                    ) : (
                      <div className="w-48 h-48 flex items-center justify-center">
                        <div className="text-gray-400">Loading QR Code...</div>
                      </div>
                    )}
                  </div>
                  <div className="text-center">
                    <p className="text-xs font-mono text-gray-600 dark:text-gray-400 mb-2">
                      {event.checkinQrCode}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Display this QR code at the event venue for attendee check-in
                    </p>
                  </div>
                  <div className="pt-2">
                    <button
                      onClick={() => QRCodeService.downloadQRCode(event.checkinQrCode!, `${event.eventId}-checkin-qr`, 1000)}
                      className="block w-full text-center px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-md transition-colors"
                    >
                      Download High-Res QR Code
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-center h-48 bg-gray-50 dark:bg-gray-800 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600">
                    <div className="text-center">
                      <QrCodeIcon className="w-12 h-12 mx-auto mb-2 text-gray-400" />
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        No check-in QR code generated yet
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="primary"
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
                  <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
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
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">
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
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Event Logo
                    </label>
                    {event.eventLogo ? (
                      <div className="bg-black rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                        <img
                          src={getAbsoluteImageUrl(event.eventLogo)}
                          alt="Event logo"
                          className="w-full h-auto"
                        />
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-32 bg-gray-100 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                        <PhotoIcon className="w-8 h-8 text-gray-400" />
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
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Badge Logo
                    </label>
                    {event.badgeLogo ? (
                      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                        <img
                          src={getAbsoluteImageUrl(event.badgeLogo)}
                          alt="Badge logo"
                          className="w-full h-auto max-h-32 object-contain"
                        />
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-32 bg-gray-100 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                        <PhotoIcon className="w-8 h-8 text-gray-400" />
                      </div>
                    )}
                  </>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Screenshot
                  <span className="ml-2 text-xs text-gray-500 font-normal">(Auto-generated or upload custom)</span>
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
                      className="w-full h-auto rounded-lg border border-gray-200 dark:border-gray-700"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-32 bg-gray-100 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                      <PhotoIcon className="w-8 h-8 text-gray-400" />
                      <span className="ml-2 text-sm text-gray-500">No screenshot</span>
                    </div>
                  )
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Featured Image
                  <span className="ml-2 text-xs text-gray-500 font-normal">(Used for social sharing & blog posts)</span>
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
                      className="w-full h-auto rounded-lg border border-gray-200 dark:border-gray-700"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-32 bg-gray-100 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                      <PhotoIcon className="w-8 h-8 text-gray-400" />
                    </div>
                  )
                )}
              </div>
            </div>
          </div>
        </Card>

        {/* Appearance - Theme & Colors */}
        <Card className="overflow-hidden border-0 shadow-sm">
          <div className="p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="p-2 bg-gradient-to-br from-pink-50 to-purple-50 dark:from-pink-900/20 dark:to-purple-900/20 rounded-lg">
                <SwatchIcon className="w-5 h-5 text-pink-600 dark:text-pink-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                  Appearance
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Override the portal background theme and colors for this event
                </p>
              </div>
            </div>
            <div className="space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Select a theme and customize colors for this event's portal page.
                Leave as "Use brand default" to inherit the global brand theme.
              </p>

              {/* Theme Picker */}
              {isEditMode ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Portal Theme
                    </label>
                    <div className="grid grid-cols-4 gap-3">
                      <button
                        type="button"
                        onClick={() => setValue('portalTheme', '')}
                        className={`rounded-lg border-2 p-3 text-left transition-colors ${
                          !watch('portalTheme')
                            ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
                            : 'border-gray-200 dark:border-gray-700 hover:border-indigo-300'
                        }`}
                      >
                        <div className="text-sm font-medium text-gray-900 dark:text-white">Brand Default</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">Inherit from settings</div>
                      </button>
                      {([
                        { value: 'blobs', label: 'Blobs', desc: 'Animated floating blobs' },
                        { value: 'gradient_wave', label: 'Gradient Wave', desc: 'Smooth animated gradient' },
                        { value: 'basic', label: 'Basic', desc: 'Solid background color' },
                      ] as const).map((t) => (
                        <button
                          key={t.value}
                          type="button"
                          onClick={() => setValue('portalTheme', t.value)}
                          className={`rounded-lg border-2 p-3 text-left transition-colors ${
                            watch('portalTheme') === t.value
                              ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
                              : 'border-gray-200 dark:border-gray-700 hover:border-indigo-300'
                          }`}
                        >
                          <div className="text-sm font-medium text-gray-900 dark:text-white">{t.label}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">{t.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Theme-specific color inputs */}
                  {watch('portalTheme') === 'blobs' && (
                    <div className="grid grid-cols-2 gap-4 mt-4">
                      {([
                        { key: 'background', label: 'Background' },
                        { key: 'blob1', label: 'Blob 1' },
                        { key: 'blob2', label: 'Blob 2' },
                        { key: 'blob3', label: 'Blob 3' },
                      ] as const).map(({ key, label }) => (
                        <div key={key}>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{label}</label>
                          <div className="flex gap-2">
                            <input
                              type="color"
                              value={eventThemeColors.blobs[key]}
                              onChange={(e) => setEventThemeColors(prev => ({
                                ...prev,
                                blobs: { ...prev.blobs, [key]: e.target.value },
                              }))}
                              className="w-12 h-10 rounded-lg border border-gray-300 dark:border-gray-600 cursor-pointer"
                            />
                            <Input
                              value={eventThemeColors.blobs[key]}
                              onChange={(e) => setEventThemeColors(prev => ({
                                ...prev,
                                blobs: { ...prev.blobs, [key]: e.target.value },
                              }))}
                              placeholder={DEFAULT_THEME_COLORS.blobs[key]}
                              className="flex-1"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {watch('portalTheme') === 'gradient_wave' && (
                    <div className="grid grid-cols-3 gap-4 mt-4">
                      {([
                        { key: 'start', label: 'Start' },
                        { key: 'middle', label: 'Middle' },
                        { key: 'end', label: 'End' },
                      ] as const).map(({ key, label }) => (
                        <div key={key}>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{label}</label>
                          <div className="flex gap-2">
                            <input
                              type="color"
                              value={eventThemeColors.gradient_wave[key]}
                              onChange={(e) => setEventThemeColors(prev => ({
                                ...prev,
                                gradient_wave: { ...prev.gradient_wave, [key]: e.target.value },
                              }))}
                              className="w-12 h-10 rounded-lg border border-gray-300 dark:border-gray-600 cursor-pointer"
                            />
                            <Input
                              value={eventThemeColors.gradient_wave[key]}
                              onChange={(e) => setEventThemeColors(prev => ({
                                ...prev,
                                gradient_wave: { ...prev.gradient_wave, [key]: e.target.value },
                              }))}
                              placeholder={DEFAULT_THEME_COLORS.gradient_wave[key]}
                              className="flex-1"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {watch('portalTheme') === 'basic' && (
                    <div className="max-w-xs mt-4">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Background</label>
                      <div className="flex gap-2">
                        <input
                          type="color"
                          value={eventThemeColors.basic.background}
                          onChange={(e) => setEventThemeColors(prev => ({
                            ...prev,
                            basic: { ...prev.basic, background: e.target.value },
                          }))}
                          className="w-12 h-10 rounded-lg border border-gray-300 dark:border-gray-600 cursor-pointer"
                        />
                        <Input
                          value={eventThemeColors.basic.background}
                          onChange={(e) => setEventThemeColors(prev => ({
                            ...prev,
                            basic: { ...prev.basic, background: e.target.value },
                          }))}
                          placeholder={DEFAULT_THEME_COLORS.basic.background}
                          className="flex-1"
                        />
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Portal Theme
                  </label>
                  {event.portalTheme ? (
                    <div className="flex items-center gap-3">
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300 capitalize">
                        {event.portalTheme === 'gradient_wave' ? 'Gradient Wave' : event.portalTheme === 'blobs' ? 'Blobs' : 'Basic'}
                      </span>
                      {event.themeColors && (
                        <div className="flex gap-1">
                          {Object.values(event.themeColors)
                            .filter((v): v is string => typeof v === 'string' && v.startsWith('#')).map((color, i) => (
                            <div
                              key={i}
                              className="w-6 h-6 rounded border border-gray-200 dark:border-gray-700"
                              style={{ backgroundColor: color }}
                              title={color}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="text-gray-500 text-sm">Using brand default</span>
                  )}
                </div>
              )}

              {/* Preview */}
              {(() => {
                const selectedTheme = isEditMode ? watch('portalTheme') as PortalTheme : event?.portalTheme as PortalTheme;
                if (!selectedTheme) return null;
                const colors = isEditMode ? eventThemeColors[selectedTheme] : (
                  event?.themeColors || DEFAULT_THEME_COLORS[selectedTheme]
                );
                let bgStyle: React.CSSProperties = {};
                if (selectedTheme === 'blobs') {
                  const c = colors as ThemeColorsMap['blobs'];
                  bgStyle = { background: `linear-gradient(135deg, ${c.blob1}, ${c.blob2}, ${c.blob3})` };
                } else if (selectedTheme === 'gradient_wave') {
                  const c = colors as ThemeColorsMap['gradient_wave'];
                  bgStyle = { background: `linear-gradient(135deg, ${c.start}, ${c.middle}, ${c.end})` };
                } else if (selectedTheme === 'basic') {
                  const c = colors as ThemeColorsMap['basic'];
                  bgStyle = { background: c.background };
                }
                return (
                  <div className="mt-4">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Preview</label>
                    <div
                      className="h-24 rounded-lg border border-gray-200 dark:border-gray-700 relative overflow-hidden"
                      style={bgStyle}
                    >
                      <span className="absolute inset-0 flex items-center justify-center text-white font-semibold text-lg drop-shadow-lg">
                        Sample Text
                      </span>
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
                <CodeBracketIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                Metadata
              </h3>
            </div>
            <div className="space-y-4">
              {/* Event ID - Special styling */}
              <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Event ID</span>
                <p className="font-mono text-sm text-gray-900 dark:text-white mt-1 break-all select-all">
                  {event.eventId}
                </p>
              </div>

              {/* Event Slug - Editable URL-friendly identifier */}
              <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Event Slug</span>
                {isEditMode ? (
                  <div className="mt-1">
                    <input
                      type="text"
                      {...register('eventSlug')}
                      placeholder="e.g., my-event-2026"
                      className="w-full px-2 py-1 text-sm font-mono bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    />
                    {errors.eventSlug && (
                      <p className="text-xs text-red-500 mt-1">{errors.eventSlug.message}</p>
                    )}
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      URL-friendly identifier for the event portal (lowercase, numbers, hyphens only)
                    </p>
                  </div>
                ) : (
                  <p className="font-mono text-sm text-gray-900 dark:text-white mt-1 break-all select-all">
                    {event.eventSlug || <span className="text-gray-400 italic">Not set</span>}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Entry Method */}
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Entry Method</span>
                  <p className="text-sm text-gray-900 dark:text-white mt-1 flex items-center gap-1.5">
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
                    <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Source</span>
                    <p className="text-sm text-gray-900 dark:text-white mt-1">{event.eventSource}</p>
                  </div>
                )}
              </div>

              {event.sourceType === 'scraper' && (event.scrapedBy || event.sourceDetails?.scraper_name) && (
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Scraper Name</span>
                  <p className="text-sm text-gray-900 dark:text-white mt-1 font-mono">
                    {event.sourceDetails?.scraper_name || event.scrapedBy || 'N/A'}
                  </p>
                </div>
              )}

              <div className="pt-3 border-t border-gray-100 dark:border-gray-800 grid grid-cols-2 gap-4">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Created</span>
                  <p className="text-sm text-gray-900 dark:text-white mt-1">
                    {event.createdAt ? new Date(event.createdAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric'
                    }) : 'N/A'}
                  </p>
                </div>
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Updated</span>
                  <p className="text-sm text-gray-900 dark:text-white mt-1">
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

// Event Sponsors Tab Component
const EventSponsorsTab = ({ eventId, event }: { eventId: string; event: Event | null }) => {
  const navigate = useNavigate();
  const [sponsors, setSponsors] = useState<EventSponsor[]>([]);
  const [allSponsors, setAllSponsors] = useState<Sponsor[]>([]);
  const [sponsorMediaCounts, setSponsorMediaCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingSponsor, setEditingSponsor] = useState<EventSponsor | null>(null);
  const [selectedSponsorId, setSelectedSponsorId] = useState('');
  const [sponsorName, setSponsorName] = useState('');
  const [editingSponsorName, setEditingSponsorName] = useState('');
  const [sponsorDetails, setSponsorDetails] = useState({
    sponsorship_tier: '' as 'platinum' | 'gold' | 'silver' | 'bronze' | 'partner' | 'exhibitor' | 'free' | '',
    booth_number: '',
    booth_size: '',
  });

  // Team management modal state
  const [showTeamModal, setShowTeamModal] = useState(false);
  const [managingSponsor, setManagingSponsor] = useState<EventSponsor | null>(null);
  const [eventRegistrations, setEventRegistrations] = useState<any[]>([]);
  const [selectedRegistrationIds, setSelectedRegistrationIds] = useState<Set<string>>(new Set());
  const [primaryContactId, setPrimaryContactId] = useState<string | null>(null);
  const [teamModalLoading, setTeamModalLoading] = useState(false);
  const [teamSearchQuery, setTeamSearchQuery] = useState('');

  // Scans view modal state
  const [showScansModal, setShowScansModal] = useState(false);
  const [viewingSponsor, setViewingSponsor] = useState<EventSponsor | null>(null);
  const [teamStats, setTeamStats] = useState<any[]>([]);
  const [teamScans, setTeamScans] = useState<any[]>([]);
  const [scansModalLoading, setScansModalLoading] = useState(false);
  const [scanFilters, setScanFilters] = useState({
    scannerId: '',
    interestLevel: '',
    minRating: 0,
  });

  // Email modal state
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailingSponsor, setEmailingSponsor] = useState<EventSponsor | null>(null);
  const [emailTeamMembers, setEmailTeamMembers] = useState<Array<{ id: string; full_name: string; email: string }>>([]);

  useEffect(() => {
    loadSponsors();
  }, [eventId]);

  const loadSponsors = async () => {
    setLoading(true);
    try {
      const [eventSponsorsData, allSponsorsData, mediaCountsResult] = await Promise.all([
        EventQrService.getEventSponsors(eventId),
        EventQrService.getAllSponsors(),
        getSponsorMediaCounts(eventId),
      ]);
      setSponsors(eventSponsorsData);
      setAllSponsors(allSponsorsData);
      setSponsorMediaCounts(mediaCountsResult.data || {});
    } catch (error) {
      console.error('Error loading sponsors:', error);
      toast.error('Failed to load sponsors');
    } finally {
      setLoading(false);
    }
  };

  const handleAddSponsor = async () => {
    if (!selectedSponsorId && !sponsorName.trim()) {
      toast.error('Please select or enter a sponsor name');
      return;
    }

    try {
      let sponsorId = selectedSponsorId;

      // If no sponsor ID is selected, create a new sponsor
      if (!sponsorId && sponsorName.trim()) {
        const newSponsor = await EventQrService.createSponsor({
          name: sponsorName.trim(),
        });
        sponsorId = newSponsor.id;
        toast.success('New sponsor created');
      }

      await EventQrService.addEventSponsor({
        event_id: eventId,
        sponsor_id: sponsorId,
        sponsorship_tier: sponsorDetails.sponsorship_tier || undefined,
        booth_number: sponsorDetails.booth_number || undefined,
        booth_size: sponsorDetails.booth_size || undefined,
      });
      toast.success('Sponsor added to event successfully');
      setShowAddModal(false);
      setSelectedSponsorId('');
      setSponsorName('');
      setSponsorDetails({ sponsorship_tier: '', booth_number: '', booth_size: '' });
      await loadSponsors();
    } catch (error) {
      console.error('Error adding sponsor:', error);
      toast.error('Failed to add sponsor');
    }
  };

  const handleUpdateSponsor = async () => {
    if (!editingSponsor) return;

    try {
      // Update event sponsor details (tier, booth info)
      await EventQrService.updateEventSponsor(editingSponsor.id, sponsorDetails);

      // Update sponsor name if it was changed
      if (editingSponsorName && editingSponsorName !== editingSponsor.sponsor?.name) {
        await EventQrService.updateSponsorName(editingSponsor.sponsor_id, editingSponsorName);
      }

      toast.success('Sponsor updated successfully');
      setEditingSponsor(null);
      setEditingSponsorName('');
      setSponsorDetails({ sponsorship_tier: '', booth_number: '', booth_size: '' });
      await loadSponsors();
    } catch (error) {
      console.error('Error updating sponsor:', error);
      toast.error('Failed to update sponsor');
    }
  };

  const handleRemoveSponsor = async (sponsorId: string) => {
    if (!confirm('Are you sure you want to remove this sponsor from the event?')) return;

    try {
      await EventQrService.removeEventSponsor(sponsorId);
      toast.success('Sponsor removed successfully');
      await loadSponsors();
    } catch (error) {
      console.error('Error removing sponsor:', error);
      toast.error('Failed to remove sponsor');
    }
  };

  const openEditModal = (sponsor: EventSponsor) => {
    setEditingSponsor(sponsor);
    setEditingSponsorName(sponsor.sponsor?.name || '');
    setSponsorDetails({
      sponsorship_tier: sponsor.sponsorship_tier || '',
      booth_number: sponsor.booth_number || '',
      booth_size: sponsor.booth_size || '',
    });
  };

  const handleViewMedia = (sponsorId: string) => {
    // Navigate to media tab with sponsor filter
    // We'll pass the sponsor ID via URL state
    navigate(`/events/${eventId}/media?sponsorId=${sponsorId}`);
  };

  const openTeamModal = async (sponsor: EventSponsor) => {
    setManagingSponsor(sponsor);
    setShowTeamModal(true);
    setTeamModalLoading(true);

    try {
      // Load all event registrations
      const allRegs = await EventQrService.getEventRegistrations(eventId);
      setEventRegistrations(allRegs);

      // Pre-select registrations that are already part of this team
      const teamMembers = allRegs.filter((r: any) => r.sponsor_team_id === sponsor.id);
      const teamMemberIds = new Set(teamMembers.map((r: any) => r.id));
      setSelectedRegistrationIds(teamMemberIds);

      // Find the primary contact
      const primaryContact = teamMembers.find((r: any) => r.is_primary_contact === true);
      console.log('🔍 Team members:', teamMembers.map((m: any) => ({
        id: m.id,
        name: m.full_name,
        is_primary_contact: m.is_primary_contact
      })));
      console.log('🔍 Primary contact found:', primaryContact ? { id: primaryContact.id, name: primaryContact.full_name } : 'none');
      setPrimaryContactId(primaryContact?.id || null);
    } catch (error) {
      console.error('Error loading registrations:', error);
      toast.error('Failed to load registrations');
    } finally {
      setTeamModalLoading(false);
    }
  };

  const handleSaveTeam = async () => {
    if (!managingSponsor) return;

    try {
      setTeamModalLoading(true);

      // Get current team member IDs
      const currentTeamIds = new Set(
        eventRegistrations
          .filter((r: any) => r.sponsor_team_id === managingSponsor.id)
          .map((r: any) => r.id)
      );

      // Determine which to add and which to remove
      const toAdd = Array.from(selectedRegistrationIds).filter((id) => !currentTeamIds.has(id));
      const toRemove = Array.from(currentTeamIds).filter((id) => !selectedRegistrationIds.has(id));

      // Execute updates
      if (toAdd.length > 0) {
        await EventQrService.assignRegistrationsToSponsorTeam(toAdd, managingSponsor.id);
      }
      if (toRemove.length > 0) {
        await EventQrService.removeRegistrationsFromSponsorTeam(toRemove);
      }

      // Update primary contact
      console.log('💾 Saving primary contact:', {
        primaryContactId,
        isInTeam: primaryContactId ? selectedRegistrationIds.has(primaryContactId) : false,
        sponsorId: managingSponsor.id
      });
      if (primaryContactId && selectedRegistrationIds.has(primaryContactId)) {
        // Set the selected primary contact
        console.log('✅ Setting primary contact:', primaryContactId);
        await EventQrService.setPrimaryContact(primaryContactId, managingSponsor.id);
      } else {
        // Clear primary contact if none is selected
        console.log('🗑️ Clearing primary contact for sponsor:', managingSponsor.id);
        await EventQrService.clearPrimaryContact(managingSponsor.id);
      }

      toast.success(`Team updated: ${toAdd.length} added, ${toRemove.length} removed`);

      // Reload sponsors to refresh primary contact info
      await loadSponsors();

      setShowTeamModal(false);
      setManagingSponsor(null);
      setSelectedRegistrationIds(new Set());
      setPrimaryContactId(null);
      setTeamSearchQuery('');
    } catch (error) {
      console.error('Error saving team:', error);
      toast.error('Failed to update team');
    } finally {
      setTeamModalLoading(false);
    }
  };

  const openScansModal = async (sponsor: EventSponsor) => {
    setViewingSponsor(sponsor);
    setShowScansModal(true);
    setScansModalLoading(true);

    try {
      // Load team stats and scans
      const [stats, scans] = await Promise.all([
        EventQrService.getSponsorTeamStats(sponsor.id),
        EventQrService.getSponsorTeamScans(sponsor.id, scanFilters),
      ]);
      setTeamStats(stats);
      setTeamScans(scans);
    } catch (error) {
      console.error('Error loading scans:', error);
      toast.error('Failed to load scans');
    } finally {
      setScansModalLoading(false);
    }
  };

  const openEmailModal = async (sponsor: EventSponsor) => {
    // Load event registrations first
    try {
      const allRegs = await EventQrService.getEventRegistrations(eventId);
      setEventRegistrations(allRegs);

      // Filter and prepare team members for this sponsor
      const teamMembers = allRegs
        .filter((reg: any) => reg.sponsor_team_id === sponsor.id)
        .map((reg: any) => ({
          id: reg.id,
          full_name: reg.full_name || reg.email,
          email: reg.email,
          is_primary_contact: reg.is_primary_contact || false,
        }));

      console.log('Team members for sponsor:', sponsor.sponsor?.name, teamMembers);

      // Set all state together
      setEmailTeamMembers(teamMembers);
      setEmailingSponsor(sponsor);
      setShowEmailModal(true);
    } catch (error) {
      console.error('Error loading registrations:', error);
      toast.error('Failed to load team members');
    }
  };

  const generateScansCSV = async (sponsorId: string) => {
    try {
      const csv = await EventQrService.exportSponsorScansCSV(sponsorId);
      return csv;
    } catch (error) {
      console.error('Error generating CSV:', error);
      throw error;
    }
  };

  const generateRegistrationsCSV = async () => {
    try {
      // Fetch registrations for this event
      const allRegistrations = await EventQrService.getEventRegistrations(eventId!);

      // Filter registrations with sponsor permission
      const permittedRegistrations = allRegistrations.filter((r: any) => r.sponsor_permission === true);

      if (permittedRegistrations.length === 0) {
        // Return empty CSV with just headers
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
        return headers.join(',');
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

      return csvContent;
    } catch (error) {
      console.error('Error generating registrations CSV:', error);
      throw error;
    }
  };

  const handleExportCSV = async (scannerId?: string) => {
    if (!viewingSponsor) return;

    try {
      const filters = scannerId ? { scannerId } : scanFilters;
      const csv = await EventQrService.exportSponsorScansCSV(viewingSponsor.id, filters);

      // Download CSV
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const fileName = scannerId
        ? `${viewingSponsor.sponsor?.name}_${scannerId}_scans.csv`
        : `${viewingSponsor.sponsor?.name}_all_scans.csv`;
      a.download = fileName.replace(/[^a-z0-9_.-]/gi, '_');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast.success('CSV exported successfully');
    } catch (error) {
      console.error('Error exporting CSV:', error);
      toast.error('Failed to export CSV');
    }
  };

  const handleDownloadSponsorCSV = async (sponsor: EventSponsor) => {
    try {
      const csv = await EventQrService.exportSponsorScansCSV(sponsor.id, {});

      // Download CSV
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const fileName = `${sponsor.sponsor?.name}_badge_scans.csv`;
      a.download = fileName.replace(/[^a-z0-9_.-]/gi, '_');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast.success('CSV exported successfully');
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
    <>
      <Card>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              Event Sponsors ({sponsors.length})
            </h3>
            <Button variant="primary" size="sm" onClick={() => setShowAddModal(true)}>
              <PlusIcon className="w-4 h-4 mr-2" />
              Add Sponsor
            </Button>
          </div>

          {sponsors.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <BuildingOfficeIcon className="w-12 h-12 mx-auto mb-3 text-gray-400" />
              <p>No sponsors assigned yet</p>
              <p className="text-sm mt-1">Add sponsors to this event to track booth leads and engagement</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-800">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Actions
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Sponsor
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Tier
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Booth
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Team Members
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Badge Scans
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Media
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Contact
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                  {sponsors.map((sponsor) => (
                    <tr key={sponsor.id}>
                      <td className="px-4 py-4 whitespace-nowrap text-left text-sm font-medium">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => openTeamModal(sponsor)}
                            className="p-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                            title="Manage Team"
                          >
                            <UsersIcon className="w-5 h-5" />
                          </button>
                          <button
                            onClick={() => openScansModal(sponsor)}
                            className="p-2 text-purple-600 hover:text-purple-700 hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded transition-colors"
                            title="View Scans"
                          >
                            <EyeIcon className="w-5 h-5" />
                          </button>
                          <button
                            onClick={() => handleDownloadSponsorCSV(sponsor)}
                            className="p-2 text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-900/20 rounded transition-colors"
                            title="Download Badge Scans CSV"
                          >
                            <ArrowDownTrayIcon className="w-5 h-5" />
                          </button>
                          <button
                            onClick={() => openEmailModal(sponsor)}
                            className="p-2 text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded transition-colors"
                            title="Email Team"
                          >
                            <EnvelopeIcon className="w-5 h-5" />
                          </button>
                          <button
                            onClick={() => openEditModal(sponsor)}
                            className="p-2 text-gray-600 hover:text-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 rounded transition-colors"
                            title="Edit Sponsor"
                          >
                            <PencilIcon className="w-5 h-5" />
                          </button>
                          <button
                            onClick={() => handleRemoveSponsor(sponsor.id)}
                            className="p-2 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                            title="Remove Sponsor"
                          >
                            <TrashIcon className="w-5 h-5" />
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          {sponsor.sponsor?.logo_url && (
                            <img
                              src={sponsor.sponsor.logo_url}
                              alt={sponsor.sponsor.name}
                              className="w-10 h-10 rounded-full mr-3 object-cover"
                            />
                          )}
                          <div>
                            <div className="text-sm font-medium text-gray-900 dark:text-white">
                              {sponsor.sponsor?.name}
                            </div>
                            {sponsor.sponsor?.website && (
                              <a
                                href={sponsor.sponsor.website}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                              >
                                {sponsor.sponsor.website}
                              </a>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        {sponsor.sponsorship_tier ? (
                          <Badge variant="soft" className="capitalize">
                            {sponsor.sponsorship_tier}
                          </Badge>
                        ) : (
                          <span className="text-sm text-gray-500">-</span>
                        )}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                        {sponsor.booth_number ? (
                          <div>
                            <div>#{sponsor.booth_number}</div>
                            {sponsor.booth_size && (
                              <div className="text-xs text-gray-500">{sponsor.booth_size}</div>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-500">-</span>
                        )}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm">
                        <div className="flex items-center">
                          <UsersIcon className="w-4 h-4 text-gray-400 mr-2" />
                          <span className="font-medium text-gray-900 dark:text-white">
                            {sponsor.team_member_count || 0}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm">
                        <div className="flex items-center">
                          <QrCodeIcon className="w-4 h-4 text-purple-400 mr-2" />
                          <span className="font-medium text-purple-600 dark:text-purple-400">
                            {sponsor.badge_scan_count || 0}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm">
                        <button
                          onClick={() => handleViewMedia(sponsor.id)}
                          className="flex items-center text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
                          title="View tagged media"
                        >
                          <PhotoIcon className="w-4 h-4 mr-2" />
                          <span className="font-medium">
                            {sponsorMediaCounts[sponsor.id] || 0}
                          </span>
                        </button>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                        {sponsor.primary_contact ? (
                          <div>
                            <div className="font-medium">{sponsor.primary_contact.full_name}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              {sponsor.primary_contact.email}
                            </div>
                          </div>
                        ) : (
                          <span className="text-gray-500">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      {/* Add Sponsor Modal */}
      {showAddModal && (
        <Modal
          isOpen={showAddModal}
          onClose={() => {
            setShowAddModal(false);
            setSelectedSponsorId('');
            setSponsorName('');
            setSponsorDetails({ sponsorship_tier: '', booth_number: '', booth_size: '' });
          }}
          title="Add Sponsor to Event"
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Sponsor Name
              </label>
              <input
                type="text"
                list="sponsor-list"
                value={sponsorName}
                onChange={(e) => {
                  const value = e.target.value;
                  setSponsorName(value);

                  // Check if the entered value matches an existing sponsor
                  const matchingSponsor = allSponsors.find(
                    (s) => s.name.toLowerCase() === value.toLowerCase() && !sponsors.some((es) => es.sponsor_id === s.id)
                  );
                  setSelectedSponsorId(matchingSponsor ? matchingSponsor.id : '');
                }}
                placeholder="Select existing or type new sponsor name..."
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              />
              <datalist id="sponsor-list">
                {allSponsors
                  .filter((s) => !sponsors.some((es) => es.sponsor_id === s.id))
                  .map((sponsor) => (
                    <option key={sponsor.id} value={sponsor.name} />
                  ))}
              </datalist>
              {sponsorName && !selectedSponsorId && (
                <p className="mt-1 text-sm text-blue-600 dark:text-blue-400">
                  Will create new sponsor: "{sponsorName}"
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Sponsorship Tier
              </label>
              <select
                value={sponsorDetails.sponsorship_tier}
                onChange={(e) => setSponsorDetails({ ...sponsorDetails, sponsorship_tier: e.target.value as any })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              >
                <option value="">Select tier...</option>
                <option value="platinum">Platinum</option>
                <option value="gold">Gold</option>
                <option value="silver">Silver</option>
                <option value="bronze">Bronze</option>
                <option value="partner">Partner</option>
                <option value="exhibitor">Exhibitor</option>
                <option value="free">Free</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Booth Number
              </label>
              <input
                type="text"
                value={sponsorDetails.booth_number}
                onChange={(e) => setSponsorDetails({ ...sponsorDetails, booth_number: e.target.value })}
                placeholder="e.g., A101"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Booth Size
              </label>
              <input
                type="text"
                value={sponsorDetails.booth_size}
                onChange={(e) => setSponsorDetails({ ...sponsorDetails, booth_size: e.target.value })}
                placeholder="e.g., 10x10, Large, Medium"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              />
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <Button
                variant="outline"
                onClick={() => {
                  setShowAddModal(false);
                  setSelectedSponsorId('');
                  setSponsorName('');
                  setSponsorDetails({ sponsorship_tier: '', booth_number: '', booth_size: '' });
                }}
              >
                Cancel
              </Button>
              <Button variant="primary" onClick={handleAddSponsor}>
                Add Sponsor
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Edit Sponsor Modal */}
      {editingSponsor && (
        <Modal
          isOpen={!!editingSponsor}
          onClose={() => {
            setEditingSponsor(null);
            setEditingSponsorName('');
            setSponsorDetails({ sponsorship_tier: '', booth_number: '', booth_size: '' });
          }}
          title={`Edit ${editingSponsor.sponsor?.name}`}
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Sponsor Name
              </label>
              <input
                type="text"
                value={editingSponsorName}
                onChange={(e) => setEditingSponsorName(e.target.value)}
                placeholder="Enter sponsor name..."
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Sponsorship Tier
              </label>
              <select
                value={sponsorDetails.sponsorship_tier}
                onChange={(e) => setSponsorDetails({ ...sponsorDetails, sponsorship_tier: e.target.value as any })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              >
                <option value="">Select tier...</option>
                <option value="platinum">Platinum</option>
                <option value="gold">Gold</option>
                <option value="silver">Silver</option>
                <option value="bronze">Bronze</option>
                <option value="partner">Partner</option>
                <option value="exhibitor">Exhibitor</option>
                <option value="free">Free</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Booth Number
              </label>
              <input
                type="text"
                value={sponsorDetails.booth_number}
                onChange={(e) => setSponsorDetails({ ...sponsorDetails, booth_number: e.target.value })}
                placeholder="e.g., A101"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Booth Size
              </label>
              <input
                type="text"
                value={sponsorDetails.booth_size}
                onChange={(e) => setSponsorDetails({ ...sponsorDetails, booth_size: e.target.value })}
                placeholder="e.g., 10x10, Large, Medium"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              />
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <Button
                variant="outline"
                onClick={() => {
                  setEditingSponsor(null);
                  setEditingSponsorName('');
                  setSponsorDetails({ sponsorship_tier: '', booth_number: '', booth_size: '' });
                }}
              >
                Cancel
              </Button>
              <Button variant="primary" onClick={handleUpdateSponsor}>
                Save Changes
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Manage Team Modal */}
      {showTeamModal && managingSponsor && (
        <Modal
          isOpen={showTeamModal}
          onClose={() => {
            setShowTeamModal(false);
            setManagingSponsor(null);
            setSelectedRegistrationIds(new Set());
            setTeamSearchQuery('');
          }}
          title={`Manage Team - ${managingSponsor.sponsor?.name}`}
          size="large"
        >
          <div className="space-y-4">
            {teamModalLoading ? (
              <div className="flex justify-center py-8">
                <LoadingSpinner size="medium" />
              </div>
            ) : (
              <>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Select attendees to add to this sponsor's team. Team members will be able to scan badges and view all team scans in the check-in app.
                </p>

                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    type="text"
                    placeholder="Search by name, email, job title, or company..."
                    value={teamSearchQuery}
                    onChange={(e) => setTeamSearchQuery(e.target.value)}
                    className="block w-full pl-10 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div className="max-h-96 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0">
                      <tr>
                        <th className="px-4 py-3 text-left">
                          <input
                            type="checkbox"
                            checked={(() => {
                              const filteredRegs = eventRegistrations.filter((reg: any) => {
                                if (!teamSearchQuery.trim()) return true;
                                const query = teamSearchQuery.toLowerCase();
                                const fullName = (reg.full_name || '').toLowerCase();
                                const email = (reg.email || '').toLowerCase();
                                const jobTitle = (reg.job_title || '').toLowerCase();
                                const company = (reg.company || '').toLowerCase();
                                return fullName.includes(query) || email.includes(query) || jobTitle.includes(query) || company.includes(query);
                              });
                              return filteredRegs.length > 0 && filteredRegs.every((r: any) => selectedRegistrationIds.has(r.id));
                            })()}
                            onChange={(e) => {
                              const filteredRegs = eventRegistrations.filter((reg: any) => {
                                if (!teamSearchQuery.trim()) return true;
                                const query = teamSearchQuery.toLowerCase();
                                const fullName = (reg.full_name || '').toLowerCase();
                                const email = (reg.email || '').toLowerCase();
                                const jobTitle = (reg.job_title || '').toLowerCase();
                                const company = (reg.company || '').toLowerCase();
                                return fullName.includes(query) || email.includes(query) || jobTitle.includes(query) || company.includes(query);
                              });
                              if (e.target.checked) {
                                const newSet = new Set(selectedRegistrationIds);
                                filteredRegs.forEach((r: any) => newSet.add(r.id));
                                setSelectedRegistrationIds(newSet);
                              } else {
                                const newSet = new Set(selectedRegistrationIds);
                                filteredRegs.forEach((r: any) => newSet.delete(r.id));
                                setSelectedRegistrationIds(newSet);
                              }
                            }}
                            className="rounded"
                          />
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                          Name
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                          Email
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                          Job Title
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                          Company
                        </th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                          Primary Contact
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                      {eventRegistrations
                        .filter((reg: any) => {
                          if (!teamSearchQuery.trim()) return true;
                          const query = teamSearchQuery.toLowerCase();
                          const fullName = (reg.full_name || '').toLowerCase();
                          const email = (reg.email || '').toLowerCase();
                          const jobTitle = (reg.job_title || '').toLowerCase();
                          const company = (reg.company || '').toLowerCase();
                          return fullName.includes(query) || email.includes(query) || jobTitle.includes(query) || company.includes(query);
                        })
                        .sort((a: any, b: any) => {
                          // Priority 1: Already selected members at the top
                          const aSelected = selectedRegistrationIds.has(a.id);
                          const bSelected = selectedRegistrationIds.has(b.id);
                          if (aSelected && !bSelected) return -1;
                          if (!aSelected && bSelected) return 1;

                          // Priority 2: Same company as sponsor (case-insensitive comparison)
                          const sponsorCompany = (managingSponsor?.sponsor?.name || '').toLowerCase().trim();
                          const aCompany = (a.company || '').toLowerCase().trim();
                          const bCompany = (b.company || '').toLowerCase().trim();
                          const aSameCompany = sponsorCompany && aCompany && aCompany.includes(sponsorCompany);
                          const bSameCompany = sponsorCompany && bCompany && bCompany.includes(sponsorCompany);
                          if (aSameCompany && !bSameCompany) return -1;
                          if (!aSameCompany && bSameCompany) return 1;

                          // Priority 3: Alphabetical by name
                          const aName = (a.full_name || '').toLowerCase();
                          const bName = (b.full_name || '').toLowerCase();
                          return aName.localeCompare(bName);
                        })
                        .map((reg: any) => {
                          const isSelected = selectedRegistrationIds.has(reg.id);
                          const sponsorCompany = (managingSponsor?.sponsor?.name || '').toLowerCase().trim();
                          const regCompany = (reg.company || '').toLowerCase().trim();
                          const isSameCompany = sponsorCompany && regCompany && regCompany.includes(sponsorCompany);

                          return (
                            <tr
                              key={reg.id}
                              className={`hover:bg-gray-50 dark:hover:bg-gray-800 ${
                                isSelected ? 'bg-blue-50 dark:bg-blue-900/20' :
                                isSameCompany ? 'bg-green-50 dark:bg-green-900/10' : ''
                              }`}
                            >
                              <td className="px-4 py-3">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={(e) => {
                                    const newSet = new Set(selectedRegistrationIds);
                                    if (e.target.checked) {
                                      newSet.add(reg.id);
                                    } else {
                                      newSet.delete(reg.id);
                                    }
                                    setSelectedRegistrationIds(newSet);
                                  }}
                                  className="rounded"
                                />
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                                <div className="flex items-center gap-2">
                                  {reg.full_name || 'N/A'}
                                  {isSelected && (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-800 dark:text-blue-100">
                                      Selected
                                    </span>
                                  )}
                                  {!isSelected && isSameCompany && (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100">
                                      Same Company
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                                {reg.email || 'N/A'}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                                {reg.job_title || '-'}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                                {reg.company || '-'}
                              </td>
                              <td className="px-4 py-3 text-center">
                                <input
                                  type="radio"
                                  name="primaryContact"
                                  checked={primaryContactId === reg.id}
                                  onChange={() => setPrimaryContactId(reg.id)}
                                  disabled={!isSelected}
                                  className="rounded-full disabled:opacity-30 disabled:cursor-not-allowed"
                                  title={isSelected ? 'Set as primary contact' : 'Select as team member first'}
                                />
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {selectedRegistrationIds.size} selected
                  </p>
                  <div className="flex gap-3">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setShowTeamModal(false);
                        setManagingSponsor(null);
                        setSelectedRegistrationIds(new Set());
                      }}
                    >
                      Cancel
                    </Button>
                    <Button variant="primary" onClick={handleSaveTeam} disabled={teamModalLoading}>
                      Save Team
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}

      {/* View Scans Modal */}
      {showScansModal && viewingSponsor && (
        <Modal
          isOpen={showScansModal}
          onClose={() => {
            setShowScansModal(false);
            setViewingSponsor(null);
            setTeamStats([]);
            setTeamScans([]);
          }}
          title={`Scans - ${viewingSponsor.sponsor?.name}`}
          size="large"
        >
          <div className="space-y-6">
            {scansModalLoading ? (
              <div className="flex justify-center py-8">
                <LoadingSpinner size="medium" />
              </div>
            ) : (
              <>
                {/* Team Statistics */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-semibold text-gray-900 dark:text-white">Team Members</h4>
                    <Button variant="secondary" size="sm" onClick={() => handleExportCSV()}>
                      Export All Scans
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 gap-3">
                    {teamStats.map((member: any) => (
                      <div
                        key={member.member_profile_id}
                        className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
                      >
                        <div>
                          <p className="font-medium text-gray-900 dark:text-white">{member.full_name}</p>
                          <p className="text-sm text-gray-600 dark:text-gray-400">{member.email}</p>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                              {member.scan_count}
                            </p>
                            <p className="text-xs text-gray-500">scans</p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleExportCSV(member.member_profile_id)}
                            disabled={member.scan_count === 0}
                          >
                            Export
                          </Button>
                        </div>
                      </div>
                    ))}
                    {teamStats.length === 0 && (
                      <p className="text-center text-gray-500 py-4">No team members assigned yet</p>
                    )}
                  </div>
                </div>

                {/* Recent Scans */}
                <div>
                  <h4 className="font-semibold text-gray-900 dark:text-white mb-3">
                    Recent Scans ({teamScans.length})
                  </h4>
                  <div className="max-h-96 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                      <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                            Scanned Person
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                            Company
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                            Scanner
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                            Interest
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                            Date
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                        {teamScans.map((scan: any) => {
                          const scannedCustomer = scan.scanned?.customer;
                          const scannerCustomer = scan.scanner?.customer;
                          return (
                            <tr key={scan.id}>
                              <td className="px-4 py-3">
                                <div className="text-sm font-medium text-gray-900 dark:text-white">
                                  {scannedCustomer?.attributes?.first_name} {scannedCustomer?.attributes?.last_name}
                                </div>
                                <div className="text-xs text-gray-500">{scannedCustomer?.email}</div>
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                                {scannedCustomer?.attributes?.company || '-'}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                                {scannerCustomer?.attributes?.first_name} {scannerCustomer?.attributes?.last_name}
                              </td>
                              <td className="px-4 py-3">
                                {scan.interest_level && (
                                  <Badge
                                    variant="soft"
                                    className={
                                      scan.interest_level === 'hot'
                                        ? 'bg-red-100 text-red-800'
                                        : scan.interest_level === 'warm'
                                        ? 'bg-yellow-100 text-yellow-800'
                                        : 'bg-blue-100 text-blue-800'
                                    }
                                  >
                                    {scan.interest_level}
                                  </Badge>
                                )}
                              </td>
                              <td className="px-4 py-3 text-xs text-gray-500">
                                {scan.scanned_at ? new Date(scan.scanned_at).toLocaleString() : '-'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {teamScans.length === 0 && (
                      <p className="text-center text-gray-500 py-8">No scans yet</p>
                    )}
                  </div>
                </div>

                <div className="flex justify-end pt-4 border-t border-gray-200 dark:border-gray-700">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setShowScansModal(false);
                      setViewingSponsor(null);
                      setTeamStats([]);
                      setTeamScans([]);
                    }}
                  >
                    Close
                  </Button>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}

      {/* Email Sponsor Team Modal */}
      {showEmailModal && emailingSponsor && event && (
        <SendSponsorEmailModal
          isOpen={showEmailModal}
          onClose={() => {
            setShowEmailModal(false);
            setEmailingSponsor(null);
            setEmailTeamMembers([]);
          }}
          eventName={event.eventTitle || ''}
          eventSponsorId={emailingSponsor.id}
          sponsorName={emailingSponsor.sponsor?.name || ''}
          teamMembers={emailTeamMembers}
          onGenerateScansCSV={() => generateScansCSV(emailingSponsor.id)}
          onGenerateRegistrationsCSV={generateRegistrationsCSV}
          eventData={{
            event_id: event.eventId,
            event_title: event.eventTitle,
            event_city: event.eventCity,
            event_country_code: event.eventCountryCode,
            event_start: event.eventStart,
            event_end: event.eventEnd,
          }}
          sponsorData={{
            name: emailingSponsor.sponsor?.name || '',
            slug: emailingSponsor.sponsor?.slug,
          }}
        />
      )}
    </>
  );
};

// Pagination constant
const ITEMS_PER_PAGE = 50;

// Event Registrations Tab Component
const EventRegistrationsTab = ({ eventId, gradualEventslug }: { eventId: string; gradualEventslug?: string | null }) => {
  const navigate = useNavigate();
  const [registrations, setRegistrations] = useState<EventRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [editingCell, setEditingCell] = useState<{ id: string; field: 'registration_type' | 'ticket_type' } | null>(null);
  const [editValue, setEditValue] = useState('');
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
    status: string | null;
    click_ids: Record<string, string> | null;
  }>>(new Map());

  useEffect(() => {
    loadRegistrations();
  }, [eventId]);

  // Subscribe to real-time changes for event registrations
  useEffect(() => {
    if (!eventId) return;

    const channel = supabase
      .channel(`event_registrations_${eventId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'event_registrations',
          filter: `event_id=eq.${eventId}`,
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
                .from('event_registrations_with_members')
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
              .from('event_registrations_with_members')
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
  }, [eventId]);

  const loadRegistrations = async () => {
    setLoading(true);
    try {
      // Fetch registrations and tracking sessions in parallel
      const [data, trackingResult] = await Promise.all([
        EventQrService.getEventRegistrations(eventId),
        supabase
          .from('ad_tracking_sessions')
          .select('matched_registration_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, status, click_ids')
          .eq('event_id', eventId)
          .not('matched_registration_id', 'is', null),
      ]);

      setRegistrations(data);

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
    } catch (error) {
      console.error('Error loading registrations:', error);
      toast.error('Failed to load registrations');
    } finally {
      setLoading(false);
    }
  };

  // Gradual sync state
  const gradualSync = useGradualSync(eventId, gradualEventslug, loadRegistrations);

  const handleStartEdit = (registrationId: string, field: 'registration_type' | 'ticket_type', currentValue: string | null) => {
    setEditingCell({ id: registrationId, field });
    setEditValue(currentValue || '');
  };

  const handleSaveEdit = async () => {
    if (!editingCell) return;

    try {
      await EventQrService.updateRegistration(editingCell.id, {
        [editingCell.field]: editValue || null,
      });

      // Update local state
      setRegistrations(registrations.map(reg =>
        reg.id === editingCell.id
          ? { ...reg, [editingCell.field]: editValue || null }
          : reg
      ));

      toast.success('Registration updated successfully');
      setEditingCell(null);
      setEditValue('');
    } catch (error) {
      console.error('Error updating registration:', error);
      toast.error('Failed to update registration');
    }
  };

  const handleCancelEdit = () => {
    setEditingCell(null);
    setEditValue('');
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
        memberProfileId: registration.member_profile_id,
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
      const appUrl = import.meta.env.VITE_APP_URL || 'https://app.tech.tickets';
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

  // Pagination calculations
  const totalPages = Math.ceil(filteredRegistrations.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedRegistrations = filteredRegistrations.slice(startIndex, endIndex);

  // Reset to page 1 when search query or filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, amountFilter, amountThreshold]);

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
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              Event Registrations
            </h3>
            <Badge variant="default" className="text-sm">
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
            <AddMemberModal eventId={eventId} onComplete={loadRegistrations} />
            <LumaUpload
              eventId={eventId}
              lumaEventId={event?.lumaEventId}
              brandId={getBrandId()}
              onComplete={loadRegistrations}
            />
            <BulkRegistrationUpload eventId={eventId} onComplete={loadRegistrations} />
            <GradualSyncButton
              gradualEventslug={gradualEventslug}
              loading={gradualSync.loading}
              isActive={gradualSync.isActive}
              progress={gradualSync.progress}
              onSync={gradualSync.startSync}
            />
          </div>
        </div>

        {/* Luma Upload Status */}
        <LumaUploadStatus brandId={getBrandId()} eventId={eventId} />

        {/* Gradual Sync Status */}
        <GradualSyncStatus
          job={gradualSync.job}
          isActive={gradualSync.isActive}
          progress={gradualSync.progress}
          onCancel={gradualSync.cancelSync}
          onDismiss={gradualSync.dismiss}
        />

        {registrations.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <UsersIcon className="w-12 h-12 mx-auto mb-3 text-gray-400" />
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
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              />
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-600 dark:text-gray-400">Amount Paid:</span>
                <select
                  value={amountFilter}
                  onChange={(e) => setAmountFilter(e.target.value as 'all' | 'above' | 'below')}
                  className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                >
                  <option value="all">All</option>
                  <option value="above">At or above</option>
                  <option value="below">Below</option>
                </select>
                {amountFilter !== 'all' && (
                  <div className="flex items-center gap-1">
                    <span className="text-sm text-gray-600 dark:text-gray-400">$</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={amountThreshold}
                      onChange={(e) => setAmountThreshold(e.target.value)}
                      className="w-24 px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                    />
                  </div>
                )}
                {amountFilter !== 'all' && amountThreshold && (
                  <button
                    onClick={() => {
                      setAmountFilter('all');
                      setAmountThreshold('');
                    }}
                    className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  >
                    Clear filter
                  </button>
                )}
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 border-separate border-spacing-0">
                <thead className="bg-gray-50 dark:bg-gray-800">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider sticky left-0 z-20 bg-gray-50 dark:bg-gray-800 min-w-[100px]">
                      Actions
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider sticky left-[100px] z-20 bg-gray-50 dark:bg-gray-800 min-w-[200px] relative after:absolute after:right-0 after:top-0 after:bottom-0 after:w-px after:shadow-[2px_0_5px_rgba(0,0,0,0.1)]">
                      Attendee
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Company
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Reg. Type
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Ticket Type
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Qty
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Amount Paid
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Sponsor Permission
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider" title="Ad platform detected from click ID">
                      Platform
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      UTM Source
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      UTM Medium
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      UTM Campaign
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      UTM Content
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      UTM Term
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Registered
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      QR Code
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                  {paginatedRegistrations.map((registration) => (
                    <Fragment key={registration.id}>
                    <tr>
                      <td className="px-4 py-4 whitespace-nowrap text-left text-sm font-medium sticky left-0 z-10 bg-white dark:bg-gray-900 min-w-[100px]">
                        <div className="flex items-center gap-2">
                          {hasAnswers(registration) && (
                            <button
                              onClick={() => setExpandedRowId(expandedRowId === registration.id ? null : registration.id)}
                              className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                              title={expandedRowId === registration.id ? 'Hide details' : 'Show registration answers'}
                            >
                              {expandedRowId === registration.id ? (
                                <ChevronUpIcon className="w-5 h-5" />
                              ) : (
                                <ChevronDownIcon className="w-5 h-5" />
                              )}
                            </button>
                          )}
                          <button
                            onClick={() => handleCheckIn(registration)}
                            className="text-green-600 hover:text-green-900 dark:text-green-400 dark:hover:text-green-300"
                            title="Check in"
                          >
                            <CheckIcon className="w-5 h-5" />
                          </button>
                          <button
                            onClick={() => handleDeleteClick(registration.id, registration.full_name || registration.email || 'this registration')}
                            className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
                            title="Delete registration"
                          >
                            <TrashIcon className="w-5 h-5" />
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap sticky left-[100px] z-10 bg-white dark:bg-gray-900 min-w-[200px] relative after:absolute after:right-0 after:top-0 after:bottom-0 after:w-px after:shadow-[2px_0_5px_rgba(0,0,0,0.06)]">
                        <div>
                          <div className="text-sm font-medium text-gray-900 dark:text-white">
                            {registration.customer_id ? (
                              <button
                                onClick={() => navigate(`/members/${registration.customer_id}`)}
                                className="hover:text-primary-600 dark:hover:text-primary-400 hover:underline text-left cursor-pointer"
                              >
                                {registration.full_name || 'N/A'}
                              </button>
                            ) : (
                              registration.full_name || 'N/A'
                            )}
                          </div>
                          <div className="text-sm text-gray-500">{registration.email}</div>
                          {registration.job_title && (
                            <div className="text-xs text-gray-400">{registration.job_title}</div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                        {registration.company || '-'}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        {editingCell?.id === registration.id && editingCell?.field === 'registration_type' ? (
                          <input
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={handleSaveEdit}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveEdit();
                              if (e.key === 'Escape') handleCancelEdit();
                            }}
                            autoFocus
                            className="px-2 py-1 text-sm border border-blue-500 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        ) : (
                          <div
                            onClick={() => handleStartEdit(registration.id, 'registration_type', registration.registration_type)}
                            className="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 rounded px-2 py-1 inline-block"
                          >
                            {registration.registration_type ? (
                              <Badge variant="soft" className="capitalize">
                                {registration.registration_type.replace('_', ' ')}
                              </Badge>
                            ) : (
                              <span className="text-sm text-gray-500">Click to edit</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        {editingCell?.id === registration.id && editingCell?.field === 'ticket_type' ? (
                          <input
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={handleSaveEdit}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveEdit();
                              if (e.key === 'Escape') handleCancelEdit();
                            }}
                            autoFocus
                            className="px-2 py-1 text-sm border border-blue-500 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        ) : (
                          <div
                            onClick={() => handleStartEdit(registration.id, 'ticket_type', registration.ticket_type)}
                            className="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 rounded px-2 py-1 inline-block"
                          >
                            {registration.ticket_type ? (
                              <span className="text-sm text-gray-900 dark:text-white">{registration.ticket_type}</span>
                            ) : (
                              <span className="text-sm text-gray-500">Click to edit</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-center text-sm">
                        {(registration as any).ticket_quantity > 1 ? (
                          <span className="text-gray-900 dark:text-white font-medium">{(registration as any).ticket_quantity}</span>
                        ) : (
                          <span className="text-gray-400">1</span>
                        )}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-right text-sm">
                        {registration.amount_paid != null ? (
                          <span className="text-gray-900 dark:text-white font-medium">
                            {new Intl.NumberFormat('en-US', {
                              style: 'currency',
                              currency: registration.currency || 'USD',
                            }).format(registration.amount_paid)}
                          </span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-center">
                        {(registration as any).sponsor_permission === true ? (
                          <CheckIcon className="w-5 h-5 text-green-600 dark:text-green-400 inline-block" title="Permission granted" />
                        ) : (
                          <XMarkIcon className="w-5 h-5 text-gray-400 dark:text-gray-600 inline-block" title="No permission" />
                        )}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        <Badge
                          variant="soft"
                          className={
                            registration.status === 'confirmed'
                              ? 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400'
                              : registration.status === 'cancelled'
                              ? 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400'
                              : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400'
                          }
                        >
                          {registration.status}
                        </Badge>
                      </td>
                      {(() => {
                        const tracking = trackingByRegistration.get(registration.id);
                        const platformColors: Record<string, string> = {
                          meta: 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400',
                          google: 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400',
                          reddit: 'bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-400',
                          linkedin: 'bg-sky-100 text-sky-800 dark:bg-sky-900/20 dark:text-sky-400',
                          tiktok: 'bg-pink-100 text-pink-800 dark:bg-pink-900/20 dark:text-pink-400',
                          bing: 'bg-teal-100 text-teal-800 dark:bg-teal-900/20 dark:text-teal-400',
                        };
                        const isTemplate = (v: string | null) => v && v.includes('{{');
                        const utmCell = (value: string | null) => (
                          <td className="px-4 py-4 whitespace-nowrap text-sm">
                            {value && !isTemplate(value) ? (
                              <span className="text-gray-900 dark:text-white truncate max-w-[150px] block" title={value}>
                                {value}
                              </span>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                        );
                        return (
                          <>
                            <td className="px-4 py-4 whitespace-nowrap text-sm">
                              {tracking?.platform ? (
                                <Badge
                                  variant="soft"
                                  className={platformColors[tracking.platform] || ''}
                                  title={tracking.platform}
                                >
                                  {tracking.platform}
                                </Badge>
                              ) : (
                                <span className="text-gray-400">-</span>
                              )}
                            </td>
                            {utmCell(tracking?.utm_source ?? (registration.source && registration.source !== 'event_portal' ? registration.source : null))}
                            {utmCell(tracking?.utm_medium ?? null)}
                            {utmCell(tracking?.utm_campaign ?? null)}
                            {utmCell(tracking?.utm_content ?? null)}
                            {utmCell(tracking?.utm_term ?? null)}
                          </>
                        );
                      })()}
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(registration.registered_at).toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm">
                        <div className="flex flex-col gap-1">
                          {registration.qr_code_id ? (
                            <button
                              onClick={() => handleViewQrCode(registration, 'member')}
                              className="flex items-center gap-1 text-primary-600 hover:text-primary-800 dark:text-primary-400 dark:hover:text-primary-300"
                              title="View Member QR Code"
                            >
                              <QrCodeIcon className="w-4 h-4" />
                              <span className="text-xs">Member</span>
                            </button>
                          ) : null}
                          {registration.external_qr_code ? (
                            <button
                              onClick={() => handleViewQrCode(registration, 'luma')}
                              className="flex items-center gap-1 text-purple-600 hover:text-purple-800 dark:text-purple-400 dark:hover:text-purple-300"
                              title="View Luma QR Code"
                            >
                              <QrCodeIcon className="w-4 h-4" />
                              <span className="text-xs">Luma</span>
                            </button>
                          ) : null}
                          {!registration.qr_code_id && !registration.external_qr_code && (
                            <span className="text-gray-400">-</span>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expandedRowId === registration.id && (
                      <tr>
                        <td colSpan={10} className="px-4 py-3 bg-gray-50 dark:bg-gray-800/50">
                          <div className="space-y-3">
                            {/* LinkedIn URL */}
                            {registration.linkedin_url && (
                              <div className="flex items-center gap-2 text-sm">
                                <span className="text-gray-500 dark:text-gray-400 font-medium">LinkedIn:</span>
                                <a
                                  href={registration.linkedin_url.startsWith('http') ? registration.linkedin_url : `https://${registration.linkedin_url}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-primary-600 hover:text-primary-800 dark:text-primary-400 dark:hover:text-primary-300 hover:underline"
                                >
                                  {registration.linkedin_url}
                                </a>
                              </div>
                            )}
                            {/* Registration Answers */}
                            {(() => {
                              const answers = getRegistrationAnswers(registration);
                              if (answers.length === 0) return null;
                              return (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2">
                                  {answers.map((a, i) => (
                                    <div key={i}>
                                      <dt className="text-xs text-gray-500 dark:text-gray-400">{a.label}</dt>
                                      <dd className="text-sm text-gray-900 dark:text-white">{a.value}</dd>
                                    </div>
                                  ))}
                                </div>
                              );
                            })()}
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            {filteredRegistrations.length === 0 && searchQuery && (
              <div className="text-center py-8 text-gray-500">
                <p>No registrations found matching "{searchQuery}"</p>
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between border-t border-gray-200 dark:border-gray-700 pt-4">
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  Showing {startIndex + 1}-{Math.min(endIndex, filteredRegistrations.length)} of {filteredRegistrations.length} registrations
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(1)}
                    disabled={currentPage === 1}
                    className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    First
                  </button>
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <span className="px-3 py-1 text-sm text-gray-700 dark:text-gray-300">
                    Page {currentPage} of {totalPages}
                  </span>
                  <button
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                  <button
                    onClick={() => setCurrentPage(totalPages)}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Last
                  </button>
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
        title={qrCodeModal.qrType === 'luma' ? 'Luma QR Code' : 'Member QR Code'}
        size="md"
      >
        {qrCodeModal.registration && (
          <div className="space-y-4">
            {/* Member Information */}
            <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Attendee Details
              </h4>
              <div className="space-y-1 text-sm">
                <p className="text-gray-900 dark:text-white font-medium">
                  {qrCodeModal.registration.full_name || 'N/A'}
                </p>
                {qrCodeModal.registration.email && (
                  <p className="text-gray-600 dark:text-gray-400">
                    {qrCodeModal.registration.email}
                  </p>
                )}
                {qrCodeModal.registration.company && (
                  <p className="text-gray-600 dark:text-gray-400">
                    {qrCodeModal.registration.company}
                  </p>
                )}
                {qrCodeModal.registration.job_title && (
                  <p className="text-gray-600 dark:text-gray-400">
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
                  alt={qrCodeModal.qrType === 'luma' ? 'Luma QR Code' : 'Member QR Code'}
                  className="w-80 h-80 border-2 border-gray-200 dark:border-gray-700 rounded-lg p-2 bg-white"
                />
                {qrCodeModal.qrType === 'member' && qrCodeModal.registration.qr_code_id && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
                    QR Code ID: {qrCodeModal.registration.qr_code_id}
                  </p>
                )}
                {qrCodeModal.qrType === 'luma' && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
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
    scanner_profile_id: string;
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

const EventAttendanceTab = ({ eventId }: { eventId: string }) => {
  const navigate = useNavigate();
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

  const loadAttendance = async () => {
    setLoading(true);
    try {
      const data = await EventQrService.getAttendanceWithScanCounts(eventId);
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
      const stats = await EventQrService.getBadgeScanStats(eventId);
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
      const csv = await EventQrService.exportAttendanceCSV(eventId);

      // Download CSV
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `event_${eventId}_attendance.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast.success('CSV exported successfully');
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
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Event Attendance
          </h3>
          <div className="flex items-center gap-2">
            <BulkAttendanceUpload eventId={eventId} onComplete={loadAttendance} />
            <Button variant="secondary" onClick={handleExportCSV}>
              Export CSV
            </Button>
          </div>
        </div>

        {attendance.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <UserGroupIcon className="w-12 h-12 mx-auto mb-3 text-gray-400" />
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
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              />
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-800">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Actions
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Attendee
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Company
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Check-in Method
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Check-in Time
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Badge Printed
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Scans
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      QR Code
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                  {paginatedAttendance.map((record) => (
                    <tr key={record.id}>
                      <td className="px-4 py-4 whitespace-nowrap text-left text-sm font-medium">
                        <button
                          onClick={() => handleDeleteClick(record.id, record.full_name || record.email || 'this attendance record')}
                          className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
                          title="Delete attendance record"
                        >
                          <TrashIcon className="w-5 h-5" />
                        </button>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        <div>
                          <div className="text-sm font-medium text-gray-900 dark:text-white">
                            {record.customer_id ? (
                              <button
                                onClick={() => navigate(`/members/${record.customer_id}`)}
                                className="hover:text-primary-600 dark:hover:text-primary-400 hover:underline text-left cursor-pointer"
                              >
                                {record.full_name || 'N/A'}
                              </button>
                            ) : (
                              record.full_name || 'N/A'
                            )}
                          </div>
                          <div className="text-sm text-gray-500">{record.email}</div>
                        </div>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                        {record.company || '-'}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        {record.check_in_method ? (
                          <Badge variant="soft" className="capitalize">
                            {record.check_in_method.replace('_', ' ')}
                          </Badge>
                        ) : (
                          <span className="text-sm text-gray-500">-</span>
                        )}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                        <div>{new Date(record.checked_in_at).toLocaleDateString()}</div>
                        <div className="text-xs">{new Date(record.checked_in_at).toLocaleTimeString()}</div>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        {record.badge_printed_on_site ? (
                          <Badge variant="soft" className="bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400">
                            Yes
                          </Badge>
                        ) : (
                          <Badge variant="soft" className="bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-400">
                            No
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-3">
                          <span className="text-lg font-semibold text-blue-600 dark:text-blue-400">
                            {record.scan_count || 0}
                          </span>
                          {record.scan_count > 0 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleExportAttendeeScans(record.member_profile_id, record.full_name || 'attendee')}
                              className="text-xs"
                            >
                              Export
                            </Button>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                        {record.qr_code_id || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {filteredAttendance.length === 0 && searchQuery && (
              <div className="text-center py-8 text-gray-500">
                <p>No attendance records found matching "{searchQuery}"</p>
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between border-t border-gray-200 dark:border-gray-700 pt-4">
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  Showing {startIndex + 1}-{Math.min(endIndex, filteredAttendance.length)} of {filteredAttendance.length} attendance records
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(1)}
                    disabled={currentPage === 1}
                    className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    First
                  </button>
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <span className="px-3 py-1 text-sm text-gray-700 dark:text-gray-300">
                    Page {currentPage} of {totalPages}
                  </span>
                  <button
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                  <button
                    onClick={() => setCurrentPage(totalPages)}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Last
                  </button>
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


// Event Reports Tab Component
const EventReportsTab = ({ eventId }: { eventId: string }) => {
  const [registrations, setRegistrations] = useState<EventRegistration[]>([]);
  const [attendance, setAttendance] = useState<EventAttendance[]>([]);
  const [checkInData, setCheckInData] = useState<CheckInData[]>([]);
  const [badgeScanStats, setBadgeScanStats] = useState<BadgeScanStats | null>(null);
  const [calendarStats, setCalendarStats] = useState<any>(null);
  const [calendarWithAttendance, setCalendarWithAttendance] = useState<any[]>([]);
  const [lumaPaymentStats, setLumaPaymentStats] = useState<any>(null);
  const [registrationClassifications, setRegistrationClassifications] = useState<{ byFunction: Array<{ function: string; count: number; jobTitles: string[] }>; bySeniority: Array<{ seniority: string; count: number; jobTitles: string[] }> } | null>(null);
  const [attendanceClassifications, setAttendanceClassifications] = useState<{ byFunction: Array<{ function: string; count: number; jobTitles: string[] }>; bySeniority: Array<{ seniority: string; count: number; jobTitles: string[] }> } | null>(null);
  const [expandedFunctions, setExpandedFunctions] = useState<Set<string>>(new Set());
  const [expandedSeniorities, setExpandedSeniorities] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [eventId]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load all data in parallel for better performance
      const [regData, attData, stats, calStats, calWithAtt, lumaStats, regClassifications, attClassifications] = await Promise.all([
        EventQrService.getEventRegistrations(eventId),
        EventQrService.getAttendanceWithScanCounts(eventId),
        EventQrService.getBadgeScanStats(eventId),
        EventQrService.getCalendarStats(eventId),
        EventQrService.getCalendarInteractionsWithAttendance(eventId),
        EventQrService.getLumaPaymentStats(eventId),
        EventQrService.getRegistrationJobClassifications(eventId),
        EventQrService.getAttendanceJobClassifications(eventId),
      ]);

      setRegistrations(regData);
      setAttendance(attData);
      processCheckInTimeline(attData);
      setBadgeScanStats(stats);
      setCalendarStats(calStats);
      setCalendarWithAttendance(calWithAtt);
      setLumaPaymentStats(lumaStats);
      setRegistrationClassifications(regClassifications);
      setAttendanceClassifications(attClassifications);
    } catch (error) {
      console.error('Error loading reports data:', error);
      toast.error('Failed to load reports data');
    } finally {
      setLoading(false);
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

  const handleDownloadRegistrationSponsorCSV = () => {
    try {
      const permittedRegistrations = registrations.filter((r: any) => r.sponsor_permission === true);

      if (permittedRegistrations.length === 0) {
        toast.error('No registrations with sponsor permission to export');
        return;
      }

      const headers = ['First Name', 'Last Name', 'Email', 'Company', 'Job Title', 'Registration Type', 'Ticket Type', 'Status', 'Registered At'];
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

      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      ].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${eventId}_sponsor_permission_registrations.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast.success('CSV downloaded successfully');
    } catch (error) {
      console.error('Error downloading CSV:', error);
      toast.error('Failed to download CSV');
    }
  };

  const handleDownloadAttendanceSponsorCSV = () => {
    try {
      const permittedAttendees = attendance.filter((a: any) => a.sponsor_permission === true);

      if (permittedAttendees.length === 0) {
        toast.error('No attendees with sponsor permission to export');
        return;
      }

      const headers = ['First Name', 'Last Name', 'Email', 'Company', 'Job Title', 'Checked In At'];
      const rows = permittedAttendees.map((att: any) => [
        att.first_name || '',
        att.last_name || '',
        att.email || '',
        att.company || '',
        att.job_title || '',
        att.checked_in_at ? new Date(att.checked_in_at).toLocaleString() : ''
      ]);

      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      ].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${eventId}_sponsor_permission_attendance.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast.success('CSV downloaded successfully');
    } catch (error) {
      console.error('Error downloading CSV:', error);
      toast.error('Failed to download CSV');
    }
  };

  // Calculate stats
  const registrationStats = {
    total: registrations.length,
    confirmed: registrations.filter((r) => r.status === 'confirmed').length,
    cancelled: registrations.filter((r) => r.status === 'cancelled').length,
    waitlist: registrations.filter((r) => r.status === 'waitlist').length,
  };

  const attendanceStats = {
    total: attendance.length,
    qrScan: attendance.filter((a) => a.check_in_method === 'qr_scan').length,
    manual: attendance.filter((a) => a.check_in_method === 'manual_entry').length,
    badgePrinted: attendance.filter((a) => a.badge_printed_on_site).length,
  };

  const registrationSponsorPermissionCount = registrations.filter((r: any) => r.sponsor_permission === true).length;
  const attendanceSponsorPermissionCount = attendance.filter((a: any) => a.sponsor_permission === true).length;

  // Calculate source analytics
  const sourceStats = registrations.reduce((acc: Record<string, number>, reg) => {
    const source = (reg as any).source || 'unknown';
    acc[source] = (acc[source] || 0) + 1;
    return acc;
  }, {});

  const sortedSources = Object.entries(sourceStats).sort(([, a], [, b]) => b - a);

  // Calculate job title analytics for registrations
  const registrationJobTitleStats = registrations.reduce((acc: Record<string, number>, reg) => {
    const jobTitle = (reg as any).job_title || 'Not specified';
    acc[jobTitle] = (acc[jobTitle] || 0) + 1;
    return acc;
  }, {});

  const sortedRegistrationJobTitles = Object.entries(registrationJobTitleStats).sort(([, a], [, b]) => b - a);

  // Calculate job title analytics for attendance
  const attendanceJobTitleStats = attendance.reduce((acc: Record<string, number>, att) => {
    const jobTitle = (att as any).job_title || 'Not specified';
    acc[jobTitle] = (acc[jobTitle] || 0) + 1;
    return acc;
  }, {});

  // Chart configurations
  const cumulativeChartOptions: ApexOptions = {
    chart: { type: 'area', toolbar: { show: false }, zoom: { enabled: false } },
    dataLabels: { enabled: false },
    stroke: { curve: 'smooth', width: 2 },
    xaxis: { type: 'datetime', labels: { format: 'HH:mm' } },
    yaxis: { title: { text: 'Cumulative Check-ins' } },
    tooltip: { x: { format: 'MMM dd, HH:mm' } },
    colors: ['#3B82F6'],
    fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.7, opacityTo: 0.3 } }
  };

  const cumulativeChartSeries = [{
    name: 'Cumulative Check-ins',
    data: checkInData.map(d => ({ x: new Date(d.date).getTime(), y: d.cumulative }))
  }];

  const perMinuteChartOptions: ApexOptions = {
    chart: { type: 'bar', toolbar: { show: false } },
    plotOptions: { bar: { borderRadius: 4, columnWidth: '60%' } },
    dataLabels: { enabled: false },
    xaxis: { type: 'datetime', labels: { format: 'HH:mm' } },
    yaxis: { title: { text: 'Check-ins per Minute' } },
    tooltip: { x: { format: 'MMM dd, HH:mm' } },
    colors: ['#8B5CF6']
  };

  const perMinuteChartSeries = [{
    name: 'Check-ins',
    data: checkInData.map(d => ({ x: new Date(d.date).getTime(), y: d.count }))
  }];

  // Badge scan chart configurations
  const badgeScanCumulativeOptions: ApexOptions = badgeScanStats?.timeline ? {
    chart: { type: 'area', toolbar: { show: false }, zoom: { enabled: false } },
    dataLabels: { enabled: false },
    stroke: { curve: 'smooth', width: 2 },
    xaxis: { type: 'datetime', labels: { format: 'HH:mm' } },
    yaxis: { title: { text: 'Cumulative Scans' } },
    tooltip: { x: { format: 'MMM dd, HH:mm' } },
    colors: ['#10B981'],
    fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.7, opacityTo: 0.3 } }
  } : {};

  const badgeScanCumulativeSeries = badgeScanStats?.timeline ? [{
    name: 'Cumulative Scans',
    data: badgeScanStats.timeline.map(d => ({ x: new Date(d.date).getTime(), y: d.cumulative }))
  }] : [];

  const badgeScanPerMinuteOptions: ApexOptions = badgeScanStats?.timeline ? {
    chart: { type: 'bar', toolbar: { show: false } },
    plotOptions: { bar: { borderRadius: 4, columnWidth: '60%' } },
    dataLabels: { enabled: false },
    xaxis: { type: 'datetime', labels: { format: 'HH:mm' } },
    yaxis: { title: { text: 'Scans per Minute' } },
    tooltip: { x: { format: 'MMM dd, HH:mm' } },
    colors: ['#F59E0B']
  } : {};

  const badgeScanPerMinuteSeries = badgeScanStats?.timeline ? [{
    name: 'Scans',
    data: badgeScanStats.timeline.map(d => ({ x: new Date(d.date).getTime(), y: d.count }))
  }] : [];

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
    <div className="space-y-8">
      {/* Registration Reports */}
      <Card>
        <div className="p-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6">Registration Analytics</h2>

          {/* Registration Stats */}
          {registrations.length > 0 && (
            <>
              <div className="grid grid-cols-4 gap-4 mb-6">
                <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                  <div className="text-2xl font-bold text-gray-900 dark:text-white">{registrationStats.total}</div>
                  <div className="text-sm text-gray-500">Total</div>
                </div>
                <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                  <div className="text-2xl font-bold text-green-600 dark:text-green-400">{registrationStats.confirmed}</div>
                  <div className="text-sm text-gray-500">Confirmed</div>
                </div>
                <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
                  <div className="text-2xl font-bold text-red-600 dark:text-red-400">{registrationStats.cancelled}</div>
                  <div className="text-sm text-gray-500">Cancelled</div>
                </div>
                <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                  <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{registrationStats.waitlist}</div>
                  <div className="text-sm text-gray-500">Waitlist</div>
                </div>
              </div>

              {/* Source Analytics & Sponsor Permission */}
              <div className="grid grid-cols-2 gap-4 mb-4">
                {/* Registration Sources */}
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                  <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-3">Registration Sources</h4>
                  {sortedSources.length > 0 ? (
                    <div className="space-y-2">
                      {sortedSources.map(([source, count]) => {
                        const percentage = registrationStats.total > 0
                          ? Math.round((count / registrationStats.total) * 100)
                          : 0;
                        return (
                          <div key={source} className="flex items-center justify-between">
                            <span className="text-sm text-blue-800 dark:text-blue-200 flex-1 min-w-0 truncate">
                              {source === 'unknown' ? 'Not specified' : source}
                            </span>
                            <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                              <div className="w-24 h-2 bg-blue-200 dark:bg-blue-800 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-blue-600 dark:bg-blue-400 rounded-full"
                                  style={{ width: `${percentage}%` }}
                                />
                              </div>
                              <span className="text-sm font-semibold text-blue-900 dark:text-blue-100 w-10 text-right tabular-nums">
                                {count}
                              </span>
                              <span className="text-sm text-blue-700 dark:text-blue-300 w-12 text-right tabular-nums">
                                {percentage}%
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-blue-700 dark:text-blue-300">No source data available</p>
                  )}
                </div>

                {/* Sponsor Permission (Registrations) */}
                <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-semibold text-purple-900 dark:text-purple-100">Sponsor Data Sharing</h4>
                    <button
                      onClick={handleDownloadRegistrationSponsorCSV}
                      disabled={registrationSponsorPermissionCount === 0}
                      className="p-1.5 text-purple-600 hover:text-purple-700 hover:bg-purple-100 dark:text-purple-400 dark:hover:text-purple-300 dark:hover:bg-purple-800 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Download CSV of registrations with sponsor permission"
                    >
                      <ArrowDownTrayIcon className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-purple-800 dark:text-purple-200">Granted Permission</span>
                      <span className="text-2xl font-bold text-purple-600 dark:text-purple-400">{registrationSponsorPermissionCount}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-purple-800 dark:text-purple-200">No Permission</span>
                      <span className="text-2xl font-bold text-gray-600 dark:text-gray-400">{registrationStats.total - registrationSponsorPermissionCount}</span>
                    </div>
                    <div className="pt-2 border-t border-purple-200 dark:border-purple-700">
                      <div className="text-xs text-purple-700 dark:text-purple-300">
                        {registrationStats.total > 0 ? `${Math.round((registrationSponsorPermissionCount / registrationStats.total) * 100)}%` : '0%'} of registrants granted permission
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Job Title Breakdown (Registrations) */}
              {sortedRegistrationJobTitles.length > 0 && sortedRegistrationJobTitles.some(([title]) => title !== 'Not specified') && (
                <div className="p-4 bg-teal-50 dark:bg-teal-900/20 rounded-lg border border-teal-200 dark:border-teal-800 mb-4">
                  <h4 className="text-sm font-semibold text-teal-900 dark:text-teal-100 mb-3">Registrations by Job Title (Top 15)</h4>
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {sortedRegistrationJobTitles.slice(0, 15).map(([title, count]) => {
                      const percentage = registrationStats.total > 0
                        ? Math.round((count / registrationStats.total) * 100)
                        : 0;
                      return (
                        <div key={title} className="flex items-center justify-between">
                          <span className="text-sm text-teal-800 dark:text-teal-200 flex-1 min-w-0 truncate" title={title}>
                            {title}
                          </span>
                          <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                            <div className="w-24 h-2 bg-teal-200 dark:bg-teal-800 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-teal-600 dark:bg-teal-400 rounded-full"
                                style={{ width: `${percentage}%` }}
                              />
                            </div>
                            <span className="text-sm font-semibold text-teal-900 dark:text-teal-100 w-10 text-right tabular-nums">
                              {count}
                            </span>
                            <span className="text-sm text-teal-700 dark:text-teal-300 w-12 text-right tabular-nums">
                              {percentage}%
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Job Function & Seniority Classification (Registrations) */}
              {registrationClassifications && (registrationClassifications.byFunction.length > 0 || registrationClassifications.bySeniority.length > 0) && (
                <div className="grid grid-cols-2 gap-4">
                  {/* By Job Function */}
                  {registrationClassifications.byFunction.length > 0 && registrationClassifications.byFunction.some(f => f.function !== 'Not classified') && (
                    <div className="p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg border border-indigo-200 dark:border-indigo-800">
                      <h4 className="text-sm font-semibold text-indigo-900 dark:text-indigo-100 mb-3">Registrations by Job Function</h4>
                      <div className="space-y-1">
                        {registrationClassifications.byFunction.map(({ function: fn, count, jobTitles }) => {
                          const percentage = registrationStats.total > 0
                            ? Math.round((count / registrationStats.total) * 100)
                            : 0;
                          const isExpanded = expandedFunctions.has(`reg-${fn}`);
                          const hasJobTitles = jobTitles && jobTitles.length > 0;
                          return (
                            <div key={fn}>
                              <div
                                className={`flex items-center justify-between ${hasJobTitles ? 'cursor-pointer hover:bg-indigo-100 dark:hover:bg-indigo-800/30 rounded px-1 -mx-1' : ''}`}
                                onClick={() => {
                                  if (hasJobTitles) {
                                    setExpandedFunctions(prev => {
                                      const next = new Set(prev);
                                      if (next.has(`reg-${fn}`)) {
                                        next.delete(`reg-${fn}`);
                                      } else {
                                        next.add(`reg-${fn}`);
                                      }
                                      return next;
                                    });
                                  }
                                }}
                              >
                                <span className="text-sm text-indigo-800 dark:text-indigo-200 flex items-center gap-1 flex-1 min-w-0">
                                  {hasJobTitles && (
                                    <span className="text-indigo-500 dark:text-indigo-400 w-4 flex-shrink-0">
                                      {isExpanded ? '▼' : '▶'}
                                    </span>
                                  )}
                                  <span className="truncate">{fn}</span>
                                </span>
                                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                  <div className="w-20 h-2 bg-indigo-200 dark:bg-indigo-800 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-indigo-600 dark:bg-indigo-400 rounded-full"
                                      style={{ width: `${percentage}%` }}
                                    />
                                  </div>
                                  <span className="text-sm font-semibold text-indigo-900 dark:text-indigo-100 w-10 text-right tabular-nums">
                                    {count}
                                  </span>
                                  <span className="text-sm text-indigo-700 dark:text-indigo-300 w-12 text-right tabular-nums">
                                    {percentage}%
                                  </span>
                                </div>
                              </div>
                              {isExpanded && hasJobTitles && (
                                <div className="ml-5 mt-1 mb-2 pl-2 border-l-2 border-indigo-300 dark:border-indigo-700">
                                  {jobTitles.map((title, idx) => (
                                    <div key={idx} className="text-xs text-indigo-600 dark:text-indigo-400 py-0.5">
                                      {title}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* By Job Seniority */}
                  {registrationClassifications.bySeniority.length > 0 && registrationClassifications.bySeniority.some(s => s.seniority !== 'Not classified') && (
                    <div className="p-4 bg-pink-50 dark:bg-pink-900/20 rounded-lg border border-pink-200 dark:border-pink-800">
                      <h4 className="text-sm font-semibold text-pink-900 dark:text-pink-100 mb-3">Registrations by Seniority</h4>
                      <div className="space-y-1">
                        {registrationClassifications.bySeniority.map(({ seniority, count, jobTitles }) => {
                          const percentage = registrationStats.total > 0
                            ? Math.round((count / registrationStats.total) * 100)
                            : 0;
                          const isExpanded = expandedSeniorities.has(`reg-${seniority}`);
                          const hasJobTitles = jobTitles && jobTitles.length > 0;
                          return (
                            <div key={seniority}>
                              <div
                                className={`flex items-center justify-between ${hasJobTitles ? 'cursor-pointer hover:bg-pink-100 dark:hover:bg-pink-800/30 rounded px-1 -mx-1' : ''}`}
                                onClick={() => {
                                  if (hasJobTitles) {
                                    setExpandedSeniorities(prev => {
                                      const next = new Set(prev);
                                      if (next.has(`reg-${seniority}`)) {
                                        next.delete(`reg-${seniority}`);
                                      } else {
                                        next.add(`reg-${seniority}`);
                                      }
                                      return next;
                                    });
                                  }
                                }}
                              >
                                <span className="text-sm text-pink-800 dark:text-pink-200 flex items-center gap-1 flex-1 min-w-0">
                                  {hasJobTitles && (
                                    <span className="text-pink-500 dark:text-pink-400 w-4 flex-shrink-0">
                                      {isExpanded ? '▼' : '▶'}
                                    </span>
                                  )}
                                  <span className="truncate">{seniority}</span>
                                </span>
                                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                  <div className="w-20 h-2 bg-pink-200 dark:bg-pink-800 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-pink-600 dark:bg-pink-400 rounded-full"
                                      style={{ width: `${percentage}%` }}
                                    />
                                  </div>
                                  <span className="text-sm font-semibold text-pink-900 dark:text-pink-100 w-10 text-right tabular-nums">
                                    {count}
                                  </span>
                                  <span className="text-sm text-pink-700 dark:text-pink-300 w-12 text-right tabular-nums">
                                    {percentage}%
                                  </span>
                                </div>
                              </div>
                              {isExpanded && hasJobTitles && (
                                <div className="ml-5 mt-1 mb-2 pl-2 border-l-2 border-pink-300 dark:border-pink-700">
                                  {jobTitles.map((title, idx) => (
                                    <div key={idx} className="text-xs text-pink-600 dark:text-pink-400 py-0.5">
                                      {title}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {registrations.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              <p>No registration data available</p>
            </div>
          )}
        </div>
      </Card>

      {/* Attendance Reports */}
      <Card>
        <div className="p-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6">Attendance Analytics</h2>

          {/* Attendance Stats */}
          {attendance.length > 0 && (
            <>
              <div className="grid grid-cols-4 gap-4 mb-6">
                <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                  <div className="text-2xl font-bold text-gray-900 dark:text-white">{attendanceStats.total}</div>
                  <div className="text-sm text-gray-500">Total Checked In</div>
                </div>
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{attendanceStats.qrScan}</div>
                  <div className="text-sm text-gray-500">QR Scan</div>
                </div>
                <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                  <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">{attendanceStats.manual}</div>
                  <div className="text-sm text-gray-500">Manual</div>
                </div>
                <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                  <div className="text-2xl font-bold text-green-600 dark:text-green-400">{attendanceStats.badgePrinted}</div>
                  <div className="text-sm text-gray-500">Badge Printed</div>
                </div>
              </div>

              {/* Attendee Source Analytics & Sponsor Permission */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                {/* Attendee Registration Sources */}
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                  <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-3">Attendee Registration Sources (Attendance Rate)</h4>
                  {(() => {
                    // Calculate source stats for attendees only by cross-referencing with registrations
                    const attendeeSourceStats = attendance.reduce((acc: Record<string, number>, att) => {
                      // Find the matching registration by email
                      const registration = registrations.find((reg) => reg.email === att.email);
                      const source = (registration as any)?.source || 'unknown';
                      acc[source] = (acc[source] || 0) + 1;
                      return acc;
                    }, {});

                    // Sort by attendance rate percentage (highest first)
                    const sortedAttendeeSources = Object.entries(attendeeSourceStats).sort(([sourceA, countA], [sourceB, countB]) => {
                      const totalA = sourceStats[sourceA] || countA;
                      const totalB = sourceStats[sourceB] || countB;
                      const rateA = totalA > 0 ? (countA / totalA) : 0;
                      const rateB = totalB > 0 ? (countB / totalB) : 0;
                      return rateB - rateA; // Sort descending by percentage
                    });

                    return sortedAttendeeSources.length > 0 ? (
                      <div className="space-y-2">
                        {sortedAttendeeSources.map(([source, attendeeCount]) => {
                          // Get total registrations for this source
                          const totalRegistrations = sourceStats[source] || attendeeCount;
                          // Calculate attendance rate as percentage
                          const attendanceRate = totalRegistrations > 0
                            ? Math.round((attendeeCount / totalRegistrations) * 100)
                            : 0;

                          return (
                            <div key={source} className="flex items-center justify-between">
                              <span className="text-sm text-blue-800 dark:text-blue-200 flex-1 min-w-0 truncate">
                                {source === 'unknown' ? 'Not specified' : source}
                              </span>
                              <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                <div className="w-24 h-2 bg-blue-200 dark:bg-blue-800 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-blue-600 dark:bg-blue-400 rounded-full"
                                    style={{ width: `${attendanceRate}%` }}
                                  />
                                </div>
                                <span className="text-sm font-semibold text-blue-900 dark:text-blue-100 w-8 text-right tabular-nums">
                                  {attendeeCount}
                                </span>
                                <span className="text-sm text-blue-700 dark:text-blue-300">/</span>
                                <span className="text-sm font-semibold text-blue-900 dark:text-blue-100 w-8 text-left tabular-nums">
                                  {totalRegistrations}
                                </span>
                                <span className="text-sm text-blue-700 dark:text-blue-300 w-12 text-right tabular-nums">
                                  {attendanceRate}%
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-sm text-blue-700 dark:text-blue-300">No source data available</p>
                    );
                  })()}
                </div>

                {/* Sponsor Data Sharing (Attendance) */}
                <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-semibold text-purple-900 dark:text-purple-100">Sponsor Data Sharing</h4>
                    <button
                      onClick={handleDownloadAttendanceSponsorCSV}
                      disabled={attendanceSponsorPermissionCount === 0}
                      className="p-1.5 text-purple-600 hover:text-purple-700 hover:bg-purple-100 dark:text-purple-400 dark:hover:text-purple-300 dark:hover:bg-purple-800 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Download CSV of attendees with sponsor permission"
                    >
                      <ArrowDownTrayIcon className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-purple-800 dark:text-purple-200">Granted Permission</span>
                      <span className="text-2xl font-bold text-purple-600 dark:text-purple-400">{attendanceSponsorPermissionCount}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-purple-800 dark:text-purple-200">No Permission</span>
                      <span className="text-2xl font-bold text-gray-600 dark:text-gray-400">{attendanceStats.total - attendanceSponsorPermissionCount}</span>
                    </div>
                    <div className="pt-2 border-t border-purple-200 dark:border-purple-700">
                      <div className="text-xs text-purple-700 dark:text-purple-300">
                        {attendanceStats.total > 0 ? `${Math.round((attendanceSponsorPermissionCount / attendanceStats.total) * 100)}%` : '0%'} of attendees granted permission
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Job Title Breakdown (Attendance) */}
              {Object.keys(attendanceJobTitleStats).length > 0 && Object.keys(attendanceJobTitleStats).some(title => title !== 'Not specified') && (
                <div className="p-4 bg-teal-50 dark:bg-teal-900/20 rounded-lg border border-teal-200 dark:border-teal-800 mb-6">
                  <h4 className="text-sm font-semibold text-teal-900 dark:text-teal-100 mb-3">Attendees by Job Title (Top 15)</h4>
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {Object.entries(attendanceJobTitleStats).sort(([, a], [, b]) => b - a).slice(0, 15).map(([title, count]) => {
                      const percentage = attendanceStats.total > 0
                        ? Math.round((count / attendanceStats.total) * 100)
                        : 0;
                      // Calculate attendance rate for this job title
                      const registrationCount = registrationJobTitleStats[title] || count;
                      const attendanceRate = registrationCount > 0
                        ? Math.round((count / registrationCount) * 100)
                        : 0;
                      return (
                        <div key={title} className="flex items-center justify-between">
                          <span className="text-sm text-teal-800 dark:text-teal-200 flex-1 min-w-0 truncate" title={title}>
                            {title}
                          </span>
                          <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                            <div className="w-20 h-2 bg-teal-200 dark:bg-teal-800 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-teal-600 dark:bg-teal-400 rounded-full"
                                style={{ width: `${percentage}%` }}
                              />
                            </div>
                            <span className="text-sm font-semibold text-teal-900 dark:text-teal-100 w-8 text-right tabular-nums">
                              {count}
                            </span>
                            <span className="text-xs text-teal-700 dark:text-teal-300 w-16 text-right">
                              ({attendanceRate}% rate)
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Job Function & Seniority Classification (Attendance) */}
              {attendanceClassifications && (attendanceClassifications.byFunction.length > 0 || attendanceClassifications.bySeniority.length > 0) && (
                <div className="grid grid-cols-2 gap-4 mb-6">
                  {/* By Job Function */}
                  {attendanceClassifications.byFunction.length > 0 && attendanceClassifications.byFunction.some(f => f.function !== 'Not classified') && (
                    <div className="p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg border border-indigo-200 dark:border-indigo-800">
                      <h4 className="text-sm font-semibold text-indigo-900 dark:text-indigo-100 mb-3">Attendees by Job Function</h4>
                      <div className="space-y-1">
                        {attendanceClassifications.byFunction.map(({ function: fn, count, jobTitles }) => {
                          const percentage = attendanceStats.total > 0
                            ? Math.round((count / attendanceStats.total) * 100)
                            : 0;
                          const isExpanded = expandedFunctions.has(`att-${fn}`);
                          const hasJobTitles = jobTitles && jobTitles.length > 0;
                          return (
                            <div key={fn}>
                              <div
                                className={`flex items-center justify-between ${hasJobTitles ? 'cursor-pointer hover:bg-indigo-100 dark:hover:bg-indigo-800/30 rounded px-1 -mx-1' : ''}`}
                                onClick={() => {
                                  if (hasJobTitles) {
                                    setExpandedFunctions(prev => {
                                      const next = new Set(prev);
                                      if (next.has(`att-${fn}`)) {
                                        next.delete(`att-${fn}`);
                                      } else {
                                        next.add(`att-${fn}`);
                                      }
                                      return next;
                                    });
                                  }
                                }}
                              >
                                <span className="text-sm text-indigo-800 dark:text-indigo-200 flex items-center gap-1 flex-1 min-w-0">
                                  {hasJobTitles && (
                                    <span className="text-indigo-500 dark:text-indigo-400 w-4 flex-shrink-0">
                                      {isExpanded ? '▼' : '▶'}
                                    </span>
                                  )}
                                  <span className="truncate">{fn}</span>
                                </span>
                                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                  <div className="w-20 h-2 bg-indigo-200 dark:bg-indigo-800 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-indigo-600 dark:bg-indigo-400 rounded-full"
                                      style={{ width: `${percentage}%` }}
                                    />
                                  </div>
                                  <span className="text-sm font-semibold text-indigo-900 dark:text-indigo-100 w-10 text-right tabular-nums">
                                    {count}
                                  </span>
                                  <span className="text-sm text-indigo-700 dark:text-indigo-300 w-12 text-right tabular-nums">
                                    {percentage}%
                                  </span>
                                </div>
                              </div>
                              {isExpanded && hasJobTitles && (
                                <div className="ml-5 mt-1 mb-2 pl-2 border-l-2 border-indigo-300 dark:border-indigo-700">
                                  {jobTitles.map((title, idx) => (
                                    <div key={idx} className="text-xs text-indigo-600 dark:text-indigo-400 py-0.5">
                                      {title}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* By Job Seniority */}
                  {attendanceClassifications.bySeniority.length > 0 && attendanceClassifications.bySeniority.some(s => s.seniority !== 'Not classified') && (
                    <div className="p-4 bg-pink-50 dark:bg-pink-900/20 rounded-lg border border-pink-200 dark:border-pink-800">
                      <h4 className="text-sm font-semibold text-pink-900 dark:text-pink-100 mb-3">Attendees by Seniority</h4>
                      <div className="space-y-1">
                        {attendanceClassifications.bySeniority.map(({ seniority, count, jobTitles }) => {
                          const percentage = attendanceStats.total > 0
                            ? Math.round((count / attendanceStats.total) * 100)
                            : 0;
                          const isExpanded = expandedSeniorities.has(`att-${seniority}`);
                          const hasJobTitles = jobTitles && jobTitles.length > 0;
                          return (
                            <div key={seniority}>
                              <div
                                className={`flex items-center justify-between ${hasJobTitles ? 'cursor-pointer hover:bg-pink-100 dark:hover:bg-pink-800/30 rounded px-1 -mx-1' : ''}`}
                                onClick={() => {
                                  if (hasJobTitles) {
                                    setExpandedSeniorities(prev => {
                                      const next = new Set(prev);
                                      if (next.has(`att-${seniority}`)) {
                                        next.delete(`att-${seniority}`);
                                      } else {
                                        next.add(`att-${seniority}`);
                                      }
                                      return next;
                                    });
                                  }
                                }}
                              >
                                <span className="text-sm text-pink-800 dark:text-pink-200 flex items-center gap-1 flex-1 min-w-0">
                                  {hasJobTitles && (
                                    <span className="text-pink-500 dark:text-pink-400 w-4 flex-shrink-0">
                                      {isExpanded ? '▼' : '▶'}
                                    </span>
                                  )}
                                  <span className="truncate">{seniority}</span>
                                </span>
                                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                  <div className="w-20 h-2 bg-pink-200 dark:bg-pink-800 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-pink-600 dark:bg-pink-400 rounded-full"
                                      style={{ width: `${percentage}%` }}
                                    />
                                  </div>
                                  <span className="text-sm font-semibold text-pink-900 dark:text-pink-100 w-10 text-right tabular-nums">
                                    {count}
                                  </span>
                                  <span className="text-sm text-pink-700 dark:text-pink-300 w-12 text-right tabular-nums">
                                    {percentage}%
                                  </span>
                                </div>
                              </div>
                              {isExpanded && hasJobTitles && (
                                <div className="ml-5 mt-1 mb-2 pl-2 border-l-2 border-pink-300 dark:border-pink-700">
                                  {jobTitles.map((title, idx) => (
                                    <div key={idx} className="text-xs text-pink-600 dark:text-pink-400 py-0.5">
                                      {title}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Check-in Timeline Charts */}
              {checkInData.length > 0 && (
                <div className="space-y-6 mb-6">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Check-in Timeline</h3>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Cumulative Check-ins Chart */}
                    <Card skin="shadow" className="p-6">
                      <div className="mb-4">
                        <h4 className="text-base font-semibold text-gray-900 dark:text-white">
                          Cumulative Check-ins Over Time
                        </h4>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                          Total number of attendees checked in over time
                        </p>
                      </div>
                      <ReactApexChart
                        options={cumulativeChartOptions}
                        series={cumulativeChartSeries}
                        type="area"
                        height={300}
                      />
                    </Card>

                    {/* Check-ins per Minute Chart */}
                    <Card skin="shadow" className="p-6">
                      <div className="mb-4">
                        <h4 className="text-base font-semibold text-gray-900 dark:text-white">
                          Check-ins per Minute
                        </h4>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                          Number of attendees checked in per minute
                        </p>
                      </div>
                      <ReactApexChart
                        options={perMinuteChartOptions}
                        series={perMinuteChartSeries}
                        type="bar"
                        height={300}
                      />
                    </Card>
                  </div>
                </div>
              )}

              {/* Badge Scanning Statistics */}
              {badgeScanStats && badgeScanStats.totalScans > 0 && (
                <div className="space-y-6">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Badge Scanning Activity</h3>

                  {/* Badge Scan Stats */}
                  <div className="grid grid-cols-4 gap-4">
                    <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                      <div className="text-2xl font-bold text-gray-900 dark:text-white">{badgeScanStats.totalScans}</div>
                      <div className="text-sm text-gray-500">Total Scans</div>
                    </div>
                    <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                      <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">{badgeScanStats.uniqueScanners}</div>
                      <div className="text-sm text-gray-500">Active Scanners</div>
                    </div>
                    <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                      <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{badgeScanStats.uniqueScanned}</div>
                      <div className="text-sm text-gray-500">Unique People Scanned</div>
                    </div>
                    <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
                      <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{badgeScanStats.avgScansPerScanner}</div>
                      <div className="text-sm text-gray-500">Avg Scans per Scanner</div>
                    </div>
                  </div>

                  {/* Badge Scan Timeline Charts */}
                  {badgeScanStats.timeline.length > 0 && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      {/* Cumulative Badge Scans Chart */}
                      <Card skin="shadow" className="p-6">
                        <div className="mb-4">
                          <h4 className="text-base font-semibold text-gray-900 dark:text-white">
                            Cumulative Badge Scans Over Time
                          </h4>
                          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                            Total number of badge scans over time
                          </p>
                        </div>
                        <ReactApexChart
                          options={badgeScanCumulativeOptions}
                          series={badgeScanCumulativeSeries}
                          type="area"
                          height={300}
                        />
                      </Card>

                      {/* Badge Scans per Minute Chart */}
                      <Card skin="shadow" className="p-6">
                        <div className="mb-4">
                          <h4 className="text-base font-semibold text-gray-900 dark:text-white">
                            Badge Scans per Minute
                          </h4>
                          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                            Number of badge scans per minute
                          </p>
                        </div>
                        <ReactApexChart
                          options={badgeScanPerMinuteOptions}
                          series={badgeScanPerMinuteSeries}
                          type="bar"
                          height={300}
                        />
                      </Card>
                    </div>
                  )}

                  {/* Top Scanners Table */}
                  {badgeScanStats.topScanners.length > 0 && (
                    <Card skin="shadow" className="p-6">
                      <h4 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
                        Top Scanners
                      </h4>
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                          <thead className="bg-gray-50 dark:bg-gray-800">
                            <tr>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                Rank
                              </th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                Scanner
                              </th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                Company
                              </th>
                              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                Total Scans
                              </th>
                              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                Unique Scanned
                              </th>
                            </tr>
                          </thead>
                          <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                            {badgeScanStats.topScanners.map((scanner, index) => (
                              <tr key={scanner.scanner_profile_id}>
                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                                  #{index + 1}
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap">
                                  <div className="text-sm font-medium text-gray-900 dark:text-white">
                                    {scanner.scanner_name}
                                  </div>
                                  <div className="text-xs text-gray-500">{scanner.scanner_email}</div>
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                                  {scanner.scanner_company || '-'}
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-semibold text-gray-900 dark:text-white">
                                  {scanner.scan_count}
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap text-right text-sm text-gray-600 dark:text-gray-400">
                                  {scanner.unique_scanned}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </Card>
                  )}
                </div>
              )}
            </>
          )}

          {attendance.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              <p>No attendance data available</p>
            </div>
          )}
        </div>
      </Card>

      {/* Calendar Interaction Reports */}
      <Card>
        <div className="p-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6">Calendar Integration Analytics</h2>

          {calendarStats && (
            <>
              {/* Calendar Stats Overview */}
              <div className="grid grid-cols-4 gap-4 mb-6">
                <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                  <div className="text-2xl font-bold text-gray-900 dark:text-white">
                    {calendarStats.totalInteractions}
                  </div>
                  <div className="text-sm text-gray-500">Total Clicks</div>
                </div>
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                    {calendarStats.uniqueUsers}
                  </div>
                  <div className="text-sm text-gray-500">Unique Users</div>
                </div>
                <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                  <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                    {calendarStats.byType?.google || 0}
                  </div>
                  <div className="text-sm text-gray-500">Google Calendar</div>
                </div>
                <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                  <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                    {calendarStats.byType?.outlook || 0}
                  </div>
                  <div className="text-sm text-gray-500">Outlook Calendar</div>
                </div>
              </div>

              {/* Calendar Type Distribution & Engagement by Attendance */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                {/* Calendar Type Distribution */}
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                  <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-3">Calendar Type Distribution</h4>
                  {Object.entries(calendarStats.byType || {}).length > 0 ? (
                    <div className="space-y-2">
                      {Object.entries(calendarStats.byType).map(([type, count]) => (
                        <div key={type} className="flex items-center justify-between">
                          <span className="text-sm text-blue-800 dark:text-blue-200 capitalize">
                            {type === 'ics' ? 'ICS Download' :
                             type === 'apple' ? 'Apple Calendar' :
                             type === 'google' ? 'Google Calendar' :
                             type === 'outlook' ? 'Outlook Calendar' : type}
                          </span>
                          <div className="flex items-center gap-2">
                            <div className="w-24 h-2 bg-blue-200 dark:bg-blue-800 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-blue-600 dark:bg-blue-400 rounded-full"
                                style={{ width: `${(count / calendarStats.totalInteractions) * 100}%` }}
                              />
                            </div>
                            <span className="text-sm font-semibold text-blue-900 dark:text-blue-100 w-8 text-right">
                              {count}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-blue-700 dark:text-blue-300">No calendar interaction data available</p>
                  )}
                </div>

                {/* Calendar Engagement by Attendance Status */}
                <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                  <h4 className="text-sm font-semibold text-green-900 dark:text-green-100 mb-3">Calendar Engagement by Attendance</h4>
                  {(() => {
                    const withCalendar = calendarWithAttendance || [];
                    const attendedWithCalendar = withCalendar.filter(u => u.hasAttended).length;
                    const notAttendedWithCalendar = withCalendar.filter(u => !u.hasAttended && u.hasRegistration).length;
                    const noRegistrationWithCalendar = withCalendar.filter(u => !u.hasRegistration).length;

                    return (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-green-800 dark:text-green-200">Attended Event</span>
                          <div className="flex items-center gap-2">
                            <span className="text-lg font-bold text-green-600 dark:text-green-400">
                              {attendedWithCalendar}
                            </span>
                            <span className="text-sm text-green-700 dark:text-green-300">
                              ({withCalendar.length > 0 ? Math.round((attendedWithCalendar / withCalendar.length) * 100) : 0}%)
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-yellow-800 dark:text-yellow-200">Registered, Not Attended</span>
                          <div className="flex items-center gap-2">
                            <span className="text-lg font-bold text-yellow-600 dark:text-yellow-400">
                              {notAttendedWithCalendar}
                            </span>
                            <span className="text-sm text-yellow-700 dark:text-yellow-300">
                              ({withCalendar.length > 0 ? Math.round((notAttendedWithCalendar / withCalendar.length) * 100) : 0}%)
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-gray-800 dark:text-gray-200">No Registration</span>
                          <div className="flex items-center gap-2">
                            <span className="text-lg font-bold text-gray-600 dark:text-gray-400">
                              {noRegistrationWithCalendar}
                            </span>
                            <span className="text-sm text-gray-700 dark:text-gray-300">
                              ({withCalendar.length > 0 ? Math.round((noRegistrationWithCalendar / withCalendar.length) * 100) : 0}%)
                            </span>
                          </div>
                        </div>
                        <div className="pt-2 border-t border-green-200 dark:border-green-700">
                          <div className="text-xs text-green-700 dark:text-green-300">
                            {attendedWithCalendar > 0 && withCalendar.length > 0
                              ? `${Math.round((attendedWithCalendar / withCalendar.length) * 100)}% of users who added to calendar attended`
                              : 'No attendance data for calendar users'}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Top Calendar Users */}
              {calendarStats.byEmail && calendarStats.byEmail.length > 0 && (
                <Card skin="shadow" className="p-6">
                  <h4 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
                    Most Active Calendar Users (Top 10)
                  </h4>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                      <thead className="bg-gray-50 dark:bg-surface-2">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            Email
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            Total Clicks
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            Calendar Types Used
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            Status
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200 dark:bg-surface-1 dark:divide-gray-700">
                        {calendarStats.byEmail.slice(0, 10).map((user: any, index: number) => {
                          const userData = calendarWithAttendance.find(u => u.email === user.email);
                          return (
                            <tr key={index}>
                              <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                                {user.email}
                              </td>
                              <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                                {user.count}
                              </td>
                              <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                                <div className="flex gap-1">
                                  {user.types.map((type: string) => (
                                    <Badge key={type} variant="soft" className="text-xs">
                                      {type === 'ics' ? 'ICS' :
                                       type === 'apple' ? 'Apple' :
                                       type === 'google' ? 'Google' :
                                       type === 'outlook' ? 'Outlook' : type}
                                    </Badge>
                                  ))}
                                </div>
                              </td>
                              <td className="px-4 py-4 whitespace-nowrap text-sm">
                                {userData?.hasAttended ? (
                                  <Badge variant="soft" className="bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400">
                                    Attended
                                  </Badge>
                                ) : userData?.hasRegistration ? (
                                  <Badge variant="soft" className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400">
                                    Registered
                                  </Badge>
                                ) : (
                                  <Badge variant="soft" className="bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-400">
                                    Not Registered
                                  </Badge>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </>
          )}

          {!calendarStats || calendarStats.totalInteractions === 0 && (
            <div className="text-center py-12 text-gray-500">
              <p>No calendar interaction data available</p>
              <p className="text-sm mt-2">Calendar links will be tracked when users click them in registration emails</p>
            </div>
          )}
        </div>
      </Card>

      {/* Luma Payment Analytics */}
      {lumaPaymentStats && (
        <Card>
          <div className="p-6">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6">Luma Payment Analytics</h2>

            {/* Revenue Overview */}
            <div className="grid grid-cols-4 gap-4 mb-6">
              <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {lumaPaymentStats.currency?.toUpperCase() === 'GBP' ? '£' : lumaPaymentStats.currency?.toUpperCase() === 'USD' ? '$' : lumaPaymentStats.currency?.toUpperCase() === 'EUR' ? '€' : ''}{lumaPaymentStats.totalRevenue.toFixed(2)}
                </div>
                <div className="text-sm text-gray-500">Total Revenue</div>
              </div>
              <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                  {lumaPaymentStats.paidRegistrations}
                </div>
                <div className="text-sm text-gray-500">Paid Registrations</div>
              </div>
              <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div className="text-2xl font-bold text-gray-900 dark:text-white">
                  {lumaPaymentStats.freeRegistrations}
                </div>
                <div className="text-sm text-gray-500">Free Registrations</div>
              </div>
              <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                  {lumaPaymentStats.currency?.toUpperCase() === 'GBP' ? '£' : lumaPaymentStats.currency?.toUpperCase() === 'USD' ? '$' : lumaPaymentStats.currency?.toUpperCase() === 'EUR' ? '€' : ''}{(lumaPaymentStats.totalRevenue / lumaPaymentStats.paidRegistrations).toFixed(2)}
                </div>
                <div className="text-sm text-gray-500">Avg. Ticket Price</div>
              </div>
            </div>

            {/* Ticket Types & Coupon Codes */}
            <div className="grid grid-cols-2 gap-4 mb-6">
              {/* Ticket Types */}
              <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-3">Revenue by Ticket Type</h4>
                {lumaPaymentStats.ticketTypes.length > 0 ? (
                  <div className="space-y-2">
                    {lumaPaymentStats.ticketTypes.map((ticket: any) => {
                      const percentage = lumaPaymentStats.totalRevenue > 0
                        ? Math.round((ticket.revenue / lumaPaymentStats.totalRevenue) * 100)
                        : 0;
                      return (
                        <div key={ticket.name} className="flex items-center justify-between">
                          <span className="text-sm text-blue-800 dark:text-blue-200 flex-1 min-w-0 truncate">
                            {ticket.name}
                          </span>
                          <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                            <div className="w-20 h-2 bg-blue-200 dark:bg-blue-800 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-blue-600 dark:bg-blue-400 rounded-full"
                                style={{ width: `${percentage}%` }}
                              />
                            </div>
                            <span className="text-sm font-semibold text-blue-900 dark:text-blue-100 w-16 text-right tabular-nums">
                              {lumaPaymentStats.currency?.toUpperCase() === 'GBP' ? '£' : lumaPaymentStats.currency?.toUpperCase() === 'USD' ? '$' : ''}{ticket.revenue.toFixed(0)}
                            </span>
                            <span className="text-xs text-blue-700 dark:text-blue-300 w-10 text-right">
                              ({ticket.count})
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-blue-700 dark:text-blue-300">No ticket type data available</p>
                )}
              </div>

              {/* Coupon Codes */}
              <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
                <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-100 mb-3">Coupon Code Usage</h4>
                {lumaPaymentStats.couponCodes.length > 0 ? (
                  <div className="space-y-2">
                    {lumaPaymentStats.couponCodes.map((coupon: any) => {
                      const percentage = lumaPaymentStats.paidRegistrations > 0
                        ? Math.round((coupon.count / lumaPaymentStats.paidRegistrations) * 100)
                        : 0;
                      return (
                        <div key={coupon.code} className="flex items-center justify-between">
                          <span className="text-sm text-amber-800 dark:text-amber-200 font-mono">
                            {coupon.code}
                          </span>
                          <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                            <div className="w-20 h-2 bg-amber-200 dark:bg-amber-800 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-amber-600 dark:bg-amber-400 rounded-full"
                                style={{ width: `${percentage}%` }}
                              />
                            </div>
                            <span className="text-sm font-semibold text-amber-900 dark:text-amber-100 w-8 text-right tabular-nums">
                              {coupon.count}
                            </span>
                            <span className="text-xs text-amber-700 dark:text-amber-300 w-12 text-right">
                              {percentage}%
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-amber-700 dark:text-amber-300">No coupon codes used</p>
                )}
              </div>
            </div>

            {/* Revenue by Job Title */}
            {lumaPaymentStats.jobTitles && lumaPaymentStats.jobTitles.length > 0 && lumaPaymentStats.jobTitles.some((j: any) => j.title !== 'Not specified') && (
              <div className="p-4 bg-teal-50 dark:bg-teal-900/20 rounded-lg border border-teal-200 dark:border-teal-800 mb-6">
                <h4 className="text-sm font-semibold text-teal-900 dark:text-teal-100 mb-3">Revenue by Job Title (Top 15)</h4>
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {lumaPaymentStats.jobTitles.slice(0, 15).map((job: any) => {
                    const percentage = lumaPaymentStats.totalRevenue > 0
                      ? Math.round((job.revenue / lumaPaymentStats.totalRevenue) * 100)
                      : 0;
                    const currencySymbol = lumaPaymentStats.currency?.toUpperCase() === 'GBP' ? '£' : lumaPaymentStats.currency?.toUpperCase() === 'USD' ? '$' : lumaPaymentStats.currency?.toUpperCase() === 'EUR' ? '€' : '';
                    return (
                      <div key={job.title} className="flex items-center justify-between">
                        <span className="text-sm text-teal-800 dark:text-teal-200 flex-1 min-w-0 truncate" title={job.title}>
                          {job.title}
                        </span>
                        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                          <div className="w-16 h-2 bg-teal-200 dark:bg-teal-800 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-teal-600 dark:bg-teal-400 rounded-full"
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                          <span className="text-sm font-semibold text-teal-900 dark:text-teal-100 w-16 text-right tabular-nums">
                            {currencySymbol}{job.revenue.toFixed(0)}
                          </span>
                          <span className="text-xs text-teal-700 dark:text-teal-300 w-8 text-right">
                            ({job.count})
                          </span>
                          <span className="text-xs text-teal-600 dark:text-teal-400 w-16 text-right">
                            avg {currencySymbol}{job.avgTicketPrice.toFixed(0)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Revenue by Job Function & Seniority */}
            {((lumaPaymentStats.byFunction && lumaPaymentStats.byFunction.length > 0) || (lumaPaymentStats.bySeniority && lumaPaymentStats.bySeniority.length > 0)) && (
              <div className="grid grid-cols-2 gap-4 mb-6">
                {/* By Job Function */}
                {lumaPaymentStats.byFunction && lumaPaymentStats.byFunction.length > 0 && lumaPaymentStats.byFunction.some((f: any) => f.function !== 'Not classified') && (
                  <div className="p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg border border-indigo-200 dark:border-indigo-800">
                    <h4 className="text-sm font-semibold text-indigo-900 dark:text-indigo-100 mb-3">Revenue by Job Function</h4>
                    <div className="space-y-1">
                      {lumaPaymentStats.byFunction.map((item: any) => {
                        const percentage = lumaPaymentStats.totalRevenue > 0
                          ? Math.round((item.revenue / lumaPaymentStats.totalRevenue) * 100)
                          : 0;
                        const currencySymbol = lumaPaymentStats.currency?.toUpperCase() === 'GBP' ? '£' : lumaPaymentStats.currency?.toUpperCase() === 'USD' ? '$' : lumaPaymentStats.currency?.toUpperCase() === 'EUR' ? '€' : '';
                        const isExpanded = expandedFunctions.has(`rev-${item.function}`);
                        const hasJobTitles = item.jobTitles && item.jobTitles.length > 0;
                        return (
                          <div key={item.function}>
                            <div
                              className={`flex items-center justify-between ${hasJobTitles ? 'cursor-pointer hover:bg-indigo-100 dark:hover:bg-indigo-800/30 rounded px-1 -mx-1' : ''}`}
                              onClick={() => {
                                if (hasJobTitles) {
                                  setExpandedFunctions(prev => {
                                    const next = new Set(prev);
                                    if (next.has(`rev-${item.function}`)) {
                                      next.delete(`rev-${item.function}`);
                                    } else {
                                      next.add(`rev-${item.function}`);
                                    }
                                    return next;
                                  });
                                }
                              }}
                            >
                              <span className="text-sm text-indigo-800 dark:text-indigo-200 flex items-center gap-1 flex-1 min-w-0">
                                {hasJobTitles && (
                                  <span className="text-indigo-500 dark:text-indigo-400 w-4 flex-shrink-0">
                                    {isExpanded ? '▼' : '▶'}
                                  </span>
                                )}
                                <span className="truncate">{item.function}</span>
                              </span>
                              <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                <div className="w-16 h-2 bg-indigo-200 dark:bg-indigo-800 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-indigo-600 dark:bg-indigo-400 rounded-full"
                                    style={{ width: `${percentage}%` }}
                                  />
                                </div>
                                <span className="text-sm font-semibold text-indigo-900 dark:text-indigo-100 w-14 text-right tabular-nums">
                                  {currencySymbol}{item.revenue.toFixed(0)}
                                </span>
                                <span className="text-xs text-indigo-700 dark:text-indigo-300 w-6 text-right">
                                  ({item.count})
                                </span>
                                <span className="text-xs text-indigo-600 dark:text-indigo-400 w-14 text-right">
                                  avg {currencySymbol}{item.avgTicketPrice.toFixed(0)}
                                </span>
                              </div>
                            </div>
                            {isExpanded && hasJobTitles && (
                              <div className="ml-5 mt-1 mb-2 pl-2 border-l-2 border-indigo-300 dark:border-indigo-700">
                                {item.jobTitles.map((title: string, idx: number) => (
                                  <div key={idx} className="text-xs text-indigo-600 dark:text-indigo-400 py-0.5">
                                    {title}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* By Job Seniority */}
                {lumaPaymentStats.bySeniority && lumaPaymentStats.bySeniority.length > 0 && lumaPaymentStats.bySeniority.some((s: any) => s.seniority !== 'Not classified') && (
                  <div className="p-4 bg-pink-50 dark:bg-pink-900/20 rounded-lg border border-pink-200 dark:border-pink-800">
                    <h4 className="text-sm font-semibold text-pink-900 dark:text-pink-100 mb-3">Revenue by Seniority</h4>
                    <div className="space-y-1">
                      {lumaPaymentStats.bySeniority.map((item: any) => {
                        const percentage = lumaPaymentStats.totalRevenue > 0
                          ? Math.round((item.revenue / lumaPaymentStats.totalRevenue) * 100)
                          : 0;
                        const currencySymbol = lumaPaymentStats.currency?.toUpperCase() === 'GBP' ? '£' : lumaPaymentStats.currency?.toUpperCase() === 'USD' ? '$' : lumaPaymentStats.currency?.toUpperCase() === 'EUR' ? '€' : '';
                        const isExpanded = expandedSeniorities.has(`rev-${item.seniority}`);
                        const hasJobTitles = item.jobTitles && item.jobTitles.length > 0;
                        return (
                          <div key={item.seniority}>
                            <div
                              className={`flex items-center justify-between ${hasJobTitles ? 'cursor-pointer hover:bg-pink-100 dark:hover:bg-pink-800/30 rounded px-1 -mx-1' : ''}`}
                              onClick={() => {
                                if (hasJobTitles) {
                                  setExpandedSeniorities(prev => {
                                    const next = new Set(prev);
                                    if (next.has(`rev-${item.seniority}`)) {
                                      next.delete(`rev-${item.seniority}`);
                                    } else {
                                      next.add(`rev-${item.seniority}`);
                                    }
                                    return next;
                                  });
                                }
                              }}
                            >
                              <span className="text-sm text-pink-800 dark:text-pink-200 flex items-center gap-1 flex-1 min-w-0">
                                {hasJobTitles && (
                                  <span className="text-pink-500 dark:text-pink-400 w-4 flex-shrink-0">
                                    {isExpanded ? '▼' : '▶'}
                                  </span>
                                )}
                                <span className="truncate">{item.seniority}</span>
                              </span>
                              <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                <div className="w-16 h-2 bg-pink-200 dark:bg-pink-800 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-pink-600 dark:bg-pink-400 rounded-full"
                                    style={{ width: `${percentage}%` }}
                                  />
                                </div>
                                <span className="text-sm font-semibold text-pink-900 dark:text-pink-100 w-14 text-right tabular-nums">
                                  {currencySymbol}{item.revenue.toFixed(0)}
                                </span>
                                <span className="text-xs text-pink-700 dark:text-pink-300 w-6 text-right">
                                  ({item.count})
                                </span>
                                <span className="text-xs text-pink-600 dark:text-pink-400 w-14 text-right">
                                  avg {currencySymbol}{item.avgTicketPrice.toFixed(0)}
                                </span>
                              </div>
                            </div>
                            {isExpanded && hasJobTitles && (
                              <div className="ml-5 mt-1 mb-2 pl-2 border-l-2 border-pink-300 dark:border-pink-700">
                                {item.jobTitles.map((title: string, idx: number) => (
                                  <div key={idx} className="text-xs text-pink-600 dark:text-pink-400 py-0.5">
                                    {title}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Paid Attendees Table */}
            {lumaPaymentStats.paidAttendees.length > 0 && (
              <Card skin="shadow" className="p-6">
                <h4 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
                  Paid Registrations ({lumaPaymentStats.paidAttendees.length})
                </h4>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-gray-800">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Name
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Job Title
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Ticket Type
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Coupon
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Amount
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                      {lumaPaymentStats.paidAttendees.map((attendee: any, index: number) => (
                        <tr key={index}>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900 dark:text-white">{attendee.name}</div>
                            <div className="text-xs text-gray-500">{attendee.email}</div>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 max-w-48 truncate" title={attendee.jobTitle || 'Not specified'}>
                            {attendee.jobTitle || <span className="text-gray-400">-</span>}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                            {attendee.ticketType}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm">
                            {attendee.couponCode ? (
                              <Badge variant="soft" className="bg-amber-100 text-amber-800 dark:bg-amber-900/20 dark:text-amber-400 font-mono text-xs">
                                {attendee.couponCode}
                              </Badge>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-semibold text-green-600 dark:text-green-400">
                            {lumaPaymentStats.currency?.toUpperCase() === 'GBP' ? '£' : lumaPaymentStats.currency?.toUpperCase() === 'USD' ? '$' : lumaPaymentStats.currency?.toUpperCase() === 'EUR' ? '€' : ''}{attendee.amount.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </div>
        </Card>
      )}

    </div>
  );
};

export default EventDetailPage;
