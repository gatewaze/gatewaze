import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

    // Use admin repo paths
    this.cacheDir = path.resolve(__dirname, '../../../cache');
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * Initialize the browser and page
   */
  async initialize() {
    console.log(`🚀 Initializing ${this.config.name} scraper...`);

    const browserOptions = {
      headless: process.env.HEADLESS !== 'false' ? "new" : false,
      defaultViewport: { width: 1440, height: 900 },
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1440,900',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-breakpad',
        '--disable-crash-reporter',
        '--disable-crashpad'
      ],
      ignoreHTTPSErrors: true,
      timeout: 120000
    };

    // On macOS, use system Chrome if available for better compatibility
    if (process.platform === 'darwin') {
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
    // In Docker/Linux, Puppeteer will use its bundled Chrome automatically

    this.browser = await puppeteer.launch(browserOptions);
    this.page = await this.browser.newPage();

    // Set realistic user agent and headers
    await this.page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36');
    await this.page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    });

    // Set up error logging
    this.page.on('console', msg => {
      if (msg.type() === 'error') {
        console.error('Page error:', msg.text());
      }
    });

    console.log(`✅ Browser initialized successfully`);
  }

  /**
   * Validate that a URL exists and doesn't return 404
   */
  async validateUrl(url) {
    if (!this.globalConfig?.urlValidation?.enabled) {
      return true;
    }

    try {
      const response = await fetch(url, {
        method: 'HEAD',
        timeout: this.globalConfig.urlValidation.timeout || 10000,
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
   * Load processed URLs from Supabase to avoid duplicates
   */
  async loadProcessedUrls() {
    try {
      // Import Supabase client from main app
      const { supabase } = await import('../../lib/supabase.js');

      const { data: events, error } = await supabase
        .from('events')
        .select('event_link')
        .not('event_link', 'is', null);

      if (error) {
        console.warn(`⚠️  Could not load processed URLs from database: ${error.message}`);
        return;
      }

      events.forEach(event => {
        if (event.event_link) {
          this.processedUrls.add(event.event_link);
        }
      });

      console.log(`📚 Loaded ${this.processedUrls.size} previously processed URLs from database`);
    } catch (error) {
      console.warn(`⚠️  Could not connect to database for processed URLs: ${error.message}`);
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
      const today = new Date();
      const futureDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
      return {
        eventStart: today.toISOString().split('T')[0],
        eventEnd: futureDate.toISOString().split('T')[0]
      };
    }

    try {
      // Clean up common date format issues
      let cleanDate = dateStr
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/–/g, '-')
        .replace(/—/g, '-');

      // Handle various date formats
      const currentYear = new Date().getFullYear();

      // Try parsing as standard date first
      let startDate = new Date(cleanDate);
      if (!isNaN(startDate.getTime())) {
        const isoDate = startDate.toISOString().split('T')[0];
        return {
          eventStart: isoDate,
          eventEnd: isoDate
        };
      }

      // Handle date ranges like "Dec 9 - 11, 2024"
      const rangeMatch = cleanDate.match(/(\w+)\s+(\d+)\s*-\s*(\d+),?\s*(\d{4})?/);
      if (rangeMatch) {
        const [, month, startDay, endDay, year] = rangeMatch;
        const eventYear = year || currentYear;

        startDate = new Date(`${month} ${startDay}, ${eventYear}`);
        const endDate = new Date(`${month} ${endDay}, ${eventYear}`);

        if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
          return {
            eventStart: startDate.toISOString().split('T')[0],
            eventEnd: endDate.toISOString().split('T')[0]
          };
        }
      }

      // Handle single dates without year
      const singleMatch = cleanDate.match(/(\w+)\s+(\d+)/);
      if (singleMatch) {
        const [, month, day] = singleMatch;
        startDate = new Date(`${month} ${day}, ${currentYear}`);

        // If date is in the past, assume next year
        const now = new Date();
        if (startDate < now) {
          startDate = new Date(`${month} ${day}, ${currentYear + 1}`);
        }

        if (!isNaN(startDate.getTime())) {
          const isoDate = startDate.toISOString().split('T')[0];
          return {
            eventStart: isoDate,
            eventEnd: isoDate
          };
        }
      }

      // Fallback: create dates relative to now
      console.warn(`⚠️ Could not parse date: "${dateStr}", using fallback`);
      const today = new Date();
      const futureDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

      return {
        eventStart: today.toISOString().split('T')[0],
        eventEnd: futureDate.toISOString().split('T')[0]
      };

    } catch (error) {
      console.warn(`⚠️ Date parsing error for "${dateStr}": ${error.message}`);
      const today = new Date();
      const futureDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

      return {
        eventStart: today.toISOString().split('T')[0],
        eventEnd: futureDate.toISOString().split('T')[0]
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
   * Normalize event data to match admin app format
   */
  normalizeEvent(rawEvent) {
    const { eventStart, eventEnd } = this.parseDateToISO(rawEvent.dateText || rawEvent.date);

    return {
      event_title: this.cleanEventTitle(rawEvent.name || rawEvent.title),
      event_link: rawEvent.url || '',
      event_start: eventStart,
      event_end: eventEnd,
      event_city: rawEvent.city || '',
      event_country_code: this.normalizeCountryCode(rawEvent.country || ''),
      event_region: rawEvent.region || '',
      event_type: this.config.type, // conference or meetup
      event_topics: [], // To be filled by topic matching
      // New audit fields for scrapers
      scraperName: this.config.name,
      scraperRunId: this.generateRunId(),
      source_type: 'scraper',
      source_details: {
        scraper_name: this.config.name,
        scraper_type: this.config.type,
        base_url: this.config.baseUrl || this.config.config?.baseUrl,
        scraped_timestamp: new Date().toISOString(),
        raw_data_hash: this.hashRawData(rawEvent)
      }
    };
  }

  /**
   * Generate a unique run ID for this scraping session
   */
  generateRunId() {
    if (!this.runId) {
      this.runId = `${this.config.name}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
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
   * Normalize country codes to ISO format
   */
  normalizeCountryCode(country) {
    const countryMap = {
      'United States': 'US',
      'United Kingdom': 'GB',
      'Germany': 'DE',
      'France': 'FR',
      'Italy': 'IT',
      'Spain': 'ES',
      'Netherlands': 'NL',
      'Canada': 'CA',
      'Australia': 'AU',
      'Japan': 'JP',
      'Singapore': 'SG',
      'Brazil': 'BR',
      'India': 'IN',
      'China': 'CN',
      'South Korea': 'KR'
    };

    if (country.length === 2) {
      return country.toUpperCase();
    }

    return countryMap[country] || '';
  }

  /**
   * Print scraping statistics
   */
  printStats() {
    console.log(`\n📊 ${this.config.name} Statistics:`);
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