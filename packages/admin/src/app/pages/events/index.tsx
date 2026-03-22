import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router';
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  CalendarIcon,
  GlobeAltIcon,
  PhotoIcon,
  CameraIcon,
  MagnifyingGlassIcon,
  FunnelIcon,
  EyeIcon,
  DocumentDuplicateIcon,
  ArrowPathIcon,
  MapPinIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'sonner';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  createColumnHelper,
  SortingState,
} from '@tanstack/react-table';

import {
  Button,
  Modal,
  Card,
  Input,
  Select,
  Badge,
  Pagination,
  PaginationFirst,
  PaginationLast,
  PaginationNext,
  PaginationPrevious,
  PaginationItems,
  ConfirmModal,
  ImageUpload,
  Tabs,
} from '@/components/ui';
import type { Tab } from '@/components/ui/Tabs';
import { Page } from '@/components/shared/Page';
import { DataTable } from '@/components/shared/table/DataTable';
import { RowActions } from '@/components/shared/table/RowActions';
import { TopicSelector } from '@/components/shared/TopicSelector';
import { TerminalOutputModal } from '@/components/shared/TerminalOutputModal';
import { EventService, Event, EventIdGenerator } from '@/utils/eventService';
import { ScreenshotService } from '@/utils/screenshotService';
import { useAuthContext } from '@/app/contexts/auth/context';
import { useAccountAccess } from '@/hooks/useAccountAccess';
import { AccountService } from '@/utils/accountService';
import { Account } from '@/lib/supabase';
import { getApiBaseUrl } from '@/config/brands';
import { useEventTypes } from '@/hooks/useEventTypes';
import { useHasModule } from '@/hooks/useModuleFeature';

// Form validation schema
const eventSchema = yup.object({
  eventTitle: yup.string().required('Event title is required').min(3, 'Title must be at least 3 characters'),
  eventCity: yup.string().required(),
  eventCountryCode: yup.string().required().max(5, 'Country code must be 5 characters or less'),
  eventLink: yup.string().url('Must be a valid URL').optional().nullable(),
  eventStart: yup.string().required('Start date is required'),
  eventEnd: yup.string().required('End date is required'),
  eventType: yup.string().optional(),
  eventRegion: yup.string().optional(),
  listingIntro: yup.string().optional(),
  offerResult: yup.string().optional(),
  offerCloseDisplay: yup.string().optional(),
  eventTopics: yup.array().of(yup.string().required()).optional(),
  offerTicketDetails: yup.string().optional(),
  offerValue: yup.string().optional(),
  offerBeta: yup.boolean().optional(),
  isLiveInProduction: yup.boolean().optional(),
  eventLogo: yup.string().optional().test('valid-url-or-path', 'Must be a valid URL or path', function(value) {
    if (!value || value.trim() === '') return true;
    // Allow local paths starting with /
    if (value.startsWith('/')) return true;
    // Allow full URLs
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  }),
  offerSlug: yup.string().optional(),
  offerCloseDate: yup.string().optional(),
  eventLocation: yup.string().optional(),
  // New fields
  venueAddress: yup.string().optional(),
  scrapedBy: yup.string().optional(),
  sourceType: yup.string().optional(),
  sourceDetails: yup.string().optional().test('valid-json', 'Must be valid JSON or empty', function(value) {
    if (!value || value.trim() === '') return true;
    try {
      JSON.parse(value);
      return true;
    } catch {
      return false;
    }
  }),
  screenshotUrl: yup.string().url('Must be a valid URL').optional(),
  accountId: yup.string().optional(),
});

type EventFormData = yup.InferType<typeof eventSchema>;

// Screenshot Preview Component
function ScreenshotPreview({ event, onViewScreenshot }: { event: Event; onViewScreenshot: (event: Event) => void }) {
  const hasScreenshot = event.screenshotGenerated;
  const screenshotUrl = event.screenshotUrl || `/preview/${event.eventId}.jpg`;

  return (
    <div className="flex items-center justify-center">
      <div
        className="w-24 h-16 overflow-hidden relative rounded-lg border border-[var(--gray-a5)] bg-[var(--gray-a3)] cursor-pointer"
        onClick={hasScreenshot ? () => onViewScreenshot(event) : undefined}
        title={hasScreenshot ? "View full screenshot" : undefined}
      >
        {hasScreenshot ? (
          <img
            src={screenshotUrl}
            alt={`Screenshot of ${event.eventTitle}`}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-[var(--gray-a8)] gap-1">
            <PhotoIcon className="w-5 h-5" />
            <span className="text-[10px]">No image</span>
          </div>
        )}
      </div>
    </div>
  );
}

// Event types are now fetched from platform_settings via useEventTypes() hook

const regions = [
  { value: 'na', label: 'North America' },
  { value: 'eu', label: 'Europe' },
  { value: 'as', label: 'Asia' },
  { value: 'sa', label: 'South America' },
  { value: 'af', label: 'Africa' },
  { value: 'oc', label: 'Oceania' },
  { value: 'on', label: 'Online' },
];

const sourceTypes = [
  { value: 'manual', label: 'Manual Entry' },
  { value: 'scraper', label: 'Scraped Data' },
  { value: 'user_submission', label: 'User Submission' },
];

export default function EventsManagement() {
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const { isAccountUser, accounts: userAccounts } = useAccountAccess();
  const { eventTypes } = useEventTypes();
  const hasTopicsModule = useHasModule('event-topics');
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: 10,
  });
  const [generatingScreenshots, setGeneratingScreenshots] = useState<Set<string>>(new Set());
  const [generatingAllScreenshots, setGeneratingAllScreenshots] = useState(false);
  const [refreshingEvents, setRefreshingEvents] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [hidePastEvents, setHidePastEvents] = useState(true);
  const [hideEventsWithScreenshots, setHideEventsWithScreenshots] = useState(false);
  const [filterScraperName, setFilterScraperName] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('scraperName');
  });
  const [selectedEventIds, setSelectedEventIds] = useState<Set<string>>(new Set());
  const [deletingBulkEvents, setDeletingBulkEvents] = useState(false);
  const [generatingBulkScreenshots, setGeneratingBulkScreenshots] = useState(false);
  const [refreshingBulkEvents, setRefreshingBulkEvents] = useState(false);
  const [selectedEventType, setSelectedEventType] = useState<string>('');
  const [selectedSourceType, setSelectedSourceType] = useState<string>('');
  const [selectedScrapedBy, setSelectedScrapedBy] = useState<string>('');
  const [eventLogoPath, setEventLogoPath] = useState<string | undefined>(undefined);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeTab, setActiveTab] = useState<'basic' | 'location' | 'dates' | 'discount' | 'competition' | 'topics' | 'source'>('basic');

  // Screenshot viewer modal state
  const [screenshotViewerOpen, setScreenshotViewerOpen] = useState(false);
  const [viewingEvent, setViewingEvent] = useState<Event | null>(null);

  // Terminal output modal state
  const [terminalModalOpen, setTerminalModalOpen] = useState(false);
  const [terminalTitle, setTerminalTitle] = useState('');
  const [terminalOutput, setTerminalOutput] = useState<string[]>([]);
  const [terminalRunning, setTerminalRunning] = useState(false);
  const [currentEventId, setCurrentEventId] = useState<string>('');
  const [currentEventTitle, setCurrentEventTitle] = useState<string>('');
  const [showScreenshotPreview, setShowScreenshotPreview] = useState(false);
  const [screenshotUrl, setScreenshotUrl] = useState<string>('');

  // Confirmation modal state
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    confirmText?: string;
    confirmColor?: 'red' | 'blue' | 'green';
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<EventFormData>({
    resolver: yupResolver(eventSchema) as any,
    defaultValues: {
      isLiveInProduction: true, // Default to true for new events
    },
  });

  const watchedTopics = watch('eventTopics', []);

  // Map form fields to their respective tabs for error navigation
  const fieldToTab: Record<string, typeof activeTab> = {
    eventTitle: 'basic',
    eventLink: 'basic',
    eventType: 'basic',
    isLiveInProduction: 'basic',
    accountId: 'basic',
    eventLogo: 'basic',
    listingIntro: 'basic',
    eventCity: 'location',
    eventCountryCode: 'location',
    eventRegion: 'location',
    eventLocation: 'location',
    venueAddress: 'location',
    eventStart: 'dates',
    eventEnd: 'dates',
    offerValue: 'discount',
    offerSlug: 'discount',
    offerCloseDate: 'discount',
    offerCloseDisplay: 'discount',
    offerTicketDetails: 'discount',
    offerResult: 'discount',
    offerBeta: 'discount',
    eventTopics: 'topics',
    scrapedBy: 'source',
    sourceType: 'source',
    sourceDetails: 'source',
    screenshotUrl: 'source',
  };

  // Get tabs that have validation errors
  const tabsWithErrors = useMemo(() => {
    const errorTabs = new Set<string>();
    for (const field of Object.keys(errors)) {
      const tab = fieldToTab[field];
      if (tab) errorTabs.add(tab);
    }
    return errorTabs;
  }, [errors]);

  // Handle validation errors by switching to the first tab with errors
  const onValidationError = (validationErrors: Record<string, unknown>) => {
    const errorFields = Object.keys(validationErrors);
    if (errorFields.length > 0) {
      const firstErrorTab = fieldToTab[errorFields[0]];
      if (firstErrorTab && firstErrorTab !== activeTab) {
        setActiveTab(firstErrorTab);
      }
      toast.error('Please fix the required fields highlighted in red');
    }
  };

  useEffect(() => {
    loadEvents();
    loadAccounts();
  }, []);

  // Reload events when account membership changes (for account users)
  useEffect(() => {
    if (isAccountUser && userAccounts.length > 0) {
      loadEvents();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAccountUser, userAccounts.length]);

  const loadAccounts = async () => {
    try {
      const { accounts: fetchedAccounts, error } = await AccountService.getActiveAccounts();
      if (!error && fetchedAccounts) {
        setAccounts(fetchedAccounts);
      }
    } catch (error) {
      console.error('Error loading accounts:', error);
    }
  };

  // Handle edit query parameter - redirect to detail page
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const editEventId = params.get('edit');

    if (editEventId) {
      // Navigate to the event detail page
      navigate(`/events/${editEventId}`);
    }
  }, [navigate]);

  // Helper function to check if event is in the past
  const isEventInPast = (eventEnd?: string) => {
    if (!eventEnd) return false;

    const now = new Date();
    const endDate = new Date(eventEnd);
    return endDate < now;
  };

  // No longer needed - we get screenshot status from database

  // Get unique scraped_by values for filter dropdown
  const scrapedByOptions = useMemo(() => {
    const uniqueScrapedBy = [...new Set(events.map(event => event.scrapedBy).filter(Boolean))];
    return uniqueScrapedBy.map(value => ({ value, label: value }));
  }, [events]);

  // Filtered events based on search and past events filter
  const filteredEvents = useMemo(() => {
    let filtered = events;

    // Filter by scraper name if present
    if (filterScraperName) {
      filtered = filtered.filter(event => event.scrapedBy === filterScraperName);
    }

    // Filter by search term
    if (searchTerm.trim()) {
      const searchLower = searchTerm.toLowerCase().trim();
      filtered = filtered.filter(event =>
        event.eventTitle.toLowerCase().includes(searchLower) ||
        event.eventId.toLowerCase().includes(searchLower) ||
        event.eventCity?.toLowerCase().includes(searchLower) ||
        event.eventCountryCode?.toLowerCase().includes(searchLower) ||
        event.eventLink?.toLowerCase().includes(searchLower) ||
        event.eventTopics?.some(topic => topic.toLowerCase().includes(searchLower))
      );
    }

    // Filter out past events if enabled
    if (hidePastEvents) {
      filtered = filtered.filter(event => !isEventInPast(event.eventEnd));
    }

    // Filter out events with screenshots if enabled
    if (hideEventsWithScreenshots) {
      filtered = filtered.filter(event => !event.screenshotGenerated);
    }

    // Filter by event type
    if (selectedEventType) {
      filtered = filtered.filter(event => event.eventType === selectedEventType);
    }

    // Filter by source type
    if (selectedSourceType) {
      filtered = filtered.filter(event => event.sourceType === selectedSourceType);
    }

    // Filter by scraped by
    if (selectedScrapedBy) {
      filtered = filtered.filter(event => event.scrapedBy === selectedScrapedBy);
    }

    return filtered;
  }, [events, searchTerm, hidePastEvents, hideEventsWithScreenshots, selectedEventType, selectedSourceType, selectedScrapedBy, filterScraperName]);

  const loadEvents = async () => {
    setLoading(true);
    try {
      const result = await EventService.getAllEvents();
      if (result.success && result.data) {
        let eventsData = result.data;

        // Filter events for account users - only show events for their accounts
        if (isAccountUser && userAccounts.length > 0) {
          const accountIds = userAccounts.map(acc => acc.id);
          eventsData = eventsData.filter(event =>
            event.accountId && accountIds.includes(event.accountId)
          );
          console.log(`Filtered to ${eventsData.length} events for account user's ${userAccounts.length} account(s)`);
        }

        setEvents(eventsData);
        return eventsData;
      }
    } catch (error) {
      console.error('Failed to load events:', error);
    } finally {
      setLoading(false);
    }
    return null;
  };

  const openCreateModal = () => {
    setEditingEvent(null);
    reset();
    setActiveTab('basic');
    setIsModalOpen(true);
  };

  const openEditModal = async (event: Event) => {
    // Fetch fresh data from database to avoid stale data issues
    console.log('🔄 Fetching fresh event data from DB for event:', event.id);

    if (!event.id) {
      console.error('❌ Event ID is missing');
      toast.error('Cannot edit event: ID is missing');
      return;
    }

    const result = await EventService.getEventById(event.id);

    if (!result.success || !result.data) {
      console.error('❌ Failed to load fresh event data:', result.error);
      // Fall back to using the passed event if fetch fails
      setEditingEvent(event);
      populateFormWithEvent(event);
      setActiveTab('basic');
      setIsModalOpen(true);
      return;
    }

    const freshEvent = result.data;
    console.log('✅ Loaded fresh event data, accountId:', freshEvent.accountId);
    setEditingEvent(freshEvent);
    populateFormWithEvent(freshEvent);
    setActiveTab('basic');
    setIsModalOpen(true);
  };

  // Helper function to populate form with event data
  const populateFormWithEvent = (event: Event) => {
    // Populate form with all event data
    setValue('eventTitle', event.eventTitle);
    setValue('listingIntro', event.listingIntro || '');
    setValue('offerResult', event.offerResult || '');
    setValue('offerCloseDisplay', event.offerCloseDisplay || '');
    setValue('eventTopics', event.eventTopics || []);
    setValue('offerTicketDetails', event.offerTicketDetails || '');
    setValue('offerValue', event.offerValue || '');
    setValue('eventCity', event.eventCity || '');
    setValue('eventCountryCode', event.eventCountryCode || '');
    setValue('eventLink', event.eventLink || '');
    setValue('eventLogo', event.eventLogo || '');
    setValue('offerSlug', event.offerSlug || '');
    setValue('offerBeta', event.offerBeta || false);
    setValue('isLiveInProduction', event.isLiveInProduction !== undefined ? event.isLiveInProduction : true);

    // Convert ISO timestamps to datetime-local format (YYYY-MM-DDTHH:mm)
    const formatForDatetimeLocal = (isoString: string) => {
      if (!isoString) return '';
      try {
        // Parse ISO string and convert to local datetime-local format
        const date = new Date(isoString);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}`;
      } catch (e) {
        return isoString; // Return original if parsing fails
      }
    };

    setValue('eventStart', formatForDatetimeLocal(event.eventStart || ''));
    setValue('eventEnd', formatForDatetimeLocal(event.eventEnd || ''));
    setValue('offerCloseDate', formatForDatetimeLocal(event.offerCloseDate || ''));
    setValue('eventRegion', event.eventRegion || '');
    setValue('eventLocation', event.eventLocation || '');
    setValue('eventType', event.eventType || '');
    setValue('venueAddress', event.venueAddress || '');
    setValue('scrapedBy', event.scrapedBy || '');
    setValue('sourceType', event.sourceType || '');
    setValue('sourceDetails', event.sourceDetails ? JSON.stringify(event.sourceDetails, null, 2) : '');
    setValue('screenshotUrl', event.screenshotUrl || '');
    setValue('accountId', event.accountId || '');
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingEvent(null);
    reset();
  };

  const onSubmit = async (data: EventFormData) => {
    setSubmitting(true);

    try {
      if (editingEvent) {
        // Update existing event (pass original event for screenshot comparison)
        const userInfo = user ? { id: user.id, email: user.email } : undefined;

        // Build update data - account users can only edit basic fields
        const updateData: any = {
          eventTitle: data.eventTitle,
          listingIntro: data.listingIntro,
          eventCity: data.eventCity,
          eventCountryCode: data.eventCountryCode,
          eventLink: data.eventLink,
          eventLogo: data.eventLogo,
          eventStart: data.eventStart,
          eventEnd: data.eventEnd,
          eventRegion: data.eventRegion,
          eventLocation: data.eventLocation,
          venueAddress: data.venueAddress,
          eventTopics: data.eventTopics?.filter(topic => topic !== undefined) as string[],
          isLiveInProduction: true,
          offerBeta: data.offerBeta,
        };

        // Only system admins can edit these fields
        if (!isAccountUser) {
          updateData.offerResult = data.offerResult;
          updateData.offerCloseDisplay = data.offerCloseDisplay;
          updateData.offerTicketDetails = data.offerTicketDetails;
          updateData.offerValue = data.offerValue;
          updateData.offerSlug = data.offerSlug;
          updateData.offerCloseDate = data.offerCloseDate;
          updateData.eventType = data.eventType;
          updateData.scrapedBy = data.scrapedBy;
          // Don't pass sourceType when editing via UI - let EventService determine it's a UI edit
          // updateData.sourceType = data.sourceType as 'manual' | 'scraper' | 'user_submission';
          updateData.sourceDetails = data.sourceDetails && data.sourceDetails.trim() !== '' ? JSON.parse(data.sourceDetails) : null;
          updateData.screenshotUrl = data.screenshotUrl;
          updateData.accountId = data.accountId || undefined;
        }

        const result = await EventService.updateEvent(editingEvent.id!, updateData, editingEvent, userInfo);

        if (result.success) {
          await loadEvents();
          closeModal();
        } else {
          console.error('Failed to update event:', result.error);
        }
      } else {
        // Create new event
        const eventId = await EventIdGenerator.generateUniqueEventId();
        const userInfo = user ? { id: user.id, email: user.email } : undefined;

        const result = await EventService.createEvent({
          eventId,
          eventTitle: data.eventTitle,
          listingIntro: data.listingIntro,
          offerResult: data.offerResult,
          offerCloseDisplay: data.offerCloseDisplay,
          eventTopics: data.eventTopics?.filter(topic => topic !== undefined) as string[],
          offerTicketDetails: data.offerTicketDetails,
          offerValue: data.offerValue,
          offerBeta: data.offerBeta,
          isLiveInProduction: true,
          eventCity: data.eventCity,
          eventCountryCode: data.eventCountryCode,
          eventLink: data.eventLink,
          eventLogo: data.eventLogo,
          offerSlug: data.offerSlug,
          offerCloseDate: data.offerCloseDate,
          eventStart: data.eventStart,
          eventEnd: data.eventEnd,
          eventRegion: data.eventRegion,
          eventLocation: data.eventLocation,
          eventType: data.eventType,
          venueAddress: data.venueAddress,
          scrapedBy: data.scrapedBy,
          sourceType: 'manual',
          sourceDetails: null,
          screenshotUrl: undefined,
          accountId: data.accountId || undefined,
        }, userInfo);

        if (result.success) {
          await loadEvents();
          closeModal();
        } else {
          console.error('Failed to create event:', result.error);
        }
      }
    } catch (error) {
      console.error('Error submitting form:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const deleteEvent = async (event: Event) => {
    if (!event.id) return;

    setConfirmModal({
      isOpen: true,
      title: 'Delete Event',
      message: `Are you sure you want to delete "${event.eventTitle}"? This action cannot be undone.`,
      confirmText: 'Delete',
      confirmColor: 'red',
      onConfirm: async () => {
        try {
          const result = await EventService.deleteEvent(event.id!);
          if (result.success) {
            await loadEvents();
          } else {
            console.error('Failed to delete event:', result.error);
          }
        } catch (error) {
          console.error('Error deleting event:', error);
        }
      },
    });
  };

  const duplicateEvent = async (event: Event) => {
    if (!event) return;

    try {
      // Generate a new unique event ID
      const newEventId = await EventIdGenerator.generateUniqueEventId();

      // Create a copy of the event with a new ID and modified title
      const duplicatedEvent = {
        ...event,
        eventId: newEventId,
        eventTitle: `${event.eventTitle} (Copy)`,
        // Remove the database ID so it creates a new entry
        id: undefined,
        createdAt: undefined,
        updatedAt: undefined,
        // Reset screenshot status for the duplicate
        screenshotGenerated: false,
        screenshotGeneratedAt: undefined,
        screenshotUrl: undefined,
      };

      const userInfo = user ? { id: user.id, email: user.email } : undefined;
      const result = await EventService.createEvent(duplicatedEvent, userInfo);
      if (result.success) {
        await loadEvents();
        console.log(`Event duplicated successfully with ID: ${newEventId}`);
      } else {
        console.error('Failed to duplicate event:', result.error);
      }
    } catch (error) {
      console.error('Error duplicating event:', error);
    }
  };

  const generateScreenshot = async (event: Event) => {
    if (!event.eventId || !event.eventLink) {
      console.warn('Cannot generate screenshot: Event missing ID or link');
      return;
    }

    // Skip if event was scraped by Luma iCal Scraper (uses images from Luma pages)
    if (event.scrapedBy === 'Luma iCal Scraper') {
      toast.warning('Luma events use images from their pages, not screenshots');
      return;
    }

    // Setup modal state
    setCurrentEventId(event.eventId);
    setCurrentEventTitle(event.eventTitle);
    setTerminalTitle(`Generating Screenshot (with fallback) - ${event.eventTitle}`);
    setTerminalOutput([]);
    setShowScreenshotPreview(true);
    setScreenshotUrl(event.screenshotUrl || `/preview/${event.eventId}.jpg`);
    setTerminalModalOpen(true);
    setTerminalRunning(true);
    setGeneratingScreenshots(prev => new Set(prev).add(event.eventId));

    try {
      await ScreenshotService.generateScreenshotWithStream(event.eventId, {
        onProgress: (line: string) => {
          setTerminalOutput(prev => [...prev, line]);
        },
        onComplete: async (result) => {
          setTerminalRunning(false);
          if (result.success) {
            setTerminalOutput(prev => [...prev, '', '✅ Screenshot generation completed successfully!']);
            // Reload events to get updated screenshot status and URL from database
            const updatedEvents = await loadEvents();
            // Update the modal's screenshot URL from the refreshed event data
            if (updatedEvents) {
              const updatedEvent = updatedEvents.find(e => e.eventId === event.eventId);
              if (updatedEvent?.screenshotUrl) {
                setScreenshotUrl(updatedEvent.screenshotUrl);
              }
            }
          } else {
            setTerminalOutput(prev => [...prev, '', `❌ Screenshot generation failed: ${result.error}`]);
          }
        },
        onError: (error: string) => {
          setTerminalRunning(false);
          setTerminalOutput(prev => [...prev, '', `❌ Error: ${error}`]);
        }
      });
    } catch (error: any) {
      setTerminalRunning(false);
      setTerminalOutput(prev => [...prev, '', `❌ Unexpected error: ${error.message}`]);
    } finally {
      setGeneratingScreenshots(prev => {
        const newSet = new Set(prev);
        newSet.delete(event.eventId);
        return newSet;
      });
    }
  };

  
  const regenerateScreenshot = async () => {
    if (!currentEventId) {
      console.warn('No current event ID available for BrowserLess.io generation');
      return;
    }

    // Find the current event
    const event = events.find(e => e.eventId === currentEventId);
    if (!event || !event.eventLink) {
      console.warn('Cannot generate BrowserLess.io screenshot: Event missing link');
      return;
    }

    setTerminalRunning(true);
    setTerminalOutput(prev => [...prev, '', '🌐 Forcing BrowserLess.io screenshot generation...']);
    setTerminalOutput(prev => [...prev, `📋 Event: ${event.eventTitle}`]);
    setTerminalOutput(prev => [...prev, `🔗 URL: ${event.eventLink}`]);

    // Call the backend API which will handle BrowserLess.io properly
    try {
      await ScreenshotService.generateScreenshotWithBrowserlessStream(event.eventId, {
        onProgress: (line: string) => {
          setTerminalOutput(prev => [...prev, line]);
        },
        onComplete: async (result) => {
          setTerminalRunning(false);
          if (result.success) {
            setTerminalOutput(prev => [...prev, '', '✅ BrowserLess.io screenshot generated successfully!']);
            // Reload events to get updated screenshot URL from database
            await loadEvents();
          } else {
            setTerminalOutput(prev => [...prev, '', `❌ BrowserLess.io screenshot generation failed: ${result.error}`]);
          }
        },
        onError: (error: string) => {
          setTerminalOutput(prev => [...prev, '', `❌ BrowserLess.io error: ${error}`]);
          setTerminalRunning(false);
        }
      });
    } catch (error: any) {
      setTerminalOutput(prev => [...prev, `❌ BrowserLess.io error: ${error.message}`]);
      setTerminalRunning(false);
    }
  };

  const generateAllScreenshots = async () => {
    if (events.length === 0) {
      console.warn('No events found');
      return;
    }

    // Open terminal modal
    setTerminalTitle(`Generating All Screenshots (${events.length} events)`);
    setTerminalOutput([]);
    setShowScreenshotPreview(false);
    setScreenshotUrl('');
    setTerminalModalOpen(true);
    setTerminalRunning(true);
    setGeneratingAllScreenshots(true);

    try {
      await ScreenshotService.generateAllScreenshotsWithStream({
        onProgress: (line: string) => {
          setTerminalOutput(prev => [...prev, line]);
        },
        onComplete: async (result) => {
          setTerminalRunning(false);
          if (result.success) {
            setTerminalOutput(prev => [...prev, '', '✅ All screenshots generated successfully!']);
            // Reload events to get updated screenshot status from database
            await loadEvents();
          } else {
            setTerminalOutput(prev => [...prev, '', `❌ Bulk screenshot generation failed: ${result.error}`]);
          }
        },
        onError: (error: string) => {
          setTerminalRunning(false);
          setTerminalOutput(prev => [...prev, '', `❌ Error: ${error}`]);
        }
      });
    } catch (error: any) {
      setTerminalRunning(false);
      setTerminalOutput(prev => [...prev, '', `❌ Unexpected error: ${error.message}`]);
    } finally {
      setGeneratingAllScreenshots(false);
    }
  };

  const generateSelectedScreenshots = async () => {
    if (selectedEventIds.size === 0) {
      console.warn('Please select events to generate screenshots for');
      return;
    }

    // Filter out Luma events
    const selectedEvents = filteredEvents.filter(event => selectedEventIds.has(event.eventId));
    const nonLumaEvents = selectedEvents.filter(event => event.scrapedBy !== 'Luma iCal Scraper');

    if (nonLumaEvents.length === 0) {
      toast.warning('All selected events are from Luma, which use images from their pages instead of screenshots');
      return;
    }

    if (nonLumaEvents.length < selectedEvents.length) {
      const skipped = selectedEvents.length - nonLumaEvents.length;
      toast.info(`Skipping ${skipped} Luma event(s). Generating screenshots for ${nonLumaEvents.length} events.`);
    }

    // Open terminal modal
    setTerminalTitle(`Generating Selected Screenshots (${nonLumaEvents.length} events)`);
    setTerminalOutput([]);
    setShowScreenshotPreview(false);
    setScreenshotUrl('');
    setTerminalModalOpen(true);
    setTerminalRunning(true);
    setGeneratingBulkScreenshots(true);

    try {
      const eventIdsArray = nonLumaEvents.map(e => e.eventId);
      await ScreenshotService.generateMultipleScreenshotsWithStream(eventIdsArray, {
        onProgress: (line: string) => {
          setTerminalOutput(prev => [...prev, line]);
        },
        onComplete: async (result) => {
          setTerminalRunning(false);
          if (result.success) {
            setTerminalOutput(prev => [...prev, '', `✅ Screenshots generated for ${eventIdsArray.length} events!`]);
            // Reload events to get updated screenshot status from database
            await loadEvents();
            // Clear selections after successful generation
            setSelectedEventIds(new Set());
          } else {
            setTerminalOutput(prev => [...prev, '', `❌ Bulk screenshot generation failed: ${result.error}`]);
          }
        },
        onError: (error: string) => {
          setTerminalRunning(false);
          setTerminalOutput(prev => [...prev, '', `❌ Error: ${error}`]);
        }
      });
    } catch (error: any) {
      setTerminalRunning(false);
      setTerminalOutput(prev => [...prev, '', `❌ Unexpected error: ${error.message}`]);
    } finally {
      setGeneratingBulkScreenshots(false);
    }
  };

  // Bulk delete selected events
  const deleteSelectedEvents = () => {
    if (selectedEventIds.size === 0) {
      console.warn('Please select events to delete');
      return;
    }

    // Get event titles for confirmation
    const selectedEvents = filteredEvents.filter(event => selectedEventIds.has(event.eventId));
    const eventTitles = selectedEvents.slice(0, 3).map(e => e.eventTitle).join(', ');
    const displayText = selectedEvents.length > 3
      ? `${eventTitles} and ${selectedEvents.length - 3} more`
      : eventTitles;

    setConfirmModal({
      isOpen: true,
      title: 'Delete Selected Events',
      message: `Are you sure you want to delete ${selectedEventIds.size} events?\n\n${displayText}\n\nThis action cannot be undone.`,
      confirmText: 'Delete Events',
      confirmColor: 'red',
      onConfirm: confirmDeleteSelectedEvents
    });
  };

  const confirmDeleteSelectedEvents = async () => {
    setDeletingBulkEvents(true);

    try {
      // Convert eventIds to UUID ids for deletion
      const selectedEvents = filteredEvents.filter(event => selectedEventIds.has(event.eventId));
      const eventUUIDs = selectedEvents.map(event => event.id).filter(Boolean) as string[];
      const result = await EventService.bulkDeleteEvents(eventUUIDs);

      if (result.success && result.data) {
        const { deleted, failed } = result.data;

        if (deleted > 0) {
          console.log(`✅ Successfully deleted ${deleted} events`);
          // Reload events to reflect deletions
          await loadEvents();
          // Clear selections after successful deletion
          setSelectedEventIds(new Set());
        }

        if (failed > 0) {
          console.warn(`❌ Failed to delete ${failed} events`);
        }

        // Show result message
        if (failed > 0) {
          toast.warning(`Deleted ${deleted} events. ${failed} failed to delete.`);
        } else {
          toast.success(`Successfully deleted ${deleted} events.`);
        }
      } else {
        console.error('Bulk delete failed:', result.error);
        toast.error(`Failed to delete events: ${result.error}`);
      }
    } catch (error) {
      console.error('Error during bulk delete:', error);
      toast.error('An unexpected error occurred while deleting events.');
    } finally {
      setDeletingBulkEvents(false);
    }
  };

  const refreshSelectedEvents = async () => {
    if (selectedEventIds.size === 0) {
      console.warn('Please select events to refresh');
      return;
    }

    // Get selected events with scraper info
    const selectedEvents = filteredEvents.filter(event => selectedEventIds.has(event.eventId));
    const eventsWithScrapers = selectedEvents.filter(event => event.scrapedBy && event.eventLink);

    if (eventsWithScrapers.length === 0) {
      toast.error('None of the selected events have scraper information available for refresh.');
      return;
    }

    if (eventsWithScrapers.length < selectedEvents.length) {
      const skipped = selectedEvents.length - eventsWithScrapers.length;
      if (!confirm(`${skipped} of ${selectedEvents.length} selected events will be skipped (no scraper info). Continue with ${eventsWithScrapers.length} events?`)) {
        toast.info('Refresh cancelled');
        return;
      }
    }

    setRefreshingBulkEvents(true);

    try {
      // Prepare batch of events to refresh
      const eventsToRefresh = eventsWithScrapers.map(event => ({
        eventId: event.eventId,
        scraperName: event.scrapedBy!,
        eventLink: event.eventLink!
      }));

      const apiBaseUrl = getApiBaseUrl();
      const response = await fetch(`${apiBaseUrl}/scrapers/refresh-events-bulk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ events: eventsToRefresh })
      });

      const result = await response.json();

      if (response.ok && result.success) {
        if (result.failed > 0) {
          toast.warning(`Refreshed ${result.succeeded} of ${eventsToRefresh.length} events. ${result.failed} failed.`);
        } else {
          toast.success(`Successfully refreshed ${result.succeeded} events!`);
        }

        // Update only the refreshed events in local state instead of reloading all events
        // Fetch updated data for the successfully refreshed events
        const successfulEventIds = eventsToRefresh
          .slice(0, result.succeeded)
          .map(e => selectedEvents.find(se => se.eventId === e.eventId)?.id)
          .filter(Boolean) as string[];

        if (successfulEventIds.length > 0) {
          // Fetch updated events
          const updatePromises = successfulEventIds.map(id => EventService.getEventById(id));
          const updateResults = await Promise.all(updatePromises);

          // Update local state with refreshed events
          setEvents(prevEvents => {
            const updatedEventsMap = new Map(
              updateResults
                .filter(r => r.success && r.data)
                .map(r => [r.data!.id, r.data!])
            );

            return prevEvents.map(e =>
              updatedEventsMap.has(e.id) ? updatedEventsMap.get(e.id)! : e
            );
          });
        }

        // Clear selections after successful refresh
        setSelectedEventIds(new Set());
      } else {
        toast.error(`Failed to refresh events: ${result.error || 'Unknown error'}`);
      }
    } catch (error: any) {
      console.error('Error refreshing events:', error);
      toast.error(`Error refreshing events: ${error.message}`);
    } finally {
      setRefreshingBulkEvents(false);
    }
  };

  // Select/deselect all visible events
  const toggleSelectAll = () => {
    if (selectedEventIds.size === filteredEvents.length) {
      // Deselect all
      setSelectedEventIds(new Set());
    } else {
      // Select all visible events that have links
      const eventsWithLinks = filteredEvents.filter(event => event.eventLink);
      setSelectedEventIds(new Set(eventsWithLinks.map(event => event.eventId)));
    }
  };

  // Toggle individual event selection
  const toggleEventSelection = (eventId: string) => {
    setSelectedEventIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(eventId)) {
        newSet.delete(eventId);
      } else {
        newSet.add(eventId);
      }
      return newSet;
    });
  };

  const viewScreenshot = (event: Event) => {
    setViewingEvent(event);
    setScreenshotViewerOpen(true);
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleDateString();
  };


  const refreshEvent = async (event: Event) => {
    if (!event.scrapedBy) {
      toast.error('Cannot refresh this event: No scraper information available');
      return;
    }

    if (!event.eventLink) {
      toast.error('Cannot refresh this event: No event link available');
      return;
    }

    setRefreshingEvents(prev => new Set(prev).add(event.eventId));

    try {
      // Call API to re-scrape this specific event
      const apiBaseUrl = getApiBaseUrl();
      const response = await fetch(`${apiBaseUrl}/scrapers/refresh-event`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          eventId: event.eventId,
          scraperName: event.scrapedBy,
          eventLink: event.eventLink
        })
      });

      const result = await response.json();

      if (response.ok && result.success) {
        toast.success(`Event "${event.eventTitle}" refreshed successfully!`);

        // Update only the changed event in local state instead of reloading all events
        if (!event.id) return;
        const updatedEventResult = await EventService.getEventById(event.id);
        if (updatedEventResult.success && updatedEventResult.data) {
          setEvents(prevEvents =>
            prevEvents.map(e => e.id === event.id ? updatedEventResult.data! : e)
          );
        }
      } else {
        toast.error(`Failed to refresh event: ${result.error || 'Unknown error'}`);
      }
    } catch (error: any) {
      console.error('Error refreshing event:', error);
      toast.error(`Error refreshing event: ${error.message}`);
    } finally {
      setRefreshingEvents(prev => {
        const newSet = new Set(prev);
        newSet.delete(event.eventId);
        return newSet;
      });
    }
  };

  const columnHelper = createColumnHelper<Event>();

  const columns = useMemo(() => [
    columnHelper.display({
      id: 'select',
      size: 44,
      minSize: 44,
      maxSize: 44,
      header: ({ table }) => (
        <input
          type="checkbox"
          checked={selectedEventIds.size > 0 && selectedEventIds.size === filteredEvents.filter(e => e.eventLink).length}
          ref={(el) => {
            if (el) el.indeterminate = selectedEventIds.size > 0 && selectedEventIds.size < filteredEvents.filter(e => e.eventLink).length;
          }}
          onChange={toggleSelectAll}
          className="rounded border-[var(--gray-a6)] text-[var(--accent-9)] focus:ring-[var(--accent-8)]"
        />
      ),
      cell: (info) => {
        const event = info.row.original;
        if (!event.eventLink) {
          return <div className="w-4 h-4" />; // Empty space for events without links
        }
        return (
          <input
            type="checkbox"
            checked={selectedEventIds.has(event.eventId)}
            onChange={() => toggleEventSelection(event.eventId)}
            className="rounded border-[var(--gray-a6)] text-[var(--accent-9)] focus:ring-[var(--accent-8)]"
          />
        );
      },
    }),
    columnHelper.display({
      id: 'screenshot',
      header: 'Preview',
      size: 120,
      minSize: 120,
      maxSize: 120,
      cell: (info) => <ScreenshotPreview event={info.row.original} onViewScreenshot={viewScreenshot} />,
    }),
    columnHelper.accessor('eventTitle', {
      header: 'Event',
      size: 350,
      cell: (info) => {
        const event = info.row.original;
        return (
          <div className="flex items-center gap-3 max-w-[350px]">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-[var(--gray-12)] truncate">
                {event.eventTitle}
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs font-mono text-[var(--gray-11)] bg-[var(--gray-a3)] px-2 py-0.5 rounded-md">
                  {event.eventId}
                </span>
              </div>
              {event.eventLink && (
                <a
                  href={event.eventLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 mt-1.5 text-xs text-[var(--gray-a8)] hover:text-[var(--accent-11)]"
                >
                  <GlobeAltIcon className="size-3" />
                  <span className="truncate max-w-[180px]">{new URL(event.eventLink).hostname}</span>
                </a>
              )}
            </div>
          </div>
        );
      },
    }),
    columnHelper.accessor((row) => `${row.eventCity}${row.eventCountryCode ? `, ${row.eventCountryCode}` : ''}`, {
      id: 'location',
      header: 'Location',
      cell: (info) => {
        const event = info.row.original;
        const regionLabels: Record<string, string> = {
          'na': 'North America',
          'eu': 'Europe',
          'as': 'Asia',
          'sa': 'South America',
          'af': 'Africa',
          'oc': 'Oceania',
          'on': 'Online',
        };
        return (
          <div className="flex items-start gap-2">
            <MapPinIcon className="w-4 h-4 text-[var(--gray-a8)] mt-0.5 flex-shrink-0" />
            <div>
              <div className="text-sm font-medium text-[var(--gray-12)]">
                {event.eventCity}
                {event.eventCountryCode && (
                  <span className="ml-1 text-[var(--gray-11)] font-normal">
                    {event.eventCountryCode}
                  </span>
                )}
              </div>
              {event.eventRegion && (
                <div className="text-xs text-[var(--gray-a8)] mt-0.5">
                  {regionLabels[event.eventRegion] || event.eventRegion}
                </div>
              )}
            </div>
          </div>
        );
      },
    }),
    columnHelper.accessor('eventStart', {
      header: 'Date',
      cell: (info) => {
        const event = info.row.original;
        const isPast = isEventInPast(event.eventEnd);
        const startDate = event.eventStart ? new Date(event.eventStart) : null;
        const endDate = event.eventEnd ? new Date(event.eventEnd) : null;

        const fmt = (date: Date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const isSameDay = startDate && endDate && startDate.getTime() === endDate.getTime();

        return (
          <div className="flex flex-col gap-0.5 whitespace-nowrap">
            <span className={`text-sm ${isPast ? 'text-[var(--gray-a8)]' : 'text-[var(--gray-12)]'}`}>
              {startDate ? fmt(startDate) : 'N/A'}
            </span>
            {endDate && !isSameDay && (
              <span className={`text-xs ${isPast ? 'text-[var(--gray-a8)]' : 'text-[var(--gray-a11)]'}`}>
                to {fmt(endDate)}
              </span>
            )}
            {isPast && (
              <Badge color="gray" variant="soft">Past</Badge>
            )}
          </div>
        );
      },
    }),
    columnHelper.accessor('eventType', {
      header: 'Type',
      cell: (info) => {
        const event = info.row.original;
        if (!event.eventType) {
          return <span className="text-xs text-[var(--gray-a8)]">—</span>;
        }
        return (
          <Badge color="gray" variant="soft" className="capitalize">
            {event.eventType}
          </Badge>
        );
      },
    }),
    columnHelper.accessor('sourceType', {
      header: 'Source',
      cell: (info) => {
        const event = info.row.original;
        const sourceColors: Record<string, 'blue' | 'green' | 'purple' | 'gray'> = {
          'manual': 'blue',
          'scraper': 'green',
          'user_submission': 'purple',
        };
        const labels: Record<string, string> = {
          'manual': 'Manual',
          'scraper': 'Scraped',
          'user_submission': 'User',
        };
        return (
          <Badge color={sourceColors[event.sourceType || ''] || 'gray'} variant="soft">
            {labels[event.sourceType || ''] || 'Unknown'}
          </Badge>
        );
      },
    }),
    columnHelper.accessor('sourceEventId', {
      header: 'Source Event ID',
      cell: (info) => {
        const event = info.row.original;
        if (!event.sourceEventId) {
          return <span className="text-xs text-[var(--gray-a8)]">—</span>;
        }
        return (
          <span className="text-xs font-mono text-[var(--gray-11)] bg-[var(--gray-a3)] px-2 py-0.5 rounded-md max-w-[120px] truncate inline-block" title={event.sourceEventId}>
            {event.sourceEventId}
          </span>
        );
      },
    }),
    columnHelper.accessor('registrationCount', {
      header: 'Registrations',
      cell: (info) => {
        const count = info.getValue() || 0;
        return (
          <Badge color={count > 0 ? 'green' : 'gray'} variant="soft">
            {count}
          </Badge>
        );
      },
    }),
    columnHelper.display({
      id: 'actions',
      header: '',
      cell: (info) => {
        const event = info.row.original;
        const isGenerating = generatingScreenshots.has(event.eventId);
        const isRefreshing = refreshingEvents.has(event.eventId);
        return (
          <RowActions
            actions={[
              { label: 'View/Edit', icon: <EyeIcon className="size-4" />, onClick: () => navigate(`/events/${event.eventId}`) },
              { label: 'Re-scrape', icon: <ArrowPathIcon className="size-4" />, onClick: () => refreshEvent(event), disabled: isRefreshing || !event.eventLink, hidden: !event.scrapedBy },
              { label: 'Screenshot', icon: <CameraIcon className="size-4" />, onClick: () => generateScreenshot(event), disabled: isGenerating || !event.eventLink },
              { label: 'Duplicate', icon: <DocumentDuplicateIcon className="size-4" />, onClick: () => duplicateEvent(event) },
              { label: 'Delete', icon: <TrashIcon className="size-4" />, onClick: () => deleteEvent(event), color: 'red' },
            ]}
          />
        );
      },
    }),
  ], [generatingScreenshots, refreshingEvents, selectedEventIds, filteredEvents, toggleSelectAll, toggleEventSelection, duplicateEvent]);

  const table = useReactTable({
    data: filteredEvents,
    columns,
    state: {
      sorting,
      pagination,
    },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    manualPagination: false,
    autoResetPageIndex: false, // This prevents resetting to page 1 on data changes
  });

  if (loading) {
    return (
      <Page title="Events Management">
        <div className="p-6 flex flex-col items-center justify-center h-80 gap-4">
          <div className="size-8 border-2 border-[var(--accent-9)] border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-[var(--gray-11)]">Loading events...</p>
        </div>
      </Page>
    );
  }

  return (
    <Page title="Events Management">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex justify-between items-start">
            <div>
              <h1 className="text-2xl font-semibold text-[var(--gray-12)]">
                Events
              </h1>
              <p className="text-sm text-[var(--gray-11)] mt-0.5">
                <span className="text-[var(--accent-11)] font-semibold">{events.length}</span> events
                {filteredEvents.length !== events.length && (
                  <span className="text-[var(--gray-a8)]"> · <span className="text-[var(--accent-11)]">{filteredEvents.length}</span> matching filters</span>
                )}
              </p>
            </div>

            <div className="flex gap-3 items-center">
              {selectedEventIds.size > 0 && (
                <div className="flex items-center gap-3 px-4 py-2 bg-[var(--gray-a3)] rounded-xl border border-[var(--gray-a5)]">
                  <span className="text-sm text-[var(--gray-11)]">
                    <span className="text-[var(--accent-11)] font-bold">{selectedEventIds.size}</span> selected
                  </span>
                  <div className="w-px h-5 bg-[var(--gray-a5)]" />
                  <div className="flex gap-1">
                    <Button
                      isIcon
                      variant="ghost"
                      onClick={refreshSelectedEvents}
                      disabled={refreshingBulkEvents}
                      title="Refresh selected"
                    >
                      {refreshingBulkEvents ? (
                        <div className="size-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <ArrowPathIcon className="size-4" />
                      )}
                    </Button>
                    <Button
                      isIcon
                      variant="ghost"
                      onClick={generateSelectedScreenshots}
                      disabled={generatingBulkScreenshots}
                      title="Generate previews"
                    >
                      {generatingBulkScreenshots ? (
                        <div className="size-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <CameraIcon className="size-4" />
                      )}
                    </Button>
                    <Button
                      isIcon
                      variant="ghost"
                      color="red"
                      onClick={deleteSelectedEvents}
                      disabled={deletingBulkEvents}
                      title="Delete selected"
                    >
                      {deletingBulkEvents ? (
                        <div className="size-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <TrashIcon className="size-4" />
                      )}
                    </Button>
                  </div>
                </div>
              )}
              <Button onClick={openCreateModal} variant="solid">
                <PlusIcon className="size-4" />
                Add Event
              </Button>
            </div>
          </div>

        {/* Search & Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Search */}
          <div className="relative flex-1 min-w-[240px]">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <MagnifyingGlassIcon className="size-4 text-[var(--gray-a8)]" />
            </div>
            <input
              type="text"
              placeholder="Search events..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-sm bg-[var(--gray-a3)] border border-[var(--gray-a5)] rounded-lg text-[var(--gray-12)] placeholder-[var(--gray-a8)] focus:ring-2 focus:ring-[var(--accent-8)] focus:border-transparent"
            />
          </div>

          {/* Dropdown Filters */}
          <select
            value={selectedEventType}
            onChange={(e) => setSelectedEventType(e.target.value)}
            className={`px-2.5 py-1.5 text-sm rounded-lg border bg-[var(--gray-a3)] focus:ring-2 focus:ring-[var(--accent-8)] cursor-pointer ${selectedEventType ? 'border-[var(--accent-8)] text-[var(--accent-11)]' : 'border-[var(--gray-a5)] text-[var(--gray-11)]'}`}
          >
            <option value="">Event Type</option>
            {eventTypes.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>

          <select
            value={selectedSourceType}
            onChange={(e) => setSelectedSourceType(e.target.value)}
            className={`px-2.5 py-1.5 text-sm rounded-lg border bg-[var(--gray-a3)] focus:ring-2 focus:ring-[var(--accent-8)] cursor-pointer ${selectedSourceType ? 'border-[var(--accent-8)] text-[var(--accent-11)]' : 'border-[var(--gray-a5)] text-[var(--gray-11)]'}`}
          >
            <option value="">Source</option>
            {sourceTypes.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>

          <select
            value={selectedScrapedBy}
            onChange={(e) => setSelectedScrapedBy(e.target.value)}
            className={`px-2.5 py-1.5 text-sm rounded-lg border bg-[var(--gray-a3)] focus:ring-2 focus:ring-[var(--accent-8)] cursor-pointer ${selectedScrapedBy ? 'border-[var(--accent-8)] text-[var(--accent-11)]' : 'border-[var(--gray-a5)] text-[var(--gray-11)]'}`}
          >
            <option value="">Scraper</option>
            {scrapedByOptions.map((scraper) => (
              <option key={scraper.value} value={scraper.value}>
                {scraper.label}
              </option>
            ))}
          </select>

          {/* Toggle Filters */}
          <div className="flex items-center gap-1.5">
            <Button
              size="1"
              variant={hidePastEvents ? 'soft' : 'ghost'}
              color={hidePastEvents ? 'orange' : 'gray'}
              onClick={() => setHidePastEvents(!hidePastEvents)}
            >
              <ClockIcon className="size-3.5" />
              Hide past
            </Button>
            <Button
              size="1"
              variant={hideEventsWithScreenshots ? 'soft' : 'ghost'}
              color={hideEventsWithScreenshots ? undefined : 'gray'}
              onClick={() => setHideEventsWithScreenshots(!hideEventsWithScreenshots)}
            >
              <PhotoIcon className="size-3.5" />
              No screenshots
            </Button>
          </div>

          {/* Reset */}
          {(searchTerm || hidePastEvents || hideEventsWithScreenshots || selectedEventType || selectedSourceType || selectedScrapedBy || filterScraperName) && (
            <Button
              size="1"
              variant="ghost"
              color="gray"
              onClick={() => {
                setSearchTerm('');
                setHidePastEvents(false);
                setHideEventsWithScreenshots(false);
                setSelectedEventType('');
                setSelectedSourceType('');
                setSelectedScrapedBy('');
                setFilterScraperName(null);
                window.history.replaceState({}, '', window.location.pathname);
              }}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Reset
            </Button>
          )}
        </div>

        {filterScraperName && (
          <div className="flex items-center gap-3 px-4 py-3 bg-[var(--accent-a3)] border border-[var(--accent-a5)] rounded-xl">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-[var(--accent-11)]">
                Filtered by scraper:
              </span>
              <Badge color="primary" variant="soft">
                {filterScraperName}
              </Badge>
            </div>
            <Button
              variant="ghost"
              onClick={() => {
                setFilterScraperName(null);
                window.history.replaceState({}, '', window.location.pathname);
              }}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Clear filter
            </Button>
          </div>
        )}

        <Card className="overflow-hidden">
          <DataTable table={table} onRowDoubleClick={(event) => navigate(`/events/${event.eventId}`)} />

          {filteredEvents.length === 0 && (
            <div className="text-center py-16 px-6">
              <CalendarIcon className="w-8 h-8 text-[var(--gray-a8)] mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-[var(--gray-12)] mb-2">
                {events.length === 0 ? "No events yet" : "No matching events"}
              </h3>
              <p className="text-[var(--gray-11)] max-w-md mx-auto mb-6">
                {events.length === 0
                  ? "Get started by creating your first event. It only takes a moment."
                  : "Try adjusting your search terms or filters to find what you're looking for."
                }
              </p>
              {events.length === 0 && (
                <Button onClick={openCreateModal} variant="solid">
                  <PlusIcon className="size-4" />
                  Create your first event
                </Button>
              )}
            </div>
          )}

          {filteredEvents.length > 0 && (
            <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--gray-a5)]">
              <div className="flex items-center gap-4">
                <span className="text-sm text-[var(--gray-11)]">
                  <span className="font-semibold text-[var(--gray-12)]">
                    {table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1}
                  </span>
                  <span className="mx-1">-</span>
                  <span className="font-semibold text-[var(--gray-12)]">
                    {Math.min(
                      (table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize,
                      table.getFilteredRowModel().rows.length
                    )}
                  </span>
                  <span className="mx-1">of</span>
                  <span className="font-semibold text-[var(--gray-12)]">
                    {table.getFilteredRowModel().rows.length}
                  </span>
                </span>
                <select
                  value={table.getState().pagination.pageSize.toString()}
                  onChange={(e) => table.setPageSize(Number(e.target.value))}
                  className="px-3 py-1.5 text-sm bg-[var(--gray-a2)] border border-[var(--gray-a5)] rounded-lg focus:ring-2 focus:ring-[var(--accent-8)] cursor-pointer"
                >
                  <option value="5">5 / page</option>
                  <option value="10">10 / page</option>
                  <option value="20">20 / page</option>
                  <option value="50">50 / page</option>
                </select>
              </div>

              <Pagination
                total={table.getPageCount()}
                value={table.getState().pagination.pageIndex + 1}
                onChange={(page) => table.setPageIndex(page - 1)}
                className="flex items-center gap-1"
              >
                <PaginationFirst
                  onClick={() => table.setPageIndex(0)}
                  disabled={!table.getCanPreviousPage()}
                />
                <PaginationPrevious
                  onClick={() => table.previousPage()}
                  disabled={!table.getCanPreviousPage()}
                />
                <PaginationItems />
                <PaginationNext
                  onClick={() => table.nextPage()}
                  disabled={!table.getCanNextPage()}
                />
                <PaginationLast
                  onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                  disabled={!table.getCanNextPage()}
                />
              </Pagination>
            </div>
          )}
        </Card>

        {/* Event Modal */}
        <Modal
          isOpen={isModalOpen}
          onClose={closeModal}
          title={editingEvent ? 'Edit Event' : 'Create New Event'}
          size="xl"
        >
          <form onSubmit={handleSubmit(onSubmit as any, onValidationError)} className="flex flex-col h-[calc(90vh-140px)]">
            {/* Tab Navigation */}
            <Tabs
              value={activeTab}
              onChange={(tab) => setActiveTab(tab as 'basic' | 'location' | 'dates' | 'discount' | 'competition' | 'topics' | 'source')}
              tabs={[
                { id: 'basic', label: 'Basic Info', icon: tabsWithErrors.has('basic') ? <span className="size-2 rounded-full bg-red-500" /> : undefined },
                { id: 'location', label: 'Location', icon: tabsWithErrors.has('location') ? <span className="size-2 rounded-full bg-red-500" /> : undefined },
                { id: 'dates', label: 'Dates & Time', icon: tabsWithErrors.has('dates') ? <span className="size-2 rounded-full bg-red-500" /> : undefined },
                hasTopicsModule && { id: 'topics', label: 'Topics', icon: tabsWithErrors.has('topics') ? <span className="size-2 rounded-full bg-red-500" /> : undefined },
                !isAccountUser && editingEvent && { id: 'source', label: 'Source', icon: tabsWithErrors.has('source') ? <span className="size-2 rounded-full bg-red-500" /> : undefined },
              ].filter(Boolean) as Tab[]}
              className="-mx-6 px-6 mb-6 flex-shrink-0"
            />

            {/* Tab Content - Scrollable */}
            <div className="flex-1 overflow-y-auto pr-2">
              {/* Basic Information Tab */}
              {activeTab === 'basic' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                      <Input
                        label="Event Title *"
                        {...register('eventTitle')}
                        error={errors.eventTitle?.message}
                      />
                    </div>

                    {accounts.length > 0 && (
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
                        Account / Organization
                      </label>
                      <select
                        {...register('accountId')}
                        className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      >
                        <option value="">No Account (Public Event)</option>
                        {accounts.map(account => (
                          <option key={account.id} value={account.id}>
                            {account.name}
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-xs text-neutral-500">
                        Assign this event to an organization. Account owners will be able to view and manage their events.
                      </p>
                      {errors.accountId && (
                        <p className="mt-1 text-sm text-error-600">{errors.accountId.message}</p>
                      )}
                    </div>
                    )}

                    <Input
                      label="Event Link"
                      type="url"
                      {...register('eventLink')}
                      error={errors.eventLink?.message}
                    />

                    <div>
                      <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
                        Event Type
                      </label>
                      <select
                        {...register('eventType')}
                        className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      >
                        <option value="">Select Event Type</option>
                        {eventTypes.map(type => (
                          <option key={type.value} value={type.value}>
                            {type.label}
                          </option>
                        ))}
                      </select>
                      {errors.eventType && (
                        <p className="mt-1 text-sm text-error-600">{errors.eventType.message}</p>
                      )}
                    </div>

                  </div>
                </div>
              )}

              {/* Location Tab */}
              {activeTab === 'location' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input
                      label="City *"
                      {...register('eventCity')}
                      error={errors.eventCity?.message}
                    />

                    <Input
                      label="Country Code *"
                      {...register('eventCountryCode')}
                      error={errors.eventCountryCode?.message}
                      placeholder="e.g., US, GB, DE"
                      maxLength={5}
                    />

                    <div>
                      <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
                        Region
                      </label>
                      <select
                        {...register('eventRegion')}
                        className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      >
                        <option value="">Select Region</option>
                        {regions.map(region => (
                          <option key={region.value} value={region.value}>
                            {region.label}
                          </option>
                        ))}
                      </select>
                      {errors.eventRegion && (
                        <p className="mt-1 text-sm text-error-600">{errors.eventRegion.message}</p>
                      )}
                    </div>

                    <Input
                      label="Event Location (Coordinates)"
                      {...register('eventLocation')}
                      error={errors.eventLocation?.message}
                      placeholder="lat,lng or specific coordinates"
                    />

                    <div className="md:col-span-2">
                      <Input
                        label="Venue Address"
                        {...register('venueAddress')}
                        error={errors.venueAddress?.message}
                        placeholder="Full venue address or venue name"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Dates & Time Tab */}
              {activeTab === 'dates' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input
                      label="Start Date & Time"
                      type="datetime-local"
                      {...register('eventStart')}
                      error={errors.eventStart?.message}
                    />

                    <Input
                      label="End Date & Time"
                      type="datetime-local"
                      {...register('eventEnd')}
                      error={errors.eventEnd?.message}
                    />
                  </div>
                </div>
              )}

              {/* Discount Tab */}
              {activeTab === 'discount' && !isAccountUser && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input
                      label="Discount Value"
                      {...register('offerValue')}
                      error={errors.offerValue?.message}
                      placeholder="e.g., $100 off, 20% off"
                    />

                    <Input
                      label="Slug"
                      {...register('offerSlug')}
                      error={errors.offerSlug?.message}
                      placeholder="URL-friendly identifier"
                    />

                    <Input
                      label="Offer Close Date & Time"
                      type="datetime-local"
                      {...register('offerCloseDate')}
                      error={errors.offerCloseDate?.message}
                    />

                    <Input
                      label="Offer Close Display"
                      {...register('offerCloseDisplay')}
                      error={errors.offerCloseDisplay?.message}
                      placeholder="Display text for offer end"
                    />

                    <Input
                      label="Ticket Details"
                      {...register('offerTicketDetails')}
                      error={errors.offerTicketDetails?.message}
                      placeholder="e.g., VIP Pass, Conference Ticket"
                    />

                    <Input
                      label="Result"
                      {...register('offerResult')}
                      error={errors.offerResult?.message}
                      placeholder="e.g., Discounted conference pass"
                    />

                    <ImageUpload
                      label="Event Logo"
                      value={watch('eventLogo') || ''}
                      onChange={(url) => {
                        setValue('eventLogo', url || '');
                      }}
                      onImagePathChange={setEventLogoPath}
                      placeholder="Upload an image or enter URL"
                      maxSizeInMB={10}
                      error={errors.eventLogo?.message}
                    />

                    <div className="flex items-center space-x-3">
                      <input
                        type="checkbox"
                        id="offerBeta"
                        {...register('offerBeta')}
                        className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                      />
                      <label htmlFor="offerBeta" className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                        Testing
                      </label>
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
                        Listing Introduction
                      </label>
                      <textarea
                        {...register('listingIntro')}
                        rows={4}
                        className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        placeholder="Brief introduction or description for the discount offer..."
                      />
                      {errors.listingIntro && (
                        <p className="mt-1 text-sm text-error-600">{errors.listingIntro.message}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Competition Tab */}
              {activeTab === 'competition' && !isAccountUser && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input
                      label="Prize Value"
                      {...register('offerValue')}
                      error={errors.offerValue?.message}
                      placeholder="e.g., $5,000, Free ticket, VIP pass"
                    />

                    <Input
                      label="Competition Slug"
                      {...register('offerSlug')}
                      error={errors.offerSlug?.message}
                      placeholder="URL-friendly identifier"
                    />

                    <Input
                      label="Competition End Date & Time"
                      type="datetime-local"
                      {...register('offerCloseDate')}
                      error={errors.offerCloseDate?.message}
                    />

                    <Input
                      label="Competition End Display"
                      {...register('offerCloseDisplay')}
                      error={errors.offerCloseDisplay?.message}
                      placeholder="Display text for competition end"
                    />

                    <Input
                      label="Ticket Details"
                      {...register('offerTicketDetails')}
                      error={errors.offerTicketDetails?.message}
                      placeholder="e.g., VIP Pass, Conference Ticket"
                    />

                    <Input
                      label="Result"
                      {...register('offerResult')}
                      error={errors.offerResult?.message}
                      placeholder="e.g., Free conference pass"
                    />

                    <ImageUpload
                      label="Event Logo"
                      value={watch('eventLogo') || ''}
                      onChange={(url) => {
                        setValue('eventLogo', url || '');
                      }}
                      onImagePathChange={setEventLogoPath}
                      placeholder="Upload an image or enter URL"
                      maxSizeInMB={10}
                      error={errors.eventLogo?.message}
                    />

                    <div className="flex items-center space-x-3">
                      <input
                        type="checkbox"
                        id="offerBeta"
                        {...register('offerBeta')}
                        className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                      />
                      <label htmlFor="offerBeta" className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                        Testing
                      </label>
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
                        Listing Introduction
                      </label>
                      <textarea
                        {...register('listingIntro')}
                        rows={4}
                        className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        placeholder="Brief introduction or description for the competition..."
                      />
                      {errors.listingIntro && (
                        <p className="mt-1 text-sm text-error-600">{errors.listingIntro.message}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Topics Tab */}
              {activeTab === 'topics' && (
                <div className="space-y-6">
                  <TopicSelector
                    selectedTopics={watchedTopics || []}
                    onTopicsChange={(topics) => setValue('eventTopics', topics as string[])}
                    disabled={submitting}
                  />
                </div>
              )}

              {/* Source & Metadata Tab */}
              {activeTab === 'source' && !isAccountUser && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
                        Source Type
                      </label>
                      <select
                        {...register('sourceType')}
                        className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      >
                        <option value="">Select Source Type</option>
                        {sourceTypes.map(type => (
                          <option key={type.value} value={type.value}>
                            {type.label}
                          </option>
                        ))}
                      </select>
                      {errors.sourceType && (
                        <p className="mt-1 text-sm text-error-600">{errors.sourceType.message}</p>
                      )}
                    </div>

                    <Input
                      label="Scraped By"
                      {...register('scrapedBy')}
                      error={errors.scrapedBy?.message}
                      placeholder="Name of scraper that collected this data"
                    />

                    <Input
                      label="Screenshot URL"
                      type="url"
                      {...register('screenshotUrl')}
                      error={errors.screenshotUrl?.message}
                      placeholder="https://example.com/screenshot.jpg"
                    />

                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
                        Source Details (JSON)
                      </label>
                      <textarea
                        {...register('sourceDetails')}
                        rows={6}
                        className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-mono text-sm"
                        placeholder='{"scraper_name": "example", "job_id": 123}'
                      />
                      {errors.sourceDetails && (
                        <p className="mt-1 text-sm text-error-600">{errors.sourceDetails.message}</p>
                      )}
                      <p className="mt-1 text-xs text-gray-500">
                        Enter valid JSON or leave empty. This field stores additional metadata about the source.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Form Actions - Sticky Footer */}
            <div className="flex justify-end gap-3 pt-4 mt-6 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex-shrink-0 -mx-6 px-6 -mb-6 pb-6">
              <Button
                type="button"
                variant="outline"
                onClick={closeModal}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="solid"
                disabled={submitting}
              >
                {submitting
                  ? (editingEvent ? 'Updating...' : 'Creating...')
                  : (editingEvent ? 'Update Event' : 'Create Event')
                }
              </Button>
            </div>
          </form>
        </Modal>

        {/* Terminal Output Modal */}
        <TerminalOutputModal
          isOpen={terminalModalOpen}
          onClose={() => {
            setTerminalModalOpen(false);
            setShowScreenshotPreview(false);
            setScreenshotUrl('');
          }}
          title={terminalTitle}
          isRunning={terminalRunning}
          output={terminalOutput}
          onClear={() => setTerminalOutput([])}
          showScreenshotPreview={showScreenshotPreview}
          screenshotUrl={screenshotUrl}
          eventTitle={currentEventTitle}
          onBrowserlessGeneration={regenerateScreenshot}
          currentEventId={currentEventId}
        />

        {/* Screenshot Viewer Modal */}
        <Modal
          isOpen={screenshotViewerOpen}
          onClose={() => {
            setScreenshotViewerOpen(false);
            setViewingEvent(null);
          }}
          title={`Screenshot - ${viewingEvent?.eventTitle}`}
          size="lg"
        >
          {viewingEvent && (
            <div className="flex flex-col items-center space-y-4">
              <div className="flex items-center justify-center bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
                <img
                  src={viewingEvent.screenshotUrl || `/preview/${viewingEvent.eventId}.jpg`}
                  alt={`Screenshot of ${viewingEvent.eventTitle}`}
                  className="rounded-lg shadow-lg"
                  style={{
                    maxHeight: '70vh',
                    maxWidth: '100%',
                    height: 'auto',
                    width: 'auto'
                  }}
                />
              </div>
              <div className="text-center space-y-2">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {viewingEvent.eventTitle}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  Event ID: {viewingEvent.eventId}
                </p>
                {viewingEvent.eventLink && (
                  <a
                    href={viewingEvent.eventLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary-600 hover:text-primary-700 text-sm font-medium"
                  >
                    <GlobeAltIcon className="w-4 h-4" />
                    Visit Event Page
                  </a>
                )}
              </div>
            </div>
          )}
        </Modal>

        {/* Confirmation Modal */}
        <ConfirmModal
          isOpen={confirmModal.isOpen}
          onClose={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
          onConfirm={confirmModal.onConfirm}
          title={confirmModal.title}
          message={confirmModal.message}
          confirmText={confirmModal.confirmText}
          confirmColor={confirmModal.confirmColor}
        />
      </div>
    </Page>
  );
}