import { BaseScraper } from './BaseScraper.js';

/**
 * Scraper for Luma calendar events
 * Handles infinite scrolling and event type detection
 */
export class LumaEventsScraper extends BaseScraper {
  constructor(config, globalConfig) {
    super(config, globalConfig);
    // Set headless mode (false for debugging, true for production)
    this.config.headless = true;
    // Track current calendar being scraped
    this.currentCalendar = null;
  }

  /**
   * Main scraping method
   */
  async scrape() {
    console.log(`🎯 Starting ${this.config.name} scraping...`);

    await this.initialize();
    this.loadProcessedUrls();

    try {
      // Use the base_url from the scraper configuration
      if (this.config.url || this.config.base_url) {
        const calendarUrl = this.config.url || this.config.base_url;
        console.log(`📅 Scraping calendar: ${this.config.name} (${calendarUrl})`);

        // Set current calendar info for normalization
        this.currentCalendar = {
          name: this.config.name,
          url: calendarUrl,
          description: this.config.description || ''
        };

        await this.scrapeCalendarPage(calendarUrl);
      } else {
        console.warn('⚠️ No calendar URL configured for Luma scraper');
      }

      console.log(`✅ Completed Luma events scraping`);

    } catch (error) {
      console.error(`❌ General error in Luma scraping: ${error.message}`);
      this.stats.failed++;
    } finally {
      // Cleanup and finalize
      await this.cleanup();
    }

    // Return the scraped events
    return this.scrapedEvents;
  }


  /**
   * Scrape a Luma calendar page with infinite scrolling
   */
  async scrapeCalendarPage(calendarUrl) {
    console.log(`📄 Starting infinite scroll scraping from: ${calendarUrl}`);

    try {
      // Set user agent and headers to avoid blocking
      await this.page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      await this.page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      });

      // Navigate to the calendar page
      console.log('🌍 Navigating to Luma calendar...');
      await this.page.goto(calendarUrl, {
        waitUntil: 'networkidle2',
        timeout: 60000
      });

      // Wait for the page to load
      await this.page.waitForSelector('body', { timeout: 30000 });
      console.log('✅ Page loaded successfully');

      // Perform infinite scrolling to load all events
      console.log('📜 Starting infinite scroll...');
      await this.performInfiniteScroll();

      // Extract events after scrolling is complete
      console.log('🔍 Extracting events from loaded page...');
      const rawEvents = await this.extractEvents();

      if (!rawEvents || rawEvents.length === 0) {
        console.log('📭 No events found on this calendar');
        return;
      }

      console.log(`🔍 Found ${rawEvents.length} events on calendar`);

      // Process each event
      for (const rawEvent of rawEvents) {
        this.stats.total++;

        // Check if we should skip this event
        if (this.shouldSkipEvent(rawEvent)) {
          console.log(`⏭️ Event already processed: ${rawEvent.name}`);
          continue;
        }

        try {
          // Normalize the event data
          const normalizedEvent = this.normalizeEvent(rawEvent);

          if (normalizedEvent) {
            // Check if event is in the past
            if (this.isPastEvent(normalizedEvent.eventStart, normalizedEvent.eventEnd)) {
              console.log(`⏰ Skipping past event: ${normalizedEvent.eventTitle} (${normalizedEvent.eventStart})`);
              this.stats.skipped++;
              continue;
            }

            this.scrapedEvents.push(normalizedEvent);
            this.processedUrls.add(rawEvent.url);
            this.stats.processed++;
            console.log(`✅ Event processed: ${normalizedEvent.eventTitle}`);
          } else {
            this.stats.failed++;
          }
        } catch (error) {
          console.error(`❌ Error processing event ${rawEvent.name}: ${error.message}`);
          this.stats.failed++;
        }

        // Small delay between events
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      console.log(`✅ Completed calendar scraping`);

    } catch (error) {
      console.error(`❌ Calendar scraping error: ${error.message}`);
      throw error;
    }

    this.printStats();
    return this.scrapedEvents;
  }

  /**
   * Perform infinite scrolling to load all events
   */
  async performInfiniteScroll() {
    console.log('🔄 Starting infinite scroll to load all events...');

    let scrollAttempts = 0;
    const maxScrollAttempts = 50; // Prevent infinite loops
    let lastHeight = 0;
    let stableCount = 0;
    const maxStableCount = 3; // Stop after 3 consecutive stable heights

    while (scrollAttempts < maxScrollAttempts && stableCount < maxStableCount) {
      // Get current scroll height
      const currentHeight = await this.page.evaluate(() => document.body.scrollHeight);

      console.log(`📏 Scroll attempt ${scrollAttempts + 1}: Height ${currentHeight}px`);

      // Scroll to bottom
      await this.page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });

      // Wait for 5 seconds as requested
      console.log('⏳ Waiting 5 seconds for content to load...');
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Check if height changed
      const newHeight = await this.page.evaluate(() => document.body.scrollHeight);

      if (newHeight === lastHeight) {
        stableCount++;
        console.log(`📏 Height stable (${stableCount}/${maxStableCount}): ${newHeight}px`);
      } else {
        stableCount = 0;
        console.log(`📈 Height increased: ${lastHeight}px → ${newHeight}px`);
      }

      lastHeight = newHeight;
      scrollAttempts++;

      // Additional check for load indicators
      try {
        const loadingIndicator = await this.page.$('[data-testid="loading"], .loading, .spinner');
        if (loadingIndicator) {
          console.log('⌛ Loading indicator detected, waiting additional 2 seconds...');
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (error) {
        // Ignore errors when checking for loading indicators
      }
    }

    if (stableCount >= maxStableCount) {
      console.log('✅ Infinite scroll completed - page height stabilized');
    } else {
      console.log('⚠️ Infinite scroll stopped - reached maximum attempts');
    }

    // Final scroll to top to ensure all content is accessible
    await this.page.evaluate(() => window.scrollTo(0, 0));
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  /**
   * Extract detailed event information by clicking on the event
   */
  async extractEventDetails(eventUrl, eventTitle) {
    try {
      console.log(`🔍 Extracting details for: ${eventTitle}`);

      // Method 1: Try to find and click the event element
      const clickResult = await this.page.evaluate((url, title) => {
        // First try to find by exact URL match
        const links = Array.from(document.querySelectorAll('a[href*="lu.ma"]'));
        for (const link of links) {
          if (link.href === url) {
            link.click();
            return { success: true, method: 'url_match' };
          }
        }

        // Method 2: Find by partial URL match (event ID)
        const eventId = url.split('/').pop();
        if (eventId) {
          for (const link of links) {
            if (link.href.includes(eventId)) {
              link.click();
              return { success: true, method: 'id_match' };
            }
          }
        }

        // Method 3: Find clickable element containing event title
        const titleWords = title.split(' ').slice(0, 3).join(' '); // First 3 words
        const allElements = Array.from(document.querySelectorAll('*'));

        for (const element of allElements) {
          if (element.textContent && element.textContent.includes(titleWords)) {
            // Find the closest clickable parent (link or has click handler)
            let clickable = element;
            let depth = 0;
            while (clickable && depth < 5) { // Limit search depth
              if (clickable.tagName === 'A' ||
                  clickable.onclick ||
                  clickable.getAttribute('href') ||
                  clickable.classList.contains('event-card') ||
                  clickable.className.includes('event')) {
                clickable.click();
                return { success: true, method: 'title_parent' };
              }
              clickable = clickable.parentElement;
              depth++;
            }
          }
        }

        return { success: false, method: 'none' };
      }, eventUrl, eventTitle);

      if (!clickResult.success) {
        console.warn(`❌ Could not find clickable element for: ${eventTitle}`);
        return { startTime: '', endTime: '', timezone: '' };
      }

      console.log(`✅ Clicked event using method: ${clickResult.method}`);

      // Wait longer for page content to load and transition
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Check if detail content appeared by looking for Luma-specific content
      let detailContentFound = false;
      for (let i = 0; i < 5; i++) {
        const hasDetailContent = await this.page.evaluate(() => {
          // Look for Luma page-container structure that appears after clicking
          const pageContainer = document.querySelector('.jsx-7dfc4da78ae3d3a6.page-container');
          const eventPanel = document.querySelector('.jsx-beaf8e5edae41bce.event-panel');
          const timeContent = document.querySelector('.jsx-3365490771.desc.text-ellipses');
          const descContent = document.querySelector('[class*="desc"][class*="text-ellipses"]');
          const cardContent = document.querySelector('.jsx-2300524551.top-card-content');

          console.log('Checking for Luma page containers:');
          console.log('- page-container (.jsx-7dfc4da78ae3d3a6):', !!pageContainer);
          console.log('- event-panel (.jsx-beaf8e5edae41bce):', !!eventPanel);
          console.log('- time content (.jsx-3365490771.desc.text-ellipses):', !!timeContent);
          console.log('- desc text-ellipses pattern:', !!descContent);
          console.log('- top-card-content:', !!cardContent);

          return !!(pageContainer || eventPanel || timeContent || descContent || cardContent);
        });

        if (hasDetailContent) {
          detailContentFound = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 800));
      }

      console.log(`Detail content found: ${detailContentFound}`);

      // Extract time information from the current page state
      const timeInfo = await this.page.evaluate(() => {
        // Look specifically for Luma page-container and detail content
        let container = document;
        let containerType = 'document';

        // Priority 1: Look for the event panel structure from user's HTML
        const pageContainer = document.querySelector('.jsx-7dfc4da78ae3d3a6.page-container');
        const eventPanel = document.querySelector('.jsx-beaf8e5edae41bce.event-panel');
        // Priority 2: Look for the exact time content class
        const timeContent = document.querySelector('.jsx-3365490771.desc.text-ellipses');
        // Priority 3: Look for similar desc text-ellipses patterns
        const descContent = document.querySelector('[class*="desc"][class*="text-ellipses"]');
        // Priority 4: Look for top-card-content
        const cardContent = document.querySelector('.jsx-2300524551.top-card-content');

        if (pageContainer) {
          container = pageContainer;
          containerType = 'page-container';
          console.log('Found page-container (.jsx-7dfc4da78ae3d3a6) for time extraction');
        } else if (eventPanel) {
          container = eventPanel;
          containerType = 'event-panel';
          console.log('Found event-panel (.jsx-beaf8e5edae41bce) for time extraction');
        } else if (timeContent) {
          container = timeContent.closest('[class*="jsx-"]') || timeContent.parentElement || timeContent;
          containerType = 'time content element';
          console.log('Found jsx-3365490771 desc text-ellipses container for time extraction');
        } else if (descContent) {
          container = descContent.closest('[class*="jsx-"]') || descContent.parentElement || descContent;
          containerType = 'desc text-ellipses pattern';
          console.log('Found desc text-ellipses pattern container for time extraction');
        } else if (cardContent) {
          container = cardContent;
          containerType = 'top-card-content';
          console.log('Found top-card-content container for time extraction');
        } else {
          console.log('No Luma-specific container found, using document');
        }

        const allText = container.textContent || document.body.textContent || '';
        console.log(`Extracting from ${containerType}: "${allText.substring(0, 300)}..."`);

        // PRIORITIZED patterns for Luma-specific formats (based on user-provided HTML)
        const patterns = [
          // PRIORITY 1: Exact Luma format: "16:30 - 21:30 GMT-4" (24h with GMT-X)
          /(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})\s*(GMT[-+]\d+)/i,
          // PRIORITY 2: Similar format: "16:30 - 21:30 EDT" (24h with timezone abbrev)
          /(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})\s*([A-Z]{2,4})/i,
          // PRIORITY 3: Full format: "Wednesday, October 16 · 6:00 PM - 9:00 PM EDT"
          /(\w+,\s*\w+\s+\d{1,2})\s*·\s*(\d{1,2}:\d{2}\s*[AP]M)\s*[-–—]\s*(\d{1,2}:\d{2}\s*[AP]M)\s*([A-Z]{2,4})/i,
          // PRIORITY 4: Date with time range: "Oct 16 · 6:00 PM - 9:00 PM EDT"
          /(\w+\s+\d{1,2})\s*·\s*(\d{1,2}:\d{2}\s*[AP]M)\s*[-–—]\s*(\d{1,2}:\d{2}\s*[AP]M)\s*([A-Z]{2,4})/i,
          // PRIORITY 5: 12-hour format: "6:00 PM - 9:00 PM EDT"
          /(\d{1,2}:\d{2}\s*[AP]M)\s*[-–—]\s*(\d{1,2}:\d{2}\s*[AP]M)\s*([A-Z]{2,4})/i,
          // PRIORITY 6: Time range without timezone: "6:00 PM - 9:00 PM"
          /(\d{1,2}:\d{2}\s*[AP]M)\s*[-–—]\s*(\d{1,2}:\d{2}\s*[AP]M)/i,
          // PRIORITY 7: Single time with timezone: "6:00 PM EDT"
          /(\d{1,2}:\d{2}\s*[AP]M)\s*([A-Z]{2,4})/i,
          // PRIORITY 8: 24h single time: "18:30 GMT+2"
          /(\d{1,2}:\d{2})\s*(GMT[+-]\d+)/i,
          // PRIORITY 9: Simple time: "6:00 PM" or "18:30" (fallback)
          /(\d{1,2}:\d{2}\s*[AP]M?)/i
        ];

        let startTime = '';
        let endTime = '';
        let timezone = '';

        for (let i = 0; i < patterns.length; i++) {
          const pattern = patterns[i];
          const match = allText.match(pattern);
          if (match) {
            console.log(`Pattern ${i+1} matched: ${pattern.source} -> ${JSON.stringify(match)}`);

            // Handle different pattern types based on priority
            if (i === 0 || i === 1) {
              // PRIORITY 1 & 2: "16:30 - 21:30 GMT-4" format
              startTime = match[1];  // "16:30"
              endTime = match[2];    // "21:30"
              timezone = match[3];   // "GMT-4"
            } else if (pattern.source.includes('[-–—]')) {
              // Time range patterns
              if (pattern.source.includes('\\w+,\\s*\\w+') || pattern.source.includes('\\w+\\s+\\d')) {
                // Full format with date - times are in positions 2,3,4
                startTime = match[2];
                endTime = match[3];
                timezone = match[4] || '';
              } else {
                // Regular time range
                startTime = match[1];
                endTime = match[2];
                timezone = match[3] || '';
              }
            } else {
              // Single time patterns
              startTime = match[1];
              timezone = match[2] || '';
            }

            console.log(`✅ Extracted: start="${startTime}", end="${endTime}", tz="${timezone}"`);
            break;
          }
        }

        return {
          startTime: startTime.trim(),
          endTime: endTime.trim(),
          timezone: timezone.trim(),
          debugText: allText.substring(0, 400) // For debugging
        };
      });

      // Close any open modal/dialog
      await this.page.keyboard.press('Escape');
      await new Promise(resolve => setTimeout(resolve, 500));

      // If that doesn't work, try clicking outside
      if (detailContentFound) {
        try {
          await this.page.click('body', { offset: { x: 10, y: 10 } });
          await new Promise(resolve => setTimeout(resolve, 300));
        } catch (e) {
          // Ignore click errors
        }
      }

      console.log(`🕐 Extracted times: ${timeInfo.startTime || 'none'} - ${timeInfo.endTime || 'none'} ${timeInfo.timezone || ''}`);

      return timeInfo;

    } catch (error) {
      console.warn(`❌ Error extracting details for ${eventTitle}: ${error.message}`);

      // Cleanup: try to close any open modals
      try {
        await this.page.keyboard.press('Escape');
        await new Promise(resolve => setTimeout(resolve, 500));
        await this.page.click('body', { offset: { x: 10, y: 10 } });
      } catch (e) {
        // Ignore cleanup errors
      }

      return { startTime: '', endTime: '', timezone: '', debugText: '' };
    }
  }

  /**
   * Extract events with detailed time information using Next button navigation
   */
  async extractEventsWithNextButton(basicEvents) {
    if (!basicEvents || basicEvents.length === 0) {
      console.log('📭 No basic events to enhance');
      return [];
    }

    console.log(`🎯 Starting direct URL navigation for ${basicEvents.length} events`);
    const enhancedEvents = [];

    try {
      for (let i = 0; i < basicEvents.length; i++) {
        const event = basicEvents[i];
        console.log(`\n📊 Processing event ${i + 1}/${basicEvents.length}: ${event.name}`);

        try {
          // Navigate directly to the event URL
          if (!event.url) {
            console.warn(`⚠️ No URL for event: ${event.name}`);
            enhancedEvents.push(event);
            continue;
          }

          console.log(`🌐 Navigating to: ${event.url}`);
          await this.page.goto(event.url, { waitUntil: 'networkidle0', timeout: 30000 });

          // Wait for page to fully load
          await new Promise(resolve => setTimeout(resolve, 2000));

          // Check current URL
          const currentUrl = this.page.url();
          console.log(`✅ Loaded URL: ${currentUrl}`);

          // Extract time information from event detail page
          const timeDetails = await this.extractTimeFromDetailView();
          console.log(`🕐 Time extraction result:`, timeDetails);

          // Extract coordinates from Google Maps embed (prioritize over text parsing)
          const coordinates = await this.extractCoordinatesFromMap();
          let locationData = null;

          if (coordinates) {
            console.log(`📍 Found coordinates from map: ${coordinates.lat}, ${coordinates.lng}`);

            // Use reverse geocoding to get location details from coordinates
            if (this.geocodingService) {
              try {
                locationData = await this.geocodingService.reverseGeocode(coordinates.lat, coordinates.lng);
                if (locationData) {
                  console.log(`🗺️ Reverse geocoded: ${locationData.city}, ${locationData.countryCode} (${locationData.region})`);
                }
              } catch (error) {
                console.warn(`⚠️ Reverse geocoding failed: ${error.message}`);
              }
            }
          }

          // Get event title from current view
          const currentTitle = await this.page.evaluate(() => {
            // Try multiple selectors for title
            const titleSelectors = [
              'h1.title',
              '.event-title',
              '[class*="title"]',
              'h1',
              '.jsx-2300524551 h1',
              '.jsx-2300524551 .title'
            ];

            let title = '';
            for (const selector of titleSelectors) {
              const element = document.querySelector(selector);
              if (element && element.textContent.trim()) {
                title = element.textContent.trim();
                break;
              }
            }
            return title;
          });

          console.log(`📋 Found title on page: "${currentTitle}"`);

          // Create enhanced event with map-based location data (prioritized)
          const enhancedEvent = {
            ...event,
            startTime: timeDetails.startTime || event.startTime || '',
            endTime: timeDetails.endTime || event.endTime || '',
            timezone: timeDetails.timezone || event.timezone || ''
          };

          // If we have location data from map, use it (prioritize over text-based parsing)
          if (locationData) {
            enhancedEvent.eventCity = locationData.city;
            enhancedEvent.eventCountry = locationData.country;
            enhancedEvent.eventCountryCode = locationData.countryCode;
            enhancedEvent.eventRegion = locationData.region;
            enhancedEvent.eventLocation = `${coordinates.lat},${coordinates.lng}`;
            console.log(`✅ Set location from map: ${locationData.city}, ${locationData.countryCode}`);
          }

          enhancedEvents.push(enhancedEvent);

          if (timeDetails.startTime) {
            console.log(`✅ Enhanced event: ${event.name} - ${timeDetails.startTime}${timeDetails.endTime ? ` to ${timeDetails.endTime}` : ''} ${timeDetails.timezone}`);
          } else {
            console.log(`⚠️ No time extracted for: ${event.name}`);
          }

        } catch (error) {
          console.warn(`❌ Error processing event ${event.name}:`, error.message);
          // Add event without enhancement if there's an error
          enhancedEvents.push(event);
        }

        // Small delay between events
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      console.log(`📊 Processed ${enhancedEvents.length} events via direct URL navigation`);
      return enhancedEvents;

    } catch (error) {
      console.error('❌ Error in direct URL navigation:', error.message);
      console.log('📝 Falling back to basic events');
      return basicEvents;
    }
  }

  /**
   * Extract coordinates from Google Maps embed on the page
   * Returns { lat, lng } or null if not found
   */
  async extractCoordinatesFromMap() {
    try {
      const coordinates = await this.page.evaluate(() => {
        // Look for Google Maps links and iframes
        const mapElements = [
          ...Array.from(document.querySelectorAll('a[href*="google.com/maps"]')),
          ...Array.from(document.querySelectorAll('iframe[src*="google.com/maps"]'))
        ];

        console.log(`Found ${mapElements.length} Google Maps elements`);

        for (const element of mapElements) {
          const url = element.href || element.src;
          if (!url) continue;

          console.log(`Checking map URL: ${url}`);

          // Pattern 1: center=LAT,LNG or center=LAT%2CLNG
          const centerMatch = url.match(/center=([0-9.-]+)[%2C,]+([0-9.-]+)/i);
          if (centerMatch) {
            const lat = parseFloat(centerMatch[1]);
            const lng = parseFloat(centerMatch[2]);
            console.log(`✅ Extracted from center parameter: ${lat}, ${lng}`);
            return { lat, lng };
          }

          // Pattern 2: query=LAT,LNG or query=LAT%2CLNG
          const queryMatch = url.match(/query=([0-9.-]+)[%2C,]+([0-9.-]+)/i);
          if (queryMatch) {
            const lat = parseFloat(queryMatch[1]);
            const lng = parseFloat(queryMatch[2]);
            console.log(`✅ Extracted from query parameter: ${lat}, ${lng}`);
            return { lat, lng };
          }

          // Pattern 3: @LAT,LNG (Google Maps share format)
          const atMatch = url.match(/@([0-9.-]+),([0-9.-]+)/);
          if (atMatch) {
            const lat = parseFloat(atMatch[1]);
            const lng = parseFloat(atMatch[2]);
            console.log(`✅ Extracted from @ format: ${lat}, ${lng}`);
            return { lat, lng };
          }

          // Pattern 4: ll=LAT,LNG
          const llMatch = url.match(/ll=([0-9.-]+),([0-9.-]+)/);
          if (llMatch) {
            const lat = parseFloat(llMatch[1]);
            const lng = parseFloat(llMatch[2]);
            console.log(`✅ Extracted from ll parameter: ${lat}, ${lng}`);
            return { lat, lng };
          }
        }

        console.log('⚠️ No coordinates found in map elements');
        return null;
      });

      return coordinates;

    } catch (error) {
      console.warn(`⚠️ Error extracting coordinates from map: ${error.message}`);
      return null;
    }
  }

  /**
   * Extract time information from the current detail view
   */
  async extractTimeFromDetailView() {
    const result = await this.page.evaluate(() => {
      // Look for page-container structure and time content
      const pageContainer = document.querySelector('.jsx-7dfc4da78ae3d3a6.page-container');
      const eventPanel = document.querySelector('.jsx-beaf8e5edae41bce.event-panel');
      const timeContent = document.querySelector('.jsx-3365490771.desc.text-ellipses');
      const descContent = document.querySelector('[class*="desc"][class*="text-ellipses"]');

      let timeText = '';
      let containerType = 'none';

      // Priority 1: Get text directly from the time content element
      if (timeContent) {
        timeText = timeContent.textContent || '';
        containerType = 'time-content-direct';
      }
      // Priority 2: Look for desc content
      else if (descContent) {
        timeText = descContent.textContent || '';
        containerType = 'desc-content-direct';
      }
      // Priority 3: Look in the event panel
      else if (eventPanel) {
        timeText = eventPanel.textContent || '';
        containerType = 'event-panel';
      }
      // Priority 4: Look in the page container
      else if (pageContainer) {
        timeText = pageContainer.textContent || '';
        containerType = 'page-container';
      }
      // Fallback: full document
      else {
        timeText = document.body.textContent || '';
        containerType = 'document';
      }

      const allText = timeText;

      // Debug info to return to Node.js
      const debugInfo = {
        containerType,
        textPreview: allText.substring(0, 300),
        hasPageContainer: !!pageContainer,
        hasEventPanel: !!eventPanel,
        hasTimeContent: !!timeContent,
        hasDescContent: !!descContent
      };

      // Prioritized patterns for Luma time formats
      const patterns = [
        // Priority 1: "16:30 - 21:30 GMT-4" (exact user format)
        /(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})\s*(GMT[-+]\d+)/i,
        // Priority 2: "10:00 AM - 2:00 PM EDT" (12h with timezone)
        /(\d{1,2}:\d{2}\s*[AP]M)\s*[-–—]\s*(\d{1,2}:\d{2}\s*[AP]M)\s*([A-Z]{3})/i,
        // Priority 3: "16:30 - 21:30 EDT" (24h with timezone)
        /(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})\s*([A-Z]{3})/i,
      ];

      let startTime = '';
      let endTime = '';
      let timezone = '';
      let matchedPattern = null;

      for (let i = 0; i < patterns.length; i++) {
        const pattern = patterns[i];
        const match = allText.match(pattern);
        if (match) {
          matchedPattern = { patternIndex: i + 1, match: match };

          // All patterns have the same capture groups: startTime, endTime, timezone
          startTime = match[1];
          endTime = match[2];
          timezone = match[3];
          break;
        }
      }

      return {
        startTime,
        endTime,
        timezone,
        debugInfo,
        matchedPattern
      };
    });

    // Log debug info at Node.js level
    console.log(`🔍 Container: ${result.debugInfo.containerType}`);
    console.log(`📄 Text preview: "${result.debugInfo.textPreview}..."`);
    console.log(`🏗️ Elements found:`, {
      pageContainer: result.debugInfo.hasPageContainer,
      eventPanel: result.debugInfo.hasEventPanel,
      timeContent: result.debugInfo.hasTimeContent,
      descContent: result.debugInfo.hasDescContent
    });

    if (result.matchedPattern) {
      console.log(`✅ Pattern ${result.matchedPattern.patternIndex} matched:`, result.matchedPattern.match);
    } else {
      console.log(`❌ No time patterns matched`);
    }

    return {
      startTime: result.startTime,
      endTime: result.endTime,
      timezone: result.timezone
    };
  }

  /**
   * Click the Next button to navigate to the next event
   */
  async clickNextButton() {
    try {
      return await this.page.evaluate(() => {
        console.log('🔍 Searching for Next button...');

        // Look for Next button with the exact structure provided by user
        const nextButton = document.querySelector('button[aria-label="Next"].lux-menu-trigger-wrapper.btn.lux-button.flex-center.small.light.solid.variant-color-light.icon-only');

        if (nextButton) {
          console.log('🔄 Found exact Next button, clicking...');
          nextButton.click();
          return true;
        }

        // Try simpler selectors
        const simpleNext = document.querySelector('button[aria-label="Next"]');
        if (simpleNext) {
          console.log('🔄 Found simple Next button, clicking...');
          simpleNext.click();
          return true;
        }

        // Look for any button containing "Next" or with next arrow
        const allButtons = Array.from(document.querySelectorAll('button'));
        console.log(`Found ${allButtons.length} buttons on page`);

        for (const btn of allButtons) {
          const ariaLabel = btn.getAttribute('aria-label');
          const textContent = btn.textContent;
          const innerHTML = btn.innerHTML;

          if (ariaLabel === 'Next' ||
              textContent.includes('Next') ||
              innerHTML.includes('m6 9 6 6 6-6') || // Next arrow SVG path
              innerHTML.includes('next') ||
              ariaLabel === 'next') {
            console.log(`🔄 Found button with aria-label="${ariaLabel}", text="${textContent}"`);
            btn.click();
            return true;
          }
        }

        // Debug: show all buttons with their labels
        console.log('Available buttons:');
        allButtons.slice(0, 10).forEach((btn, i) => {
          const ariaLabel = btn.getAttribute('aria-label');
          const textContent = btn.textContent.trim().substring(0, 50);
          const className = btn.className.substring(0, 100);
          console.log(`  ${i + 1}. aria-label="${ariaLabel}" text="${textContent}" class="${className}"`);
        });

        console.log('🏁 No Next button found');
        return false;
      });
    } catch (error) {
      console.warn('❌ Error clicking Next button:', error.message);
      return false;
    }
  }

  /**
   * Extract events from the current page by processing timeline sections
   */
  async extractEvents() {
    // First get the basic event list to know what events exist
    const basicEvents = await this.page.evaluate(() => {
      const events = [];

      // Process timeline sections first to get proper date associations
      const timelineSections = Array.from(document.querySelectorAll('.jsx-797115727.timeline-section'));
      console.log(`Found ${timelineSections.length} timeline sections`);

      if (timelineSections.length === 0) {
        console.log('No timeline sections found, falling back to simple extraction');
        return []; // Return empty array as fallback
      }

      timelineSections.forEach((section, sectionIndex) => {
        try {
          // Extract the date from the section header
          const dateElement = section.querySelector('.jsx-3191908726.date');
          if (!dateElement) {
            console.log(`No date found in section ${sectionIndex + 1}, skipping`);
            return;
          }

          const sectionDate = dateElement.textContent?.trim() || '';
          console.log(`Processing section ${sectionIndex + 1} with date: "${sectionDate}"`);

          // Find all event links in this section
          const eventElements = section.querySelectorAll('a.event-link.content-link, a[aria-label]');
          console.log(`Found ${eventElements.length} events in section "${sectionDate}"`);

          eventElements.forEach((eventElement, eventIndex) => {
            try {
              // Extract event data - prioritize aria-label for title
              const ariaLabel = eventElement.getAttribute('aria-label');
              const textContent = eventElement.textContent?.trim() || '';
              const title = ariaLabel || textContent || '';

              // Skip if no meaningful title
              if (!title || title.length < 5) {
                console.log(`Skipping event ${eventIndex + 1} in section "${sectionDate}": no meaningful title`);
                return;
              }

              // Get event URL
              let url = '';
              const linkEl = eventElement.tagName === 'A' ? eventElement : eventElement.querySelector('a');
              if (linkEl) {
                url = linkEl.getAttribute('href');
                if (url && !url.startsWith('http')) {
                  url = url.startsWith('/') ? `https://lu.ma${url}` : `https://lu.ma/${url}`;
                }
              }

              if (!url) {
                console.log(`Skipping event ${eventIndex + 1} in section "${sectionDate}": no URL found`);
                return;
              }

              // Extract time information using simplified approach
              let startTime = '';
              let endTime = '';
              let timezone = '';

              // Look for time in the specific Luma time structure
              const timeContainer = eventElement.querySelector('.jsx-1305897383.event-time, .jsx-1305897383');
              if (timeContainer) {
                const timeSpans = timeContainer.querySelectorAll('span.jsx-1305897383');
                const warningSpan = timeContainer.querySelector('.text-warning');

                // First try to get main time
                if (timeSpans.length > 0) {
                  const mainTimeText = timeSpans[0].textContent?.trim() || '';
                  const timeMatch = mainTimeText.match(/(\d{1,2}:\d{2})/);
                  if (timeMatch) {
                    startTime = timeMatch[1];
                    console.log(`Found main time: ${startTime}`);
                  }
                }

                // Then try to get timezone-specific time from warning span
                if (warningSpan) {
                  const warningText = warningSpan.textContent?.trim() || '';
                  const tzTimeMatch = warningText.match(/(\d{1,2}:\d{2})\s*(GMT[+-]\d+)/i);
                  if (tzTimeMatch) {
                    endTime = tzTimeMatch[1]; // Often the localized time
                    timezone = tzTimeMatch[2];
                    console.log(`Found timezone time: ${endTime} ${timezone}`);
                  }
                }
              }

              // Enhanced fallback: search in entire event element for time patterns
              if (!startTime && !endTime) {
                const allText = eventElement.textContent || '';
                console.log(`Searching for time in text: "${allText.substring(0, 200)}..."`);

                const timePatterns = [
                  // Full date and time formats
                  /(\d{1,2}:\d{2}\s*[AP]M)\s*[-–]\s*(\d{1,2}:\d{2}\s*[AP]M)\s*([A-Z]{2,4})/i, // "6:00 PM - 9:00 PM EDT"
                  /(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})\s*(GMT[+-]\d+)/i, // "18:30 - 21:00 GMT+2"
                  /(\d{1,2}:\d{2})\s*·\s*(\d{1,2}:\d{2})\s*(GMT[+-]\d+)/i, // "16:30 · 18:30 GMT+2"
                  /(\d{1,2}:\d{2}\s*[AP]M)\s*([A-Z]{2,4})/i, // "6:00 PM EDT"
                  /(\d{1,2}:\d{2})\s*(GMT[+-]\d+)/i, // "16:30 GMT+2"
                  /(\d{1,2}:\d{2}\s*[AP]M)/i, // "6:00 PM"
                  /(\d{1,2}:\d{2})/i // Simple time "16:30"
                ];

                for (const pattern of timePatterns) {
                  const match = allText.match(pattern);
                  if (match) {
                    if (pattern.source.includes('[-–]')) {
                      // Time range pattern
                      startTime = match[1];
                      endTime = match[2];
                      timezone = match[3] || '';
                      console.log(`Found time range: ${startTime} - ${endTime} ${timezone}`);
                    } else {
                      // Single time pattern
                      startTime = match[1];
                      timezone = match[2] || '';
                      console.log(`Found single time: ${startTime} ${timezone}`);
                    }
                    break;
                  }
                }

                // Try to extract additional context for better time detection
                if (!startTime) {
                  // Look for common time words followed by times
                  const contextPatterns = [
                    /(?:at|from|starts?\s+at)\s*(\d{1,2}:\d{2}(?:\s*[AP]M)?)/i,
                    /(\d{1,2}:\d{2}(?:\s*[AP]M)?)\s*(?:start|begin)/i
                  ];

                  for (const pattern of contextPatterns) {
                    const match = allText.match(pattern);
                    if (match) {
                      startTime = match[1];
                      console.log(`Found contextual time: ${startTime}`);
                      break;
                    }
                  }
                }
              }

              // Extract location information
              let venueAddress = '';
              let locationText = '';

              // Look for location using the Luma SVG structure
              const locationAttributes = eventElement.querySelectorAll('.jsx-2421433570.attribute');
              for (const attr of locationAttributes) {
                const svg = attr.querySelector('svg');
                if (svg) {
                  // Check if it's a location icon by looking for specific path patterns
                  const paths = svg.querySelectorAll('path');
                  const hasLocationPath = Array.from(paths).some(path => {
                    const d = path.getAttribute('d');
                    return d && (d.includes('6.854') || d.includes('8.146') || d.includes('11.02'));
                  });

                  if (hasLocationPath) {
                    const textEl = attr.querySelector('.jsx-e74804ac03b83871.text-ellipses');
                    if (textEl) {
                      const text = textEl.textContent?.trim() || '';
                      if (text && text.length > 3 &&
                          !text.includes('Register to See') &&
                          !text.includes('TBD') &&
                          !text.includes('TBA')) {
                        venueAddress = text;

                        // Determine if it's virtual or physical
                        if (text.toLowerCase().includes('virtual') ||
                            text.toLowerCase().includes('online')) {
                          locationText = 'Virtual';
                        } else {
                          locationText = text;
                        }
                        console.log(`Found location: ${venueAddress}`);
                        break;
                      }
                    }
                  }
                }
              }

              // Create event object with section date
              const eventData = {
                name: title,
                url: url,
                dateText: sectionDate, // Use the section date
                startTime: startTime,
                endTime: endTime,
                timezone: timezone,
                location: locationText,
                venueAddress: venueAddress,
                description: '',
                sectionIndex: sectionIndex,
                eventIndex: eventIndex
              };

              events.push(eventData);
              console.log(`Added event: ${title} on ${sectionDate} at ${startTime || 'no time'}`);

            } catch (error) {
              console.warn(`Error extracting event ${eventIndex + 1} in section ${sectionIndex + 1}:`, error);
            }
          });

        } catch (error) {
          console.warn(`Error processing section ${sectionIndex + 1}:`, error);
        }
      });

      // Remove duplicates based on URL
      const uniqueEvents = [];
      const seenUrls = new Set();

      events.forEach(event => {
        if (event.url && !seenUrls.has(event.url)) {
          seenUrls.add(event.url);
          uniqueEvents.push(event);
        }
      });

      console.log(`Extracted ${uniqueEvents.length} unique events from ${timelineSections.length} sections`);
      return uniqueEvents;
    });

    // Now enhance events with detailed time information using Next button approach
    console.log('🕐 Extracting detailed time information using Next button navigation...');
    const enhancedEvents = await this.extractEventsWithNextButton(basicEvents);

    console.log(`\n✅ Enhanced ${enhancedEvents.length} events with detailed information`);
    return enhancedEvents;
  }

  /**
   * Determine event type based on title and description
   */
  determineEventType(title, description = '') {
    const text = `${title} ${description}`.toLowerCase();

    // Workshop indicators
    const workshopKeywords = [
      'workshop', 'training', 'bootcamp', 'class', 'course', 'tutorial',
      'hands-on', 'learn', 'build', 'create', 'coding', 'programming',
      'lab', 'session', 'masterclass', 'certification', 'academy'
    ];

    // Meetup indicators
    const meetupKeywords = [
      'meetup', 'gathering', 'community', 'networking', 'social',
      'drinks', 'coffee', 'lunch', 'dinner', 'happy hour', 'mixer',
      'chat', 'discussion', 'talk', 'presentation', 'panel',
      'group', 'club', 'society'
    ];

    // Check for workshop keywords
    const hasWorkshopKeywords = workshopKeywords.some(keyword => text.includes(keyword));
    const hasMeetupKeywords = meetupKeywords.some(keyword => text.includes(keyword));

    // Prioritize workshop if both are present (workshops often have networking components)
    if (hasWorkshopKeywords) {
      return 'workshop';
    } else if (hasMeetupKeywords) {
      return 'meetup';
    }

    // Default to meetup if unsure (most Luma events are social gatherings)
    return 'meetup';
  }

  /**
   * Normalize event data for database storage
   */
  normalizeEvent(rawEvent) {
    console.log(`🔍 Normalizing event: "${rawEvent.name}"`);
    console.log(`📅 Raw date data: dateText="${rawEvent.dateText}", startTime="${rawEvent.startTime}", endTime="${rawEvent.endTime}", timezone="${rawEvent.timezone}"`);

    const dateResult = this.parseDateTimeToISO(
      rawEvent.dateText,
      rawEvent.startTime,
      rawEvent.endTime,
      rawEvent.timezone
    );

    // If date parsing failed, return null to skip this event
    if (!dateResult) {
      console.warn(`❌ Date parsing failed for event "${rawEvent.name}" with dateText="${rawEvent.dateText}"`);
      return null;
    }

    console.log(`✅ Parsed dates: eventStart="${dateResult.eventStart}", eventEnd="${dateResult.eventEnd}"`);;

    const { eventStart, eventEnd } = dateResult;
    const scraperName = this.config.config?.name || 'LumaEventsScraper';
    const eventType = this.determineEventType(rawEvent.name, rawEvent.description);

    // Parse location
    let city = '';
    let country = '';
    let region = '';

    if (rawEvent.location) {
      if (rawEvent.location.toLowerCase().includes('online') ||
          rawEvent.location.toLowerCase().includes('virtual') ||
          rawEvent.location.toLowerCase().includes('remote')) {
        city = 'Online';
        region = 'on';
      } else {
        // Try to parse location string
        const parts = rawEvent.location.split(',').map(p => p.trim());
        if (parts.length >= 1) city = parts[0];
        if (parts.length >= 2) {
          // Could be city, state or city, country
          const lastPart = parts[parts.length - 1];
          if (parts.length >= 3) {
            region = parts[1];
            country = lastPart;
          } else {
            country = lastPart;
          }
        }
      }
    }

    const normalized = {
      eventId: this.generateEventId(rawEvent),
      eventStart: eventStart, // Full ISO timestamp from parseDateTimeToISO (e.g., "2026-03-18T16:00:00.000Z")
      eventEnd: eventEnd, // Full ISO timestamp from parseDateTimeToISO
      eventTitle: this.cleanEventTitle(rawEvent.name),
      eventLink: rawEvent.url || '',
      eventCity: city,
      eventCountry: country,
      eventCountryCode: '', // Will be populated by EventProcessor
      eventRegion: region,
      venueAddress: rawEvent.venueAddress || '', // New venue address field
      scrapedBy: this.config.name || 'LumaEventsScraper', // Track which scraper collected this
      eventType: eventType, // 'meetup' or 'workshop'
      eventTopics: [], // To be filled by topic matching
      // New audit fields for scrapers
      scraperName: scraperName,
      scraperRunId: this.generateRunId(),
      source_type: 'scraper',
      source_details: {
        scraper_name: scraperName,
        scraper_type: 'luma',
        calendar_name: this.currentCalendar?.name,
        calendar_url: this.currentCalendar?.url,
        scraped_timestamp: new Date().toISOString(),
        raw_data_hash: this.hashRawData(rawEvent)
      },
      rawData: rawEvent
    };

    // Handle online events
    if (city.toLowerCase() === 'online') {
      normalized.eventCity = 'Online';
      normalized.eventCountryCode = '';
      normalized.eventRegion = 'on';
    }

    // Add description if available
    if (rawEvent.description) {
      normalized.description = rawEvent.description.substring(0, 500);
    }

    return normalized;
  }

  /**
   * Generate a unique event ID based on event data
   */
  generateEventId(rawEvent) {
    // Create a hash from the event URL and title for uniqueness
    const dataString = `${rawEvent.url}_${rawEvent.name}_${rawEvent.dateText}`;
    let hash = 0;
    for (let i = 0; i < dataString.length; i++) {
      const char = dataString.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    // Convert to base36 and take first 6 characters
    const hashStr = Math.abs(hash).toString(36);
    return hashStr.substring(0, 6).padEnd(6, '0');
  }

  /**
   * Clean event title - remove common Luma artifacts
   */
  cleanEventTitle(title) {
    if (!title) return '';

    let cleanTitle = title.trim();

    // Remove common Luma prefixes/suffixes
    cleanTitle = cleanTitle.replace(/^(Event:|Luma:|Calendar:)/i, '');
    cleanTitle = cleanTitle.replace(/\s*-\s*Luma$/i, '');

    // Remove excessive whitespace and newlines
    cleanTitle = cleanTitle.replace(/\s+/g, ' ');
    cleanTitle = cleanTitle.replace(/\n+/g, ' ');

    // Remove leading/trailing special characters
    cleanTitle = cleanTitle.replace(/^[^\w]+|[^\w]+$/g, '');

    return cleanTitle.trim();
  }

  /**
   * Convert time from 12-hour format (e.g., "10:14 PM") to 24-hour format (e.g., "22:14")
   */
  convertTo24HourFormat(timeStr) {
    if (!timeStr) return '00:00';

    // If it's already in 24-hour format, return as-is
    if (!timeStr.match(/[AP]M/i)) {
      return timeStr;
    }

    // Parse 12-hour format
    const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
    if (!timeMatch) {
      console.warn(`Could not parse time: ${timeStr}, using 00:00`);
      return '00:00';
    }

    let hour = parseInt(timeMatch[1]);
    const minute = timeMatch[2];
    const ampm = timeMatch[3].toUpperCase();

    // Convert to 24-hour format
    if (ampm === 'AM' && hour === 12) {
      hour = 0; // 12 AM = 00:xx
    } else if (ampm === 'PM' && hour !== 12) {
      hour += 12; // 1 PM = 13:xx, 2 PM = 14:xx, etc.
    }
    // 12 PM stays as 12:xx

    return `${String(hour).padStart(2, '0')}:${minute}`;
  }

  /**
   * Enhanced date parsing for various Luma date formats with time support
   */
  parseDateTimeToISO(dateStr, startTime = '', endTime = '', detectedTimezone = '') {
    console.log(`🕐 Parsing date: "${dateStr}" with startTime="${startTime}", endTime="${endTime}", timezone="${detectedTimezone}"`);

    if (!dateStr) {
      console.warn(`No date provided, skipping event`);
      return null; // Return null to indicate this event should be skipped
    }

    try {
      let baseDate = null;
      const now = new Date();
      const currentYear = now.getFullYear();
      console.log(`Current year: ${currentYear}, Today: ${now.toISOString().split('T')[0]}`);

      // Handle "today" explicitly
      if (dateStr.toLowerCase() === 'today') {
        console.log('✅ Detected "today", using current date');
        baseDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      }
      // Handle relative dates with timezone info like "30 Sept, 19:00 GMT-4"
      else if (dateStr.includes(',') && dateStr.includes('GMT')) {
        const datePart = dateStr.split(',')[0].trim();
        const lumaMatch = datePart.match(/^(\d{1,2})\s+(\w{3})$/i);
        if (lumaMatch) {
          const day = parseInt(lumaMatch[1]);
          const monthStr = lumaMatch[2];
          const fullDateStr = `${monthStr} ${day}, ${currentYear}`;
          baseDate = new Date(fullDateStr);

          // Check if this date is in the past - if so, assume next year
          if (baseDate < now) {
            baseDate = new Date(`${monthStr} ${day}, ${currentYear + 1}`);
            console.log(`Date was in past, using next year: ${baseDate}`);
          }
        }
      }
      // Handle Luma date formats like "16 Oct", "30 Sept", etc.
      else {
        const lumaDatePattern1 = /^(\d{1,2})\s+(\w{3,4})$/i; // "16 Oct" or "30 Sept"
        const lumaDatePattern2 = /^(\w{3,4})\s+(\d{1,2})$/i; // "Oct 16" or "Sept 30"

        let lumaMatch = dateStr.match(lumaDatePattern1);
        if (lumaMatch) {
          console.log(`✅ Matched pattern 1 (day month): "${dateStr}"`);
          const day = parseInt(lumaMatch[1]);
          const monthStr = lumaMatch[2];
          console.log(`Extracted: day=${day}, month="${monthStr}"`);

          // Create date for this year first
          const fullDateStr = `${monthStr} ${day}, ${currentYear}`;
          baseDate = new Date(fullDateStr);
          console.log(`Parsing "${dateStr}" as "${fullDateStr}" → ${baseDate.toISOString()}`);

          if (isNaN(baseDate.getTime())) {
            throw new Error(`Invalid Luma date format: ${dateStr}`);
          }

          // If the date is in the past (more than 1 day ago), assume it's next year
          const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          if (baseDate < oneDayAgo) {
            baseDate = new Date(`${monthStr} ${day}, ${currentYear + 1}`);
            console.log(`📅 Date was in past, using next year: ${baseDate.toISOString()}`);
          } else {
            console.log(`📅 Date is current/future, using this year: ${baseDate.toISOString()}`);
          }
        } else {
          lumaMatch = dateStr.match(lumaDatePattern2);
          if (lumaMatch) {
            const monthStr = lumaMatch[1];
            const day = parseInt(lumaMatch[2]);

            // Create date for this year first
            const fullDateStr = `${monthStr} ${day}, ${currentYear}`;
            baseDate = new Date(fullDateStr);
            console.log(`Parsing "${dateStr}" as "${fullDateStr}" → ${baseDate}`);

            if (isNaN(baseDate.getTime())) {
              throw new Error(`Invalid Luma date format: ${dateStr}`);
            }

            // If the date is in the past (more than 1 day ago), assume it's next year
            const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            if (baseDate < oneDayAgo) {
              baseDate = new Date(`${monthStr} ${day}, ${currentYear + 1}`);
              console.log(`Date was in past, using next year: ${baseDate}`);
            }
          }
        }
      }

      // Fallback: try other common formats
      if (!baseDate) {
        // Try to parse the date string directly
        baseDate = new Date(dateStr);

        if (isNaN(baseDate.getTime())) {
          // Try some common patterns
          const patterns = [
            /(\w+)\s+(\d{1,2}),?\s+(\d{4})/i, // "December 15, 2024"
            /(\d{1,2})\/(\d{1,2})\/(\d{4})/,   // "12/15/2024"
            /(\d{4})-(\d{1,2})-(\d{1,2})/     // "2024-12-15"
          ];

          for (const pattern of patterns) {
            const match = dateStr.match(pattern);
            if (match) {
              baseDate = new Date(dateStr);
              if (!isNaN(baseDate.getTime())) {
                break;
              }
            }
          }
        }
      }

      if (!baseDate || isNaN(baseDate.getTime())) {
        console.warn(`Could not parse date: "${dateStr}"`);
        return null; // Return null to skip this event
      }

      // Format base date as YYYY-MM-DD
      const year = baseDate.getFullYear();
      const month = String(baseDate.getMonth() + 1).padStart(2, '0');
      const day = String(baseDate.getDate()).padStart(2, '0');
      const dateOnly = `${year}-${month}-${day}`;

      // Get the timezone from scraper configuration, fallback to detected timezone or UTC
      const scraperTimezone = this.config.timezone || detectedTimezone || 'UTC';
      console.log(`Using timezone: ${scraperTimezone}`);

      // Add time information if available
      let eventStart = `${dateOnly}T00:00:00`;
      let eventEnd = `${dateOnly}T23:59:59`;

      if (startTime) {
        const convertedStartTime = this.convertTo24HourFormat(startTime);
        eventStart = `${dateOnly}T${convertedStartTime}:00`;
      }

      if (endTime) {
        const convertedEndTime = this.convertTo24HourFormat(endTime);
        eventEnd = `${dateOnly}T${convertedEndTime}:00`;
      } else if (startTime) {
        // If we have start time but no end time, assume 2-hour duration
        const convertedStartTime = this.convertTo24HourFormat(startTime);
        const timeParts = convertedStartTime.split(':');
        const startHour = parseInt(timeParts[0]);
        const startMinute = parseInt(timeParts[1]);
        const endHour = (startHour + 2) % 24; // Handle wrap-around after midnight
        eventEnd = `${dateOnly}T${String(endHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')}:00`;
      }

      // Convert to UTC if we have a specific timezone
      if (scraperTimezone !== 'UTC') {
        try {
          // Create dates in the scraper's timezone and convert to UTC for storage
          const startInTz = new Date(`${eventStart}${this.getTimezoneOffset(scraperTimezone)}`);
          const endInTz = new Date(`${eventEnd}${this.getTimezoneOffset(scraperTimezone)}`);

          eventStart = startInTz.toISOString();
          eventEnd = endInTz.toISOString();

          console.log(`Converted from ${scraperTimezone} to UTC: ${eventStart} to ${eventEnd}`);
        } catch (error) {
          console.warn(`Timezone conversion failed for ${scraperTimezone}, using original times`);
        }
      }

      console.log(`Parsed Luma date "${dateStr}" with time "${startTime}-${endTime}" (${scraperTimezone}) → ${eventStart} to ${eventEnd}`);

      return {
        eventStart,
        eventEnd
      };

    } catch (error) {
      console.warn(`Date parsing error for "${dateStr}":`, error.message, 'Skipping event.');
      return null; // Return null to indicate this event should be skipped
    }
  }

  /**
   * Backward compatibility method
   */
  parseDateToISO(dateStr) {
    const result = this.parseDateTimeToISO(dateStr);
    return {
      eventStart: result.eventStart.split('T')[0],
      eventEnd: result.eventEnd.split('T')[0]
    };
  }

  /**
   * Generate run ID for tracking
   */
  generateRunId() {
    return `luma_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  /**
   * Convert GMT offset (like GMT+2, GMT-5) to IANA timezone identifier
   */
  convertGMTOffsetToTimezone(gmtOffset) {
    const offsetMappings = {
      'GMT+0': 'UTC',
      'GMT+1': 'Europe/Berlin', // CET
      'GMT+2': 'Europe/Berlin', // CEST (summer time)
      'GMT+3': 'Europe/Moscow',
      'GMT+5': 'Asia/Karachi',
      'GMT+8': 'Asia/Singapore',
      'GMT+9': 'Asia/Tokyo',
      'GMT-5': 'America/New_York', // EST
      'GMT-4': 'America/New_York', // EDT (summer time)
      'GMT-6': 'America/Chicago', // CST
      'GMT-7': 'America/Denver', // MST
      'GMT-8': 'America/Los_Angeles', // PST
      'UTC+0': 'UTC',
      'UTC+1': 'Europe/Berlin',
      'UTC+2': 'Europe/Berlin',
      'UTC-5': 'America/New_York',
      'UTC-8': 'America/Los_Angeles'
    };

    return offsetMappings[gmtOffset] || null;
  }

  /**
   * Get timezone offset string for a given IANA timezone
   */
  getTimezoneOffset(timezone) {
    try {
      // Create a date object and get the timezone offset
      const now = new Date();
      const offsetInMinutes = now.getTimezoneOffset();

      // This is a simplified approach - for production you'd want to use a proper timezone library
      // For now, we'll use common timezone mappings
      const timezoneOffsets = {
        'America/New_York': '-05:00', // EST (adjust for DST as needed)
        'America/Los_Angeles': '-08:00', // PST
        'America/Chicago': '-06:00', // CST
        'America/Denver': '-07:00', // MST
        'Europe/Berlin': '+01:00', // CET
        'Europe/Moscow': '+03:00', // MSK
        'Europe/London': '+00:00', // GMT
        'Asia/Singapore': '+08:00', // SGT
        'Asia/Tokyo': '+09:00', // JST
        'Asia/Karachi': '+05:00', // PKT
        'UTC': '+00:00'
      };

      return timezoneOffsets[timezone] || '+00:00';
    } catch (error) {
      console.warn(`Failed to get timezone offset for ${timezone}:`, error.message);
      return '+00:00';
    }
  }

  /**
   * Hash raw data for deduplication
   */
  hashRawData(rawEvent) {
    const dataString = JSON.stringify(rawEvent);
    let hash = 0;
    for (let i = 0; i < dataString.length; i++) {
      const char = dataString.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }
}