import { BaseScraper } from './BaseScraper.js';

/**
 * Scraper for dev.events conferences page
 */
export class DevEventsConferenceScraper extends BaseScraper {
  constructor(config, globalConfig) {
    super(config, globalConfig);
    // Set headless mode (true for production, false for debugging)
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
        // Scrape main conferences page
        await this.scrapePage(this.config.config.baseUrl);
      }

      console.log(`✅ Completed conferences scraping`);

    } catch (error) {
      console.error(`❌ General error in conference scraping: ${error.message}`);
      this.stats.failed++;
    } finally {
      // Save scraped events and cleanup
      await this.saveEvents();
      await this.cleanup();
    }

    // Return the scraped events for API usage
    return this.scrapedEvents;
  }

  /**
   * Scrape a specific region
   */
  async scrapeRegion(region) {
    console.log(`🌍 Scraping region: ${region}`);
    this.currentRegion = region.toLowerCase(); // Store region in lowercase for database
    const regionUrl = `${this.config.config.baseUrl}/${region}`;
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

    try {
      // Add a small delay to appear more human-like
      console.log('⏳ Waiting before navigation...');
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Navigate to dev.events
      console.log('🌍 Navigating to dev.events...');
      console.log('📍 Target URL:', baseUrl);

      // Set user agent and headers to avoid blocking
      await this.page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      await this.page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      });

      let navigationSuccess = false;
      let lastError = null;

      // Try up to 3 navigation attempts with different strategies
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`🌍 Navigation attempt ${attempt}...`);

          if (attempt > 1) {
            // Add longer delay for retry attempts
            console.log(`⏳ Waiting ${attempt * 3} seconds before retry...`);
            await new Promise(resolve => setTimeout(resolve, attempt * 3000));
          }

          const waitStrategies = ['domcontentloaded', 'load', 'networkidle0'];
          const timeouts = [30000, 45000, 60000];

          await this.page.goto(baseUrl, {
            waitUntil: waitStrategies[attempt - 1],
            timeout: timeouts[attempt - 1]
          });

          console.log(`✅ Successfully navigated to dev.events (attempt ${attempt})`);
          navigationSuccess = true;
          break;

        } catch (navigationError) {
          lastError = navigationError;
          console.error(`❌ Navigation attempt ${attempt} failed:`, navigationError.message);

          if (attempt === 3) {
            // Last attempt failed, try one more time with the most minimal approach
            try {
              console.log('🔄 Final attempt with minimal settings...');
              await new Promise(resolve => setTimeout(resolve, 10000)); // 10 second delay

              // Create a new page if the current one is corrupted
              const newPage = await this.browser.newPage();
              await this.page.close();
              this.page = newPage;

              await this.page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

              await this.page.goto(baseUrl, {
                waitUntil: 'load',
                timeout: 60000
              });

              console.log('✅ Successfully navigated with minimal approach');
              navigationSuccess = true;
              break;
            } catch (finalError) {
              console.error('❌ Final navigation attempt failed:', finalError.message);
            }
          }
        }
      }

      if (!navigationSuccess) {
        throw new Error(`Failed to navigate to ${this.config.config.baseUrl} after all attempts. Last error: ${lastError?.message}`);
      }

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
      let hasMorePages = true;
      let consecutiveErrors = 0;
      const maxConsecutiveErrors = 3;

      // Process all available pages
      while (hasMorePages && consecutiveErrors < maxConsecutiveErrors) {
        console.log(`📄 Processing page ${currentPage}...`);

        try {
          // First page is already loaded, for next pages we need to navigate
          if (currentPage > 1) {
            console.log(`🌐 Navigating to page ${currentPage}...`);
            let navigationSuccess = false;

            // Try up to 3 times to navigate to the page
            for (let attempt = 1; attempt <= 3; attempt++) {
              try {
                await this.page.goto(`${baseUrl}?page=${currentPage}`, {
                  waitUntil: 'networkidle2',
                  timeout: 60000
                }).catch(err => {
                  throw new Error(`Navigation error: ${err.message}`);
                });

                // Wait for content to be visible
                await this.page.waitForSelector('#events', { timeout: 30000 })
                  .catch(err => {
                    throw new Error(`Timeout waiting for #events: ${err.message}`);
                  });

                navigationSuccess = true;
                console.log(`✅ Successfully loaded page ${currentPage}`);
                break;
              } catch (navError) {
                if (attempt < 3) {
                  console.log(`⚠️  Navigation attempt ${attempt} failed: ${navError.message}`);
                  console.log(`⏳ Retrying in 3 seconds...`);
                  await new Promise(resolve => setTimeout(resolve, 3000));
                } else {
                  throw navError; // Let the outer try-catch handle it after all attempts fail
                }
              }
            }

            if (!navigationSuccess) {
              throw new Error(`Failed to navigate to page ${currentPage} after multiple attempts`);
            }
          }

          // Extract events from current page
          let pageEvents = [];
          try {
            pageEvents = await this.extractEvents();
            consecutiveErrors = 0; // Reset consecutive errors counter on success
          } catch (extractError) {
            console.error(`❌ Error extracting events: ${extractError.message}`);
            // Try to reload the page once
            console.log(`🔄 Attempting to reload the page and extract again...`);
            try {
              await this.page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
              await new Promise(resolve => setTimeout(resolve, 3000));
              pageEvents = await this.extractEvents();
            } catch (reloadError) {
              console.error(`❌ Failed after reload: ${reloadError.message}`);
              throw new Error(`Could not extract events even after page reload: ${reloadError.message}`);
            }
          }

          if (!pageEvents || pageEvents.length === 0) {
            console.log(`📭 No events found on page ${currentPage}. This might be the last page.`);
            hasMorePages = false;
            continue;
          }

          console.log(`🔍 Found ${pageEvents.length} events on page ${currentPage}`);

          // Process each event
          for (const rawEvent of pageEvents) {
            this.stats.total++;

            if (this.shouldSkipEvent(rawEvent)) {
              continue;
            }

            // Extract actual event URL from dev.events listing page
            const devEventsUrl = rawEvent.url;

            // Preserve the original dev.events URL for ID extraction later
            rawEvent.devEventsUrl = devEventsUrl;

            const { url: actualEventUrl, coverImageUrl, lumaData } = await this.extractActualEventUrl(devEventsUrl);
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

            // Safety check: Skip if we still have a dev.events URL (extraction failed)
            if (rawEvent.url && rawEvent.url.includes('dev.events')) {
              console.log(`🚫 Skipping dev.events URL (extraction failed): ${rawEvent.name} - ${rawEvent.url}`);
              this.stats.failed++;
              continue;
            }

            // Validate URL if enabled
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

          // Check for next page using multiple strategies
          let hasNextPage = false;
          try {
            // Strategy 1: Check for "Show more" button
            hasNextPage = await this.page.evaluate((nextPage) => {
              const showMoreButton = document.querySelector('button.moreButton.button.is-small');
              if (showMoreButton && !showMoreButton.disabled) {
                return true;
              }

              // Strategy 2: Check for pagination element
              const paginationElement = document.querySelector('.pagination');
              if (paginationElement) {
                const pageLinks = Array.from(document.querySelectorAll('.pagination-link'));
                return pageLinks.some(link => parseInt(link.textContent.trim()) > nextPage - 1);
              }

              return false;
            }, currentPage);
          } catch (evalError) {
            console.error(`❌ Error checking for next page: ${evalError.message}`);
            hasNextPage = currentPage < 10; // Assume there are at least 10 pages if we can't check
          }

          if (!hasNextPage) {
            console.log('🏁 No more pages available.');
            hasMorePages = false;
          } else {
            // If we've loaded a lot of pages, check if we're approaching the expected total
            if (this.stats.processed >= totalEvents) {
              console.log(`🎯 Reached expected total of ${totalEvents} events. Stopping.`);
              hasMorePages = false;
            } else {
              currentPage++;

              // Add a delay between requests to be gentle to the server
              console.log('⏳ Waiting before loading next page...');
              await new Promise(resolve => setTimeout(resolve, 2000 + Math.floor(Math.random() * 1000))); // Add some randomness
            }
          }
        } catch (error) {
          console.error(`❌ Error processing page ${currentPage}:`, error.message);
          consecutiveErrors++;

          if (consecutiveErrors >= maxConsecutiveErrors) {
            console.error(`💥 Too many consecutive errors (${consecutiveErrors}). Stopping pagination.`);
          } else {
            console.log(`🔄 Trying to continue to the next page... (error ${consecutiveErrors}/${maxConsecutiveErrors})`);
            currentPage++;
            console.log(`⏳ Waiting longer (${5 + consecutiveErrors * 2} seconds) after an error...`);
            await new Promise(resolve => setTimeout(resolve, (5 + consecutiveErrors * 2) * 1000)); // Wait longer after an error
          }
        }
      }

      console.log(`✅ Completed scraping ${currentPage - 1} pages`);

    } catch (error) {
      console.error(`❌ Scraping error: ${error.message}`);
      throw error;
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
          const hrefValue = nameElement.getAttribute('href');
          if (hrefValue) {
            // Check if it's already an absolute URL
            if (hrefValue.startsWith('http://') || hrefValue.startsWith('https://')) {
              url = hrefValue;
            } else {
              // It's a relative URL, prepend the base URL
              url = 'https://dev.events' + (hrefValue.startsWith('/') ? '' : '/') + hrefValue;
            }
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

        // Extract venue address information
        let venueAddress = '';

        // Look for detailed venue information in the event description or subtitle
        const descriptionEl = row.querySelector('.subtitle.is-6, .content');
        if (descriptionEl) {
          const fullText = descriptionEl.textContent.trim();

          // Try to extract venue/address from the text
          // Look for patterns like "at [venue name]" or venue information
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
              venueAddress = match[1].trim();
              // Clean up the venue name
              venueAddress = venueAddress.replace(/\s+/g, ' ').trim();
              break;
            }
          }
        }

        return { dateText, name, url, city, country, region, venueAddress };
      });
    });
  }


  /**
   * Enhanced date parsing for dev.events format - matches original implementation exactly
   */
  parseDateToISO(dateStr) {
    if (!dateStr) {
      // Always provide a fallback date instead of empty values
      const currentYear = new Date().getFullYear();
      console.warn(`No date provided, using fallback: ${currentYear}-01-01 to ${currentYear}-12-31`);
      return {
        eventStart: `${currentYear}-01-01`,
        eventEnd: `${currentYear}-12-31`
      };
    }

    try {
      // First normalize the value - replace all newlines and extra spaces
      let normalizedDate = dateStr.replace(/\s+/g, ' ').trim();

      // Log the date being processed for debugging
      console.log(`Parsing date: "${normalizedDate}"`);

      // Extract the year
      let yearMatch = normalizedDate.match(/\b(20\d{2})\b/);
      let year = yearMatch ? yearMatch[1] : new Date().getFullYear().toString();

      // Handle "Apr 27 - May 2 25" format with two-digit year
      if (/^[A-Za-z]+\s+\d{1,2}\s*-\s*[A-Za-z]+\s+\d{1,2}\s+\d{2}$/.test(normalizedDate)) {
        normalizedDate = normalizedDate.replace(/(\d{2})$/, '20$1');
        console.log(`  Converted two-digit year format to: "${normalizedDate}"`);
        // Re-extract the year after conversion
        yearMatch = normalizedDate.match(/\b(20\d{2})\b/);
        year = yearMatch ? yearMatch[1] : new Date().getFullYear().toString();
      }

      // Handle "Apr 16 25" format with two-digit year
      if (/^[A-Za-z]+\s+\d{1,2}\s+\d{2}$/.test(normalizedDate)) {
        normalizedDate = normalizedDate.replace(/(\d{2})$/, '20$1');
        console.log(`  Converted two-digit year format to: "${normalizedDate}"`);
        // Re-extract the year after conversion
        yearMatch = normalizedDate.match(/\b(20\d{2})\b/);
        year = yearMatch ? yearMatch[1] : new Date().getFullYear().toString();
      }

      // Handle "Month Day - Month Day, Year" format (e.g., "Apr 27 - May 2, 2025")
      const crossMonthMatch = normalizedDate.match(/([A-Za-z]+)\s+(\d{1,2})\s*-\s*([A-Za-z]+)\s+(\d{1,2})(?:,\s*|\s+)(20\d{2})/);
      if (crossMonthMatch) {
        const startMonth = this.getMonthNumber(crossMonthMatch[1]);
        const startDay = crossMonthMatch[2].padStart(2, '0');
        const endMonth = this.getMonthNumber(crossMonthMatch[3]);
        const endDay = crossMonthMatch[4].padStart(2, '0');
        const eventYear = crossMonthMatch[5];

        console.log(`  Matched cross-month format: ${eventYear}-${startMonth}-${startDay} to ${eventYear}-${endMonth}-${endDay}`);
        return {
          eventStart: `${eventYear}-${startMonth}-${startDay}`,
          eventEnd: `${eventYear}-${endMonth}-${endDay}`
        };
      }

      // Handle "Month Day-Day, Year" format (e.g., "May 11-13, 2025")
      const rangeMatch = normalizedDate.match(/([A-Za-z]+)\s+(\d{1,2})[-–](\d{1,2})(?:,\s*|\s+)(20\d{2})/);
      if (rangeMatch) {
        const month = this.getMonthNumber(rangeMatch[1]);
        const startDay = rangeMatch[2].padStart(2, '0');
        const endDay = rangeMatch[3].padStart(2, '0');
        const eventYear = rangeMatch[4];

        console.log(`  Matched range format: ${eventYear}-${month}-${startDay} to ${eventYear}-${month}-${endDay}`);
        return {
          eventStart: `${eventYear}-${month}-${startDay}`,
          eventEnd: `${eventYear}-${month}-${endDay}`
        };
      }

      // Handle "Month Day, Year" format (e.g., "May 11, 2025")
      const singleMatch = normalizedDate.match(/([A-Za-z]+)\s+(\d{1,2})(?:,\s*|\s+)(20\d{2})/);
      if (singleMatch) {
        const month = this.getMonthNumber(singleMatch[1]);
        const day = singleMatch[2].padStart(2, '0');
        const eventYear = singleMatch[3];

        console.log(`  Matched single day format: ${eventYear}-${month}-${day}`);
        return {
          eventStart: `${eventYear}-${month}-${day}`,
          eventEnd: `${eventYear}-${month}-${day}`
        };
      }

      // Handle "Apr 30-May 1, 2025" format
      const acrossMonthMatch = normalizedDate.match(/([A-Za-z]+)\s+(\d{1,2})[-–]([A-Za-z]+)\s+(\d{1,2})(?:,\s*|\s+)(20\d{2})/);
      if (acrossMonthMatch) {
        const startMonth = this.getMonthNumber(acrossMonthMatch[1]);
        const startDay = acrossMonthMatch[2].padStart(2, '0');
        const endMonth = this.getMonthNumber(acrossMonthMatch[3]);
        const endDay = acrossMonthMatch[4].padStart(2, '0');
        const eventYear = acrossMonthMatch[5];

        console.log(`  Matched across-month format: ${eventYear}-${startMonth}-${startDay} to ${eventYear}-${endMonth}-${endDay}`);
        return {
          eventStart: `${eventYear}-${startMonth}-${startDay}`,
          eventEnd: `${eventYear}-${endMonth}-${endDay}`
        };
      }

      // Handle date ranges that use unicode dash (e.g., "Apr 22–24, 2025")
      const unicodeDashMatch = normalizedDate.match(/([A-Za-z]+)\s+(\d{1,2})[\u2013\u2014](\d{1,2})(?:,\s*|\s+)(20\d{2})/);
      if (unicodeDashMatch) {
        const month = this.getMonthNumber(unicodeDashMatch[1]);
        const startDay = unicodeDashMatch[2].padStart(2, '0');
        const endDay = unicodeDashMatch[3].padStart(2, '0');
        const eventYear = unicodeDashMatch[4];

        console.log(`  Matched unicode dash range format: ${eventYear}-${month}-${startDay} to ${eventYear}-${month}-${endDay}`);
        return {
          eventStart: `${eventYear}-${month}-${startDay}`,
          eventEnd: `${eventYear}-${month}-${endDay}`
        };
      }

      // Handle "Month Day to Day, Year" format (e.g., "May 11 to 13, 2025")
      const toRangeMatch = normalizedDate.match(/([A-Za-z]+)\s+(\d{1,2})\s+to\s+(\d{1,2})(?:,\s*|\s+)(20\d{2})/);
      if (toRangeMatch) {
        const month = this.getMonthNumber(toRangeMatch[1]);
        const startDay = toRangeMatch[2].padStart(2, '0');
        const endDay = toRangeMatch[3].padStart(2, '0');
        const eventYear = toRangeMatch[4];

        console.log(`  Matched 'to' range format: ${eventYear}-${month}-${startDay} to ${eventYear}-${month}-${endDay}`);
        return {
          eventStart: `${eventYear}-${month}-${startDay}`,
          eventEnd: `${eventYear}-${month}-${endDay}`
        };
      }

      // Handle "Month Day-Day" format without year (e.g., "Jan 29-30", "February 5-7")
      const monthRangeNoYearMatch = normalizedDate.match(/^([A-Za-z]+)\s+(\d{1,2})[-–](\d{1,2})$/);
      if (monthRangeNoYearMatch) {
        const month = this.getMonthNumber(monthRangeNoYearMatch[1]);
        const startDay = monthRangeNoYearMatch[2].padStart(2, '0');
        const endDay = monthRangeNoYearMatch[3].padStart(2, '0');

        // Smart year detection for dates without explicit year
        const currentDate = new Date();
        const currentYear = currentDate.getFullYear();
        const currentMonth = currentDate.getMonth() + 1;

        let smartYear = currentYear;
        if ((month === '01' || month === '02') && currentMonth > 2) {
          smartYear = currentYear + 1;
          console.log(`  Smart year detection: Jan/Feb range without explicit year, assuming ${smartYear}`);
        }

        console.log(`  Matched month range without year: ${smartYear}-${month}-${startDay} to ${smartYear}-${month}-${endDay}`);
        return {
          eventStart: `${smartYear}-${month}-${startDay}`,
          eventEnd: `${smartYear}-${month}-${endDay}`
        };
      }

      // Handle "Month Day" format without year (e.g., "Jan 29", "February 5")
      const monthDayNoYearMatch = normalizedDate.match(/^([A-Za-z]+)\s+(\d{1,2})$/);
      if (monthDayNoYearMatch) {
        const month = this.getMonthNumber(monthDayNoYearMatch[1]);
        const day = monthDayNoYearMatch[2].padStart(2, '0');

        // Smart year detection for dates without explicit year
        const currentDate = new Date();
        const currentYear = currentDate.getFullYear();
        const currentMonth = currentDate.getMonth() + 1;

        let smartYear = currentYear;
        if ((month === '01' || month === '02') && currentMonth > 2) {
          smartYear = currentYear + 1;
          console.log(`  Smart year detection: Jan/Feb date without explicit year, assuming ${smartYear}`);
        }

        console.log(`  Matched month day without year: ${smartYear}-${month}-${day}`);
        return {
          eventStart: `${smartYear}-${month}-${day}`,
          eventEnd: `${smartYear}-${month}-${day}`
        };
      }

      // Handle when there's just a year
      if (yearMatch) {
        console.log(`  Matched year-only format: ${year}-01-01 to ${year}-12-31`);
        return {
          eventStart: `${year}-01-01`,
          eventEnd: `${year}-12-31`
        };
      }

      // Additional handling for more date formats
      // Handle "DD-DD Month YYYY" format (e.g., "22-24 April 2025")
      const dayMonthYearRangeMatch = normalizedDate.match(/(\d{1,2})[-–](\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})/);
      if (dayMonthYearRangeMatch) {
        const startDay = dayMonthYearRangeMatch[1].padStart(2, '0');
        const endDay = dayMonthYearRangeMatch[2].padStart(2, '0');
        const month = this.getMonthNumber(dayMonthYearRangeMatch[3]);
        const eventYear = dayMonthYearRangeMatch[4];

        console.log(`  Matched DD-DD Month YYYY format: ${eventYear}-${month}-${startDay} to ${eventYear}-${month}-${endDay}`);
        return {
          eventStart: `${eventYear}-${month}-${startDay}`,
          eventEnd: `${eventYear}-${month}-${endDay}`
        };
      }

      // Handle "YYYY-MM-DD - YYYY-MM-DD" format (e.g., "2025-05-22 - 2025-05-24")
      const isoRangeMatch = normalizedDate.match(/(20\d{2})[-\/](\d{1,2})[-\/](\d{1,2})\s*[-–]\s*(20\d{2})[-\/](\d{1,2})[-\/](\d{1,2})/);
      if (isoRangeMatch) {
        const startYear = isoRangeMatch[1];
        const startMonth = isoRangeMatch[2].padStart(2, '0');
        const startDay = isoRangeMatch[3].padStart(2, '0');
        const endYear = isoRangeMatch[4];
        const endMonth = isoRangeMatch[5].padStart(2, '0');
        const endDay = isoRangeMatch[6].padStart(2, '0');

        console.log(`  Matched ISO range format: ${startYear}-${startMonth}-${startDay} to ${endYear}-${endMonth}-${endDay}`);
        return {
          eventStart: `${startYear}-${startMonth}-${startDay}`,
          eventEnd: `${endYear}-${endMonth}-${endDay}`
        };
      }

      // Extract month and day if available, even without a full match
      const monthMatch = normalizedDate.match(/([A-Za-z]{3,})/);
      const dayMatch = normalizedDate.match(/\b(\d{1,2})\b/);

      if (monthMatch && dayMatch) {
        const month = this.getMonthNumber(monthMatch[1]);
        const day = dayMatch[1].padStart(2, '0');

        // Smart year detection: if no explicit year was found and we're dealing with
        // Jan/Feb events while we're past those months in the current year,
        // assume it's for next year
        let smartYear = year;
        if (!yearMatch) { // No explicit year was found in the original date
          const currentDate = new Date();
          const currentYear = currentDate.getFullYear();
          const currentMonth = currentDate.getMonth() + 1; // getMonth() returns 0-11

          // If the event is in Jan/Feb and we're past Feb in the current year,
          // it's likely for next year
          if ((month === '01' || month === '02') && currentMonth > 2) {
            smartYear = (currentYear + 1).toString();
            console.log(`  Smart year detection: Jan/Feb event without explicit year, assuming ${smartYear}`);
          } else {
            smartYear = currentYear.toString();
          }
        }

        // Check if this might be a multi-day event by looking for common range indicators
        if (normalizedDate.includes('-') || normalizedDate.includes('–') ||
            normalizedDate.includes('to') || normalizedDate.includes('through')) {

          // Try to extract a range of days
          const dayRangeMatch = normalizedDate.match(/\b(\d{1,2})(?:\s*[-–]\s*|\s+to\s+|\s+through\s+)(\d{1,2})\b/);
          if (dayRangeMatch) {
            const startDay = dayRangeMatch[1].padStart(2, '0');
            const endDay = dayRangeMatch[2].padStart(2, '0');

            console.log(`  Extracted day range: ${smartYear}-${month}-${startDay} to ${smartYear}-${month}-${endDay}`);
            return {
              eventStart: `${smartYear}-${month}-${startDay}`,
              eventEnd: `${smartYear}-${month}-${endDay}`
            };
          }
        }

        console.log(`  Extracted partial date components: ${smartYear}-${month}-${day}`);
        return {
          eventStart: `${smartYear}-${month}-${day}`,
          eventEnd: `${smartYear}-${month}-${day}`
        };
      }

      // As a last resort, use the current year with a full-year range
      console.warn(`  Could not parse date "${normalizedDate}" with existing patterns. Using year-only fallback.`);

      // Apply smart year detection for fallback case too
      let fallbackYear = year;
      if (!yearMatch) { // No explicit year was found in the original date
        const currentDate = new Date();
        const currentYear = currentDate.getFullYear();
        // For unknown dates without explicit years, use current year
        fallbackYear = currentYear.toString();
      }

      return {
        eventStart: `${fallbackYear}-01-01`,
        eventEnd: `${fallbackYear}-12-31`
      };
    } catch (error) {
      console.warn(`Warning: Error parsing date "${dateStr}": ${error.message}. Using current year fallback.`);
      const currentYear = new Date().getFullYear();
      return {
        eventStart: `${currentYear}-01-01`,
        eventEnd: `${currentYear}-12-31`
      };
    }
  }

  /**
   * Helper function to get month number from month name
   */
  getMonthNumber(monthName) {
    const months = {
      'jan': '01', 'january': '01',
      'feb': '02', 'february': '02',
      'mar': '03', 'march': '03',
      'apr': '04', 'april': '04',
      'may': '05',
      'jun': '06', 'june': '06',
      'jul': '07', 'july': '07',
      'aug': '08', 'august': '08',
      'sep': '09', 'september': '09',
      'oct': '10', 'october': '10',
      'nov': '11', 'november': '11',
      'dec': '12', 'december': '12'
    };

    return months[monthName.toLowerCase()] || '01';
  }

  /**
   * Clean event title by removing years, excessive whitespace, and normalizing format
   * but preserving suffixes and edition numbers - matches original implementation
   */
  cleanEventTitle(title) {
    if (!title) return '';

    let cleanTitle = title;

    // Remove year patterns (2023, 2024, 2025, etc.)
    cleanTitle = cleanTitle.replace(/\s+20\d{2}\b/g, '');
    cleanTitle = cleanTitle.replace(/20\d{2}$/g, '');

    // DO NOT remove common event name suffixes (preserving conference, event, summit, etc.)
    // DO NOT remove edition numbers (preserving 3rd, 10th, etc.)

    // Remove parenthesized content (e.g., "(Online)", "(Virtual)", etc.)
    cleanTitle = cleanTitle.replace(/\([^)]*\)/g, '');

    // Remove special characters and normalize spaces
    cleanTitle = cleanTitle.replace(/[:#]/g, '');
    cleanTitle = cleanTitle.replace(/\s+/g, ' ');

    return cleanTitle.trim();
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
   * Normalize event data - override to use our custom cleanEventTitle
   */
  normalizeEvent(rawEvent) {
    const { eventStart, eventEnd } = this.parseDateToISO(rawEvent.dateText || rawEvent.date);
    const scraperName = this.config.config?.name || 'DevEventsConferenceScraper';

    // Extract the dev.events ID from the original dev.events URL (stored in devEventsUrl)
    const sourceEventId = this.extractDevEventsId(rawEvent.devEventsUrl);

    // Extract Luma data if available
    const lumaData = rawEvent.lumaData;
    const lumaEventId = lumaData?.lumaEventId || null;

    const normalized = {
      eventId: this.generateEventId(rawEvent), // Generate unique event ID
      eventStart,
      eventEnd,
      eventTitle: this.cleanEventTitle(rawEvent.name || rawEvent.title),
      eventLink: rawEvent.url || '',
      eventCity: lumaData?.city || rawEvent.city || '',
      eventCountry: lumaData?.country || rawEvent.country || '', // Use eventCountry for processing
      eventCountryCode: lumaData?.countryCode || '', // From Luma or will be populated by EventProcessor
      eventRegion: lumaData?.region || this.currentRegion || rawEvent.region || '',
      venueAddress: lumaData?.fullAddress || lumaData?.venueAddress || rawEvent.venueAddress || '', // Venue address field
      listingType: 'active', // Default listing type
      eventType: this.config.config?.type || 'conference', // conference or meetup
      eventTopics: [], // To be filled by topic matching
      sourceEventId: sourceEventId, // dev.events native ID
      lumaEventId: lumaEventId, // Luma event ID (evt-XXX) for registration matching
      eventTimezone: lumaData?.timezone || null, // Timezone from Luma
      // New audit fields for scrapers
      scraperName: scraperName,
      scraperRunId: this.generateRunId(),
      source_type: 'scraper',
      source_details: {
        scraper_name: scraperName,
        scraper_type: 'conference',
        base_url: this.config.config?.baseUrl,
        dev_events_url: rawEvent.devEventsUrl || null,
        dev_events_id: sourceEventId,
        luma_event_id: lumaEventId,
        scraped_timestamp: new Date().toISOString(),
        raw_data_hash: this.hashRawData(rawEvent)
      },
      rawData: rawEvent // Keep original for debugging
    };

    // Add coordinates from Luma data if available
    if (lumaData?.latitude && lumaData?.longitude) {
      normalized.coordinates = { lat: lumaData.latitude, lng: lumaData.longitude };
      normalized.eventLocation = `${lumaData.latitude},${lumaData.longitude}`;
      console.log(`📍 Using coordinates from Luma: ${normalized.eventLocation}`);
    }

    // Include cover image URL if available
    if (rawEvent.coverImageUrl) {
      normalized.coverImageUrl = rawEvent.coverImageUrl;
    }

    // Handle online events
    if (rawEvent.city?.toLowerCase() === 'online' ||
        rawEvent.region?.toLowerCase() === 'online') {
      normalized.eventCity = 'Online';
      normalized.eventCountryCode = '';
      normalized.eventRegion = 'on'; // Use 2-char code for online
    }

    return normalized;
  }

  /**
   * Generate a unique event ID based on event data
   */
  generateEventId(rawEvent) {
    // Create a deterministic but unique ID based on event URL and title
    const title = (rawEvent.name || rawEvent.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const url = rawEvent.url || '';

    // Extract a hash from the URL or title for uniqueness
    let hash = 0;
    const source = url || title;
    for (let i = 0; i < source.length; i++) {
      const char = source.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    // Convert to positive number and get last 4 digits
    const hashStr = Math.abs(hash).toString().slice(-4).padStart(4, '0');

    // Generate a 6-character ID: 2 letters + 4 numbers
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    const chars = letters[Math.floor(Math.random() * letters.length)] +
                  letters[Math.floor(Math.random() * letters.length)];

    return chars + hashStr;
  }

  /**
   * Generate a unique run ID for this scraping session
   */
  generateRunId() {
    if (!this.runId) {
      this.runId = `DevEventsConf_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    }
    return this.runId;
  }

  /**
   * Create a simple hash of raw event data for change tracking
   */
  hashRawData(rawEvent) {
    const dataString = JSON.stringify({
      name: rawEvent.name || rawEvent.title,
      url: rawEvent.url,
      date: rawEvent.dateText || rawEvent.date,
      city: rawEvent.city,
      country: rawEvent.country
    });

    // Simple hash function for tracking data changes
    let hash = 0;
    for (let i = 0; i < dataString.length; i++) {
      const char = dataString.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString();
  }

  /**
   * Extract rich event data from Luma event pages using __NEXT_DATA__ JSON
   * Returns detailed event info including coordinates, timezone, location data
   */
  async extractLumaEventData(eventPage) {
    try {
      const lumaData = await eventPage.evaluate(() => {
        const nextDataScript = document.querySelector('script#__NEXT_DATA__');
        if (!nextDataScript) return null;

        try {
          const data = JSON.parse(nextDataScript.textContent);
          const initialData = data?.props?.pageProps?.initialData?.data;
          const eventData = initialData?.event;

          if (!eventData) return null;

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
            locationType: eventData.location_type // 'offline' or 'online'
          };
        } catch (e) {
          console.error('Failed to parse __NEXT_DATA__:', e.message);
          return null;
        }
      });

      if (lumaData) {
        console.log(`📊 Extracted Luma data: id=${lumaData.lumaEventId}, tz=${lumaData.timezone}, city=${lumaData.city}`);
      }

      return lumaData;
    } catch (error) {
      console.error(`❌ Error extracting Luma event data: ${error.message}`);
      return null;
    }
  }

  /**
   * Extract actual event URL from dev.events listing page
   */
  async extractActualEventUrl(devEventsUrl) {
    try {
      console.log(`🔗 Extracting actual URL from: ${devEventsUrl}`);

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

        // Extract the actual event URL and cover image - check for iframe first, then "Visit" link
        const { actualUrl, coverImageUrl } = await eventPage.evaluate(() => {
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
                break;
              }
            }
          }

          // Priority 1: Check for iframe with conference/event URL
          const iframes = Array.from(document.querySelectorAll('iframe'));
          for (const iframe of iframes) {
            const src = iframe.getAttribute('src');
            if (src && !src.includes('dev.events')) {
              console.log('Found iframe URL:', src);
              return { actualUrl: src, coverImageUrl };
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
                return { actualUrl: href, coverImageUrl };
              }
            }
          }

          // Priority 3: Look for any external links that aren't dev.events
          const allLinks = Array.from(document.querySelectorAll('a[href]'));
          for (const link of allLinks) {
            const href = link.getAttribute('href');
            if (href && (href.startsWith('http://') || href.startsWith('https://')) && !href.includes('dev.events')) {
              // Check if this looks like an event URL
              if (href.includes('event') || href.includes('conference') || href.includes('summit') || href.includes('tickets')) {
                console.log('Found potential event URL:', href);
                return { actualUrl: href, coverImageUrl };
              }
            }
          }

          return { actualUrl: null, coverImageUrl };
        });

        // If the actual URL is a Luma event, navigate to it to extract rich data
        let lumaData = null;
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

        await eventPage.close();

        if (actualUrl) {
          console.log(`✅ Successfully extracted URL: ${actualUrl}`);
          return { url: actualUrl, coverImageUrl, lumaData };
        } else {
          console.log(`❌ No actual event URL found in ${devEventsUrl}`);
          return { url: null, coverImageUrl, lumaData: null };
        }

      } catch (pageError) {
        console.error(`❌ Error accessing event page ${devEventsUrl}:`, pageError.message);
        await eventPage.close().catch(() => {}); // Ignore close errors
        return { url: null, coverImageUrl: null, lumaData: null };
      }

    } catch (error) {
      console.error(`❌ Error extracting actual URL from ${devEventsUrl}:`, error.message);
      return { url: null, coverImageUrl: null, lumaData: null };
    }
  }
}