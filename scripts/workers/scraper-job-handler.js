/**
 * Scraper Job Handler
 *
 * Core scraper job logic extracted from scraper-worker.js for use with BullMQ.
 * This module provides the runScraperJob function that runs a scraper job
 * and uses a provided logger for output (which publishes to Redis for SSE).
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

// Region mapping helper
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

// Generate 6-character event ID
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

// Determine event status based on completeness
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

// Setup job-specific temporary directory
function setupJobDirectory(jobId) {
  const scriptDir = path.resolve(__dirname, '..');
  const jobTempDir = path.join(scriptDir, 'temp', `job-${jobId}`);

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

// Cleanup job directory
function cleanupJobDirectory(jobTempDir) {
  try {
    if (fs.existsSync(jobTempDir)) {
      fs.rmSync(jobTempDir, { recursive: true, force: true });
    }
  } catch (error) {
    console.warn(`Failed to cleanup temp directory: ${error.message}`);
  }
}

// Update job status in database
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

    const { error } = await supabase.rpc('update_scraper_job_v2', params);

    if (error) {
      console.error(`Failed to update job status: ${error.message}`);
    }
  } catch (error) {
    console.error(`Failed to update job status: ${error.message}`);
  }
}

/**
 * Run a scraper job
 * @param {number} jobId - The scraper_jobs database ID
 * @param {object} logger - Logger object with log, progress, complete, error methods
 * @returns {object} Result with stats
 */
export async function runScraperJob(jobId, logger) {
  let jobTempDir = null;
  let scraper = null;

  try {
    logger.log(`🔧 Starting scraper job ${jobId}`);

    // Update job status to running
    await updateJobStatus(jobId, 'running');

    // Get job details from database
    logger.log(`📊 Fetching job details from database...`);
    const { data: jobData, error: jobError } = await supabase.rpc('get_scraper_job', {
      job_id: jobId
    });

    if (jobError || !jobData || jobData.length === 0) {
      // Job was deleted from database - log and skip gracefully (don't retry)
      logger.log(`⚠️ Job ${jobId} not found in database - may have been deleted. Skipping.`);
      const skipError = new Error(`Job not found in database: ${jobId} - skipping`);
      skipError.skipRetry = true; // Signal to not retry this job
      throw skipError;
    }

    const job = jobData[0];
    logger.log(`✅ Job loaded: ${job.scraper_name} (${job.event_type})`);

    // Get scraper configuration
    const { data: scraperData } = await supabase
      .from('scrapers')
      .select('*')
      .eq('id', job.scraper_id)
      .single();

    if (!scraperData) {
      throw new Error('Scraper configuration not found');
    }

    logger.log(`📋 Scraper config loaded: ${scraperData.name}`);

    // Setup job-specific directory
    const paths = setupJobDirectory(jobId);
    jobTempDir = paths.jobTempDir;
    logger.log(`📁 Created job temp directory: ${jobTempDir}`);

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
        supabaseUrl: process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
        supabaseKey: process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY,
        tableName: 'events'
      },
      topicsPath: path.resolve(scriptDir, '..', 'topics.json'),
      geocoding: {
        cachePath: paths.geocodingCachePath,
        enabled: true
      }
    };

    // Initialize processing services
    const topicMatcher = new TopicMatcher(globalConfig.topicsPath);
    const geocodingService = new GeocodingService(globalConfig.geocoding);
    const eventProcessor = new EventProcessor(scriptDir);

    scraper = new ScraperClass(scraperConfig, globalConfig);

    // Pass geocoding service to scraper if supported
    if (scraper && typeof scraper === 'object') {
      scraper.geocodingService = geocodingService;
    }

    logger.log(`🔧 Scraper initialized: ${scraperData.scraper_type}`);
    logger.log(`📋 Event processor ready: ${eventProcessor.getStats().countryCodesLoaded} countries, ${eventProcessor.getStats().regionsSupported.length} regions`);

    // Run scraper
    logger.log(`🚀 Starting scrape operation...`);
    const events = await scraper.scrape();

    logger.log(`✅ Scraping completed! Found ${events?.length || 0} events`);
    logger.progress(scraper.stats);

    // Process and save events to database
    logger.log(`🔄 Processing events (cleaning, country/region mapping, topic matching, geocoding)...`);

    let processedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    let filteredCount = 0;

    for (const event of events) {
      try {
        // Filter out unwanted events
        if (eventProcessor.shouldFilterOut(event)) {
          filteredCount++;
          logger.log(`⏭️ Filtered: ${event.eventTitle}`);
          continue;
        }

        // Process event
        const cleanedEvent = eventProcessor.processEvent(event);

        // Match topics
        const contentForMatching = cleanedEvent.eventTitle + ' ' +
          (cleanedEvent.description || '') + ' ' +
          (cleanedEvent.pageContent || '');
        cleanedEvent.eventTopics = await topicMatcher.matchTopics(contentForMatching);

        // Geocode if needed (skip if scraper already provided coordinates, e.g., from Luma)
        if (cleanedEvent.coordinates || cleanedEvent.eventLocation) {
          // Scraper provided coordinates - use them directly
          if (cleanedEvent.coordinates) {
            cleanedEvent.latitude = cleanedEvent.coordinates.lat;
            cleanedEvent.longitude = cleanedEvent.coordinates.lng;
            logger.log(`📍 Using coordinates from scraper: ${cleanedEvent.coordinates.lat},${cleanedEvent.coordinates.lng}`);
          }
          // eventLocation already set from scraper (lat,lng format)
        } else if (geocodingService && cleanedEvent.eventCity && cleanedEvent.eventCity.toLowerCase() !== 'online') {
          const coordinates = await geocodingService.geocode(
            cleanedEvent.eventCity,
            cleanedEvent.eventCountryCode
          );

          if (coordinates) {
            cleanedEvent.latitude = coordinates.lat;
            cleanedEvent.longitude = coordinates.lng;
            cleanedEvent.eventLocation = `${coordinates.lat},${coordinates.lng}`;
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
              logger.log(`⚠️ Could not find existing event with UUID ${existingEventUuid}`, 'warn');
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
              logger.log(`⚠️ Failed to upload cover image: ${error.message}`, 'warn');
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
            listing_type: 'active',
            source_type: 'scraper',
            source_details: {
              scraper_name: cleanedEvent.scraperName || job.scraper_name || 'worker_scraper',
              api_endpoint: '/api/scrapers',
              scraped_timestamp: new Date().toISOString(),
              job_id: jobId
            },
            // Event ID fields for registration matching
            luma_event_id: cleanedEvent.lumaEventId || cleanedEvent.luma_event_id || null,
            source_event_id: cleanedEvent.sourceEventId || cleanedEvent.source_event_id || null,
            // Timezone from scraper (e.g., from Luma __NEXT_DATA__)
            event_timezone: cleanedEvent.eventTimezone || cleanedEvent.event_timezone || null,
            // Location coordinates from scraper (e.g., from Luma __NEXT_DATA__)
            event_location: cleanedEvent.eventLocation || cleanedEvent.event_location || null,
            // Full __NEXT_DATA__ JSON from Luma page (refreshed on each scrape)
            luma_page_data: cleanedEvent.lumaPageData || cleanedEvent.luma_page_data || null,
            // Full __NEXT_DATA__ JSON from Meetup page (refreshed on each scrape)
            meetup_page_data: cleanedEvent.meetupPageData || cleanedEvent.meetup_page_data || null
          };

          dbEvent.status = determineEventStatus(dbEvent);

          // Insert or update
          let error;
          if (isUpdate) {
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
              p_listing_type: dbEvent.listing_type,
              p_event_region: dbEvent.event_region,
              p_event_location: dbEvent.event_location || cleanedEvent.eventLocation || null,
              p_event_topics_updated_at: null,
              p_event_type: dbEvent.event_type,
              p_venue_address: cleanedEvent.venueAddress || null,
              p_scraped_by: cleanedEvent.scraperName || job.scraper_name || 'worker_scraper',
              p_scraper_id: job.scraper_id,
              p_source_type: dbEvent.source_type,
              p_source_details: dbEvent.source_details,
              p_event_timezone: dbEvent.event_timezone || null,
              p_luma_event_id: dbEvent.luma_event_id,
              p_source_event_id: dbEvent.source_event_id,
              p_luma_page_data: dbEvent.luma_page_data,
              p_meetup_page_data: dbEvent.meetup_page_data
            };
            const result = await supabase.rpc('update_event', updateParams);
            error = result.error;
          } else {
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
              p_listing_type: dbEvent.listing_type,
              p_event_region: dbEvent.event_region,
              p_event_location: dbEvent.event_location || cleanedEvent.eventLocation || null,
              p_event_topics_updated_at: null,
              p_event_type: dbEvent.event_type,
              p_venue_address: cleanedEvent.venueAddress || null,
              p_scraped_by: cleanedEvent.scraperName || job.scraper_name || 'worker_scraper',
              p_scraper_id: job.scraper_id,
              p_source_type: dbEvent.source_type,
              p_source_details: dbEvent.source_details,
              p_event_timezone: dbEvent.event_timezone || null,
              p_luma_event_id: dbEvent.luma_event_id,
              p_source_event_id: dbEvent.source_event_id,
              p_luma_page_data: dbEvent.luma_page_data,
              p_meetup_page_data: dbEvent.meetup_page_data
            };
            const result = await supabase.rpc('create_event', createParams);
            error = result.error;
            // Capture the new event UUID for luma_processing_status update
            var newEventUuid = result.data;
          }

          if (error) {
            if (error.code === '23505' || error.message?.includes('Duplicate event link')) {
              skippedCount++;
              logger.log(`⏭️  Skipped duplicate: ${cleanedEvent.eventTitle} (link already exists)`);
            } else {
              failedCount++;
              logger.log(`❌ Failed to ${isUpdate ? 'update' : 'insert'}: ${cleanedEvent.eventTitle} - ${error.message}`, 'error');
            }
          } else {
            processedCount++;
            logger.log(`✅ ${isUpdate ? 'Updated' : 'Saved'}: ${cleanedEvent.eventTitle}`);

            // Update screenshot if available
            if (screenshotUrl && screenshotGeneratedAt) {
              await supabase.rpc('update_event_screenshot_status', {
                p_event_id: eventId,
                p_screenshot_generated: true,
                p_screenshot_url: screenshotUrl,
                p_screenshot_generated_at: screenshotGeneratedAt,
              });
            }

            // Log page data if present (now included in RPC calls)
            if (dbEvent.luma_page_data || dbEvent.meetup_page_data) {
              const dataTypes = [];
              if (dbEvent.luma_page_data) dataTypes.push('Luma');
              if (dbEvent.meetup_page_data) dataTypes.push('Meetup');
              logger.log(`📄 Saved ${dataTypes.join(' & ')} page data for ${cleanedEvent.eventTitle}`);

              // Trigger Luma content processing for events with luma_page_data
              if (dbEvent.luma_page_data) {
                const eventUuid = isUpdate ? existingEventUuid : newEventUuid;
                if (eventUuid) {
                  await supabase
                    .from('events')
                    .update({ luma_processing_status: 'pending' })
                    .eq('id', eventUuid);
                  logger.log(`🔄 Queued Luma content processing for ${cleanedEvent.eventTitle}`);
                }
              }
            }
          }
        } catch (dbError) {
          failedCount++;
          logger.log(`❌ Database error for ${cleanedEvent.eventTitle}: ${dbError.message}`, 'error');
        }
      } catch (error) {
        failedCount++;
        logger.log(`❌ Failed to process event: ${error.message}`, 'error');
      }
    }

    logger.log(`📊 Final stats: ${processedCount} processed, ${skippedCount} skipped, ${failedCount} failed, ${filteredCount} filtered`);

    // Update job as completed
    await updateJobStatus(jobId, 'completed', {
      found: events?.length || 0,
      total: events?.length || 0,
      processed: processedCount,
      skipped: skippedCount,
      failed: failedCount
    });

    const result = {
      processed: processedCount,
      skipped: skippedCount,
      failed: failedCount,
      filtered: filteredCount,
      total: events?.length || 0
    };

    logger.complete(true, result);

    // Cleanup
    cleanupJobDirectory(jobTempDir);

    logger.log(`✅ Scraper job completed successfully`);

    return result;

  } catch (error) {
    logger.log(`❌ Scraper job failed: ${error.message}`, 'error');
    logger.error(error);

    // Clean up browser to prevent orphaned Chromium processes
    if (scraper) {
      try {
        await scraper.cleanup();
      } catch (cleanupError) {
        logger.log(`⚠️ Browser cleanup failed: ${cleanupError.message}`, 'warn');
      }
    }

    // Update job as failed
    await updateJobStatus(jobId, 'failed', {
      error: error.message
    });

    logger.complete(false, {
      error: error.message
    });

    // Cleanup on error
    if (jobTempDir) {
      cleanupJobDirectory(jobTempDir);
    }

    throw error;
  }
}
