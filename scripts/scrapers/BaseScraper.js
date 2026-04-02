import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

/**
 * Base class for all scrapers providing common functionality
 */
export class BaseScraper {
  constructor(config, globalConfig) {
    this.config = config;
    this.globalConfig = globalConfig;
    this.browser = null;
    this.page = null;
    this.processedUrls = new Set();
    this.scrapedEvents = [];
    this.stats = {
      total: 0,
      processed: 0,
      skipped: 0,
      failed: 0,
      urlValidationFailed: 0
    };
  }

  /**
   * Initialize the browser and page
   */
  async initialize() {
    console.log(`🚀 Initializing ${this.config.name} scraper...`);

    const browserOptions = {
      headless: this.config.headless !== undefined ? this.config.headless : true,
      defaultViewport: { width: 1440, height: 900 },
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1440,900',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-default-apps',
        '--disable-popup-blocking',
        '--disable-translate',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--single-process', // Helps with Docker memory issues
        // Disable crash reporting to avoid crashpad fork issues in containers
        '--disable-crash-reporter',
        '--disable-breakpad',
        '--no-zygote' // Prevents zygote process spawning
      ],
      ignoreHTTPSErrors: true,
      timeout: 120000
    };

    // Use PUPPETEER_EXECUTABLE_PATH if set (Docker uses system Chrome)
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      console.log(`Using Chrome at: ${process.env.PUPPETEER_EXECUTABLE_PATH}`);
      browserOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    } else if (process.platform === 'darwin') {
      // On macOS, use system Chrome if available for better compatibility
      const macOSChromePaths = [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary'
      ];

      for (const chromePath of macOSChromePaths) {
        if (fs.existsSync(chromePath)) {
          console.log(`Using Chrome at: ${chromePath}`);
          browserOptions.executablePath = chromePath;
          break;
        }
      }
    }
    // Otherwise Puppeteer will use its bundled Chrome

    console.log(`🔧 Launching browser with options:`, JSON.stringify({
      headless: browserOptions.headless,
      executablePath: browserOptions.executablePath || 'bundled',
      argsCount: browserOptions.args.length
    }));

    try {
      this.browser = await puppeteer.launch(browserOptions);
      console.log(`✅ Browser launched successfully`);
    } catch (launchError) {
      console.error(`❌ Browser launch failed: ${launchError.message}`);
      console.error(`Stack: ${launchError.stack}`);
      throw launchError;
    }

    this.page = await this.browser.newPage();
    console.log(`✅ New page created`);

    // Hide automation indicators
    await this.page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
    });

    // Set realistic user agent and headers
    await this.page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36');
    await this.page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1'
    });

    // Set up error logging with filtering for known non-critical errors
    this.page.on('console', msg => {
      if (msg.type() === 'error') {
        const errorText = msg.text();

        // Filter out known non-critical errors from third-party libraries
        const ignoredErrors = [
          'THREE.WebGLRenderer',
          'WebGL context',
          'Failed to load resource: the server responded with a status of 403',
          'SwiftShader',
          'ANGLE'
        ];

        // Only log if it's not an ignored error
        const shouldIgnore = ignoredErrors.some(ignored => errorText.includes(ignored));
        if (!shouldIgnore) {
          console.error('Page error:', errorText);
        }
      }
    });

    console.log(`✅ Browser initialized successfully`);
  }

  /**
   * Validate that a URL exists and doesn't return 404
   */
  async validateUrl(url) {
    if (!this.globalConfig.urlValidation.enabled) {
      return true;
    }

    try {
      const response = await fetch(url, {
        method: 'HEAD',
        timeout: this.globalConfig.urlValidation.timeout,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; EventsBot/1.0; +https://gatewaze.com/bot)'
        }
      });

      // Consider 2xx and 3xx status codes as valid
      const isValid = response.status >= 200 && response.status < 400;

      if (!isValid) {
        console.warn(`⚠️  URL validation failed: ${url} (Status: ${response.status})`);
        this.stats.urlValidationFailed++;
      }

      return isValid;
    } catch (error) {
      console.warn(`⚠️  URL validation error for ${url}: ${error.message}`);
      this.stats.urlValidationFailed++;
      return false;
    }
  }

  /**
   * Load processed URLs to avoid duplicates
   */
  loadProcessedUrls() {
    const processedFile = path.resolve(this.globalConfig.processedEventsPath);

    if (fs.existsSync(processedFile)) {
      try {
        const data = fs.readFileSync(processedFile, 'utf8');
        const lines = data.split('\n');

        // Skip header row and process each line
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line) {
            // Extract URL from CSV (assuming it's the 4th column)
            const columns = line.split(',');
            if (columns.length >= 4) {
              const url = columns[3].replace(/"/g, '').trim();
              if (url) {
                this.processedUrls.add(url);
              }
            }
          }
        }

        console.log(`📚 Loaded ${this.processedUrls.size} previously processed URLs`);
      } catch (error) {
        console.error(`Error reading processed URLs: ${error.message}`);
      }
    } else {
      console.log('📝 No processed events file found, starting fresh');
    }
  }

  /**
   * Check if an event should be skipped (already processed)
   */
  shouldSkipEvent(event) {
    if (!event.url) {
      return true;
    }

    if (this.processedUrls.has(event.url)) {
      this.stats.skipped++;
      return true;
    }

    return false;
  }

  /**
   * Parse date text into ISO format dates
   */
  parseDateToISO(dateStr) {
    if (!dateStr) {
      const currentYear = new Date().getFullYear();
      return {
        eventStart: `${currentYear}-01-01`,
        eventEnd: `${currentYear}-12-31`
      };
    }

    // Implementation would be specific to date format
    // For now, return a basic implementation
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) {
        throw new Error('Invalid date');
      }

      const isoDate = date.toISOString().split('T')[0];
      return {
        eventStart: isoDate,
        eventEnd: isoDate
      };
    } catch (error) {
      console.warn(`Date parsing failed for "${dateStr}", using current year`);
      const currentYear = new Date().getFullYear();
      return {
        eventStart: `${currentYear}-01-01`,
        eventEnd: `${currentYear}-12-31`
      };
    }
  }

  /**
   * Clean and normalize event titles
   */
  cleanEventTitle(title) {
    if (!title) return '';

    return title
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s\-\.,()&]/g, '')
      .substring(0, 200);
  }

  /**
   * Normalize event data
   */
  normalizeEvent(rawEvent) {
    const { eventStart, eventEnd } = this.parseDateToISO(rawEvent.dateText || rawEvent.date);

    return {
      eventStart,
      eventEnd,
      eventTitle: this.cleanEventTitle(rawEvent.name || rawEvent.title),
      eventLink: rawEvent.url || '',
      eventCity: rawEvent.city || '',
      eventCountryCode: rawEvent.country || '',
      eventRegion: rawEvent.region || '',
      venueAddress: rawEvent.venueAddress || '', // New venue address field
      scrapedBy: this.config.name || this.constructor.name, // Track which scraper collected this
      eventType: this.config.type, // conference or meetup
      eventTopics: [], // To be filled by topic matching
      latitude: null,
      longitude: null,
      rawData: rawEvent // Keep original for debugging
    };
  }

  /**
   * Save events to JSON file
   */
  async saveEvents() {
    if (this.scrapedEvents.length === 0) {
      console.log('📭 No events to save');
      return;
    }

    const outputPath = path.resolve(this.globalConfig.outputPath);
    const outputDir = path.dirname(outputPath);

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Load existing events if file exists
    let allEvents = [];
    if (fs.existsSync(outputPath)) {
      try {
        const existingData = fs.readFileSync(outputPath, 'utf8');
        allEvents = JSON.parse(existingData);
      } catch (error) {
        console.warn(`Warning: Could not read existing events file: ${error.message}`);
        allEvents = [];
      }
    }

    // Add new events
    allEvents.push(...this.scrapedEvents);

    // Save updated events
    fs.writeFileSync(outputPath, JSON.stringify(allEvents, null, 2), 'utf8');
    console.log(`💾 Saved ${this.scrapedEvents.length} new events to ${outputPath}`);
  }

  /**
   * Check if an event is in the past or today (should be filtered out)
   * Only future events (starting tomorrow or later) are kept
   * Unless config.past is true, which allows past events to be included
   */
  isPastEvent(eventStart, eventEnd) {
    // If config.past is true, don't filter any events based on date
    if (this.config?.config?.past === true) {
      return false; // Never filter out past events when past: true
    }

    try {
      const now = new Date();
      const tomorrow = new Date();
      tomorrow.setDate(now.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0); // Start of tomorrow

      // Parse event dates
      const startDate = new Date(eventStart);
      const endDate = new Date(eventEnd || eventStart);

      // Event is considered past/today if it starts before tomorrow
      // This filters out past events AND today's events
      const eventStartsBeforeTomorrow = startDate < tomorrow;

      if (eventStartsBeforeTomorrow) {
        console.log(`Filtering out event starting: ${eventStart} (before tomorrow: ${tomorrow.toISOString()})`);
      }

      return eventStartsBeforeTomorrow;
    } catch (error) {
      console.warn(`Error checking if event is past: ${error.message}`);
      return false; // If we can't parse dates, don't filter out
    }
  }

  /**
   * Print scraping statistics
   */
  printStats() {
    console.log('\n📊 Scraping Statistics:');
    console.log(`📋 Total found: ${this.stats.total}`);
    console.log(`✅ Processed: ${this.stats.processed}`);
    console.log(`⏭️  Skipped (duplicates): ${this.stats.skipped}`);
    console.log(`❌ Failed: ${this.stats.failed}`);
    console.log(`🔗 URL validation failed: ${this.stats.urlValidationFailed}`);
  }

  /**
   * Cleanup browser resources
   */
  async cleanup() {
    if (this.browser) {
      await this.browser.close();
      console.log('🧹 Browser cleanup completed');
    }
  }

  /**
   * Abstract method to be implemented by specific scrapers
   */
  async scrape() {
    throw new Error('scrape() method must be implemented by subclasses');
  }

  /**
   * Abstract method to extract events from page
   */
  async extractEvents() {
    throw new Error('extractEvents() method must be implemented by subclasses');
  }
}