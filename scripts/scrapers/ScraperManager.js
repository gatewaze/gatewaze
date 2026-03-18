import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DevEventsConferenceScraper } from './DevEventsConferenceScraper.js';
import { DevEventsMeetupScraper } from './DevEventsMeetupScraper.js';
import { LumaEventsScraper } from './LumaEventsScraper.js';
import { LumaICalScraper } from './LumaICalScraper.js';
import { TopicMatcher } from './TopicMatcher.js';
import { GeocodingService } from './GeocodingService.js';
import { DatabaseIntegrator } from './DatabaseIntegrator.js';
import { supabase } from '../supabase-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Main scraper management system that orchestrates all scrapers
 */
export class ScraperManager {
  constructor(configPath = './scrapers-config.json') {
    this.configPath = path.resolve(__dirname, configPath);
    this.config = null; // Will be loaded from Supabase
    this.scrapers = new Map();
    this.topicMatcher = null;
    this.geocodingService = null;
    this.databaseIntegrator = null;
    this.allEvents = [];
    this.initialized = false;
  }

  /**
   * Initialize the scraper manager - loads config from Supabase
   */
  async initialize() {
    if (this.initialized) return;

    await this.loadConfigFromSupabase();
    this.initializeServices();
    await this.initializeScrapers();
    this.initialized = true;
  }

  /**
   * Load configuration from Supabase
   */
  async loadConfigFromSupabase() {
    try {
      console.log('📋 Loading scraper configurations from Supabase...');

      // Get all enabled scrapers from Supabase
      const { data: scrapers, error } = await supabase
        .from('scrapers')
        .select('*')
        .eq('enabled', true);

      if (error) {
        console.error('❌ Error loading scrapers from Supabase:', error);
        throw error;
      }

      // Also load global config from JSON file (for now)
      const globalConfig = this.loadGlobalConfig();

      // Transform Supabase data to match the expected format
      const scrapersConfig = {};
      scrapers.forEach(scraper => {
        const scraperKey = scraper.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
        scrapersConfig[scraperKey] = {
          name: scraper.name,
          url: scraper.base_url,
          type: scraper.event_type,
          scraper: scraper.scraper_type,
          enabled: scraper.enabled,
          config: scraper.config || {}
        };
      });

      this.config = {
        scrapers: scrapersConfig,
        globalConfig: globalConfig
      };

      console.log(`📋 Loaded ${scrapers.length} scraper configurations from Supabase`);
    } catch (error) {
      console.error('❌ Error loading configuration from Supabase:', error);
      throw error;
    }
  }

  /**
   * Load global configuration from JSON file (fallback)
   */
  loadGlobalConfig() {
    try {
      const configData = fs.readFileSync(this.configPath, 'utf8');
      const config = JSON.parse(configData);
      return config.globalConfig || {};
    } catch (error) {
      console.warn('⚠️ Could not load global config from JSON, using defaults');
      return {
        outputPath: "./scraped-events.json",
        processedEventsPath: "./processed-events.csv",
        topicsPath: "./topics.json",
        countryCodesPath: "./country-codes.json",
        regionCodesPath: "./region-codes.json"
      };
    }
  }

  /**
   * Initialize services (topic matching, geocoding, database integration)
   */
  initializeServices() {
    try {
      // Initialize topic matcher
      this.topicMatcher = new TopicMatcher(
        path.resolve(__dirname, this.config.globalConfig.topicsPath)
      );

      // Initialize geocoding service
      this.geocodingService = new GeocodingService(this.config.globalConfig.geocoding);

      // Initialize database integrator
      this.databaseIntegrator = new DatabaseIntegrator(this.config.globalConfig.database);

      console.log('🛠️ Services initialized successfully');
    } catch (error) {
      console.error(`❌ Error initializing services: ${error.message}`);
      throw error;
    }
  }

  /**
   * Initialize all configured scrapers
   */
  async initializeScrapers() {
    const scraperClasses = {
      'DevEventsConferenceScraper': DevEventsConferenceScraper,
      'DevEventsMeetupScraper': DevEventsMeetupScraper,
      'LumaEventsScraper': LumaEventsScraper,
      'LumaICalScraper': LumaICalScraper
    };

    for (const [scraperId, scraperConfig] of Object.entries(this.config.scrapers)) {
      if (!scraperConfig.enabled) {
        console.log(`⏸️ Skipping disabled scraper: ${scraperConfig.name}`);
        continue;
      }

      const ScraperClass = scraperClasses[scraperConfig.scraper];
      if (!ScraperClass) {
        console.warn(`⚠️ Unknown scraper class: ${scraperConfig.scraper} for ${scraperId}`);
        continue;
      }

      try {
        const scraper = new ScraperClass(scraperConfig, this.config.globalConfig);
        this.scrapers.set(scraperId, scraper);
        console.log(`✅ Initialized scraper: ${scraperConfig.name}`);
      } catch (error) {
        console.error(`❌ Error initializing scraper ${scraperId}: ${error.message}`);
      }
    }

    console.log(`🎯 Initialized ${this.scrapers.size} scrapers`);
  }

  /**
   * Run all enabled scrapers
   */
  async runAllScrapers() {
    console.log('🚀 Starting all scrapers...');

    const results = {
      scrapers: {},
      totalEvents: 0,
      processedEvents: 0,
      failedEvents: 0,
      duplicateEvents: 0
    };

    for (const [scraperId, scraper] of this.scrapers) {
      console.log(`\\n🎯 Running scraper: ${scraper.config.name}`);

      try {
        const events = await scraper.scrape();
        results.scrapers[scraperId] = {
          name: scraper.config.name,
          eventsFound: events.length,
          stats: scraper.stats
        };

        this.allEvents.push(...events);
        results.totalEvents += events.length;

        console.log(`✅ Completed scraper: ${scraper.config.name} (${events.length} events)`);
      } catch (error) {
        console.error(`❌ Scraper failed: ${scraper.config.name} - ${error.message}`);
        results.scrapers[scraperId] = {
          name: scraper.config.name,
          error: error.message,
          eventsFound: 0
        };
      }
    }

    console.log(`\\n📊 Total events scraped: ${this.allEvents.length}`);
    return results;
  }

  /**
   * Run a specific scraper by ID
   */
  async runScraper(scraperId) {
    // Ensure we're initialized
    await this.initialize();

    const scraper = this.scrapers.get(scraperId);
    if (!scraper) {
      throw new Error(`Scraper not found: ${scraperId}`);
    }

    console.log(`🎯 Running specific scraper: ${scraper.config.name}`);
    const events = await scraper.scrape();
    if (events && Array.isArray(events)) {
      this.allEvents.push(...events);
    }

    return {
      scraperId,
      name: scraper.config.name,
      eventsFound: events.length,
      events
    };
  }

  /**
   * Process all scraped events (topic matching, geocoding, validation)
   */
  async processEvents() {
    if (this.allEvents.length === 0) {
      console.log('📭 No events to process');
      return;
    }

    console.log(`\\n🔄 Processing ${this.allEvents.length} events...`);

    let processed = 0;
    let failed = 0;

    for (const event of this.allEvents) {
      try {
        // 1. Match topics
        if (this.topicMatcher) {
          event.eventTopics = await this.topicMatcher.matchTopics(
            event.eventTitle + ' ' + (event.description || '')
          );
        }

        // 2. Geocoding for location coordinates
        if (this.geocodingService && event.eventCity && event.eventCity !== 'Online') {
          const coordinates = await this.geocodingService.geocode(
            event.eventCity,
            event.eventCountryCode
          );

          if (coordinates) {
            event.latitude = coordinates.lat;
            event.longitude = coordinates.lng;
          }
        }

        // 3. Validate and clean data
        event.eventTitle = this.cleanText(event.eventTitle, 200);
        event.eventLink = this.validateUrl(event.eventLink);

        // 4. Set additional metadata
        event.scraped_at = new Date().toISOString();
        event.listing_status = 'active';

        processed++;
      } catch (error) {
        console.error(`❌ Error processing event "${event.eventTitle}": ${error.message}`);
        failed++;
      }
    }

    console.log(`✅ Processed ${processed} events, ${failed} failed`);
  }

  /**
   * Remove duplicate events based on configured matching criteria
   */
  deduplicateEvents() {
    const dedupeConfig = this.config.globalConfig.deduplication;
    const uniqueEvents = [];
    const seenEvents = new Map();

    console.log(`🔍 Deduplicating events using fields: ${dedupeConfig.matchFields.join(', ')}`);

    for (const event of this.allEvents) {
      // Create a key based on match fields
      const keyParts = dedupeConfig.matchFields.map(field => {
        let value = event[field] || '';

        // Normalize for comparison
        if (typeof value === 'string') {
          value = value.toLowerCase().trim();
        }

        return value;
      });

      const key = keyParts.join('|');

      if (!seenEvents.has(key)) {
        seenEvents.set(key, event);
        uniqueEvents.push(event);
      } else {
        console.log(`🔄 Duplicate found: ${event.eventTitle}`);
      }
    }

    const duplicatesRemoved = this.allEvents.length - uniqueEvents.length;
    this.allEvents = uniqueEvents;

    console.log(`✅ Removed ${duplicatesRemoved} duplicates, ${uniqueEvents.length} unique events remain`);
  }

  /**
   * Save processed events to database
   */
  async saveToDatabase() {
    if (!this.databaseIntegrator) {
      console.log('💾 Saving to JSON file (no database configured)');
      return this.saveToJson();
    }

    console.log('💾 Saving events to database...');

    try {
      const result = await this.databaseIntegrator.insertEvents(this.allEvents);
      console.log(`✅ Saved ${result.inserted} events to database`);
      console.log(`🔄 Updated ${result.updated} existing events`);
      console.log(`⏭️  Skipped ${result.skipped} duplicate events`);

      return result;
    } catch (error) {
      console.error(`❌ Database save failed: ${error.message}`);
      console.log('💾 Falling back to JSON file save...');
      return this.saveToJson();
    }
  }

  /**
   * Save events to JSON file as fallback
   */
  async saveToJson() {
    const outputPath = path.resolve(__dirname, this.config.globalConfig.outputPath);
    const outputDir = path.dirname(outputPath);

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(this.allEvents, null, 2), 'utf8');
    console.log(`💾 Saved ${this.allEvents.length} events to ${outputPath}`);

    return {
      inserted: this.allEvents.length,
      updated: 0,
      skipped: 0,
      file: outputPath
    };
  }

  /**
   * Complete scraping workflow
   */
  async run() {
    try {
      console.log('🎬 Starting complete scraping workflow...');

      // Step 1: Run all scrapers
      const scrapingResults = await this.runAllScrapers();

      if (this.allEvents.length === 0) {
        console.log('📭 No events scraped, workflow complete');
        return scrapingResults;
      }

      // Step 2: Process events (topic matching, geocoding)
      await this.processEvents();

      // Step 3: Remove duplicates
      this.deduplicateEvents();

      // Step 4: Save to database
      const saveResults = await this.saveToDatabase();

      // Step 5: Generate summary
      const summary = {
        scraping: scrapingResults,
        processing: {
          totalEvents: this.allEvents.length,
          topicsMatched: this.allEvents.filter(e => e.eventTopics?.length > 0).length,
          geocoded: this.allEvents.filter(e => e.latitude && e.longitude).length
        },
        saving: saveResults,
        completedAt: new Date().toISOString()
      };

      console.log('\\n🎉 Scraping workflow completed successfully!');
      this.printSummary(summary);

      return summary;
    } catch (error) {
      console.error(`❌ Workflow failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Print workflow summary
   */
  printSummary(summary) {
    console.log('\\n📋 WORKFLOW SUMMARY');
    console.log('═'.repeat(50));

    console.log('\\n🎯 SCRAPING RESULTS:');
    for (const [scraperId, result] of Object.entries(summary.scraping.scrapers)) {
      console.log(`  ${result.name}: ${result.eventsFound} events`);
      if (result.error) {
        console.log(`    ❌ Error: ${result.error}`);
      }
    }

    console.log('\\n🔄 PROCESSING RESULTS:');
    console.log(`  📊 Total events: ${summary.processing.totalEvents}`);
    console.log(`  🏷️  Topics matched: ${summary.processing.topicsMatched}`);
    console.log(`  🌍 Geocoded: ${summary.processing.geocoded}`);

    console.log('\\n💾 SAVING RESULTS:');
    console.log(`  ➕ Inserted: ${summary.saving.inserted}`);
    console.log(`  🔄 Updated: ${summary.saving.updated}`);
    console.log(`  ⏭️  Skipped: ${summary.saving.skipped}`);

    console.log(`\\n✅ Completed at: ${summary.completedAt}`);
  }

  /**
   * Utility: Clean text
   */
  cleanText(text, maxLength = 200) {
    if (!text) return '';
    return text.trim().replace(/\\s+/g, ' ').substring(0, maxLength);
  }

  /**
   * Utility: Validate URL
   */
  validateUrl(url) {
    if (!url) return '';
    try {
      new URL(url);
      return url;
    } catch {
      return '';
    }
  }

  /**
   * List available scrapers
   */
  listScrapers() {
    console.log('\\n📋 Available Scrapers:');
    console.log('═'.repeat(40));

    for (const [scraperId, scraperConfig] of Object.entries(this.config.scrapers)) {
      const status = scraperConfig.enabled ? '✅ Enabled' : '⏸️ Disabled';
      console.log(`${scraperId}:`);
      console.log(`  Name: ${scraperConfig.name}`);
      console.log(`  Type: ${scraperConfig.type}`);
      console.log(`  URL: ${scraperConfig.url}`);
      console.log(`  Status: ${status}`);
      console.log('');
    }
  }

  /**
   * Enable/disable a scraper
   */
  toggleScraper(scraperId, enabled = true) {
    if (!this.config.scrapers[scraperId]) {
      throw new Error(`Scraper not found: ${scraperId}`);
    }

    this.config.scrapers[scraperId].enabled = enabled;
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');

    console.log(`${enabled ? '✅ Enabled' : '⏸️ Disabled'} scraper: ${scraperId}`);
  }
}