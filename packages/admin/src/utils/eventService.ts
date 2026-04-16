import { supabase } from '@/lib/supabase';
import { toPublicUrl } from '@gatewaze/shared';
import { ScreenshotService } from './screenshotService';
import { EventExportService } from './eventExportService';

// Default bucket URL derived from the Supabase project URL; storage paths stored
// as relative values are resolved through this base at read time.
const BUCKET_URL = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/media`;

export interface Event {
  id?: string;
  eventId: string;
  eventSlug?: string | null;
  eventTitle: string;
  listingIntro?: string;
  offerResult?: string;
  offerCloseDisplay?: string;
  eventTopics?: string[];
  offerTicketDetails?: string;
  offerValue?: string;
  eventCity?: string;
  eventCountryCode?: string;
  eventLink?: string;
  eventLogo?: string;
  badgeLogo?: string;
  offerSlug?: string;
  offerCloseDate?: string;
  eventStart?: string;
  eventEnd?: string;
  eventRegion?: string;
  eventLocation?: string;
  eventTopicsUpdatedAt?: number;
  eventType?: string;
  contentCategory?: string | null;
  venueAddress?: string;
  scrapedBy?: string;
  scraperId?: number;
  createdAt?: string;
  updatedAt?: string;
  // New audit fields
  sourceType?: 'manual' | 'scraper' | 'user_submission';
  sourceDetails?: {
    entry_method?: string;
    user_id?: string;
    user_email?: string;
    scraper_name?: string;
    added_timestamp?: string;
    [key: string]: any;
  };
  addedAt?: string;
  lastUpdatedAt?: string;
  lastScrapedAt?: string;
  // Screenshot metadata
  screenshotGenerated?: boolean;
  screenshotGeneratedAt?: string;
  screenshotUrl?: string;
  // Account association
  accountId?: string;
  // Beta offer indicator
  offerBeta?: boolean;
  // Live in production indicator
  isLiveInProduction?: boolean;
  // Event check-in QR code
  checkinQrCode?: string;
  // Registration controls
  enableRegistration?: boolean;
  enableNativeRegistration?: boolean;
  walkinsAllowed?: boolean;
  // Luma integration
  lumaEventId?: string;
  // Custom domain (white-label)
  customDomain?: string | null;
  customDomainStatus?: string | null;
  // External source event ID (e.g., dev.events)
  sourceEventId?: string;
  // Call for speakers
  enableCallForSpeakers?: boolean;
  // Agenda
  enableAgenda?: boolean;
  // Event-specific fields
  eventLatitude?: number | null;
  eventLongitude?: number | null;
  eventSource?: string | null;
  eventTimezone?: string | null;
  eventFeaturedImage?: string | null;
  // Gradient colors for event portal
  gradientColor1?: string | null;
  gradientColor2?: string | null;
  gradientColor3?: string | null;
  // Registration count (computed field)
  registrationCount?: number;
  // Talk duration options for speaker submissions
  talkDurationOptions?: Array<{ duration: number; capacity: number }> | null;
  // Scraped page data from external sources (refreshed on each scrape)
  lumaPageData?: Record<string, any> | null;
  meetupPageData?: Record<string, any> | null;
  // Processed HTML content from scrapers (read-only)
  lumaProcessedHtml?: string | null;
  meetupProcessedHtml?: string | null;
  // Configurable register button text
  registerButtonText?: string | null;
  // Rich text page content (takes priority over scraped content)
  pageContent?: string | null;
  // Recommended event
  recommendedEventId?: string | null;
  // Venue page content
  venueContent?: string | null;
  venueMapImage?: string | null;
  // Added page content (configurable title, e.g. Workshops)
  addedpageContent?: string | null;
  addedpageTitle?: string | null;
  eventDescription?: string | null;
}

export interface EventServiceResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

export class EventService {
  static async getEventById(id: string): Promise<EventServiceResponse<Event>> {
    try {
      // Check if the ID is a UUID (primary key) or event_id (short string)
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      const column = isUUID ? 'id' : 'event_id';

      const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq(column, id)
        .single();

      if (error) {
        console.error('Error fetching event:', error);
        return { success: false, error: error.message };
      }

      // Map database fields to Event interface
      const event: Event = {
        id: data.id,
        eventId: data.event_id,
        eventSlug: data.event_slug,
        eventTitle: data.event_title,
        listingIntro: data.listing_intro,
        offerResult: data.offer_result,
        offerCloseDisplay: data.offer_close_display,
        eventTopics: data.event_topics,
        offerTicketDetails: data.offer_ticket_details,
        offerValue: data.offer_value,
        eventCity: data.event_city,
        eventCountryCode: data.event_country_code,
        eventLink: data.event_link,
        eventLogo: (toPublicUrl(data.event_logo, BUCKET_URL) ?? undefined),
        badgeLogo: (toPublicUrl(data.badge_logo, BUCKET_URL) ?? undefined),
        offerSlug: data.offer_slug,
        offerCloseDate: data.offer_close_date,
        eventStart: data.event_start,
        eventEnd: data.event_end,
        eventRegion: data.event_region,
        eventLocation: data.event_location,
        eventTopicsUpdatedAt: data.event_topics_updated_at,
        eventType: data.event_type,
        contentCategory: data.content_category,
        screenshotUrl: (toPublicUrl(data.screenshot_url, BUCKET_URL) ?? undefined),
        screenshotGenerated: data.screenshot_generated,
        screenshotGeneratedAt: data.screenshot_generated_at,
        venueAddress: data.venue_address,
        scrapedBy: data.scraped_by,
        scraperId: data.scraper_id,
        sourceType: data.source_type,
        sourceDetails: data.source_details,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        accountId: data.account_id,
        offerBeta: data.offer_beta,
        isLiveInProduction: data.is_live_in_production !== undefined ? data.is_live_in_production : true,
        checkinQrCode: data.checkin_qr_code,
        enableRegistration: data.enable_registration !== undefined ? data.enable_registration : true,
        enableNativeRegistration: data.enable_native_registration || false,
        walkinsAllowed: data.walkins_allowed !== undefined ? data.walkins_allowed : false,
        enableCallForSpeakers: data.enable_call_for_speakers || false,
        enableAgenda: data.enable_agenda || false,
        lumaEventId: data.luma_event_id,
        customDomain: data.custom_domain,
        customDomainStatus: data.custom_domain_status,
        sourceEventId: data.source_event_id,
        eventLatitude: data.event_latitude,
        eventLongitude: data.event_longitude,
        eventSource: data.event_source,
        eventTimezone: data.event_timezone,
        eventFeaturedImage: (toPublicUrl(data.event_featured_image, BUCKET_URL) ?? undefined),
        gradientColor1: data.gradient_color_1,
        gradientColor2: data.gradient_color_2,
        gradientColor3: data.gradient_color_3,
        talkDurationOptions: data.talk_duration_options || [{ duration: 10, capacity: 10 }, { duration: 25, capacity: 5 }],
        lumaPageData: data.luma_page_data,
        meetupPageData: data.meetup_page_data,
        lumaProcessedHtml: data.luma_processed_html || null,
        meetupProcessedHtml: data.meetup_processed_html || null,
        registerButtonText: data.register_button_text || null,
        pageContent: data.page_content || null,
        recommendedEventId: data.recommended_event_id || null,
        venueContent: data.venue_content || null,
        venueMapImage: (toPublicUrl(data.venue_map_image, BUCKET_URL) ?? undefined),
        addedpageContent: data.addedpage_content || null,
        addedpageTitle: data.addedpage_title || null,
      };

      console.log('📖 Loaded event from DB:', {
        eventId: event.eventId,
        title: event.eventTitle,
        accountId: event.accountId,
        rawAccountId: data.account_id
      });

      return { success: true, data: event };
    } catch (error: any) {
      console.error('Error in getEventById:', error);
      return { success: false, error: error.message };
    }
  }

  static async getEventByEventId(eventId: string): Promise<EventServiceResponse<Event>> {
    try {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('event_id', eventId)
        .single();

      if (error) {
        console.error('Error fetching event by event_id:', error);
        return { success: false, error: error.message };
      }

      // Map database fields to Event interface
      const event: Event = {
        id: data.id,
        eventId: data.event_id,
        eventSlug: data.event_slug,
        eventTitle: data.event_title,
        listingIntro: data.listing_intro,
        offerResult: data.offer_result,
        offerCloseDisplay: data.offer_close_display,
        eventTopics: data.event_topics,
        offerTicketDetails: data.offer_ticket_details,
        offerValue: data.offer_value,
        eventCity: data.event_city,
        eventCountryCode: data.event_country_code,
        eventLink: data.event_link,
        eventLogo: (toPublicUrl(data.event_logo, BUCKET_URL) ?? undefined),
        badgeLogo: (toPublicUrl(data.badge_logo, BUCKET_URL) ?? undefined),
        offerSlug: data.offer_slug,
        offerCloseDate: data.offer_close_date,
        eventStart: data.event_start,
        eventEnd: data.event_end,
        eventRegion: data.event_region,
        eventLocation: data.event_location,
        eventTopicsUpdatedAt: data.event_topics_updated_at,
        eventType: data.event_type,
        contentCategory: data.content_category,
        screenshotUrl: (toPublicUrl(data.screenshot_url, BUCKET_URL) ?? undefined),
        screenshotGenerated: data.screenshot_generated,
        screenshotGeneratedAt: data.screenshot_generated_at,
        venueAddress: data.venue_address,
        scrapedBy: data.scraped_by,
        scraperId: data.scraper_id,
        sourceType: data.source_type,
        sourceDetails: data.source_details,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        accountId: data.account_id,
        offerBeta: data.offer_beta,
        isLiveInProduction: data.is_live_in_production !== undefined ? data.is_live_in_production : true,
        checkinQrCode: data.checkin_qr_code,
        enableRegistration: data.enable_registration !== undefined ? data.enable_registration : true,
        enableNativeRegistration: data.enable_native_registration || false,
        walkinsAllowed: data.walkins_allowed !== undefined ? data.walkins_allowed : false,
        enableCallForSpeakers: data.enable_call_for_speakers || false,
        enableAgenda: data.enable_agenda || false,
        lumaEventId: data.luma_event_id,
        customDomain: data.custom_domain,
        customDomainStatus: data.custom_domain_status,
        sourceEventId: data.source_event_id,
        eventLatitude: data.event_latitude,
        eventLongitude: data.event_longitude,
        eventSource: data.event_source,
        eventTimezone: data.event_timezone,
        eventFeaturedImage: (toPublicUrl(data.event_featured_image, BUCKET_URL) ?? undefined),
        gradientColor1: data.gradient_color_1,
        gradientColor2: data.gradient_color_2,
        gradientColor3: data.gradient_color_3,
        talkDurationOptions: data.talk_duration_options || [{ duration: 10, capacity: 10 }, { duration: 25, capacity: 5 }],
        lumaPageData: data.luma_page_data,
        meetupPageData: data.meetup_page_data,
        lumaProcessedHtml: data.luma_processed_html || null,
        meetupProcessedHtml: data.meetup_processed_html || null,
        registerButtonText: data.register_button_text || null,
        pageContent: data.page_content || null,
        recommendedEventId: data.recommended_event_id || null,
        venueContent: data.venue_content || null,
        venueMapImage: (toPublicUrl(data.venue_map_image, BUCKET_URL) ?? undefined),
        addedpageContent: data.addedpage_content || null,
        addedpageTitle: data.addedpage_title || null,
      };

      return { success: true, data: event };
    } catch (error: any) {
      console.error('Error in getEventByEventId:', error);
      return { success: false, error: error.message };
    }
  }

  static async getAllEvents(): Promise<EventServiceResponse<Event[]>> {
    try {
      // Fetch all events directly from the table to avoid RPC function overloading issues
      let allEvents: any[] = [];
      let page = 0;
      const pageSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const startRange = page * pageSize;
        const endRange = startRange + pageSize - 1;

        const { data, error } = await supabase
          .from('events')
          .select('*, events_registrations(count)')
          .order('event_start', { ascending: true })
          .range(startRange, endRange);

        if (error) {
          console.error('Error fetching events page', page, ':', error);
          return { success: false, error: error.message };
        }

        if (data && data.length > 0) {
          allEvents = allEvents.concat(data);
          hasMore = data.length === pageSize; // Continue if we got a full page
          page++;
        } else {
          hasMore = false;
        }

        // Safety check to prevent infinite loops
        if (page > 10) {
          console.warn('Stopped fetching after 10 pages (10,000 records)');
          break;
        }
      }

      console.log(`📊 Fetched ${allEvents.length} total events across ${page} pages`);
      const data = allEvents;

      if (!data) {
        return { success: false, error: 'No data received' };
      }

      // Transform the response to match our Event interface
      const events: Event[] = data?.map((event: any) => ({
        id: event.id,
        eventId: event.event_id,
        eventTitle: event.event_title,
        listingIntro: event.listing_intro,
        offerResult: event.offer_result,
        offerCloseDisplay: event.offer_close_display,
        eventTopics: event.event_topics,
        offerTicketDetails: event.offer_ticket_details,
        offerValue: event.offer_value,
        eventCity: event.event_city,
        eventCountryCode: event.event_country_code,
        eventLink: event.event_link,
        eventLogo: (toPublicUrl(event.event_logo, BUCKET_URL) ?? undefined),
        badgeLogo: (toPublicUrl(event.badge_logo, BUCKET_URL) ?? undefined),
        offerSlug: event.offer_slug,
        offerCloseDate: event.offer_close_date,
        eventStart: event.event_start,
        eventEnd: event.event_end,
        eventRegion: event.event_region,
        eventLocation: event.event_location,
        eventTopicsUpdatedAt: event.event_topics_updated_at,
        eventType: event.event_type,
        contentCategory: event.content_category,
        scrapedBy: event.scraped_by,
        scraperId: event.scraper_id,
        createdAt: event.created_at,
        updatedAt: event.updated_at,
        // New audit fields
        sourceType: event.source_type,
        sourceDetails: event.source_details,
        addedAt: event.added_at,
        lastUpdatedAt: event.last_updated_at,
        lastScrapedAt: event.last_scraped_at,
        // Screenshot metadata
        screenshotGenerated: event.screenshot_generated || false,
        screenshotGeneratedAt: event.screenshot_generated_at,
        screenshotUrl: (toPublicUrl(event.screenshot_url, BUCKET_URL) ?? undefined),
        // Account association
        accountId: event.account_id,
        // Beta offer indicator
        offerBeta: event.offer_beta,
        // Live in production indicator (default to true if field doesn't exist yet)
        isLiveInProduction: event.is_live_in_production !== undefined ? event.is_live_in_production : true,
        // External source event ID
        sourceEventId: event.source_event_id,
        // Registration count from joined query
        registrationCount: event.events_registrations?.[0]?.count || 0,
        // Recommended event
        recommendedEventId: event.recommended_event_id || null,
      })) || [];

      return { success: true, data: events };
    } catch (error) {
      console.error('Error in getAllEvents:', error);
      return { success: false, error: 'Failed to fetch events' };
    }
  }

static async createEvent(eventData: Omit<Event, 'id' | 'createdAt' | 'updatedAt'>, userInfo?: { id?: string; email?: string }): Promise<EventServiceResponse<string>> {
    try {
      // Check for duplicate event_link
      if (eventData.eventLink) {
        const { data: existingEvent, error: checkError } = await supabase
          .from('events')
          .select('id, event_id, event_title')
          .eq('event_link', eventData.eventLink)
          .maybeSingle();

        if (checkError) {
          console.error('Error checking for duplicate event:', checkError);
          return { success: false, error: `Failed to check for duplicates: ${checkError.message}` };
        }

        if (existingEvent) {
          console.warn(`Duplicate event detected: ${eventData.eventTitle} (link: ${eventData.eventLink})`);
          return {
            success: false,
            error: `An event with this link already exists: "${existingEvent.event_title}" (ID: ${existingEvent.event_id})`
          };
        }
      }

      // Set up audit tracking for manual entries
      const sourceType = eventData.sourceType || 'manual';
      const sourceDetails = eventData.sourceDetails || {
        entry_method: 'admin_ui',
        user_id: userInfo?.id || null,
        user_email: userInfo?.email || null,
        added_timestamp: new Date().toISOString()
      };

      // Geocode location if city and country are provided
      let eventLocation = eventData.eventLocation;
      if (eventData.eventCity && eventData.eventCountryCode) {
        console.log(`Geocoding location for: ${eventData.eventCity}, ${eventData.eventCountryCode}`);
        try {
          const geocodeResponse = await fetch(
            `https://nominatim.openstreetmap.org/search?city=${encodeURIComponent(eventData.eventCity)}&country=${encodeURIComponent(eventData.eventCountryCode)}&format=json&limit=1`,
            {
              headers: {
                'User-Agent': 'GatewazeEventManager/1.0'
              }
            }
          );
          const geocodeData = await geocodeResponse.json();

          if (geocodeData && geocodeData.length > 0) {
            const { lat, lon } = geocodeData[0];
            eventLocation = `${lat},${lon}`;
            console.log(`Geocoded location: ${eventLocation}`);
          } else {
            console.warn(`Could not geocode: ${eventData.eventCity}, ${eventData.eventCountryCode}`);
          }
        } catch (geocodeError) {
          console.error('Geocoding error:', geocodeError);
          // Continue with the creation even if geocoding fails
        }
      }

      // Build the insert object with snake_case field names
      const insertData: any = {
        event_id: eventData.eventId,
        event_title: eventData.eventTitle,
        listing_intro: eventData.listingIntro || null,
        offer_result: eventData.offerResult || null,
        offer_close_display: eventData.offerCloseDisplay || null,
        event_topics: eventData.eventTopics || null,
        offer_ticket_details: eventData.offerTicketDetails || null,
        offer_value: eventData.offerValue || null,
        event_city: eventData.eventCity || null,
        event_country_code: eventData.eventCountryCode || null,
        event_link: eventData.eventLink || null,
        event_logo: eventData.eventLogo || null,
        badge_logo: eventData.badgeLogo || null,
        offer_slug: eventData.offerSlug || null,
        offer_close_date: eventData.offerCloseDate || null,
        event_start: eventData.eventStart || null,
        event_end: eventData.eventEnd || null,
        event_region: eventData.eventRegion || null,
        event_location: eventLocation || null,
        event_topics_updated_at: eventData.eventTopicsUpdatedAt || null,
        event_type: eventData.eventType || null,
        content_category: eventData.contentCategory || null,
        event_timezone: eventData.eventTimezone || 'UTC', // Default to UTC if not provided
        scraper_id: null,
        source_type: sourceType,
        source_details: sourceDetails,
        account_id: eventData.accountId || null,
        offer_beta: eventData.offerBeta || false,
        is_live_in_production: eventData.isLiveInProduction !== undefined ? eventData.isLiveInProduction : true, // Default to true for new events
        recommended_event_id: eventData.recommendedEventId || null,
      };

      const { data, error } = await supabase
        .from('events')
        .insert(insertData)
        .select('id')
        .single();

      if (error) {
        console.error('Error creating event:', error);
        return { success: false, error: error.message };
      }

      // Generate screenshot for the new event if it has a link
      if (eventData.eventLink && eventData.eventId) {
        console.log(`Triggering screenshot generation for new event: ${eventData.eventId}`);
        ScreenshotService.generateScreenshot(eventData.eventId).catch(error => {
          console.warn(`Screenshot generation failed for event ${eventData.eventId}:`, error);
        });
      }

      // Generate check-in QR code for the new event
      if (data.id) {
        console.log(`Generating check-in QR code for new event: ${eventData.eventId}`);
        ScreenshotManagementService.generateCheckinQrCode(data.id).catch(error => {
          console.warn(`QR code generation failed for event ${eventData.eventId}:`, error);
          // Don't fail the creation if QR code generation fails
        });
      }

      return { success: true, data: data.id };
    } catch (error) {
      console.error('Error in createEvent:', error);
      return { success: false, error: 'Failed to create event' };
    }
  }

  static async updateEvent(id: string, eventData: Partial<Event>, originalEvent?: Event, userInfo?: { id?: string; email?: string }): Promise<EventServiceResponse<boolean>> {
    try {
      // Only process source info if explicitly provided in eventData
      const sourceType = eventData.sourceType;
      let sourceDetails = eventData.sourceDetails;

      // If sourceType is provided and this is a manual update (from admin UI), update source_details
      if (sourceType !== undefined && userInfo && sourceType !== 'scraper') {
        sourceDetails = {
          ...sourceDetails,
          last_updated_by: userInfo.email || userInfo.id,
          last_manual_update: new Date().toISOString(),
          update_method: 'admin_ui'
        };
      }

      // Geocode location if city and country are provided and location has changed
      let eventLocation = eventData.eventLocation;
      const cityChanged = eventData.eventCity && eventData.eventCity !== originalEvent?.eventCity;
      const countryChanged = eventData.eventCountryCode && eventData.eventCountryCode !== originalEvent?.eventCountryCode;

      if ((cityChanged || countryChanged) && eventData.eventCity && eventData.eventCountryCode) {
        console.log(`Geocoding location for: ${eventData.eventCity}, ${eventData.eventCountryCode}`);
        try {
          const geocodeResponse = await fetch(
            `https://nominatim.openstreetmap.org/search?city=${encodeURIComponent(eventData.eventCity)}&country=${encodeURIComponent(eventData.eventCountryCode)}&format=json&limit=1`,
            {
              headers: {
                'User-Agent': 'GatewazeEventManager/1.0'
              }
            }
          );
          const geocodeData = await geocodeResponse.json();

          if (geocodeData && geocodeData.length > 0) {
            const { lat, lon } = geocodeData[0];
            eventLocation = `${lat},${lon}`;
            console.log(`Geocoded location: ${eventLocation}`);
          } else {
            console.warn(`Could not geocode: ${eventData.eventCity}, ${eventData.eventCountryCode}`);
          }
        } catch (geocodeError) {
          console.error('Geocoding error:', geocodeError);
          // Continue with the update even if geocoding fails
        }
      }

      // Build the update object with snake_case field names
      // Only include fields that are actually provided
      const updateData: any = {
        event_title: eventData.eventTitle,
        updated_at: new Date().toISOString(),
      };

      // Add optional fields only if they're defined in eventData
      if (eventData.listingIntro !== undefined) updateData.listing_intro = eventData.listingIntro || null;
      if (eventData.offerResult !== undefined) updateData.offer_result = eventData.offerResult || null;
      if (eventData.offerCloseDisplay !== undefined) updateData.offer_close_display = eventData.offerCloseDisplay || null;
      if (eventData.eventTopics !== undefined) updateData.event_topics = eventData.eventTopics || null;
      if (eventData.offerTicketDetails !== undefined) updateData.offer_ticket_details = eventData.offerTicketDetails || null;
      if (eventData.offerValue !== undefined) updateData.offer_value = eventData.offerValue || null;
      if (eventData.eventCity !== undefined) updateData.event_city = eventData.eventCity || null;
      if (eventData.eventCountryCode !== undefined) updateData.event_country_code = eventData.eventCountryCode || null;
      if (eventData.eventLink !== undefined) updateData.event_link = eventData.eventLink || null;
      if (eventData.eventLogo !== undefined) updateData.event_logo = eventData.eventLogo || null;
      if (eventData.badgeLogo !== undefined) updateData.badge_logo = eventData.badgeLogo || null;
      if (eventData.offerSlug !== undefined) updateData.offer_slug = eventData.offerSlug || null;
      if (eventData.offerCloseDate !== undefined) updateData.offer_close_date = eventData.offerCloseDate || null;
      if (eventData.eventStart !== undefined) updateData.event_start = eventData.eventStart || null;
      if (eventData.eventEnd !== undefined) updateData.event_end = eventData.eventEnd || null;
      if (eventData.eventRegion !== undefined) updateData.event_region = eventData.eventRegion || null;
      if (eventLocation !== undefined) updateData.event_location = eventLocation || null;
      if (eventData.venueAddress !== undefined) updateData.venue_address = eventData.venueAddress || null;
      if (eventData.eventTopicsUpdatedAt !== undefined) updateData.event_topics_updated_at = eventData.eventTopicsUpdatedAt || null;
      if (eventData.eventType !== undefined) updateData.event_type = eventData.eventType || null;
      if (eventData.contentCategory !== undefined) updateData.content_category = eventData.contentCategory || null;
      if (eventData.eventTimezone !== undefined) updateData.event_timezone = eventData.eventTimezone || 'UTC';
      if (eventData.scrapedBy !== undefined) updateData.scraped_by = eventData.scrapedBy || null;
      if (eventData.scraperId !== undefined) updateData.scraper_id = eventData.scraperId || null;
      if (sourceType !== undefined) updateData.source_type = sourceType || null;
      if (sourceDetails !== undefined) updateData.source_details = sourceDetails || null;
      if (eventData.screenshotUrl !== undefined) updateData.screenshot_url = eventData.screenshotUrl || null;
      if (eventData.accountId !== undefined) updateData.account_id = eventData.accountId || null;
      if (eventData.offerBeta !== undefined) updateData.offer_beta = eventData.offerBeta || false;
      if (eventData.isLiveInProduction !== undefined) {
        updateData.is_live_in_production = eventData.isLiveInProduction;
        console.log('📌 Setting is_live_in_production to:', eventData.isLiveInProduction);
      }
      if (eventData.enableRegistration !== undefined) updateData.enable_registration = eventData.enableRegistration;
      if (eventData.enableNativeRegistration !== undefined) updateData.enable_native_registration = eventData.enableNativeRegistration;
      if (eventData.walkinsAllowed !== undefined) updateData.walkins_allowed = eventData.walkinsAllowed;
      if (eventData.enableCallForSpeakers !== undefined) updateData.enable_call_for_speakers = eventData.enableCallForSpeakers;
      if (eventData.enableAgenda !== undefined) updateData.enable_agenda = eventData.enableAgenda;
      if (eventData.lumaEventId !== undefined) updateData.luma_event_id = eventData.lumaEventId || null;
      if (eventData.customDomain !== undefined) updateData.custom_domain = eventData.customDomain || null;
      if (eventData.customDomainStatus !== undefined) updateData.custom_domain_status = eventData.customDomainStatus || null;
      if (eventData.sourceEventId !== undefined) updateData.source_event_id = eventData.sourceEventId || null;
      if (eventData.eventSlug !== undefined) updateData.event_slug = eventData.eventSlug || null;
      if (eventData.gradientColor1 !== undefined) updateData.gradient_color_1 = eventData.gradientColor1 || null;
      if (eventData.gradientColor2 !== undefined) updateData.gradient_color_2 = eventData.gradientColor2 || null;
      if (eventData.gradientColor3 !== undefined) updateData.gradient_color_3 = eventData.gradientColor3 || null;
      if (eventData.talkDurationOptions !== undefined) updateData.talk_duration_options = eventData.talkDurationOptions || null;
      if (eventData.registerButtonText !== undefined) updateData.register_button_text = eventData.registerButtonText || null;
      if (eventData.pageContent !== undefined) updateData.page_content = eventData.pageContent || null;
      if (eventData.recommendedEventId !== undefined) updateData.recommended_event_id = eventData.recommendedEventId || null;
      if (eventData.venueContent !== undefined) updateData.venue_content = eventData.venueContent || null;
      if (eventData.venueMapImage !== undefined) updateData.venue_map_image = eventData.venueMapImage || null;
      if (eventData.addedpageContent !== undefined) updateData.addedpage_content = eventData.addedpageContent || null;
      if (eventData.addedpageTitle !== undefined) updateData.addedpage_title = eventData.addedpageTitle || null;

      console.log('💾 Updating event with account_id:', {
        eventId: id,
        accountId: eventData.accountId,
        accountIdInUpdate: updateData.account_id
      });

      console.log('📦 Full update data being sent:', updateData);
      console.log('📦 Update data keys:', Object.keys(updateData));
      console.log('📦 Update data values:', Object.values(updateData));

      // Log each field individually to help identify the problematic one
      for (const [key, value] of Object.entries(updateData)) {
        console.log(`  ${key}: ${JSON.stringify(value)} (type: ${typeof value})`);
      }

      // Update without select to avoid RLS issues with account users
      console.log('🔄 Sending update to Supabase:', {
        id,
        updateData,
        is_live_in_production: updateData.is_live_in_production
      });

      const { error: updateError } = await supabase
        .from('events')
        .update(updateData)
        .eq('id', id);

      if (updateError) {
        console.error('❌ Error updating event:', updateError);
        console.error('❌ Error code:', updateError.code);
        console.error('❌ Error details:', updateError.details);
        console.error('❌ Error hint:', updateError.hint);
        console.error('❌ Full error object:', JSON.stringify(updateError, null, 2));
        return { success: false, error: `${updateError.message} (code: ${updateError.code})` };
      }

      console.log('✅ Event updated successfully');

      // Note: Event export to public/events.json is handled at build time
      // The front-end website fetches from /api/events/export during its build process
      // No need to export on every update - reduces server load

      // Check if fields that affect screenshots have changed
      if (originalEvent && originalEvent.eventId) {
        const screenshotRelevantFields = ['eventLink', 'eventTitle', 'eventStart', 'eventEnd', 'eventLogo'];
        let shouldRegenerateScreenshot = false;

        for (const field of screenshotRelevantFields) {
          if (eventData[field as keyof Event] !== originalEvent[field as keyof Event]) {
            shouldRegenerateScreenshot = true;
            console.log(`Event ${originalEvent.eventId}: ${field} changed, will regenerate screenshot`);
            break;
          }
        }

        // Also regenerate if eventLink is present (in case it was added)
        if (!shouldRegenerateScreenshot && eventData.eventLink && originalEvent.eventId) {
          shouldRegenerateScreenshot = true;
        }

        if (shouldRegenerateScreenshot) {
          console.log(`Triggering screenshot regeneration for updated event: ${originalEvent.eventId}`);
          ScreenshotService.generateScreenshot(originalEvent.eventId).catch(error => {
            console.warn(`Screenshot generation failed for event ${originalEvent.eventId}:`, error);
          });
        }
      }

      return { success: true, data: true };
    } catch (error) {
      console.error('Error in updateEvent:', error);
      return { success: false, error: 'Failed to update event' };
    }
  }

  static async deleteEvent(id: string): Promise<EventServiceResponse<boolean>> {
    try {
      // First, get the event to ensure we have the UUID
      const eventResponse = await this.getEventById(id);
      if (!eventResponse.success || !eventResponse.data) {
        return { success: false, error: 'Event not found' };
      }

      const event = eventResponse.data;

      // Use the UUID from the fetched event
      const { error } = await supabase
        .from('events')
        .delete()
        .eq('id', event.id);

      if (error) {
        console.error('Error deleting event:', error);
        return { success: false, error: error.message };
      }

      return { success: true, data: true };
    } catch (error) {
      console.error('Error in deleteEvent:', error);
      return { success: false, error: 'Failed to delete event' };
    }
  }

  static async bulkDeleteEvents(eventIds: string[]): Promise<EventServiceResponse<{ deleted: number; failed: number }>> {
    try {
      let deleted = 0;
      let failed = 0;

      // Delete events one by one and track success/failure
      for (const eventId of eventIds) {
        const result = await this.deleteEvent(eventId);
        if (result.success) {
          deleted++;
        } else {
          failed++;
          console.error(`Failed to delete event ${eventId}:`, result.error);
        }
      }

      return {
        success: true,
        data: { deleted, failed },
        error: failed > 0 ? `${failed} events failed to delete` : undefined
      };
    } catch (error) {
      console.error('Error in bulkDeleteEvents:', error);
      return { success: false, error: 'Failed to bulk delete events' };
    }
  }

  static async bulkImportEvents(events: Event[]): Promise<EventServiceResponse<number>> {
    try {
      let successCount = 0;
      let errorCount = 0;

      for (const event of events) {
        const result = await this.createEvent(event);
        if (result.success) {
          successCount++;
        } else {
          errorCount++;
          console.error(`Failed to import event ${event.eventId}:`, result.error);
        }
      }

      return {
        success: errorCount === 0,
        data: successCount,
        error: errorCount > 0 ? `${errorCount} events failed to import` : undefined,
      };
    } catch (error) {
      console.error('Error in bulkImportEvents:', error);
      return { success: false, error: 'Failed to import events' };
    }
  }
}

// Event ID generation utilities
export class EventIdGenerator {
  static generateRandomEventId(existingIds = new Set<string>()): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id: string;

    do {
      id = '';
      for (let i = 0; i < 6; i++) {
        id += chars[Math.floor(Math.random() * chars.length)];
      }
    } while (existingIds.has(id));

    return id;
  }

  static generateEnhancedRandomEventId(existingIds = new Set<string>()): string {
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    const numbers = '0123456789';
    let id: string;

    do {
      id = '';

      // Add 3-4 random letters
      const letterCount = 3 + Math.floor(Math.random() * 2);
      for (let i = 0; i < letterCount; i++) {
        id += letters[Math.floor(Math.random() * letters.length)];
      }

      // Add remaining characters as numbers
      const remainingChars = 6 - letterCount;
      for (let i = 0; i < remainingChars; i++) {
        id += numbers[Math.floor(Math.random() * numbers.length)];
      }

      // Shuffle the ID to avoid predictable patterns
      id = id.split('').sort(() => Math.random() - 0.5).join('');

    } while (existingIds.has(id));

    return id;
  }

  static async generateUniqueEventId(): Promise<string> {
    // Get existing event IDs
    const { data: events } = await EventService.getAllEvents();
    const existingIds = new Set(events?.map(event => event.eventId) || []);

    return this.generateEnhancedRandomEventId(existingIds);
  }
}

// Screenshot management methods
export class ScreenshotManagementService {
  static async updateScreenshotStatus(eventId: string, generated: boolean, url?: string): Promise<EventServiceResponse<boolean>> {
    try {
      const { data, error } = await supabase.rpc('events_update_screenshot_status', {
        p_event_id: eventId,
        p_screenshot_generated: generated,
        p_screenshot_url: url || null,
        p_screenshot_generated_at: generated ? new Date().toISOString() : null,
      });

      if (error) {
        console.error('Error updating screenshot status:', error);
        return { success: false, error: error.message };
      }

      return { success: true, data };
    } catch (error) {
      console.error('Error in updateScreenshotStatus:', error);
      return { success: false, error: 'Failed to update screenshot status' };
    }
  }

  static async markScreenshotGenerated(eventId: string): Promise<EventServiceResponse<boolean>> {
    const url = `/preview/${eventId}.jpg`;
    return this.updateScreenshotStatus(eventId, true, url);
  }

  static async markScreenshotFailed(eventId: string): Promise<EventServiceResponse<boolean>> {
    return this.updateScreenshotStatus(eventId, false);
  }

  static async bulkUpdateScreenshotStatus(updates: Array<{ eventId: string; generated: boolean; url?: string }>): Promise<EventServiceResponse<number>> {
    try {
      let successCount = 0;
      let errorCount = 0;

      for (const update of updates) {
        const result = await this.updateScreenshotStatus(update.eventId, update.generated, update.url);
        if (result.success) {
          successCount++;
        } else {
          errorCount++;
          console.error(`Failed to update screenshot status for event ${update.eventId}:`, result.error);
        }
      }

      return {
        success: errorCount === 0,
        data: successCount,
        error: errorCount > 0 ? `${errorCount} updates failed` : undefined,
      };
    } catch (error) {
      console.error('Error in bulkUpdateScreenshotStatus:', error);
      return { success: false, error: 'Failed to bulk update screenshot status' };
    }
  }

  /**
   * Generate a check-in QR code for an event
   * Format: EVT-{12 random chars without ambiguous characters}
   * Example: EVT-ABCD3456HJKL
   */
  static async generateCheckinQrCode(eventId: string): Promise<EventServiceResponse<string>> {
    try {
      // Get the event to access its event_id
      const eventResponse = await EventService.getEventById(eventId);
      if (!eventResponse.success || !eventResponse.data) {
        return { success: false, error: 'Event not found' };
      }

      const event = eventResponse.data;

      // Generate QR code using the new QR code generator (12 chars, no ambiguous characters)
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude ambiguous chars (0, O, I, 1)
      let qrCode = 'EVT-';

      for (let i = 0; i < 12; i++) {
        qrCode += chars.charAt(Math.floor(Math.random() * chars.length));
      }

      // Update the event with the QR code - use the UUID from the fetched event
      const { data, error } = await supabase
        .from('events')
        .update({ checkin_qr_code: qrCode })
        .eq('id', event.id)
        .select('checkin_qr_code')
        .single();

      if (error) {
        console.error('Error updating event with QR code:', error);
        return { success: false, error: error.message };
      }

      console.log(`✅ Generated check-in QR code for event ${event.eventId}: ${qrCode}`);
      return { success: true, data: qrCode };
    } catch (error: any) {
      console.error('Error in generateCheckinQrCode:', error);
      return { success: false, error: error.message };
    }
  }
}