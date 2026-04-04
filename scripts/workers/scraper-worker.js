#!/usr/bin/env node

/**
 * Scraper Worker - Isolated Child Process
 *
 * This worker runs a single scraper job in complete isolation.
 * It communicates with the parent process via stdout (structured JSON logs)
 * and updates the job status in the database directly.
 *
 * Usage: node scraper-worker.js <jobId>
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { supabase } from '../supabase-client.js';
import { DevEventsConferenceScraper } from '../scrapers/DevEventsConferenceScraper.js';
import { DevEventsMeetupScraper } from '../scrapers/DevEventsMeetupScraper.js';
import { LumaEventsScraper } from '../scrapers/LumaEventsScraper.js';
import { LumaICalScraper } from '../scrapers/LumaICalScraper.js';
import { TopicMatcher } from '../scrapers/TopicMatcher.js';
import { GeocodingService } from '../scrapers/GeocodingService.js';
import { EventProcessor } from '../scrapers/EventProcessor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Scraper class mapping
const scraperClasses = {
  'DevEventsConferenceScraper': DevEventsConferenceScraper,
  'DevEventsMeetupScraper': DevEventsMeetupScraper,
  'LumaEventsScraper': LumaEventsScraper,
  'LumaICalScraper': LumaICalScraper
};

// Save original console.log at module level to avoid recursion
const originalConsoleLog = console.log;

/**
 * Structured logging - all output goes through stdout as JSON
 * Also persists logs to database if table exists
 */
function sendLog(message, level = 'info', metadata = null) {
  const logData = {
    type: 'log',
    level,
    message: `[${new Date().toLocaleTimeString()}] ${message}`,
    timestamp: new Date().toISOString()
  };
  originalConsoleLog(JSON.stringify(logData));

  // Also persist to database (async, non-blocking)
  persistLog(message, 'log', level, metadata).catch(() => {
    // Silently fail if table doesn't exist yet
  });
}

/**
 * Persist log to database
 * Fails silently if scraper_job_logs table doesn't exist
 */
async function persistLog(message, logType = 'log', logLevel = 'info', metadata = null) {
  const jobId = parseInt(process.argv[2]);
  if (!jobId || isNaN(jobId)) return;

  try {
    await supabase.rpc('scrapers_insert_job_log', {
      p_job_id: jobId,
      p_log_type: logType,
      p_log_level: logLevel,
      p_message: message,
      p_metadata: metadata
    });
  } catch (error) {
    // Silently fail - table may not exist yet
  }
}

function sendProgress(stats) {
  const progressData = {
    type: 'progress',
    stats,
    timestamp: new Date().toISOString()
  };
  originalConsoleLog(JSON.stringify(progressData));

  // Persist to database
  persistLog('Progress update', 'progress', 'info', stats).catch(() => {});
}

function sendComplete(success, stats = {}) {
  const completeData = {
    type: 'complete',
    success,
    stats,
    timestamp: new Date().toISOString()
  };
  originalConsoleLog(JSON.stringify(completeData));

  // Persist to database
  persistLog(
    success ? 'Job completed successfully' : 'Job failed',
    'complete',
    success ? 'info' : 'error',
    stats
  ).catch(() => {});
}

function sendError(error) {
  const errorData = {
    type: 'error',
    error: error.message || String(error),
    stack: error.stack,
    timestamp: new Date().toISOString()
  };
  originalConsoleLog(JSON.stringify(errorData));

  // Persist to database
  persistLog(
    error.message || String(error),
    'error',
    'error',
    { stack: error.stack }
  ).catch(() => {});
}

/**
 * Update job status in database
 */
async function updateJobStatus(jobId, status, stats = {}) {
  try {
    const params = {
      job_id: jobId,
      new_status: status
    };

    if (status === 'completed' || status === 'failed') {
      params.items_found_count = stats.found || stats.total || 0;
      params.items_processed_count = stats.processed || 0;
      params.items_skipped_count = stats.skipped || 0;
      params.items_failed_count = stats.failed || 0;

      if (status === 'failed' && stats.error) {
        params.error_msg = stats.error;
      }
    }

    const { error } = await supabase.rpc('scrapers_update_job', params);

    if (error) {
      sendError(new Error(`Failed to update job status: ${error.message}`));
    }
  } catch (error) {
    sendError(new Error(`Failed to update job status: ${error.message}`));
  }
}

/**
 * Setup job-specific temporary directory
 */
function setupJobDirectory(jobId) {
  const scriptDir = path.resolve(__dirname, '..');
  const jobTempDir = path.join(scriptDir, 'temp', `job-${jobId}`);

  // Create temp directory if it doesn't exist
  if (!fs.existsSync(jobTempDir)) {
    fs.mkdirSync(jobTempDir, { recursive: true });
  }

  return {
    jobTempDir,
    outputPath: path.join(jobTempDir, 'scraped-events.json'),
    processedEventsPath: path.join(jobTempDir, 'processed-events.json'),
    geocodingCachePath: path.join(jobTempDir, 'geocoding-cache.json')
  };
}

/**
 * Cleanup job directory
 */
function cleanupJobDirectory(jobTempDir) {
  try {
    if (fs.existsSync(jobTempDir)) {
      fs.rmSync(jobTempDir, { recursive: true, force: true });
      sendLog(`🧹 Cleaned up temp directory: ${jobTempDir}`);
    }
  } catch (error) {
    sendLog(`⚠️ Failed to cleanup temp directory: ${error.message}`, 'warn');
  }
}

/**
 * Helper function to generate a 6-character event ID
 */
function generateEventId(existingIds = new Set()) {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const numbers = '0123456789';
  let id;

  do {
    id = '';
    const letterCount = 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < letterCount; i++) {
      id += letters[Math.floor(Math.random() * letters.length)];
    }
    const remainingChars = 6 - letterCount;
    for (let i = 0; i < remainingChars; i++) {
      id += numbers[Math.floor(Math.random() * numbers.length)];
    }
    id = id.split('').sort(() => Math.random() - 0.5).join('');
  } while (existingIds.has(id));

  return id;
}

/**
 * Helper function to determine event status based on completeness
 */
function determineEventStatus(event) {
  const hasStartTime = event.event_start && event.event_start !== '';
  const hasEndTime = event.event_end && event.event_end !== '';
  const hasLocation = event.event_city && event.event_city !== '';
  const hasLink = event.event_link && event.event_link !== '';

  if (hasStartTime && hasEndTime && hasLocation && hasLink) {
    return 'complete';
  } else {
    return 'incomplete';
  }
}

/**
 * Helper function to map region names to 2-character codes
 */
function mapRegionToCode(regionName) {
  if (!regionName) return '';
  if (regionName.length === 2) return regionName.toLowerCase();

  const regionMap = {
    "Asia": "as", "Africa": "af", "Europe": "eu",
    "North America": "na", "South America": "sa", "Oceania": "oc",
    "Online": "on", "Central America": "na", "Caribbean": "na",
    "Middle East": "as", "Eastern Europe": "eu", "Western Europe": "eu",
    "Northern Europe": "eu", "Southern Europe": "eu", "Southeast Asia": "as",
    "East Asia": "as", "South Asia": "as", "Central Asia": "as",
    "North Africa": "af", "Sub-Saharan Africa": "af", "West Africa": "af",
    "East Africa": "af", "Southern Africa": "af", "Central Africa": "af",
    "Nordic": "eu", "Baltic": "eu", "Balkan": "eu", "Scandinavia": "eu",
    "APAC": "as", "EMEA": "eu", "LATAM": "sa"
  };

  return regionMap[regionName] || '';
}

/**
 * Main worker function
 */
async function runWorker() {
  const jobId = parseInt(process.argv[2]);

  if (!jobId || isNaN(jobId)) {
    sendError(new Error('Invalid job ID provided'));
    process.exit(1);
  }

  sendLog(`🔧 Worker started for job ${jobId} (PID: ${process.pid})`);

  let jobTempDir = null;

  try {
    // Update job status to running
    await updateJobStatus(jobId, 'running');

    // Get job details from database
    sendLog(`📊 Fetching job details from database...`);
    const { data: jobData, error: jobError } = await supabase.rpc('scrapers_get_job', {
      job_id: jobId
    });

    if (jobError || !jobData || jobData.length === 0) {
      throw new Error(`Job not found: ${jobId}`);
    }

    const job = jobData[0];
    sendLog(`✅ Job loaded: ${job.scraper_name} (${job.event_type})`);

    // Get scraper configuration
    const { data: scraperData } = await supabase
      .from('scrapers')
      .select('*')
      .eq('id', job.scraper_id)
      .single();

    if (!scraperData) {
      throw new Error('Scraper configuration not found');
    }

    sendLog(`📋 Scraper config loaded: ${scraperData.name}`);

    // Setup job-specific directory
    const paths = setupJobDirectory(jobId);
    jobTempDir = paths.jobTempDir;
    sendLog(`📁 Created job temp directory: ${jobTempDir}`);

    // Initialize scraper class
    const ScraperClass = scraperClasses[scraperData.scraper_type];
    if (!ScraperClass) {
      throw new Error(`Unknown scraper type: ${scraperData.scraper_type}`);
    }

    const scriptDir = path.resolve(__dirname, '..');

    const scraperConfig = {
      id: scraperData.id,
      name: scraperData.name,
      description: scraperData.description,
      type: scraperData.event_type,
      url: scraperData.base_url,
      base_url: scraperData.base_url,
      config: {
        ...scraperData.config || {},
        baseUrl: scraperData.base_url,
        name: scraperData.name,
        account: scraperData.account || (scraperData.config || {}).account || null
      }
    };

    const globalConfig = {
      outputPath: paths.outputPath,
      processedEventsPath: paths.processedEventsPath,
      urlValidation: {
        enabled: true,
        timeout: 10000
      },
      database: {
        supabaseUrl: process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://data.tech.tickets',
        supabaseKey: process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFqemxka29obG9reW1lcmxvYmZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgzMTE4NjAsImV4cCI6MjA3Mzg4Nzg2MH0.EnDLHAXdg-cxdlpMNC6Et5NjFCj-ls2gVkqxG4RpbxQ',
        tableName: 'events'
      },
      topicsPath: path.resolve(scriptDir, '..', 'topics.json'),
      geocoding: {
        cachePath: paths.geocodingCachePath,
        enabled: true
      }
    };

    // Initialize processing services with job-specific configs
    const topicMatcher = new TopicMatcher(globalConfig.topicsPath);
    const geocodingService = new GeocodingService(globalConfig.geocoding);
    const eventProcessor = new EventProcessor(scriptDir);

    const scraper = new ScraperClass(scraperConfig, globalConfig);

    // Pass geocoding service to scraper if supported
    if (scraper && typeof scraper === 'object') {
      scraper.geocodingService = geocodingService;
    }

    sendLog(`🔧 Scraper initialized: ${scraperData.scraper_type}`);
    sendLog(`📋 Event processor ready: ${eventProcessor.getStats().countryCodesLoaded} countries, ${eventProcessor.getStats().regionsSupported.length} regions`);

    // Override console.log to capture scraper's internal logs
    console.log = (...args) => {
      // Send as structured log using sendLog (which uses originalConsoleLog internally)
      const message = args.join(' ');
      sendLog(message);
    };

    // Run scraper
    sendLog(`🚀 Starting scrape operation...`);
    const events = await scraper.scrape();

    // Restore console.log
    console.log = originalConsoleLog;

    sendLog(`✅ Scraping completed! Found ${events?.length || 0} events`);
    sendProgress(scraper.stats);

    // Process and save events to database
    sendLog(`🔄 Processing events (cleaning, country/region mapping, topic matching, geocoding)...`);

    let processedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    let filteredCount = 0;

    for (const event of events) {
      try {
        // Filter out unwanted events
        if (eventProcessor.shouldFilterOut(event)) {
          filteredCount++;
          sendLog(`⏭️ Filtered: ${event.eventTitle}`);
          continue;
        }

        // Process event
        const cleanedEvent = eventProcessor.processEvent(event);

        // Match topics
        const contentForMatching = cleanedEvent.eventTitle + ' ' +
          (cleanedEvent.description || '') + ' ' +
          (cleanedEvent.pageContent || '');
        cleanedEvent.eventTopics = await topicMatcher.matchTopics(contentForMatching);

        // Geocode if needed
        if (geocodingService && cleanedEvent.eventCity && cleanedEvent.eventCity.toLowerCase() !== 'online') {
          const coordinates = await geocodingService.geocode(
            cleanedEvent.eventCity,
            cleanedEvent.eventCountryCode
          );

          if (coordinates) {
            cleanedEvent.latitude = coordinates.lat;
            cleanedEvent.longitude = coordinates.lng;
          }
        }

        // Save to database
        try {
          // Check for duplicates
          const existingEventUuid = await eventProcessor.isDuplicate(cleanedEvent, supabase);
          const isUpdate = existingEventUuid !== null;

          // Get or generate event ID
          let eventId = cleanedEvent.eventId || cleanedEvent.event_id;

          if (isUpdate) {
            // For updates, fetch the existing event_id from the database
            const { data: existingEvent } = await supabase
              .from('events')
              .select('event_id')
              .eq('id', existingEventUuid)
              .single();

            if (existingEvent) {
              eventId = existingEvent.event_id;
            } else {
              sendLog(`⚠️ Could not find existing event with UUID ${existingEventUuid}`, 'warn');
            }
          } else {
            // For new events, generate a new ID if needed
            if (!eventId || eventId.length > 6) {
              const { data: existingEvents } = await supabase
                .from('events')
                .select('event_id');
              const existingIds = new Set(existingEvents?.map(e => e.event_id) || []);
              eventId = generateEventId(existingIds);
            }
          }

          // Handle cover image if available
          let screenshotUrl = null;
          let screenshotGeneratedAt = null;

          if (cleanedEvent.coverImageUrl) {
            try {
              const fetch = (await import('node-fetch')).default;
              const response = await fetch(cleanedEvent.coverImageUrl);

              if (response.ok) {
                const imageBuffer = Buffer.from(await response.arrayBuffer());

                let fileExtension = 'jpg';
                const contentType = response.headers.get('content-type');
                if (contentType) {
                  if (contentType.includes('png')) fileExtension = 'png';
                  else if (contentType.includes('webp')) fileExtension = 'webp';
                }

                const { uploadEventImage } = await import('../event-image-service.js');
                const uploadResult = await uploadEventImage(imageBuffer, eventId, fileExtension);

                if (uploadResult.success) {
                  screenshotUrl = uploadResult.url;
                  screenshotGeneratedAt = new Date().toISOString();
                }
              }
            } catch (error) {
              sendLog(`⚠️ Failed to upload cover image: ${error.message}`, 'warn');
            }
          }

          // Prepare database event object
          const dbEvent = {
            event_id: eventId,
            event_title: cleanedEvent.eventTitle || cleanedEvent.event_title,
            event_city: cleanedEvent.eventCity || cleanedEvent.event_city,
            event_country_code: (cleanedEvent.eventCountryCode && cleanedEvent.eventCountryCode.length <= 2) ? cleanedEvent.eventCountryCode : '',
            event_region: mapRegionToCode(cleanedEvent.eventRegion),
            event_link: cleanedEvent.eventLink || cleanedEvent.event_link,
            event_start: cleanedEvent.eventStart || cleanedEvent.event_start,
            event_end: cleanedEvent.eventEnd || cleanedEvent.event_end,
            event_type: cleanedEvent.eventType || cleanedEvent.event_type,
            event_topics: cleanedEvent.eventTopics || cleanedEvent.event_topics || [],
            source_type: 'scraper',
            source_details: {
              scraper_name: cleanedEvent.scraperName || job.scraper_name || 'worker_scraper',
              api_endpoint: '/api/scrapers',
              scraped_timestamp: new Date().toISOString(),
              job_id: jobId
            }
          };

          dbEvent.status = determineEventStatus(dbEvent);

          // Prepare RPC parameters
          let error;
          if (isUpdate) {
            // update_event doesn't use p_event_id, only p_id (UUID)
            const updateParams = {
              p_id: existingEventUuid,
              p_event_title: dbEvent.event_title,
              p_listing_intro: null,
              p_offer_result: null,
              p_offer_close_display: null,
              p_event_topics: dbEvent.event_topics || null,
              p_offer_ticket_details: null,
              p_offer_value: null,
              p_event_city: dbEvent.event_city,
              p_event_country_code: dbEvent.event_country_code,
              p_event_link: dbEvent.event_link,
              p_event_logo: null,
              p_offer_slug: null,
              p_offer_close_date: null,
              p_event_start: dbEvent.event_start,
              p_event_end: dbEvent.event_end,
              p_event_region: dbEvent.event_region,
              p_event_location: cleanedEvent.eventLocation || null,
              p_event_topics_updated_at: null,
              p_event_type: dbEvent.event_type,
              p_venue_address: cleanedEvent.venueAddress || null,
              p_scraped_by: cleanedEvent.scraperName || job.scraper_name || 'worker_scraper',
              p_scraper_id: job.scraper_id,
              p_source_type: dbEvent.source_type,
              p_source_details: dbEvent.source_details,
              p_event_timezone: dbEvent.event_timezone || 'UTC',
              p_content_category: scraperData.content_category || null
            };
            const result = await supabase.rpc('events_update', updateParams);
            error = result.error;
          } else {
            // create_event uses p_event_id (6-char string)
            const createParams = {
              p_event_id: dbEvent.event_id,
              p_event_title: dbEvent.event_title,
              p_listing_intro: null,
              p_offer_result: null,
              p_offer_close_display: null,
              p_event_topics: dbEvent.event_topics || null,
              p_offer_ticket_details: null,
              p_offer_value: null,
              p_event_city: dbEvent.event_city,
              p_event_country_code: dbEvent.event_country_code,
              p_event_link: dbEvent.event_link,
              p_event_logo: null,
              p_offer_slug: null,
              p_offer_close_date: null,
              p_event_start: dbEvent.event_start,
              p_event_end: dbEvent.event_end,
              p_event_region: dbEvent.event_region,
              p_event_location: cleanedEvent.eventLocation || null,
              p_event_topics_updated_at: null,
              p_event_type: dbEvent.event_type,
              p_venue_address: cleanedEvent.venueAddress || null,
              p_scraped_by: cleanedEvent.scraperName || job.scraper_name || 'worker_scraper',
              p_scraper_id: job.scraper_id,
              p_source_type: dbEvent.source_type,
              p_source_details: dbEvent.source_details,
              p_content_category: scraperData.content_category || null
            };
            const result = await supabase.rpc('events_create', createParams);
            error = result.error;
          }

if (error) {
            // Check if this is a duplicate event link error
            if (error.code === '23505' || error.message?.includes('Duplicate event link')) {
              skippedCount++;
              sendLog(`⏭️  Skipped duplicate: ${cleanedEvent.eventTitle} (link already exists)`, 'info');
            } else {
              failedCount++;
              sendLog(`❌ Failed to ${isUpdate ? 'update' : 'insert'}: ${cleanedEvent.eventTitle} - ${error.message}`, 'error');
            }
          } else {
            processedCount++;
            sendLog(`✅ ${isUpdate ? 'Updated' : 'Saved'}: ${cleanedEvent.eventTitle}`);

            // Update screenshot if available
            if (screenshotUrl && screenshotGeneratedAt) {
              await supabase.rpc('events_update_screenshot_status', {
                p_event_id: eventId,
                p_screenshot_generated: true,
                p_screenshot_url: screenshotUrl,
                p_screenshot_generated_at: screenshotGeneratedAt,
              });
            }
          }
        } catch (dbError) {
          failedCount++;
          sendLog(`❌ Database error for ${cleanedEvent.eventTitle}: ${dbError.message}`, 'error');
        }
      } catch (error) {
        failedCount++;
        sendLog(`❌ Failed to process event: ${error.message}`, 'error');
      }
    }

    sendLog(`📊 Final stats: ${processedCount} processed, ${skippedCount} skipped, ${failedCount} failed, ${filteredCount} filtered`);

    // Update job as completed
    await updateJobStatus(jobId, 'completed', {
      found: events?.length || 0,
      total: events?.length || 0,
      processed: processedCount,
      skipped: skippedCount,
      failed: failedCount
    });

    sendComplete(true, {
      processed: processedCount,
      skipped: skippedCount,
      failed: failedCount,
      filtered: filteredCount,
      total: events?.length || 0
    });

    // Cleanup
    cleanupJobDirectory(jobTempDir);

    sendLog(`✅ Worker completed successfully`);
    process.exit(0);

  } catch (error) {
    sendLog(`❌ Worker failed: ${error.message}`, 'error');
    sendError(error);

    // Update job as failed
    await updateJobStatus(jobId, 'failed', {
      error: error.message
    });

    sendComplete(false, {
      error: error.message
    });

    // Cleanup on error
    if (jobTempDir) {
      cleanupJobDirectory(jobTempDir);
    }

    process.exit(1);
  }
}

// Handle process signals for graceful shutdown
process.on('SIGTERM', async () => {
  sendLog('⚠️ Received SIGTERM, shutting down gracefully...', 'warn');
  const jobId = parseInt(process.argv[2]);
  if (jobId) {
    await updateJobStatus(jobId, 'failed', { error: 'Cancelled by user' });
  }
  process.exit(2); // Exit code 2 = cancelled
});

process.on('SIGINT', async () => {
  sendLog('⚠️ Received SIGINT, shutting down gracefully...', 'warn');
  const jobId = parseInt(process.argv[2]);
  if (jobId) {
    await updateJobStatus(jobId, 'failed', { error: 'Cancelled by user' });
  }
  process.exit(2);
});

// Handle uncaught errors
process.on('uncaughtException', async (error) => {
  sendLog(`❌ Uncaught exception: ${error.message}`, 'error');
  sendError(error);
  const jobId = parseInt(process.argv[2]);
  if (jobId) {
    await updateJobStatus(jobId, 'failed', { error: error.message });
  }
  process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
  sendLog(`❌ Unhandled rejection: ${reason}`, 'error');
  sendError(new Error(String(reason)));
  const jobId = parseInt(process.argv[2]);
  if (jobId) {
    await updateJobStatus(jobId, 'failed', { error: String(reason) });
  }
  process.exit(1);
});

// Run the worker
runWorker();
