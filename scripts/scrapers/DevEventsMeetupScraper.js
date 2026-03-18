import { BaseScraper } from './BaseScraper.js';

/**
 * Scraper for dev.events meetups page
 */
export class DevEventsMeetupScraper extends BaseScraper {
  constructor(config, globalConfig) {
    super(config, globalConfig);
    // Set headless mode (false for debugging, true for production)
    this.config.headless = true;
    // Track current region being scraped
    this.currentRegion = null;
  }

  /**
   * Main scraping method
   */
  async scrape() {
    console.log(`🎯 Starting ${this.config.name} scraping...`);

    await this.initialize();
    this.loadProcessedUrls();

    try {
      // If regions are configured, scrape each region
      if (this.config.config.regions && this.config.config.regions.length > 0) {
        for (const region of this.config.config.regions) {
          await this.scrapeRegion(region);
          // Small delay between regions
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } else {
        // Scrape main meetups page
        await this.scrapePage(this.config.config.baseUrl);
      }

      console.log(`✅ Completed meetups scraping`);

    } catch (error) {
      console.error(`❌ Meetups scraping error: ${error.message}`);
      throw error;
    } finally {
      await this.cleanup();
    }

    this.printStats();
    return this.scrapedEvents;
  }

  /**
   * Scrape a specific region
   */
  async scrapeRegion(region) {
    console.log(`🌍 Scraping region: ${region}`);
    this.currentRegion = region.toLowerCase(); // Store region in lowercase for database
    const regionUrl = `https://dev.events/meetups/${region}`;
    console.log(`🔗 Region URL: ${regionUrl}`);

    try {
      await this.scrapePage(regionUrl);
    } catch (error) {
      console.error(`❌ Error scraping region ${region}: ${error.message}`);
    }
  }

  /**
   * Scrape multiple pages with pagination
   */
  async scrapePage(baseUrl) {
    console.log(`📄 Starting pagination scraping from: ${baseUrl}`);

    await this.page.goto(baseUrl, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // Wait for events to load
    await this.page.waitForSelector('body', { timeout: 30000 });

    // Get total events count for progress tracking
    const totalEventsInfo = await this.page.evaluate(() => {
      const totalText = document.querySelector('body').innerText;
      const match = totalText.match(/(\d+,\d+|\d+) meetups/i) || totalText.match(/(\d+,\d+|\d+) events/i);
      return match ? match[1].replace(',', '') : null;
    });

    const totalEvents = totalEventsInfo ? parseInt(totalEventsInfo) : 500;
    console.log(`📊 Estimated total meetups: ${totalEvents}`);

    let currentPage = 1;
    let hasMorePages = true;
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 3;
    const maxPages = 2; // Testing limit - only process 2 pages

    // Process all available pages (limited for testing)
    while (hasMorePages && consecutiveErrors < maxConsecutiveErrors && currentPage <= maxPages) {
      console.log(`📄 Processing page ${currentPage}... (max ${maxPages} for testing)`);

      try {
        // First page is already loaded, for next pages we need to navigate
        if (currentPage > 1) {
          console.log(`🌐 Navigating to page ${currentPage}...`);

          await this.page.goto(`${baseUrl}?page=${currentPage}`, {
            waitUntil: 'networkidle2',
            timeout: 60000
          });

          // Wait for content to be visible
          await this.page.waitForSelector('body', { timeout: 30000 });
          await new Promise(resolve => setTimeout(resolve, 2000));
        }

        // Extract events from current page
        let pageEvents = [];
        try {
          pageEvents = await this.extractEvents();
          consecutiveErrors = 0; // Reset consecutive errors counter on success
        } catch (extractError) {
          console.error(`❌ Error extracting events: ${extractError.message}`);
          throw extractError;
        }

        if (!pageEvents || pageEvents.length === 0) {
          console.log(`📭 No events found on page ${currentPage}. This might be the last page.`);
          hasMorePages = false;
          continue;
        }

        console.log(`🔍 Found ${pageEvents.length} events on page ${currentPage}`);

        // Process each event on this page
        for (const rawEvent of pageEvents) {
          this.stats.total++;

          if (this.shouldSkipEvent(rawEvent)) {
            continue;
          }

          // Step 1: Extract the dev.events URL from the listing
          const devEventsUrl = rawEvent.url;
          if (!devEventsUrl || !devEventsUrl.includes('dev.events')) {
            console.log(`⚠️ Skipping event without valid dev.events URL: ${rawEvent.name}`);
            this.stats.failed++;
            continue;
          }

          // Preserve the original dev.events URL for ID extraction later
          rawEvent.devEventsUrl = devEventsUrl;

          // Step 2: Visit the individual event page to get the actual "Visit" link and cover image
          const { url: actualEventUrl, coverImageUrl, lumaData, meetupData } = await this.extractActualEventUrl(devEventsUrl);
          if (!actualEventUrl) {
            console.log(`⚠️ Could not find actual event URL for: ${rawEvent.name}`);
            this.stats.failed++;
            continue;
          }

          // Use the actual event URL instead of the dev.events URL
          rawEvent.url = actualEventUrl;

          // Store the cover image URL if found
          if (coverImageUrl) {
            rawEvent.coverImageUrl = coverImageUrl;
          }

          // Store Luma data if extracted
          if (lumaData) {
            rawEvent.lumaData = lumaData;
          }

          // Store Meetup data if extracted
          if (meetupData) {
            rawEvent.meetupData = meetupData;
          }

          // Safety check: Skip if we still have a dev.events URL (extraction failed)
          if (rawEvent.url && rawEvent.url.includes('dev.events')) {
            console.log(`🚫 Skipping dev.events URL (extraction failed): ${rawEvent.name} - ${rawEvent.url}`);
            this.stats.failed++;
            continue;
          }

          // Validate the actual URL if enabled
          if (rawEvent.url && !(await this.validateUrl(rawEvent.url))) {
            continue;
          }

          // Normalize event data
          const normalizedEvent = this.normalizeEvent(rawEvent);

          // Check if event is in the past
          if (this.isPastEvent(normalizedEvent.eventStart, normalizedEvent.eventEnd)) {
            console.log(`⏰ Skipping past event: ${normalizedEvent.eventTitle} (${normalizedEvent.eventStart})`);
            this.stats.skipped++;
            continue;
          }

          // Filter out promotional/advertising events
          if (this.isPromotionalEvent(normalizedEvent)) {
            console.log(`🚫 Skipping promotional event: ${normalizedEvent.eventTitle}`);
            continue;
          }

          if (normalizedEvent.eventTitle && normalizedEvent.eventLink) {
            this.scrapedEvents.push(normalizedEvent);
            this.processedUrls.add(normalizedEvent.eventLink);
            this.stats.processed++;
          } else {
            this.stats.failed++;
          }
        }

        // For testing, stop after maxPages
        if (currentPage >= maxPages) {
          console.log(`🛑 Reached testing limit of ${maxPages} pages`);
          hasMorePages = false;
        } else {
          // Check if there might be more pages (simple heuristic)
          const hasNextPageElements = await this.page.evaluate(() => {
            // Look for pagination indicators
            const nextButtons = document.querySelectorAll('a, button');
            return Array.from(nextButtons).some(el =>
              el.textContent.toLowerCase().includes('next') ||
              el.textContent.toLowerCase().includes('more')
            );
          });

          if (!hasNextPageElements) {
            console.log(`📭 No pagination indicators found, assuming last page`);
            hasMorePages = false;
          }
        }

        currentPage++;

      } catch (error) {
        consecutiveErrors++;
        console.error(`❌ Error on page ${currentPage}: ${error.message}`);

        if (consecutiveErrors >= maxConsecutiveErrors) {
          console.error(`❌ Too many consecutive errors (${consecutiveErrors}), stopping pagination`);
          hasMorePages = false;
        } else {
          console.log(`⏳ Retrying page ${currentPage} in 3 seconds...`);
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
    }

    console.log(`✅ Completed pagination. Processed ${currentPage - 1} pages.`);
  }

  /**
   * Extract rich event data from Luma event pages using __NEXT_DATA__ JSON
   * Returns detailed event info including coordinates, timezone, location data
   * Also returns the full __NEXT_DATA__ JSON for database storage
   */
  async extractLumaEventData(eventPage) {
    try {
      const lumaData = await eventPage.evaluate(() => {
        const nextDataScript = document.querySelector('script#__NEXT_DATA__');
        if (!nextDataScript) return null;

        try {
          const data = JSON.parse(nextDataScript.textContent);

          // Store the full __NEXT_DATA__ JSON (excluding user data for privacy)
          // We keep props.pageProps which contains the event configuration
          let lumaPageData = null;
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

          if (!eventData) return { lumaPageData };

          return {
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
            locationType: eventData.location_type, // 'offline' or 'online'
            // Full page data for database storage
            lumaPageData
          };
        } catch (e) {
          console.error('Failed to parse __NEXT_DATA__:', e.message);
          return null;
        }
      });

      if (lumaData) {
        console.log(`📊 Extracted Luma data: id=${lumaData.lumaEventId}, tz=${lumaData.timezone}, city=${lumaData.city}`);
        if (lumaData.lumaPageData) {
          console.log(`📄 Captured full Luma __NEXT_DATA__ for database storage`);
        }
      }

      return lumaData;
    } catch (error) {
      console.error(`❌ Error extracting Luma event data: ${error.message}`);
      return null;
    }
  }

  /**
   * Extract rich event data from Meetup.com event pages using __NEXT_DATA__ JSON
   * Returns the full __NEXT_DATA__ JSON for database storage
   */
  async extractMeetupEventData(eventPage) {
    try {
      const meetupData = await eventPage.evaluate(() => {
        const nextDataScript = document.querySelector('script#__NEXT_DATA__');
        if (!nextDataScript) return null;

        try {
          const data = JSON.parse(nextDataScript.textContent);

          // Store the full __NEXT_DATA__ JSON (excluding sensitive user data)
          // We keep props.pageProps which contains the event configuration
          let meetupPageData = null;
          if (data?.props?.pageProps) {
            meetupPageData = {
              buildId: data.buildId,
              pageProps: { ...data.props.pageProps }
            };
          }

          // Extract useful fields for the event record
          const eventData = data?.props?.pageProps?.event || data?.props?.pageProps;

          // Try to extract location info from various possible structures
          const venue = eventData?.venue || eventData?.event?.venue;
          const group = eventData?.group || eventData?.event?.group;

          const extractedData = {
            meetupEventId: eventData?.id || eventData?.event?.id,
            title: eventData?.title || eventData?.event?.title,
            description: eventData?.description || eventData?.event?.description,
            timezone: eventData?.timezone || group?.timezone,
            // Venue info
            venueName: venue?.name,
            venueAddress: venue?.address,
            city: venue?.city,
            state: venue?.state,
            country: venue?.country,
            latitude: venue?.lat,
            longitude: venue?.lon,
            // Group info
            groupName: group?.name,
            groupUrlname: group?.urlname,
            // Full page data for database storage
            meetupPageData
          };

          return extractedData;
        } catch (e) {
          console.error('Failed to parse Meetup __NEXT_DATA__:', e.message);
          return null;
        }
      });

      if (meetupData) {
        console.log(`📊 Extracted Meetup data: id=${meetupData.meetupEventId}, city=${meetupData.city}, group=${meetupData.groupName}`);
      }

      return meetupData;
    } catch (error) {
      console.error(`❌ Error extracting Meetup event data: ${error.message}`);
      return null;
    }
  }

  /**
   * Extract the actual event URL and cover image from a dev.events event page
   * Returns an object with { url, coverImageUrl }
   */
  async extractActualEventUrl(devEventsUrl) {
    try {
      console.log(`🔗 Extracting actual URL and cover image from: ${devEventsUrl}`);

      // Create a new page for this individual event to avoid interfering with main scraping
      const eventPage = await this.browser.newPage();

      try {
        await eventPage.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        await eventPage.goto(devEventsUrl, {
          waitUntil: 'networkidle2',
          timeout: 30000
        });

        // Wait a bit for the page to fully load
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Extract both the actual event URL and cover image
        const { actualUrl, coverImageUrl } = await eventPage.evaluate(() => {
          // First, try to extract cover image from the dev.events page
          let coverImageUrl = null;

          // Look for event images in common locations
          const imageSelectors = [
            'meta[property="og:image"]', // Open Graph image
            'meta[name="twitter:image"]', // Twitter card image
            'img[class*="event"][class*="image"]',
            'img[class*="cover"]',
            'img[class*="hero"]',
            'img[class*="banner"]',
            '.event-image img',
            '.event-header img',
            '.hero img',
            'article img:first-of-type',
            '.content img:first-of-type'
          ];

          for (const selector of imageSelectors) {
            const element = document.querySelector(selector);
            if (element) {
              const src = element.getAttribute('content') || element.getAttribute('src');
              if (src && (src.startsWith('http') || src.startsWith('//'))) {
                coverImageUrl = src.startsWith('//') ? `https:${src}` : src;
                console.log('Found cover image:', coverImageUrl);
                break;
              }
            }
          }

          // Now extract the actual event URL
          let actualUrl = null;
          // Priority 1: Check for iframe with meetup or event URL
          const iframes = Array.from(document.querySelectorAll('iframe'));
          for (const iframe of iframes) {
            const src = iframe.getAttribute('src');
            if (src && (src.includes('meetup.com') || src.includes('eventbrite.com') ||
                       src.includes('tickets.') || src.includes('register'))) {
              console.log('Found iframe URL:', src);
              actualUrl = src;
              return { actualUrl, coverImageUrl };
            }
          }

          // Priority 2: Look for links with "Visit" text (case insensitive)
          const visitLinks = Array.from(document.querySelectorAll('a'))
            .filter(link => {
              const text = link.textContent.trim().toLowerCase();
              return text === 'visit' || text.includes('visit');
            });

          // Priority order: exact "visit" text, then contains visit
          for (const link of visitLinks) {
            const href = link.getAttribute('href');
            if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
              // Make sure it's not a dev.events link
              if (!href.includes('dev.events')) {
                console.log('Found visit link URL:', href);
                actualUrl = href;
                return { actualUrl, coverImageUrl };
              }
            }
          }

          // Priority 3: Look for common event platform links
          const eventPlatformLinks = Array.from(document.querySelectorAll('a[href^="http"]'))
            .filter(link => {
              const href = link.getAttribute('href');
              return href && (
                href.includes('meetup.com') ||
                href.includes('eventbrite.com') ||
                href.includes('tickets.') ||
                href.includes('register') ||
                href.includes('event')
              ) && !href.includes('dev.events');
            });

          if (eventPlatformLinks.length > 0) {
            actualUrl = eventPlatformLinks[0].getAttribute('href');
            console.log('Found event platform URL:', actualUrl);
            return { actualUrl, coverImageUrl };
          }

          // Fallback: look for external links that might be the event URL
          const externalLinks = Array.from(document.querySelectorAll('a[href^="http"]'))
            .filter(link => {
              const href = link.getAttribute('href');
              return href &&
                     !href.includes('dev.events') &&
                     !href.includes('twitter.com') &&
                     !href.includes('linkedin.com') &&
                     !href.includes('facebook.com') &&
                     !href.includes('instagram.com');
            });

          if (externalLinks.length > 0) {
            actualUrl = externalLinks[0].getAttribute('href');
            console.log('Found fallback external URL:', actualUrl);
            return { actualUrl, coverImageUrl };
          }

          return { actualUrl: null, coverImageUrl };
        });

        // If the actual URL is a Luma event, navigate to it to extract rich data
        let lumaData = null;
        let meetupData = null;

        if (actualUrl && (actualUrl.includes('lu.ma') || actualUrl.includes('luma.com'))) {
          console.log(`🔗 Detected Luma event URL, extracting rich data...`);
          try {
            await eventPage.goto(actualUrl, {
              waitUntil: 'networkidle2',
              timeout: 30000
            });
            await new Promise(resolve => setTimeout(resolve, 2000));
            lumaData = await this.extractLumaEventData(eventPage);

            // Use Luma cover image if we didn't find one on dev.events
            if (!coverImageUrl && lumaData?.coverUrl) {
              coverImageUrl = lumaData.coverUrl;
              console.log(`🖼️ Using cover image from Luma: ${coverImageUrl}`);
            }
          } catch (lumaError) {
            console.warn(`⚠️ Failed to fetch Luma event data: ${lumaError.message}`);
          }
        }

        // If the actual URL is a Meetup event, navigate to it to extract rich data
        if (actualUrl && actualUrl.includes('meetup.com')) {
          console.log(`🔗 Detected Meetup.com event URL, extracting rich data...`);
          try {
            await eventPage.goto(actualUrl, {
              waitUntil: 'networkidle2',
              timeout: 30000
            });
            await new Promise(resolve => setTimeout(resolve, 2000));
            meetupData = await this.extractMeetupEventData(eventPage);
          } catch (meetupError) {
            console.warn(`⚠️ Failed to fetch Meetup event data: ${meetupError.message}`);
          }
        }

        await eventPage.close();

        if (actualUrl) {
          console.log(`✅ Found actual URL: ${actualUrl}`);
          if (coverImageUrl) {
            console.log(`✅ Found cover image: ${coverImageUrl}`);
          }
          return { url: actualUrl, coverImageUrl, lumaData, meetupData };
        } else {
          console.log(`❌ No actual URL found for: ${devEventsUrl}`);
          if (coverImageUrl) {
            console.log(`✅ Found cover image (but no URL): ${coverImageUrl}`);
          }
          return { url: null, coverImageUrl, lumaData: null, meetupData: null };
        }

      } catch (error) {
        await eventPage.close();
        console.error(`❌ Error extracting URL from ${devEventsUrl}: ${error.message}`);
        return { url: null, coverImageUrl: null, lumaData: null, meetupData: null };
      }

    } catch (error) {
      console.error(`❌ Failed to create page for URL extraction: ${error.message}`);
      return { url: null, coverImageUrl: null, lumaData: null, meetupData: null };
    }
  }

  /**
   * Extract events from meetups page using JSON-LD and CSS selectors
   */
  async extractEvents() {
    return await this.page.evaluate(() => {
      const events = [];

      // First, try to extract from JSON-LD structured data
      const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');

      jsonLdScripts.forEach(script => {
        try {
          const data = JSON.parse(script.textContent);

          // Handle single event or array of events
          const eventData = Array.isArray(data) ? data : [data];

          eventData.forEach(item => {
            if (item['@type'] === 'EducationEvent' || item['@type'] === 'Event') {
              // Extract venue address from JSON-LD
              let venueAddress = '';
              if (item.location) {
                // Try to get full address
                if (item.location.address?.streetAddress) {
                  venueAddress = item.location.address.streetAddress;
                  if (item.location.address.addressLocality) {
                    venueAddress += `, ${item.location.address.addressLocality}`;
                  }
                } else if (item.location.name) {
                  venueAddress = item.location.name;
                }
              }

              const event = {
                name: item.name,
                url: item.url,
                dateText: item.startDate,
                endDate: item.endDate,
                city: item.location?.address?.addressLocality || '',
                country: item.location?.address?.addressCountry || '',
                region: item.location?.address?.addressRegion || '',
                venueAddress: venueAddress,
                description: item.description || '',
                organizer: item.organizer?.name || ''
              };

              events.push(event);
            }
          });
        } catch (error) {
          console.warn('Failed to parse JSON-LD:', error);
        }
      });

      // If JSON-LD didn't yield results, fall back to CSS selectors specific to meetups
      if (events.length === 0) {
        const eventElements = document.querySelectorAll('#meetups [data-type="EducationEvent"], .meetup-event, #meetups .event-item');

        eventElements.forEach(element => {
          const nameEl = element.querySelector('.name, .event-name, .title') ||
                        element.querySelector('a[href*="meetup"], a[href*="event"]');
          const urlEl = element.querySelector('a[href*="http"]') || nameEl;
          const dateEl = element.querySelector('.startDate, .event-date, time');
          const locationEl = element.querySelector('.location, .event-location');

          if (nameEl && urlEl) {
            const name = nameEl.textContent?.trim() || '';
            const url = urlEl.getAttribute('href') || '';
            const dateText = dateEl?.textContent?.trim() || dateEl?.getAttribute('datetime') || '';
            const locationText = locationEl?.textContent?.trim() || '';

            // Extract venue address
            let venueAddress = '';
            const venueEl = element.querySelector('.venue, .address, .location-details');
            if (venueEl) {
              venueAddress = venueEl.textContent?.trim() || '';
            }

            // Parse location
            let city = '';
            let country = '';
            let region = '';

            if (locationText.toLowerCase().includes('online')) {
              city = 'Online';
              region = 'Online';
            } else if (locationText) {
              const parts = locationText.split(',').map(p => p.trim());
              if (parts.length >= 1) city = parts[0];
              if (parts.length >= 2) region = parts[1];
              if (parts.length >= 3) country = parts[2];
            }

            events.push({
              name,
              url: url.startsWith('http') ? url : `https://dev.events${url}`,
              dateText,
              city,
              country,
              region,
              venueAddress
            });
          }
        });
      }

      // Additional scraping for dev.events specific structure - target meetups section specifically
      const devEventsRows = document.querySelectorAll('#meetups .row.columns.is-mobile, .meetup-row');

      devEventsRows.forEach(row => {
        const titleEl = row.querySelector('.title a, .event-title a');
        const subtitleEl = row.querySelector('.subtitle, .event-subtitle');
        const timeEl = row.querySelector('time');

        if (titleEl) {
          const name = titleEl.textContent?.trim() || '';
          const href = titleEl.getAttribute('href') || '';
          const url = href.startsWith('http') ? href : `https://dev.events${href}`;
          const dateText = timeEl?.textContent?.trim() || '';
          const subtitleText = subtitleEl?.textContent || '';

          // Extract venue address from description or subtitle
          let venueAddress = '';
          const fullText = subtitleText;
          const venuePatterns = [
            /at\s+([^,\n]+(?:Center|Centre|Hall|Hotel|Convention|Conference|Building|Arena|Stadium|Theatre|Theater|Campus|University|College|Academy|Institute|Pavilion|Complex)[^,\n]*)/i,
            /venue:\s*([^,\n]+)/i,
            /location:\s*([^,\n]+)/i,
            /address:\s*([^,\n]+)/i,
            /held at\s+([^,\n]+)/i
          ];

          for (const pattern of venuePatterns) {
            const match = fullText.match(pattern);
            if (match && match[1] && match[1].trim().length > 5) {
              venueAddress = match[1].trim().replace(/\s+/g, ' ');
              break;
            }
          }

          // Extract location from subtitle
          let city = '';
          let country = '';
          let region = '';

          if (subtitleText.toLowerCase().includes('online')) {
            city = 'Online';
            region = 'Online';
          } else {
            // Try to extract location from links in subtitle
            const locationLinks = Array.from(row.querySelectorAll('.subtitle a'));
            const locationTexts = locationLinks
              .filter(a => {
                const href = a.getAttribute('href') || '';
                return href.includes('/') && !href.startsWith('/#');
              })
              .map(a => a.textContent.trim())
              .filter(text => text.length > 1);

            if (locationTexts.length > 0) {
              city = locationTexts[0] || '';
              if (locationTexts.length > 1) {
                // Try to determine country vs region
                const lastItem = locationTexts[locationTexts.length - 1];
                const secondLast = locationTexts[locationTexts.length - 2];

                // If we have 3+ items, likely: City, State/Region, Country
                if (locationTexts.length >= 3) {
                  region = secondLast;
                  country = lastItem;
                } else {
                  // If we have 2 items, likely: City, Country
                  country = lastItem;
                }
              }
            }
          }

          if (name && url) {
            events.push({
              name,
              url,
              dateText,
              city,
              country,
              region,
              venueAddress
            });
          }
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

      return uniqueEvents;
    });
  }

  /**
   * Enhanced date parsing for meetup events
   */
  parseDateToISO(dateStr) {
    if (!dateStr) {
      return super.parseDateToISO(dateStr);
    }

    try {
      // Handle ISO date format (from JSON-LD)
      if (dateStr.includes('T') || dateStr.includes('-')) {
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) {
          const isoDate = date.toISOString().split('T')[0];
          return {
            eventStart: isoDate,
            eventEnd: isoDate
          };
        }
      }

      // Handle relative dates like "Next Tuesday", "This Friday"
      if (dateStr.toLowerCase().includes('next') || dateStr.toLowerCase().includes('this')) {
        const today = new Date();
        const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

        return {
          eventStart: nextWeek.toISOString().split('T')[0],
          eventEnd: nextWeek.toISOString().split('T')[0]
        };
      }

      // Handle recurring events like "Every Monday"
      if (dateStr.toLowerCase().includes('every')) {
        const today = new Date();
        const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);

        return {
          eventStart: today.toISOString().split('T')[0],
          eventEnd: nextMonth.toISOString().split('T')[0]
        };
      }

      // Fallback to parent implementation
      return super.parseDateToISO(dateStr);

    } catch (error) {
      console.warn(`Meetup date parsing failed for "${dateStr}": ${error.message}`);
      return super.parseDateToISO(dateStr);
    }
  }

  /**
   * Generate unique event ID
   */
  generateEventId(rawEvent) {
    const title = (rawEvent.name || rawEvent.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const url = rawEvent.url || '';
    let hash = 0;
    const source = url || title;
    for (let i = 0; i < source.length; i++) {
      const char = source.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    const hashStr = Math.abs(hash).toString().slice(-4).padStart(4, '0');
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    const chars = letters[Math.floor(Math.random() * letters.length)] +
                  letters[Math.floor(Math.random() * letters.length)];
    return chars + hashStr;
  }

  /**
   * Generate unique scraper run ID
   */
  generateRunId() {
    return `meetup_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Check if an event is promotional/advertising content that should be filtered out
   */
  isPromotionalEvent(event) {
    // Common promotional domains and patterns
    const promotionalDomains = [
      'principal.dev',
      'clean-code-developer.com',
      'masterclass.com',
      'coursera.org',
      'udemy.com',
      'pluralsight.com',
      'linkedin.com/learning'
    ];

    // Common promotional keywords in titles
    const promotionalKeywords = [
      'masterclass',
      'course',
      'training',
      'certification',
      'learn',
      'tutorial',
      'bootcamp'
    ];

    if (!event.eventLink) return false;

    try {
      const url = new URL(event.eventLink);

      // Check for promotional domains
      if (promotionalDomains.some(domain => url.hostname.includes(domain))) {
        return true;
      }

      // Check for promotional keywords in titles (case insensitive)
      const title = (event.eventTitle || '').toLowerCase();
      if (promotionalKeywords.some(keyword => title.includes(keyword))) {
        // Additional check: if it's a masterclass or course AND has promotional domain patterns
        if (url.hostname.length < 15 && !url.hostname.includes('conf') && !url.hostname.includes('summit')) {
          return true;
        }
      }

      // Check for very short domain names (often promotional)
      if (url.hostname.split('.').length === 2 && url.hostname.length < 12 &&
          !url.hostname.includes('conf') && !url.hostname.includes('dev') &&
          !url.hostname.includes('tech') && !url.pathname.includes('events')) {
        return true;
      }

    } catch (e) {
      // If URL parsing fails, it might be malformed promotional content
      return true;
    }

    return false;
  }

  /**
   * Extract the dev.events ID from a dev.events URL
   * URLs are like: https://dev.events/conferences/code-mash-2026-eguzf-gg
   * The ID is the last segment after the final hyphen: "eguzf-gg"
   */
  extractDevEventsId(url) {
    if (!url || !url.includes('dev.events')) return null;

    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/').filter(p => p);

      if (pathParts.length >= 2) {
        // The last path segment contains the event slug with ID
        // e.g., "code-mash-2026-eguzf-gg" -> ID is "eguzf-gg"
        const lastSegment = pathParts[pathParts.length - 1];

        // Match the ID pattern at the end: alphanumeric characters possibly with hyphens
        // Pattern: last 6-12 chars that look like an ID (letters, numbers, hyphens)
        const match = lastSegment.match(/-([a-z0-9]{4,12})$/i);
        if (match) {
          return match[1];
        }
      }
    } catch (e) {
      console.warn(`Failed to extract dev.events ID from ${url}: ${e.message}`);
    }

    return null;
  }

  /**
   * Normalize meetup event data
   */
  normalizeEvent(rawEvent) {
    const { eventStart, eventEnd } = this.parseDateToISO(rawEvent.dateText || rawEvent.date);
    const scraperName = this.config.config?.name || 'DevEventsMeetupScraper';

    // Extract the dev.events ID from the original dev.events URL (stored in devEventsUrl)
    const sourceEventId = this.extractDevEventsId(rawEvent.devEventsUrl);

    // Extract Luma data if available
    const lumaData = rawEvent.lumaData;
    const lumaEventId = lumaData?.lumaEventId || null;
    const lumaPageData = lumaData?.lumaPageData || null;

    // Extract Meetup data if available
    const meetupData = rawEvent.meetupData;
    const meetupEventId = meetupData?.meetupEventId || null;
    const meetupPageData = meetupData?.meetupPageData || null;

    const normalized = {
      eventId: this.generateEventId(rawEvent), // Generate unique event ID
      eventStart,
      eventEnd,
      eventTitle: this.cleanEventTitle(rawEvent.name || rawEvent.title),
      eventLink: rawEvent.url || '',
      eventCity: lumaData?.city || meetupData?.city || rawEvent.city || '',
      eventCountry: lumaData?.country || meetupData?.country || rawEvent.country || '', // Use eventCountry for processing
      eventCountryCode: lumaData?.countryCode || '', // From Luma or will be populated by EventProcessor
      eventRegion: lumaData?.region || meetupData?.state || this.currentRegion || rawEvent.region || '',
      venueAddress: lumaData?.fullAddress || lumaData?.venueAddress || meetupData?.venueAddress || rawEvent.venueAddress || '', // Venue address field
      listingType: 'active', // Default listing type
      eventType: 'meetup', // Specific to meetups
      eventTopics: [], // To be filled by topic matching
      sourceEventId: sourceEventId, // dev.events native ID
      lumaEventId: lumaEventId, // Luma event ID (evt-XXX) for registration matching
      meetupEventId: meetupEventId, // Meetup event ID for tracking
      eventTimezone: lumaData?.timezone || meetupData?.timezone || null, // Timezone from Luma or Meetup
      // Full __NEXT_DATA__ JSON from Luma page (refreshed on each scrape)
      lumaPageData: lumaPageData,
      // Full __NEXT_DATA__ JSON from Meetup page (refreshed on each scrape)
      meetupPageData: meetupPageData,
      // New audit fields for scrapers
      scraperName: scraperName,
      scraperRunId: this.generateRunId(),
      source_type: 'scraper',
      source_details: {
        scraper_name: scraperName,
        scraper_run_id: this.generateRunId(),
        original_url: rawEvent.url || null,
        dev_events_url: rawEvent.devEventsUrl || null,
        dev_events_id: sourceEventId,
        luma_event_id: lumaEventId,
        meetup_event_id: meetupEventId,
        scraped_timestamp: new Date().toISOString()
      }
    };

    // Add coordinates from Luma or Meetup data if available
    if (lumaData?.latitude && lumaData?.longitude) {
      normalized.coordinates = { lat: lumaData.latitude, lng: lumaData.longitude };
      normalized.eventLocation = `${lumaData.latitude},${lumaData.longitude}`;
      console.log(`📍 Using coordinates from Luma: ${normalized.eventLocation}`);
    } else if (meetupData?.latitude && meetupData?.longitude) {
      normalized.coordinates = { lat: meetupData.latitude, lng: meetupData.longitude };
      normalized.eventLocation = `${meetupData.latitude},${meetupData.longitude}`;
      console.log(`📍 Using coordinates from Meetup: ${normalized.eventLocation}`);
    }

    // Handle online events
    if (rawEvent.city?.toLowerCase() === 'online' ||
        rawEvent.region?.toLowerCase() === 'online') {
      normalized.eventCity = 'Online';
      normalized.eventCountryCode = '';
      normalized.eventRegion = 'on'; // Use 2-char code for online
    }

    // Extract additional meetup-specific data
    if (rawEvent.organizer) {
      normalized.organizer = rawEvent.organizer;
    }

    if (rawEvent.description) {
      normalized.description = rawEvent.description.substring(0, 500);
    }

    // Include cover image URL if available
    if (rawEvent.coverImageUrl) {
      normalized.coverImageUrl = rawEvent.coverImageUrl;
    }

    return normalized;
  }
}