import { BaseScraper } from './BaseScraper.js';

/**
 * Scraper for dev.events conferences page
 */
export class DevEventsConferenceScraper extends BaseScraper {
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
      // Navigate to dev.events
      console.log('🌍 Navigating to dev.events...');
      await this.page.goto(this.config.baseUrl, {
        waitUntil: 'networkidle2',
        timeout: 60000
      });

      await this.page.waitForSelector('#events', { timeout: 30000 });

      // Get total events count for progress tracking
      const totalEventsInfo = await this.page.evaluate(() => {
        const totalText = document.querySelector('body').innerText;
        const match = totalText.match(/(\d+,\d+|\d+) events/i);
        return match ? match[1].replace(',', '') : null;
      });

      const totalEvents = totalEventsInfo ? parseInt(totalEventsInfo) : 1000;
      console.log(`📊 Estimated total events: ${totalEvents}`);

      let currentPage = 1;
      let hasNextPage = true;

      while (hasNextPage && currentPage <= (this.config.maxPages || 100)) {
        console.log(`📄 Processing page ${currentPage}...`);

        // Extract events from current page
        const pageEvents = await this.extractEvents();
        console.log(`🔍 Found ${pageEvents.length} events on page ${currentPage}`);

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

        // Check for next page
        hasNextPage = await this.hasNextPage();
        if (hasNextPage) {
          await this.goToNextPage();
          currentPage++;
          // Small delay between pages
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      console.log(`✅ Completed scraping ${currentPage - 1} pages`);

    } catch (error) {
      console.error(`❌ Scraping error: ${error.message}`);
      throw error;
    } finally {
      await this.cleanup();
    }

    this.printStats();
    return this.scrapedEvents;
  }

  /**
   * Extract events from current page using existing logic
   */
  async extractEvents() {
    return await this.page.evaluate(() => {
      const eventRows = Array.from(document.querySelectorAll('#events .row.columns.is-mobile'))
        .filter(row => !row.classList.contains('pt-6') && !row.querySelector('nav'));

      return eventRows.map(row => {
        // Extract name and URL
        const nameElement = row.querySelector('.title.is-5 a');
        const name = nameElement ? nameElement.textContent.trim() : '';

        let url = '';
        if (nameElement && nameElement.href) {
          const relativeUrl = nameElement.getAttribute('href');
          if (relativeUrl) {
            url = 'https://dev.events' + relativeUrl;
          }
        }

        // Extract date
        let dateText = '';
        const timeElement = row.querySelector('time');
        if (timeElement) {
          dateText = timeElement.textContent.trim().replace(/\s+/g, ' ');
        }

        // Extract location data
        let city = '';
        let country = '';
        let region = '';

        const subtitleLinks = Array.from(row.querySelectorAll('.subtitle.is-6 a'));
        const subtitleText = row.querySelector('.subtitle.is-6')?.textContent || '';

        // Check if online event
        if (subtitleText.includes('Online')) {
          city = 'Online';
          country = '';
          region = 'Online';
        } else {
          // Extract in-person location
          const locationLinks = subtitleLinks.filter((a, index) => {
            const href = a.getAttribute('href') || '';
            const linkText = a.textContent.trim();

            if (!href.includes('/')) return false;
            if (href.startsWith('/ON')) return false;
            if (index === 0) return false; // Skip first link (topic)

            if (href.match(/^\/[A-Z]{2,3}$/)) {
              return true; // Country code pattern
            }

            if (href.includes('/') && href.split('/').length > 2) {
              return true; // Multi-part location
            }

            if (linkText.includes(' ') || linkText.includes(',')) {
              return true; // Location names with spaces/commas
            }

            if (linkText.length > 3 && !href.match(/^\/[a-z-]+$/i)) {
              return true;
            }

            return false;
          });

          if (locationLinks.length > 0) {
            city = locationLinks[0].textContent.trim();

            // Country detection logic
            if (locationLinks.length > 1) {
              if (locationLinks.length > 2 &&
                  (subtitleText.includes('United States') ||
                   subtitleText.includes('Canada') ||
                   subtitleText.includes('Australia'))) {
                country = locationLinks[2].textContent.trim();

                if (locationLinks.length > 3) {
                  region = locationLinks[3].textContent.trim();
                } else {
                  const regionMatch = subtitleText.match(/United States,\s*([^,]+)$/);
                  if (regionMatch) {
                    region = regionMatch[1].trim();
                  }
                }
              } else {
                country = locationLinks[1].textContent.trim();

                if (locationLinks.length > 2) {
                  region = locationLinks[2].textContent.trim();
                } else {
                  const parts = subtitleText.split(',').map(p => p.trim());
                  if (parts.length > 2) {
                    region = parts[parts.length - 1];
                  }
                }
              }
            }
          }
        }

        return { dateText, name, url, city, country, region };
      });
    });
  }

  /**
   * Check if there's a next page
   */
  async hasNextPage() {
    try {
      const nextButton = await this.page.$('nav a[aria-label="Next page"]');
      if (!nextButton) return false;

      const isDisabled = await this.page.evaluate(btn => {
        return btn.getAttribute('disabled') !== null ||
               btn.classList.contains('is-disabled') ||
               btn.parentElement.classList.contains('is-disabled');
      }, nextButton);

      return !isDisabled;
    } catch (error) {
      console.warn(`Error checking for next page: ${error.message}`);
      return false;
    }
  }

  /**
   * Navigate to next page
   */
  async goToNextPage() {
    try {
      const nextButton = await this.page.$('nav a[aria-label="Next page"]');
      if (nextButton) {
        await Promise.all([
          this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
          nextButton.click()
        ]);

        // Wait for events to load
        await this.page.waitForSelector('#events', { timeout: 30000 });
        console.log('➡️  Navigated to next page');
      }
    } catch (error) {
      console.error(`Error navigating to next page: ${error.message}`);
      throw error;
    }
  }
}