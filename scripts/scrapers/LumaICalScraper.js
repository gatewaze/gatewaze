import ical from 'node-ical';
import { BaseScraper } from './BaseScraper.js';
import { find as findTimezone } from 'geo-tz';

/**
 * Simplified Luma scraper using iCal feeds
 * Much more reliable than HTML scraping - uses Luma's official iCal API
 *
 * Example iCal URL: https://api2.luma.com/ics/get?entity=calendar&id=cal-uwop1v1UeYlgAqe
 */
export class LumaICalScraper extends BaseScraper {
  constructor(config, globalConfig) {
    super(config, globalConfig);
    this.currentCalendar = null;
    // Set headless mode (true for production)
    this.config.headless = true;
    // Delay between page fetches to avoid rate limiting (ms)
    this.pageFetchDelay = 2000;
  }

  /**
   * Unescape iCal text values
   * In iCal format, certain characters are escaped with backslashes:
   * \: -> :  (colon)
   * \; -> ;  (semicolon)
   * \, -> ,  (comma)
   * \\ -> \  (backslash)
   * \n or \N -> newline
   */
  unescapeICalText(text) {
    if (!text) return text;
    return text
      .replace(/\\n/gi, '\n')  // \n or \N -> newline
      .replace(/\\:/g, ':')    // \: -> :
      .replace(/\\;/g, ';')    // \; -> ;
      .replace(/\\,/g, ',')    // \, -> ,
      .replace(/\\\\/g, '\\'); // \\ -> \
  }

  /**
   * Extract iCal URL from the Luma calendar page
   * Clicks on "Add iCal Subscription" and extracts the URL
   */
  async extractICalUrlFromPage(calendarUrl) {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    try {
      console.log(`🔍 Extracting iCal URL from page: ${calendarUrl}`);

      // Navigate to the calendar page
      await this.page.goto(calendarUrl, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      // Wait for page to load
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Click on "Add iCal Subscription" button
      console.log(`🖱️  Clicking "Add iCal Subscription" button...`);

      // Wait for the button to be available
      await this.page.waitForSelector('[aria-label="Add iCal Subscription"]', { timeout: 10000 });

      const icalButton = await this.page.$('[aria-label="Add iCal Subscription"]');

      if (!icalButton) {
        throw new Error('Could not find "Add iCal Subscription" button on page');
      }

      await icalButton.click();

      // Wait for modal to appear and the URL to be available
      console.log(`⏳ Waiting for modal to appear...`);
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Look for the "Copy URL to Clipboard" button and click it to reveal the URL
      console.log(`🔍 Looking for "Copy URL to Clipboard" button...`);
      try {
        const copyButton = await this.page.$('button.btn.lux-button:has-text("Copy URL to Clipboard")');
        if (!copyButton) {
          // Try alternative selector
          const buttons = await this.page.$$('button');
          for (const button of buttons) {
            const text = await button.evaluate(el => el.textContent);
            if (text && text.includes('Copy URL')) {
              console.log(`🖱️  Clicking "Copy URL" button...`);
              await button.click();
              await new Promise(resolve => setTimeout(resolve, 500));
              break;
            }
          }
        } else {
          await copyButton.click();
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (e) {
        console.log(`⚠️  Could not click copy button: ${e.message}`);
      }

      // Extract the iCal URL from the modal
      console.log(`📋 Extracting iCal URL from modal...`);

      // First, let's debug what's in the modal
      const modalDebug = await this.page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input'));
        const buttons = Array.from(document.querySelectorAll('button'));
        const allText = document.body.innerHTML;
        const icsMatches = allText.match(/api2\.luma\.com\/ics\/get\?[^"'\s<>]+/g);
        return {
          inputCount: inputs.length,
          inputValues: inputs.slice(0, 5).map(i => ({ value: i.value?.substring(0, 100), type: i.type })),
          buttonTexts: buttons.slice(0, 10).map(b => b.textContent?.substring(0, 50)),
          icsMatches: icsMatches ? icsMatches.slice(0, 3) : []
        };
      });
      console.log(`🔍 Modal debug:`, JSON.stringify(modalDebug, null, 2));

      const icalUrl = await this.page.evaluate(() => {
        // Try multiple methods to find the iCal URL with the full 'id' parameter

        // Method 1: Search for complete URL with id parameter in HTML
        const bodyText = document.body.innerHTML;

        // Look for https URL with id parameter
        let match = bodyText.match(/https:\/\/api2\.luma\.com\/ics\/get\?entity=calendar&amp;id=cal-[a-zA-Z0-9]+/);
        if (match) {
          return match[0].replace(/&amp;/g, '&');
        }

        // Look for https URL with id parameter (no entity encoding)
        match = bodyText.match(/https:\/\/api2\.luma\.com\/ics\/get\?entity=calendar&id=cal-[a-zA-Z0-9]+/);
        if (match) {
          return match[0];
        }

        // Method 2: Look for webcal protocol
        match = bodyText.match(/webcal:\/\/api2\.luma\.com\/ics\/get\?entity=calendar&amp;id=cal-[a-zA-Z0-9]+/);
        if (match) {
          return match[0].replace('webcal://', 'https://').replace(/&amp;/g, '&');
        }

        match = bodyText.match(/webcal:\/\/api2\.luma\.com\/ics\/get\?entity=calendar&id=cal-[a-zA-Z0-9]+/);
        if (match) {
          return match[0].replace('webcal://', 'https://');
        }

        // Method 3: Look for input field with the URL
        const inputElement = document.querySelector('input[value*="api2.luma.com/ics"]');
        if (inputElement && inputElement.value) {
          return inputElement.value.replace('webcal://', 'https://');
        }

        // Method 4: Look for any input field that contains a URL
        const allInputs = Array.from(document.querySelectorAll('input'));
        for (const input of allInputs) {
          if (input.value && input.value.includes('api2.luma.com/ics')) {
            return input.value.replace('webcal://', 'https://');
          }
        }

        // Method 5: Look in data attributes
        const elementsWithData = Array.from(document.querySelectorAll('[data-url], [data-href], [data-link]'));
        for (const element of elementsWithData) {
          const dataUrl = element.getAttribute('data-url') ||
                         element.getAttribute('data-href') ||
                         element.getAttribute('data-link');
          if (dataUrl && dataUrl.includes('api2.luma.com/ics')) {
            return dataUrl.replace('webcal://', 'https://');
          }
        }

        return null;
      });

      if (icalUrl) {
        console.log(`✅ Found iCal URL: ${icalUrl}`);
        return icalUrl;
      } else {
        // Take a screenshot for debugging
        try {
          const screenshotPath = `/tmp/luma-ical-modal-debug-${Date.now()}.png`;
          await this.page.screenshot({ path: screenshotPath });
          console.log(`📸 Debug screenshot saved to: ${screenshotPath}`);
        } catch (e) {
          // Ignore screenshot errors
        }
        throw new Error('Could not extract iCal URL from modal');
      }

    } catch (error) {
      console.error(`❌ Failed to extract iCal URL: ${error.message}`);
      throw error;
    }
  }

  /**
   * Convert Luma calendar URL to iCal feed URL
   * Input: https://lu.ma/example-calendar
   * Output: https://api2.luma.com/ics/get?entity=calendar&id=cal-uwop1v1UeYlgAqe
   */
  async getICalUrl(calendarUrl) {
    // If already an iCal URL, return as-is
    if (calendarUrl && calendarUrl.includes('api2.luma.com/ics')) {
      return calendarUrl;
    }

    // Extract calendar ID from URL
    // Pattern 1: https://lu.ma/{calendar-name} - we'll need to look this up
    // Pattern 2: Direct calendar ID provided in config
    const icalId = this.config.ical_id || this.config.config?.ical_id;
    if (icalId) {
      return `https://api2.luma.com/ics/get?entity=calendar&id=${icalId}`;
    }

    // Try to extract iCal URL from the calendar page
    console.log(`⚠️  No ical_id in config, attempting to extract from page...`);
    try {
      const icalUrl = await this.extractICalUrlFromPage(calendarUrl);
      return icalUrl;
    } catch (error) {
      throw new Error(`Failed to get iCal URL. Either provide "ical_id" in config or ensure the calendar page has an "Add iCal Subscription" button. Error: ${error.message}`);
    }
  }

  /**
   * Main scraping method
   */
  async scrape() {
    console.log(`🎯 Starting ${this.config.name} iCal scraping...`);

    // Initialize browser for fetching event pages
    await this.initialize();

    try {
      const calendarUrl = this.config.url || this.config.base_url;
      const icalUrl = await this.getICalUrl(calendarUrl);

      console.log(`📅 Fetching iCal feed: ${icalUrl}`);

      // Set current calendar info
      this.currentCalendar = {
        name: this.config.name,
        url: calendarUrl,
        description: this.config.description || ''
      };

      // Fetch and parse iCal feed
      const events = await ical.async.fromURL(icalUrl);
      const parsedEvents = [];
      const seenEventUrls = new Set(); // Track unique event URLs to avoid duplicates
      const MAX_EVENTS = 100; // Reasonable limit to prevent infinite loops
      const MAX_PAST_DAYS = 365; // When past: true, only go back 1 year

      // Get cutoff date for past events when past: true is enabled
      let pastCutoffDate = null;
      if (this.config?.config?.past === true) {
        pastCutoffDate = new Date();
        pastCutoffDate.setDate(pastCutoffDate.getDate() - MAX_PAST_DAYS);
        console.log(`📅 Including past events up to ${MAX_PAST_DAYS} days ago (since ${pastCutoffDate.toISOString().split('T')[0]})`);
      }

      for (const [uid, event] of Object.entries(events)) {
        // Stop if we've reached the maximum number of events
        if (parsedEvents.length >= MAX_EVENTS) {
          console.log(`⚠️ Reached maximum event limit (${MAX_EVENTS}), stopping...`);
          break;
        }

        // Only process VEVENT entries (skip VCALENDAR metadata)
        if (event.type !== 'VEVENT') continue;

        // Convert iCal event dates to ISO strings
        const eventStart = event.start ? event.start.toISOString() : null;
        const eventEnd = event.end ? event.end.toISOString() : null;

        // When past: true, still filter out events older than MAX_PAST_DAYS
        if (this.config?.config?.past === true && eventStart && pastCutoffDate) {
          const startDate = new Date(eventStart);
          if (startDate < pastCutoffDate) {
            console.log(`⏰ Skipping very old event: ${event.summary} (${eventStart} - older than ${MAX_PAST_DAYS} days)`);
            this.stats.skipped++;
            continue;
          }
        }

        // Filter out past events (respects config.past setting)
        if (eventStart && super.isPastEvent(eventStart, eventEnd)) {
          console.log(`⏰ Skipping past event: ${event.summary} (ended ${event.end})`);
          this.stats.skipped++;
          continue;
        }

        try {
          const parsedEvent = await this.parseICalEvent(event);
          if (parsedEvent) {
            // Check for duplicate event URLs
            if (parsedEvent.eventLink && seenEventUrls.has(parsedEvent.eventLink)) {
              console.log(`⏭️ Skipping duplicate event: ${parsedEvent.eventTitle} (URL already processed)`);
              this.stats.skipped++;
              continue;
            }

            // Add to seen URLs set
            if (parsedEvent.eventLink) {
              seenEventUrls.add(parsedEvent.eventLink);
            }

            parsedEvents.push(parsedEvent);
            this.stats.found++;
          }
        } catch (error) {
          console.warn(`⚠️ Failed to parse event ${uid}: ${error.message}`);
          this.stats.failed++;
        }
      }

      console.log(`✅ Found ${parsedEvents.length} future events from iCal feed`);
      console.log(`📊 Stats: ${this.stats.found} found, ${this.stats.skipped} skipped (past events), ${this.stats.failed} failed`);
      this.events = parsedEvents;

    } catch (error) {
      console.error(`❌ Error in Luma iCal scraping: ${error.message}`);
      this.stats.failed++;
      this.events = []; // Return empty array on error
    } finally {
      // Cleanup browser
      await this.cleanup();
    }

    return this.events;
  }

  // Removed isPastEvent method - now using parent's implementation which respects config.past setting

  /**
   * Fetch event page content and extract cover image, description, and __NEXT_DATA__ JSON
   */
  async fetchEventPageData(eventLink) {
    if (!eventLink) {
      console.log(`⚠️ No event link provided`);
      return { coverImageUrl: null, pageContent: '', lumaData: null, lumaPageData: null };
    }

    if (!this.page) {
      console.log(`⚠️ Browser page not initialized`);
      return { coverImageUrl: null, pageContent: '', lumaData: null, lumaPageData: null };
    }

    try {
      console.log(`🌐 Fetching event page: ${eventLink}`);

      // Navigate to event page with retry logic
      let navigationSuccess = false;
      let lastError = null;

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          await this.page.goto(eventLink, {
            waitUntil: 'networkidle2',
            timeout: 30000
          });
          navigationSuccess = true;
          console.log(`✅ Page loaded successfully (attempt ${attempt})`);
          break;
        } catch (navError) {
          lastError = navError;
          console.warn(`⚠️ Navigation attempt ${attempt} failed: ${navError.message}`);
          if (attempt < 2) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
      }

      if (!navigationSuccess) {
        console.error(`❌ Failed to navigate to ${eventLink}: ${lastError?.message}`);
        return { coverImageUrl: null, pageContent: '', lumaData: null };
      }

      // Wait a bit for dynamic content to load
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Extract cover image, page content, virtual event indicator, and __NEXT_DATA__ JSON
      const pageData = await this.page.evaluate(() => {
        // Find cover image using the class 'cover-image'
        const coverImageElement = document.querySelector('.cover-image img');
        let coverImageUrl = null;

        if (coverImageElement) {
          // First, try to get src attribute (usually the main image URL)
          const src = coverImageElement.getAttribute('src');

          if (src) {
            // The src attribute should have the full CDN URL with all parameters
            coverImageUrl = src;
          } else {
            // Fallback to srcset if src is not available
            const srcset = coverImageElement.getAttribute('srcset');
            if (srcset) {
              // Parse srcset - format is "url width, url width, ..."
              const sources = srcset.split(',').map(s => s.trim());
              // Get the first URL (they all point to the same image, just different sizes)
              const firstSource = sources[0];
              coverImageUrl = firstSource.split(' ')[0];
            }
          }
        }

        // Check if event is virtual by looking for "Virtual" text in icon-row elements
        let isVirtual = false;
        const iconRows = document.querySelectorAll('.icon-row');
        for (const row of iconRows) {
          const titleElement = row.querySelector('.title');
          if (titleElement && titleElement.textContent.trim().toLowerCase() === 'virtual') {
            isVirtual = true;
            break;
          }
        }

        // Extract text content for topic matching
        const bodyText = document.body.innerText || '';

        // Extract __NEXT_DATA__ JSON for rich event data
        let lumaData = null;
        let lumaPageData = null; // Full __NEXT_DATA__ JSON for database storage
        const nextDataScript = document.querySelector('script#__NEXT_DATA__');
        if (nextDataScript) {
          try {
            const data = JSON.parse(nextDataScript.textContent);

            // Store the full __NEXT_DATA__ JSON (excluding user data for privacy)
            // We keep props.pageProps which contains the event configuration
            if (data?.props?.pageProps) {
              lumaPageData = {
                buildId: data.buildId,
                pageProps: {
                  ...data.props.pageProps,
                  // Remove initialUserData to avoid storing personal information
                }
              };
              // Also remove initialUserData from nested props if present
              if (data.props.initialUserData) {
                delete lumaPageData.initialUserData;
              }
            }

            const initialData = data?.props?.pageProps?.initialData?.data;
            const eventData = initialData?.event;

            if (eventData) {
              lumaData = {
                lumaEventId: eventData.api_id || initialData.api_id,
                timezone: eventData.timezone,
                coverUrl: eventData.cover_url,
                latitude: eventData.coordinate?.latitude,
                longitude: eventData.coordinate?.longitude,
                city: eventData.geo_address_info?.city,
                country: eventData.geo_address_info?.country,
                countryCode: eventData.geo_address_info?.country_code,
                region: eventData.geo_address_info?.region,
                venueAddress: eventData.geo_address_info?.address,
                fullAddress: eventData.geo_address_info?.full_address,
                shortAddress: eventData.geo_address_info?.short_address,
                locationType: eventData.location_type // 'offline' or 'online'
              };
            }
          } catch (e) {
            console.error('Failed to parse __NEXT_DATA__:', e.message);
          }
        }

        return {
          coverImageUrl,
          pageContent: bodyText.substring(0, 5000), // Limit content length
          isVirtual,
          lumaData,
          lumaPageData // Full page data for database storage
        };
      });

      if (pageData.coverImageUrl) {
        console.log(`✅ Cover image found: ${pageData.coverImageUrl.substring(0, 100)}...`);
      } else {
        console.log(`❌ No cover image found on page`);
      }

      if (pageData.isVirtual) {
        console.log(`🌐 Event detected as virtual`);
      }

      if (pageData.lumaData) {
        console.log(`📊 Extracted __NEXT_DATA__: tz=${pageData.lumaData.timezone}, city=${pageData.lumaData.city}`);
      }

      console.log(`📝 Page content extracted: ${pageData.pageContent.length} chars`);

      return pageData;

    } catch (error) {
      console.error(`❌ Error fetching event page ${eventLink}: ${error.message}`);
      console.error(error.stack);
      return { coverImageUrl: null, pageContent: '', isVirtual: false, lumaData: null, lumaPageData: null };
    }
  }

  /**
   * Parse a single iCal VEVENT into our event format
   */
  async parseICalEvent(event) {
    // Extract event link from description or location
    let eventLink = '';
    if (event.description) {
      // Description format: "Get up-to-date information at: https://luma.com/..."
      const linkMatch = event.description.match(/https:\/\/luma\.com\/[^\s\n]+/);
      if (linkMatch) {
        eventLink = linkMatch[0];
      }
    }

    // Extract Luma event ID from UID (e.g., evt-gOfXjRdvzijnwbt@events.lu.ma -> evt-gOfXjRdvzijnwbt)
    let lumaEventId = null;
    if (event.uid) {
      const eventIdMatch = event.uid.match(/evt-[^@]+/);
      if (eventIdMatch) {
        lumaEventId = eventIdMatch[0];
        // Fallback: construct event link from UID if not found in description
        if (!eventLink) {
          eventLink = `https://luma.com/event/${lumaEventId}`;
        }
      }
    }

    // Extract timezone - Priority: 1) TZID from event, 2) GEO coordinates, 3) Default to UTC
    let eventTimezone = 'UTC'; // Default to UTC

    // First, check if the iCal event has a TZID parameter (from events with explicit timezone)
    if (event.start && event.start.tz && event.start.tz !== 'Etc/UTC') {
      eventTimezone = event.start.tz;
      console.log(`🕐 Timezone from TZID parameter: ${eventTimezone}`);
    }

    // Extract coordinates from GEO field and reverse geocode
    let eventLocation = null;
    let coordinates = null;
    let eventCity = null;
    let eventCountryCode = null;
    let eventCountry = null;
    let eventRegion = null;

    if (event.geo) {
      const { lat, lon } = event.geo;
      eventLocation = `${lat},${lon}`;
      coordinates = { lat, lng: lon };

      console.log(`📍 Event has GEO coordinates: ${lat}, ${lon}`);

      // If we don't have a timezone from TZID, determine it from coordinates
      if (eventTimezone === 'UTC') {
        try {
          const timezones = findTimezone(lat, lon);
          if (timezones && timezones.length > 0) {
            eventTimezone = timezones[0]; // geo-tz returns IANA timezone names
            console.log(`🕐 Timezone detected from coordinates: ${eventTimezone}`);
          }
        } catch (error) {
          console.warn(`⚠️ Timezone lookup failed for ${event.summary}: ${error.message}`);
        }
      } else {
        console.log(`🕐 Using TZID timezone (skipping GEO lookup): ${eventTimezone}`);
      }

      console.log(`🔧 GeocodingService available: ${!!this.geocodingService}`);

      // Use reverse geocoding if GeocodingService is available
      if (this.geocodingService) {
        try {
          console.log(`🌍 Calling reverse geocode for ${lat}, ${lon}...`);
          const locationData = await this.geocodingService.reverseGeocode(lat, lon);
          console.log(`🗺️ Reverse geocode result:`, locationData);

          if (locationData) {
            eventCity = locationData.city;
            eventCountry = locationData.country;
            eventCountryCode = locationData.countryCode;
            eventRegion = locationData.region;
            console.log(`✅ Location data set: city=${eventCity}, country=${eventCountryCode}, region=${eventRegion}`);
          } else {
            console.log(`⚠️ No location data returned from reverse geocoding`);
          }
        } catch (error) {
          console.warn(`⚠️ Reverse geocoding failed for ${event.summary}: ${error.message}`);
        }
      } else {
        console.log(`❌ GeocodingService not available for reverse geocoding`);
      }
    }

    // Format timestamps (use ISO format for PostgreSQL)
    // Note: toISOString() always returns UTC time, regardless of original timezone
    // node-ical automatically converts TZID-based times to UTC when parsing
    const eventStart = event.start ? event.start.toISOString() : null;
    const eventEnd = event.end ? event.end.toISOString() : null;

    // Extract location/city from description if available
    // Description includes: "Address:\nCheck event page for more details."
    // Or actual address like "Ideal Glass Studios 9 W 8th St, New York, NY 10011, USA"
    let venueAddress = null;
    if (event.description) {
      const addressMatch = event.description.match(/Address:\n([^\n]+)/);
      if (addressMatch && !addressMatch[1].includes('Check event page')) {
        venueAddress = addressMatch[1].trim();
      }
    }

    // Fetch event page data (cover image and content for topic matching)
    // Always fetch to get latest cover images and event details
    let coverImageUrl = null;
    let pageContent = '';
    let isVirtual = false;
    let lumaPageData = null; // Full __NEXT_DATA__ JSON for database storage

    if (eventLink) {
      // Add delay between page fetches to avoid rate limiting
      if (this.pageFetchDelay > 0) {
        console.log(`⏳ Waiting ${this.pageFetchDelay}ms before fetching page...`);
        await new Promise(resolve => setTimeout(resolve, this.pageFetchDelay));
      }

      const pageData = await this.fetchEventPageData(eventLink);
      coverImageUrl = pageData.coverImageUrl;
      pageContent = pageData.pageContent;
      isVirtual = pageData.isVirtual || false;
      lumaPageData = pageData.lumaPageData || null; // Store full __NEXT_DATA__ JSON

      // Use __NEXT_DATA__ to fill in missing data from iCal
      const lumaData = pageData.lumaData;
      if (lumaData) {
        // Use Luma event ID from __NEXT_DATA__ if not already set from UID
        if (!lumaEventId && lumaData.lumaEventId) {
          lumaEventId = lumaData.lumaEventId;
          console.log(`📋 Using Luma event ID from __NEXT_DATA__: ${lumaEventId}`);
        }

        // Use timezone from __NEXT_DATA__ if we still have UTC default
        if (eventTimezone === 'UTC' && lumaData.timezone) {
          eventTimezone = lumaData.timezone;
          console.log(`🕐 Using timezone from __NEXT_DATA__: ${eventTimezone}`);
        }

        // Use coordinates from __NEXT_DATA__ if we don't have them from GEO field
        if (!coordinates && lumaData.latitude && lumaData.longitude) {
          coordinates = { lat: lumaData.latitude, lng: lumaData.longitude };
          eventLocation = `${lumaData.latitude},${lumaData.longitude}`;
          console.log(`📍 Using coordinates from __NEXT_DATA__: ${eventLocation}`);
        }

        // Use location data from __NEXT_DATA__ if not already set
        if (!eventCity && lumaData.city) {
          eventCity = lumaData.city;
          console.log(`🏙️ Using city from __NEXT_DATA__: ${eventCity}`);
        }
        if (!eventCountry && lumaData.country) {
          eventCountry = lumaData.country;
          console.log(`🌍 Using country from __NEXT_DATA__: ${eventCountry}`);
        }
        if (!eventCountryCode && lumaData.countryCode) {
          eventCountryCode = lumaData.countryCode;
          console.log(`🏳️ Using country code from __NEXT_DATA__: ${eventCountryCode}`);
        }
        if (!eventRegion && lumaData.region) {
          eventRegion = lumaData.region;
          console.log(`🗺️ Using region from __NEXT_DATA__: ${eventRegion}`);
        }
        if (!venueAddress && lumaData.fullAddress) {
          venueAddress = lumaData.fullAddress;
          console.log(`📫 Using venue address from __NEXT_DATA__: ${venueAddress}`);
        }

        // Use cover image from __NEXT_DATA__ if not found on page
        if (!coverImageUrl && lumaData.coverUrl) {
          coverImageUrl = lumaData.coverUrl;
          console.log(`🖼️ Using cover image from __NEXT_DATA__: ${coverImageUrl}`);
        }

        // Check if event is virtual based on location_type
        if (lumaData.locationType === 'online') {
          isVirtual = true;
        }
      }

      // If event is virtual and no location data was set from GEO coordinates
      if (isVirtual && !eventCity && !eventRegion) {
        console.log(`🌐 Setting virtual event location: city=online, region=on`);
        eventCity = 'online';
        eventRegion = 'on';
      }
    }

    // Unescape iCal text fields (handles \: -> : etc.)
    const eventName = this.unescapeICalText(event.summary) || 'Untitled Event';

    return {
      name: eventName,
      eventTitle: eventName,
      url: eventLink,
      event_link: eventLink,
      eventId: null, // Will be generated by the API with 6-char pattern
      lumaEventId, // Luma event ID (evt-XXX) for registration matching
      sourceEventId: lumaEventId, // Also set as source_event_id for consistency

      // Timestamps in ISO format (already includes timezone)
      eventStart,
      eventEnd,

      // Location data from reverse geocoding or __NEXT_DATA__
      eventLocation,
      eventCity,
      eventCountry,
      eventCountryCode,
      eventRegion,
      venueAddress,
      coordinates,

      // Timezone (IANA format) - from TZID, GEO lookup, or __NEXT_DATA__
      eventTimezone,

      // Detect event type from title
      eventType: this.detectEventType(eventName),

      // Metadata
      scraperName: this.currentCalendar.name,
      scrapedAt: new Date().toISOString(),

      // Description (also unescape iCal text)
      description: this.unescapeICalText(event.description) || '',

      // Organizer info
      organizer: event.organizer ? event.organizer.params?.CN : null,

      // Cover image URL for later processing
      coverImageUrl,

      // Page content for topic matching
      pageContent,

      // Full __NEXT_DATA__ JSON from Luma page (refreshed on each scrape)
      lumaPageData,

      // Account field (from scraper config)
      account: this.config.account || null
    };
  }

  /**
   * Detect event type from title
   * Must return one of: meetup, webinar, workshop, conference
   */
  detectEventType(title) {
    const titleLower = title.toLowerCase();

    // Check for webinar/online patterns
    if (titleLower.includes('webinar') || titleLower.includes('online') || titleLower.includes('virtual')) {
      return 'webinar';
    }

    // Check for workshop patterns
    if (titleLower.includes('workshop') || titleLower.includes('hands-on') || titleLower.includes('masterclass') || titleLower.includes('master class')) {
      return 'workshop';
    }

    // Check for conference patterns
    if (titleLower.includes('conference') || titleLower.includes('summit') || titleLower.includes('expo') || titleLower.includes('days')) {
      return 'conference';
    }

    // Default to meetup (covers meetup, happy hour, gathering, networking, and generic events)
    return 'meetup';
  }

  /**
   * Format Date object to YYYY-MM-DD
   */
  formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Initialize browser for fetching event pages
   */
  async initialize() {
    console.log('📡 Initializing iCal scraper with browser for event page fetching...');
    await super.initialize();
  }

  async cleanup() {
    console.log('✅ iCal scraper cleanup complete');
    await super.cleanup();
  }
}
