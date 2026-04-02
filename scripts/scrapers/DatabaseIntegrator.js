import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Database integrator for saving scraped events to the database
 */
export class DatabaseIntegrator {
  constructor(config) {
    this.config = config || {};
    // Use the same Supabase credentials as the main gatewaze-admin app
    this.supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || this.config.supabaseUrl || 'https://data.tech.tickets';
    this.supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || this.config.supabaseKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFqemxka29obG9reW1lcmxvYmZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgzMTE4NjAsImV4cCI6MjA3Mzg4Nzg2MH0.EnDLHAXdg-cxdlpMNC6Et5NjFCj-ls2gVkqxG4RpbxQ';
    this.tableName = this.config.tableName || 'events';

    console.log(`🔗 Using Supabase URL: ${this.supabaseUrl}`);
  }

  /**
   * Initialize Supabase client
   */
  async initialize() {
    if (!this.supabaseUrl || !this.supabaseKey) {
      return false;
    }

    try {
      // Import Supabase client dynamically
      const { createClient } = await import('@supabase/supabase-js');
      this.supabase = createClient(this.supabaseUrl, this.supabaseKey);
      console.log('✅ Database connection initialized');
      return true;
    } catch (error) {
      console.warn(`⚠️ Failed to initialize database connection: ${error.message}`);
      return false;
    }
  }

  /**
   * Insert events into the database with deduplication
   */
  async insertEvents(events) {
    if (!events || events.length === 0) {
      return { inserted: 0, updated: 0, skipped: 0, errors: [] };
    }

    const initialized = await this.initialize();
    if (!initialized) {
      console.log('💾 Database not available, falling back to JSON file');
      return this.saveToJsonFile(events);
    }

    console.log(`💾 Inserting ${events.length} events into database...`);

    const results = {
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: []
    };

    for (const event of events) {
      try {
        // Check if event already exists
        const existing = await this.findExistingEvent(event);

        if (existing) {
          // Update existing event if data has changed
          if (this.hasEventChanged(existing, event)) {
            await this.updateEvent(existing.id, event);
            results.updated++;
            console.log(`🔄 Updated: ${event.eventTitle}`);
          } else {
            results.skipped++;
            console.log(`⏭️ Skipped (no changes): ${event.eventTitle}`);
          }
        } else {
          // Insert new event
          await this.insertEvent(event);
          results.inserted++;
          console.log(`➕ Inserted: ${event.eventTitle}`);
        }
      } catch (error) {
        console.error(`❌ Error processing event "${event.eventTitle}": ${error.message}`);
        results.errors.push({
          event: event.eventTitle,
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * Normalize URL for comparison (remove trailing slashes)
   */
  normalizeUrl(url) {
    if (!url) return '';
    return url.trim().replace(/\/+$/, '');
  }

  /**
   * Find existing event in database
   */
  async findExistingEvent(event) {
    try {
      const eventLink = this.normalizeUrl(event.eventLink || event.event_link);
      const eventTitle = event.eventTitle || event.event_title;
      const eventStart = event.eventStart || event.event_start;

      // First try to match by URL (most reliable)
      // Check both with and without trailing slash to catch duplicates
      if (eventLink) {
        const { data, error } = await this.supabase
          .from(this.tableName)
          .select('*')
          .or(`event_link.eq.${eventLink},event_link.eq.${eventLink}/`)
          .limit(1);

        if (!error && data && data.length > 0) {
          return data[0];
        }
      }

      // Fallback: match by title and date
      if (eventTitle && eventStart) {
        const { data, error } = await this.supabase
          .from(this.tableName)
          .select('*')
          .eq('event_title', eventTitle)
          .eq('event_start', eventStart)
          .limit(1);

        if (!error && data && data.length > 0) {
          return data[0];
        }
      }

      return null;
    } catch (error) {
      console.warn(`⚠️ Error finding existing event: ${error.message}`);
      return null;
    }
  }

  /**
   * Check if event data has changed significantly
   */
  hasEventChanged(existingEvent, newEvent) {
    // Always update if new event has lumaPageData - we want to refresh this on every scrape
    if (newEvent.lumaPageData) {
      console.log(`🔄 Event has lumaPageData - will update to refresh Luma page data`);
      return true;
    }

    // Always update if new event has meetupPageData - we want to refresh this on every scrape
    if (newEvent.meetupPageData) {
      console.log(`🔄 Event has meetupPageData - will update to refresh Meetup page data`);
      return true;
    }

    const fieldsToCompare = [
      'event_title',
      'event_start',
      'event_end',
      'event_city',
      'event_country_code',
      'event_region',
      'event_topics',
      'latitude',
      'longitude',
      'luma_event_id'
    ];

    for (const field of fieldsToCompare) {
      const existingValue = existingEvent[field];
      const newValue = newEvent[this.mapFieldName(field)];

      // Handle array comparisons (like topics)
      if (Array.isArray(existingValue) && Array.isArray(newValue)) {
        if (JSON.stringify(existingValue.sort()) !== JSON.stringify(newValue.sort())) {
          return true;
        }
      } else if (existingValue !== newValue) {
        return true;
      }
    }

    return false;
  }

  /**
   * Map field names from scraper format to database format
   */
  mapFieldName(dbField) {
    const fieldMap = {
      'event_title': 'eventTitle',
      'event_link': 'eventLink',
      'event_start': 'eventStart',
      'event_end': 'eventEnd',
      'event_city': 'eventCity',
      'event_country_code': 'eventCountryCode',
      'event_region': 'eventRegion',
      'event_type': 'eventType',
      'event_topics': 'eventTopics',
      'latitude': 'latitude',
      'longitude': 'longitude',
      'luma_event_id': 'lumaEventId',
      'luma_page_data': 'lumaPageData',
      'meetup_page_data': 'meetupPageData'
    };

    return fieldMap[dbField] || dbField;
  }

  /**
   * Insert a new event into the database
   */
  async insertEvent(event) {
    const dbEvent = this.formatEventForDatabase(event);

    const { data, error } = await this.supabase
      .from(this.tableName)
      .insert([dbEvent])
      .select();

    if (error) {
      throw new Error(`Database insert failed: ${error.message}`);
    }

    return data[0];
  }

  /**
   * Update an existing event in the database
   */
  async updateEvent(eventId, event) {
    const dbEvent = this.formatEventForDatabase(event);

    // For updates, we want to preserve the original source info but update the scraper details
    const updateData = {
      ...dbEvent,
      // Update source_details to include scraper update info
      source_details: {
        ...dbEvent.source_details,
        last_scraped_by: event.scraperName || 'unknown',
        update_count: 1 // This could be incremented if we track it
      }
    };

    const { data, error } = await this.supabase
      .from(this.tableName)
      .update(updateData)
      .eq('id', eventId)
      .select();

    if (error) {
      throw new Error(`Database update failed: ${error.message}`);
    }

    return data[0];
  }

  /**
   * Format event data for database insertion
   */
  formatEventForDatabase(event) {
    // Only include fields that exist in the database schema
    const dbEvent = {
      event_id: event.eventId || '', // Required field
      event_title: event.eventTitle || '',
      event_link: event.eventLink || '',
      event_start: event.eventStart || null,
      event_end: event.eventEnd || null,
      event_city: event.eventCity || '',
      event_country_code: event.eventCountryCode || '',
      event_region: event.eventRegion || '',
      event_type: event.eventType || 'conference',
      event_topics: event.eventTopics || [],
      // Luma event ID for registration matching (evt-XXX format)
      luma_event_id: event.lumaEventId || null,
      // Full __NEXT_DATA__ JSON from Luma page (refreshed on each scrape)
      // This clears and updates with fresh data each time the scraper runs
      luma_page_data: event.lumaPageData || null,
      // Full __NEXT_DATA__ JSON from Meetup.com page (refreshed on each scrape)
      // This clears and updates with fresh data each time the scraper runs
      meetup_page_data: event.meetupPageData || null,
      // New audit fields
      source_type: 'scraper',
      source_details: {
        scraper_name: event.scraperName || 'unknown',
        scraper_run_id: event.scraperRunId || null,
        original_url: event.eventLink || null,
        scraped_timestamp: new Date().toISOString()
      }
    };

    // Add event_location if latitude and longitude are available
    if (event.latitude && event.longitude) {
      // Simple lat,lon format (matches admin UI geocoding format)
      dbEvent.event_location = `${event.latitude},${event.longitude}`;
      console.log(`📍 Setting event_location for ${event.eventTitle}: ${dbEvent.event_location}`);
    }

    // Remove any undefined values that might cause issues
    Object.keys(dbEvent).forEach(key => {
      if (dbEvent[key] === undefined) {
        delete dbEvent[key];
      }
    });

    return dbEvent;
  }

  /**
   * Fallback: Save events to JSON file when database is not available
   */
  async saveToJsonFile(events) {
    const outputPath = path.resolve(__dirname, '../scraped-events.json');
    const outputDir = path.dirname(outputPath);

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Load existing events
    let existingEvents = [];
    if (fs.existsSync(outputPath)) {
      try {
        const data = fs.readFileSync(outputPath, 'utf8');
        existingEvents = JSON.parse(data);
      } catch (error) {
        console.warn(`⚠️ Could not load existing events: ${error.message}`);
      }
    }

    // Deduplicate events
    const results = { inserted: 0, updated: 0, skipped: 0, errors: [] };
    const existingUrls = new Set(existingEvents.map(e => e.eventLink));

    for (const event of events) {
      if (existingUrls.has(event.eventLink)) {
        results.skipped++;
      } else {
        existingEvents.push(event);
        existingUrls.add(event.eventLink);
        results.inserted++;
      }
    }

    // Save updated events
    fs.writeFileSync(outputPath, JSON.stringify(existingEvents, null, 2), 'utf8');
    console.log(`💾 Saved ${results.inserted} new events to ${outputPath}`);

    return results;
  }

  /**
   * Test database connection
   */
  async testConnection() {
    try {
      const initialized = await this.initialize();
      if (!initialized) {
        return { success: false, message: 'Database credentials not configured' };
      }

      const { data, error } = await this.supabase
        .from(this.tableName)
        .select('count(*)')
        .limit(1);

      if (error) {
        throw error;
      }

      return {
        success: true,
        message: `Connected to database, ${this.tableName} table accessible`
      };
    } catch (error) {
      return {
        success: false,
        message: `Database connection failed: ${error.message}`
      };
    }
  }

  /**
   * Get database statistics
   */
  async getStats() {
    try {
      const initialized = await this.initialize();
      if (!initialized) {
        return { totalEvents: 0, recentEvents: 0, message: 'Database not available' };
      }

      // Get total events count
      const { data: totalData, error: totalError } = await this.supabase
        .from(this.tableName)
        .select('id', { count: 'exact' });

      if (totalError) throw totalError;

      // Get recent events (last 7 days)
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);

      const { data: recentData, error: recentError } = await this.supabase
        .from(this.tableName)
        .select('id', { count: 'exact' })
        .gte('created_at', weekAgo.toISOString());

      if (recentError) throw recentError;

      return {
        totalEvents: totalData.length,
        recentEvents: recentData.length,
        message: 'Database statistics retrieved successfully'
      };
    } catch (error) {
      return {
        totalEvents: 0,
        recentEvents: 0,
        message: `Error getting stats: ${error.message}`
      };
    }
  }

  /**
   * Clean up old events (optional maintenance)
   */
  async cleanupOldEvents(daysOld = 365) {
    try {
      const initialized = await this.initialize();
      if (!initialized) {
        return { deleted: 0, message: 'Database not available' };
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      const { data, error } = await this.supabase
        .from(this.tableName)
        .delete()
        .lt('event_end', cutoffDate.toISOString())
        .select('id');

      if (error) throw error;

      return {
        deleted: data.length,
        message: `Cleaned up ${data.length} old events`
      };
    } catch (error) {
      return {
        deleted: 0,
        message: `Cleanup failed: ${error.message}`
      };
    }
  }
}