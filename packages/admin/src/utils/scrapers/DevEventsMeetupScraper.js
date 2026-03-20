import { BaseScraper } from './BaseScraper.js';

/**
 * Scraper for dev.events meetups page
 */
export class DevEventsMeetupScraper extends BaseScraper {
  constructor(config, globalConfig) {
    super(config, globalConfig);
  }

  /**
   * Main scraping method
   */
  async scrape() {
    console.log(`🎯 Starting ${this.config.name} scraping...`);

    await this.initialize();
    await this.loadProcessedUrls();

    try {
      // If regions are configured, scrape each region
      if (this.config.regions && this.config.regions.length > 0) {
        for (const region of this.config.regions) {
          await this.scrapeRegion(region);
          // Small delay between regions
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } else {
        // Scrape main meetups page
        await this.scrapePage(this.config.baseUrl);
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
    const regionUrl = `${this.config.baseUrl}/${region}`;

    try {
      await this.scrapePage(regionUrl);
    } catch (error) {
      console.error(`❌ Error scraping region ${region}: ${error.message}`);
    }
  }

  /**
   * Scrape a specific page
   */
  async scrapePage(url) {
    console.log(`📄 Navigating to: ${url}`);

    await this.page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // Wait for events to load
    await this.page.waitForSelector('body', { timeout: 30000 });

    // Extract events from current page
    const pageEvents = await this.extractEvents();
    console.log(`🔍 Found ${pageEvents.length} events on page`);

    // Process each event
    for (const rawEvent of pageEvents) {
      this.stats.total++;

      if (this.shouldSkipEvent(rawEvent)) {
        continue;
      }

      // Validate URL if enabled
      if (rawEvent.url && !(await this.validateUrl(rawEvent.url))) {
        continue;
      }

      // Normalize event data
      const normalizedEvent = this.normalizeEvent(rawEvent);

      if (normalizedEvent.event_title && normalizedEvent.event_link) {
        this.scrapedEvents.push(normalizedEvent);
        this.processedUrls.add(normalizedEvent.event_link);
        this.stats.processed++;
      } else {
        this.stats.failed++;
      }
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
              const event = {
                name: item.name,
                url: item.url,
                dateText: item.startDate,
                endDate: item.endDate,
                city: item.location?.address?.addressLocality || '',
                country: item.location?.address?.addressCountry || '',
                region: item.location?.address?.addressRegion || '',
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

      // If JSON-LD didn't yield results, fall back to CSS selectors
      if (events.length === 0) {
        const eventElements = document.querySelectorAll('[data-type="EducationEvent"], .event-item, .meetup-event');

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
              region
            });
          }
        });
      }

      // Additional scraping for dev.events specific structure
      const devEventsRows = document.querySelectorAll('.columns.is-mobile, .event-row');

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
              region
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
   * Normalize meetup event data
   */
  normalizeEvent(rawEvent) {
    const normalized = super.normalizeEvent(rawEvent);

    // Set specific event type
    normalized.event_type = 'meetup';

    // Handle online events
    if (rawEvent.city?.toLowerCase() === 'online' ||
        rawEvent.region?.toLowerCase() === 'online') {
      normalized.event_city = 'Online';
      normalized.event_country_code = '';
      normalized.event_region = 'Online';
    }

    return normalized;
  }
}