/**
 * Meetup Content Handler
 *
 * Processes meetup_page_data from scraped Meetup events:
 * 1. Converts Markdown description to HTML
 * 2. Downloads images from meetupstatic.com and uploads to Supabase
 * 3. Extracts speakers and talks using AI
 * 4. Updates the event with processed content
 */

import crypto from 'crypto';
import { supabase } from '../supabase-client.js';
import { MarkdownConverter } from '../lib/markdown-converter.js';
import { processAllImages } from '../lib/event-content-image-service.js';
import { extractSpeakers } from '../lib/luma-speaker-extractor.js';
import { createSpeakersFromExtraction } from './luma-content-handler.js';
import { uploadEventImage } from '../event-image-service.js';

/**
 * Compute MD5 hash of description for change detection
 * @param {string} description
 * @returns {string|null}
 */
function computeHash(description) {
  if (!description) return null;
  return crypto.createHash('md5').update(description).digest('hex');
}

/**
 * Extract event data from meetup_page_data
 * @param {Object} meetupPageData
 * @returns {Object|null}
 */
function extractMeetupEvent(meetupPageData) {
  if (!meetupPageData) return null;

  // Try different paths based on Meetup's page structure
  const paths = [
    meetupPageData?.props?.pageProps?.event,
    meetupPageData?.pageProps?.event,
    meetupPageData?.event,
  ];

  for (const path of paths) {
    if (path && typeof path === 'object') {
      return path;
    }
  }

  return null;
}

/**
 * Extract event title from meetup_page_data
 * @param {Object} meetupPageData
 * @returns {string|null}
 */
function extractEventTitle(meetupPageData) {
  const event = extractMeetupEvent(meetupPageData);
  return event?.title || null;
}

/**
 * Extract description from meetup_page_data
 * @param {Object} meetupPageData
 * @returns {string|null}
 */
function extractDescription(meetupPageData) {
  const event = extractMeetupEvent(meetupPageData);
  return event?.description || null;
}

/**
 * Extract featured photo URL from meetup_page_data
 * @param {Object} meetupPageData
 * @returns {string|null}
 */
function extractFeaturedPhoto(meetupPageData) {
  const event = extractMeetupEvent(meetupPageData);
  if (!event?.featuredEventPhoto) return null;

  const photo = event.featuredEventPhoto;
  // Meetup uses baseUrl + id pattern, or has a source/highResUrl directly
  if (photo.source) return photo.source;
  if (photo.highResUrl) return photo.highResUrl;
  if (photo.baseUrl && photo.id) {
    // Common pattern: baseUrl/id/highres.jpeg
    return `${photo.baseUrl}${photo.id}/highres_${photo.id}.jpeg`;
  }
  return null;
}

/**
 * Extract event hosts from meetup_page_data (not speakers, but organizers)
 * @param {Object} meetupPageData
 * @returns {Array}
 */
function extractHosts(meetupPageData) {
  const event = extractMeetupEvent(meetupPageData);
  if (!event?.eventHosts) return [];

  return event.eventHosts.map((host) => ({
    id: host.id || host.memberId,
    name: host.name,
    photoUrl: host.memberPhoto
      ? host.memberPhoto.baseUrl
        ? `${host.memberPhoto.baseUrl}${host.memberPhoto.id}/member_${host.memberPhoto.id}.jpeg`
        : null
      : null,
  }));
}

/**
 * Download image from URL and return as buffer
 * @param {string} url
 * @returns {Promise<{buffer: Buffer, contentType: string}|null>}
 */
async function downloadImage(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`Failed to download image: ${response.status} ${response.statusText}`);
      return null;
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    return { buffer, contentType };
  } catch (error) {
    console.error(`Error downloading image from ${url}:`, error.message);
    return null;
  }
}

/**
 * Process and upload the featured event photo from Meetup
 * Downloads the image and uploads it to Supabase storage
 * @param {string} eventId - Event UUID
 * @param {Object} meetupPageData - The Meetup page data
 * @param {Function} [logger] - Optional logger function
 * @returns {Promise<{success: boolean, url?: string, error?: string}>}
 */
export async function processFeaturedPhoto(eventId, meetupPageData, logger = console.log) {
  const photoUrl = extractFeaturedPhoto(meetupPageData);

  if (!photoUrl) {
    logger(`📷 No featured photo found in Meetup data`);
    return { success: true, url: null };
  }

  logger(`📷 Downloading featured photo from Meetup: ${photoUrl}`);

  // Download the image
  const imageData = await downloadImage(photoUrl);
  if (!imageData) {
    return { success: false, error: 'Failed to download featured photo' };
  }

  // Determine file extension from content type
  let extension = 'jpg';
  if (imageData.contentType.includes('png')) extension = 'png';
  else if (imageData.contentType.includes('webp')) extension = 'webp';
  else if (imageData.contentType.includes('gif')) extension = 'gif';

  logger(`📤 Uploading featured photo to Supabase (${imageData.buffer.length} bytes, ${extension})`);

  // Upload to Supabase
  const uploadResult = await uploadEventImage(imageData.buffer, eventId, extension);

  if (!uploadResult.success) {
    return { success: false, error: uploadResult.error };
  }

  logger(`✅ Featured photo uploaded: ${uploadResult.url}`);

  // Update the event's screenshot_url with the new URL
  const { error: updateError } = await supabase
    .from('events')
    .update({ screenshot_url: uploadResult.url })
    .eq('id', eventId);

  if (updateError) {
    logger(`⚠️ Failed to update screenshot_url: ${updateError.message}`);
  } else {
    logger(`✅ Updated event screenshot_url`);
  }

  return { success: true, url: uploadResult.url };
}

/**
 * @typedef {Object} ProcessingResult
 * @property {boolean} success
 * @property {string} [html] - Processed HTML content
 * @property {string} [hash] - Content hash for change detection
 * @property {Array} [speakers] - Extracted speakers (if AI extraction enabled)
 * @property {string} [error] - Error message if failed
 * @property {Object} [stats] - Processing statistics
 */

/**
 * Process Meetup content for a single event
 * @param {string} eventId - Event UUID
 * @param {Object} [options] - Processing options
 * @param {boolean} [options.extractSpeakers=true] - Whether to extract speakers using AI
 * @param {boolean} [options.processImages=true] - Whether to download and re-host images
 * @param {boolean} [options.forceReprocess=false] - Reprocess even if content unchanged
 * @param {Function} [logger] - Optional logger function
 * @returns {Promise<ProcessingResult>}
 */
export async function processMeetupContent(eventId, options = {}, logger = console.log) {
  const {
    extractSpeakers: shouldExtractSpeakers = true,
    processImages = true,
    forceReprocess = false,
  } = options;

  try {
    logger(`📝 Processing Meetup content for event: ${eventId}`);

    // 1. Fetch event with meetup_page_data
    const { data: event, error: fetchError } = await supabase
      .from('events')
      .select('id, event_title, meetup_page_data, meetup_page_data_hash, meetup_processing_status')
      .eq('id', eventId)
      .single();

    if (fetchError || !event) {
      return {
        success: false,
        error: `Event not found: ${fetchError?.message || 'No data'}`,
      };
    }

    if (!event.meetup_page_data) {
      logger(`⏭️ No meetup_page_data for event ${eventId}`);
      await updateEventStatus(eventId, 'skipped', null, null, 'No meetup_page_data');
      return {
        success: true,
        html: null,
        hash: null,
        stats: { skipped: true, reason: 'No meetup_page_data' },
      };
    }

    // 2. Extract description
    const description = extractDescription(event.meetup_page_data);
    if (!description) {
      logger(`⏭️ No description in meetup_page_data for event ${eventId}`);
      await updateEventStatus(eventId, 'skipped', null, null, 'No description');
      return {
        success: true,
        html: null,
        hash: null,
        stats: { skipped: true, reason: 'No description' },
      };
    }

    // 3. Check for changes using hash
    const newHash = computeHash(description);
    if (
      !forceReprocess &&
      event.meetup_page_data_hash === newHash &&
      event.meetup_processing_status === 'completed'
    ) {
      logger(`⏭️ Content unchanged for event ${eventId} (hash match)`);
      return {
        success: true,
        html: null,
        hash: newHash,
        stats: { skipped: true, reason: 'Content unchanged' },
      };
    }

    // 4. Mark as processing
    await updateEventStatus(eventId, 'processing');

    // 5. Convert Markdown to HTML
    logger(`🔄 Converting Markdown to HTML...`);
    const converter = new MarkdownConverter();
    let html = converter.convert(description);
    const images = converter.getImages();

    logger(`📄 Generated ${html.length} characters of HTML with ${images.length} images`);

    // 6. Process images (download from Meetup, upload to Supabase)
    let imageStats = { processed: 0, failed: 0 };
    if (processImages && images.length > 0) {
      logger(`📷 Processing ${images.length} images...`);
      const urlMap = await processAllImages(images, eventId);

      // Replace image URLs in HTML
      for (const [originalUrl, newUrl] of urlMap) {
        if (originalUrl !== newUrl) {
          html = MarkdownConverter.replaceImageUrl(html, originalUrl, newUrl);
          imageStats.processed++;
        } else {
          imageStats.failed++;
        }
      }

      logger(`📷 Images processed: ${imageStats.processed} success, ${imageStats.failed} failed`);
    }

    // 6b. Process featured event photo (download from Meetup, upload to Supabase)
    let featuredPhotoResult = { success: true, url: null };
    if (processImages) {
      featuredPhotoResult = await processFeaturedPhoto(eventId, event.meetup_page_data, logger);
      if (!featuredPhotoResult.success) {
        logger(`⚠️ Failed to process featured photo: ${featuredPhotoResult.error}`);
      }
    }

    // 7. Extract speakers using AI (optional)
    // Note: Meetup doesn't have a dedicated speakers section - speakers are in the description
    let speakers = [];
    let speakerStats = { extracted: 0, created: 0, matched: 0, errors: 0 };
    if (shouldExtractSpeakers) {
      const eventTitle = extractEventTitle(event.meetup_page_data) || event.event_title;
      logger(`🤖 Extracting speakers for: ${eventTitle}`);

      const extractionResult = await extractSpeakers(html, eventTitle);
      if (extractionResult.success) {
        speakers = extractionResult.speakers || [];
        speakerStats.extracted = speakers.length;
        logger(`✅ Extracted ${speakers.length} speakers`);

        if (extractionResult.usage) {
          logger(
            `📊 AI tokens: ${extractionResult.usage.inputTokens} input, ${extractionResult.usage.outputTokens} output`
          );
        }

        // Create speakers in the database
        if (speakers.length > 0) {
          logger(`📝 Creating ${speakers.length} speakers in database...`);
          const creationResult = await createSpeakersFromExtraction(
            eventId,
            speakers,
            { createSpeakers: true },
            logger
          );
          speakerStats.created = creationResult.created;
          speakerStats.matched = creationResult.matched;
          speakerStats.errors = creationResult.errors.length;
        }
      } else {
        logger(`⚠️ Speaker extraction failed: ${extractionResult.error}`);
      }
    }

    // 8. Update event with processed content
    const { error: updateError } = await supabase
      .from('events')
      .update({
        meetup_processed_html: html,
        meetup_page_data_hash: newHash,
        meetup_processing_status: 'completed',
        meetup_processed_at: new Date().toISOString(),
        meetup_processing_error: null,
      })
      .eq('id', eventId);

    if (updateError) {
      throw new Error(`Failed to update event: ${updateError.message}`);
    }

    logger(`✅ Content processing completed for event ${eventId}`);

    return {
      success: true,
      html,
      hash: newHash,
      speakers,
      stats: {
        htmlLength: html.length,
        imageStats,
        speakerStats,
        featuredPhoto: featuredPhotoResult.url ? true : false,
      },
    };
  } catch (error) {
    console.error(`Error processing event ${eventId}:`, error);

    // Update status to failed
    await updateEventStatus(eventId, 'failed', null, null, error.message);

    return {
      success: false,
      error: error.message || 'Unknown error',
    };
  }
}

/**
 * Update event processing status
 * @param {string} eventId
 * @param {string} status
 * @param {string|null} html
 * @param {string|null} hash
 * @param {string|null} error
 */
async function updateEventStatus(eventId, status, html = null, hash = null, error = null) {
  const update = {
    meetup_processing_status: status,
  };

  if (html !== null) update.meetup_processed_html = html;
  if (hash !== null) update.meetup_page_data_hash = hash;
  if (error !== null) update.meetup_processing_error = error;
  if (status === 'completed') update.meetup_processed_at = new Date().toISOString();

  await supabase.from('events').update(update).eq('id', eventId);
}

/**
 * Process multiple events (batch processing)
 * @param {string[]} eventIds - Array of event UUIDs
 * @param {Object} [options] - Processing options
 * @param {Function} [logger] - Optional logger function
 * @returns {Promise<{processed: number, failed: number, skipped: number}>}
 */
export async function processMeetupContentBatch(eventIds, options = {}, logger = console.log) {
  const stats = { processed: 0, failed: 0, skipped: 0 };

  for (const eventId of eventIds) {
    const result = await processMeetupContent(eventId, options, logger);

    if (!result.success) {
      stats.failed++;
    } else if (result.stats?.skipped) {
      stats.skipped++;
    } else {
      stats.processed++;
    }

    // Small delay between events to avoid overwhelming resources
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return stats;
}

/**
 * Find events that need processing
 * @param {Object} [options]
 * @param {number} [options.limit=50] - Maximum number of events to return
 * @param {boolean} [options.includeFailed=false] - Include previously failed events
 * @returns {Promise<string[]>} Array of event UUIDs
 */
export async function findMeetupEventsNeedingProcessing(options = {}) {
  const { limit = 50, includeFailed = false } = options;

  let query = supabase
    .from('events')
    .select('id')
    .not('meetup_page_data', 'is', null)
    .or('meetup_processing_status.is.null,meetup_processing_status.eq.pending');

  if (includeFailed) {
    query = supabase
      .from('events')
      .select('id')
      .not('meetup_page_data', 'is', null)
      .or(
        'meetup_processing_status.is.null,meetup_processing_status.eq.pending,meetup_processing_status.eq.failed'
      );
  }

  const { data, error } = await query.limit(limit);

  if (error) {
    console.error('Error finding Meetup events:', error);
    return [];
  }

  return data?.map((e) => e.id) || [];
}

export default {
  processMeetupContent,
  processMeetupContentBatch,
  findMeetupEventsNeedingProcessing,
  processFeaturedPhoto,
};
