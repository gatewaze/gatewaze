/**
 * Luma Content Handler
 *
 * Processes luma_page_data from scraped events:
 * 1. Converts ProseMirror description_mirror to HTML
 * 2. Downloads images from lumacdn.com and uploads to Supabase
 * 3. Extracts speakers and talks using AI
 * 4. Updates the event with processed content
 */

import crypto from 'crypto';
import { supabase } from '../supabase-client.js';
import { ProseMirrorConverter } from '../lib/prosemirror-converter.js';
import { processAllImages } from '../lib/event-content-image-service.js';
import { extractSpeakers } from '../lib/luma-speaker-extractor.js';

/**
 * Compute MD5 hash of description_mirror for change detection
 * @param {Object} descriptionMirror
 * @returns {string|null}
 */
function computeHash(descriptionMirror) {
  if (!descriptionMirror) return null;
  return crypto.createHash('md5').update(JSON.stringify(descriptionMirror)).digest('hex');
}

/**
 * Extract description_mirror from luma_page_data
 * @param {Object} lumaPageData
 * @returns {Object|null}
 */
function extractDescriptionMirror(lumaPageData) {
  if (!lumaPageData) return null;

  // Try different paths based on Luma's page structure
  const paths = [
    lumaPageData?.pageProps?.initialData?.data?.description_mirror,
    lumaPageData?.pageProps?.data?.description_mirror,
    lumaPageData?.data?.description_mirror,
  ];

  for (const path of paths) {
    if (path && typeof path === 'object') {
      return path;
    }
  }

  return null;
}

/**
 * Extract event title from luma_page_data
 * @param {Object} lumaPageData
 * @returns {string|null}
 */
function extractEventTitle(lumaPageData) {
  if (!lumaPageData) return null;

  const paths = [
    lumaPageData?.pageProps?.initialData?.data?.event?.name,
    lumaPageData?.pageProps?.data?.event?.name,
    lumaPageData?.data?.event?.name,
  ];

  for (const path of paths) {
    if (path && typeof path === 'string') {
      return path;
    }
  }

  return null;
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
 * Process Luma content for a single event
 * @param {string} eventId - Event UUID
 * @param {Object} [options] - Processing options
 * @param {boolean} [options.extractSpeakers=true] - Whether to extract speakers using AI
 * @param {boolean} [options.processImages=true] - Whether to download and re-host images
 * @param {boolean} [options.forceReprocess=false] - Reprocess even if content unchanged
 * @param {Function} [logger] - Optional logger function
 * @returns {Promise<ProcessingResult>}
 */
export async function processLumaContent(eventId, options = {}, logger = console.log) {
  const {
    extractSpeakers: shouldExtractSpeakers = true,
    processImages = true,
    forceReprocess = false,
  } = options;

  try {
    logger(`📝 Processing Luma content for event: ${eventId}`);

    // 1. Fetch event with luma_page_data
    const { data: event, error: fetchError } = await supabase
      .from('events')
      .select('id, event_title, luma_page_data, luma_page_data_hash, luma_processing_status')
      .eq('id', eventId)
      .single();

    if (fetchError || !event) {
      return {
        success: false,
        error: `Event not found: ${fetchError?.message || 'No data'}`,
      };
    }

    if (!event.luma_page_data) {
      logger(`⏭️ No luma_page_data for event ${eventId}`);
      await updateEventStatus(eventId, 'skipped', null, null, 'No luma_page_data');
      return {
        success: true,
        html: null,
        hash: null,
        stats: { skipped: true, reason: 'No luma_page_data' },
      };
    }

    // 2. Extract description_mirror
    const descriptionMirror = extractDescriptionMirror(event.luma_page_data);
    if (!descriptionMirror) {
      logger(`⏭️ No description_mirror in luma_page_data for event ${eventId}`);
      await updateEventStatus(eventId, 'skipped', null, null, 'No description_mirror');
      return {
        success: true,
        html: null,
        hash: null,
        stats: { skipped: true, reason: 'No description_mirror' },
      };
    }

    // 3. Check for changes using hash
    const newHash = computeHash(descriptionMirror);
    if (!forceReprocess && event.luma_page_data_hash === newHash && event.luma_processing_status === 'completed') {
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

    // 5. Convert ProseMirror to HTML
    logger(`🔄 Converting ProseMirror to HTML...`);
    const converter = new ProseMirrorConverter();
    let html = converter.convert(descriptionMirror);
    const images = converter.getImages();

    logger(`📄 Generated ${html.length} characters of HTML with ${images.length} images`);

    // 6. Process images (download from Luma, upload to Supabase)
    let imageStats = { processed: 0, failed: 0 };
    if (processImages && images.length > 0) {
      logger(`📷 Processing ${images.length} images...`);
      const urlMap = await processAllImages(images, eventId);

      // Replace image URLs in HTML
      for (const [originalUrl, newUrl] of urlMap) {
        if (originalUrl !== newUrl) {
          html = ProseMirrorConverter.replaceImageUrl(html, originalUrl, newUrl);
          imageStats.processed++;
        } else {
          imageStats.failed++;
        }
      }

      logger(`📷 Images processed: ${imageStats.processed} success, ${imageStats.failed} failed`);
    }

    // 7. Extract speakers using AI (optional)
    let speakers = [];
    let speakerStats = { extracted: 0, created: 0, matched: 0, errors: 0 };
    if (shouldExtractSpeakers) {
      const eventTitle = extractEventTitle(event.luma_page_data) || event.event_title;
      logger(`🤖 Extracting speakers for: ${eventTitle}`);

      const extractionResult = await extractSpeakers(html, eventTitle);
      if (extractionResult.success) {
        speakers = extractionResult.speakers || [];
        speakerStats.extracted = speakers.length;
        logger(`✅ Extracted ${speakers.length} speakers`);

        if (extractionResult.usage) {
          logger(`📊 AI tokens: ${extractionResult.usage.inputTokens} input, ${extractionResult.usage.outputTokens} output`);
        }

        // Create speakers in the database
        if (speakers.length > 0) {
          logger(`📝 Creating ${speakers.length} speakers in database...`);
          const creationResult = await createSpeakersFromExtraction(eventId, speakers, { createSpeakers: true }, logger);
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
        luma_processed_html: html,
        luma_page_data_hash: newHash,
        luma_processing_status: 'completed',
        luma_processed_at: new Date().toISOString(),
        luma_processing_error: null,
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
    luma_processing_status: status,
  };

  if (html !== null) update.luma_processed_html = html;
  if (hash !== null) update.luma_page_data_hash = hash;
  if (error !== null) update.luma_processing_error = error;
  if (status === 'completed') update.luma_processed_at = new Date().toISOString();

  await supabase.from('events').update(update).eq('id', eventId);
}

/**
 * Process multiple events (batch processing)
 * @param {string[]} eventIds - Array of event UUIDs
 * @param {Object} [options] - Processing options
 * @param {Function} [logger] - Optional logger function
 * @returns {Promise<{processed: number, failed: number, skipped: number}>}
 */
export async function processLumaContentBatch(eventIds, options = {}, logger = console.log) {
  const stats = { processed: 0, failed: 0, skipped: 0 };

  for (const eventId of eventIds) {
    const result = await processLumaContent(eventId, options, logger);

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
export async function findEventsNeedingProcessing(options = {}) {
  const { limit = 50, includeFailed = false } = options;

  let query = supabase
    .from('events')
    .select('id')
    .not('luma_page_data', 'is', null)
    .or('luma_processing_status.is.null,luma_processing_status.eq.pending');

  if (includeFailed) {
    query = supabase
      .from('events')
      .select('id')
      .not('luma_page_data', 'is', null)
      .or('luma_processing_status.is.null,luma_processing_status.eq.pending,luma_processing_status.eq.failed');
  }

  const { data, error } = await query.limit(limit);

  if (error) {
    console.error('Error finding events:', error);
    return [];
  }

  return data?.map((e) => e.id) || [];
}

/**
 * Create speakers and talks from extracted data
 * Uses the create_placeholder_speaker_with_talk RPC function
 * @param {string} eventId - Event UUID
 * @param {Array} speakers - Extracted speaker data
 * @param {Object} [options] - Options
 * @param {boolean} [options.createSpeakers=true] - Whether to create speakers in the database
 * @param {Function} [logger] - Optional logger function
 * @returns {Promise<{created: number, matched: number, errors: string[]}>}
 */
export async function createSpeakersFromExtraction(eventId, speakers, options = {}, logger = console.log) {
  const { createSpeakers = true } = options;
  const result = { created: 0, matched: 0, errors: [] };

  if (!createSpeakers) {
    logger(`⏭️ Speaker creation disabled, skipping ${speakers.length} speakers`);
    return result;
  }

  for (let i = 0; i < speakers.length; i++) {
    const speaker = speakers[i];
    try {
      logger(`👤 Processing speaker ${i + 1}/${speakers.length}: ${speaker.name}`);

      // Parse name into first/last
      const nameParts = (speaker.name || '').trim().split(/\s+/);
      const firstName = speaker.firstName || nameParts[0] || '';
      const lastName = speaker.lastName || nameParts.slice(1).join(' ') || '';

      // Get the first talk (if any)
      const primaryTalk = speaker.talks && speaker.talks.length > 0 ? speaker.talks[0] : null;

      // Call the RPC function to create speaker with talk
      // Status is 'placeholder' for AI-extracted speakers without email addresses
      const { data, error } = await supabase.rpc('create_placeholder_speaker_with_talk', {
        p_event_uuid: eventId,
        p_first_name: firstName,
        p_last_name: lastName,
        p_company: speaker.company || null,
        p_job_title: speaker.jobTitle || null,
        p_linkedin_url: speaker.linkedinUrl || null,
        p_bio: speaker.bio || null,
        p_photo_url: speaker.photoUrl || null,
        p_speaker_title: null, // Could be 'Speaker' or extracted from content
        p_is_featured: false,
        p_sort_order: i,
        p_talk_title: primaryTalk?.title || '-',
        p_talk_synopsis: primaryTalk?.synopsis || '-',
        p_talk_duration_minutes: primaryTalk?.durationMinutes || null,
        p_talk_session_type: 'talk',
        p_talk_status: 'placeholder',
      });

      if (error) {
        throw new Error(error.message);
      }

      if (data.is_existing) {
        logger(`  ✓ Matched existing customer (ID: ${data.customer_id})`);
        result.matched++;
      } else {
        logger(`  ✓ Created new placeholder speaker (ID: ${data.speaker_id})`);
        result.created++;
      }

      // Log details
      logger(`    Company: ${speaker.company || 'N/A'}`);
      logger(`    Job Title: ${speaker.jobTitle || 'N/A'}`);
      if (speaker.linkedinUrl) {
        logger(`    LinkedIn: ${speaker.linkedinUrl}`);
      }
      if (primaryTalk) {
        logger(`    Talk: ${primaryTalk.title}`);
      }

      // Create additional talks if speaker has multiple
      if (speaker.talks && speaker.talks.length > 1) {
        for (let j = 1; j < speaker.talks.length; j++) {
          const additionalTalk = speaker.talks[j];
          try {
            // Check if this speaker already has a talk with this title for this event
            const { data: existingTalk } = await supabase
              .from('event_talk_speakers')
              .select('talk_id, event_talks!inner(id, title)')
              .eq('speaker_id', data.speaker_id)
              .eq('event_talks.event_uuid', eventId)
              .ilike('event_talks.title', additionalTalk.title)
              .limit(1)
              .maybeSingle();

            if (existingTalk) {
              logger(`    Talk: ${additionalTalk.title} (already exists, skipped)`);
              continue;
            }

            // Create additional talk and link to speaker
            const { data: talkData, error: talkError } = await supabase
              .from('event_talks')
              .insert({
                event_uuid: eventId,
                title: additionalTalk.title,
                synopsis: additionalTalk.synopsis || null,
                duration_minutes: additionalTalk.durationMinutes || null,
                session_type: 'talk',
                status: 'placeholder',
                submitted_at: new Date().toISOString(),
              })
              .select('id')
              .single();

            if (talkError) {
              logger(`    ⚠️ Failed to create additional talk: ${talkError.message}`);
            } else {
              // Link speaker to talk
              await supabase.from('event_talk_speakers').insert({
                talk_id: talkData.id,
                speaker_id: data.speaker_id,
                role: 'presenter',
                is_primary: true,
              });
              logger(`    Talk: ${additionalTalk.title} (additional)`);
            }
          } catch (talkErr) {
            logger(`    ⚠️ Failed to create additional talk: ${talkErr.message}`);
          }
        }
      }
    } catch (error) {
      logger(`  ❌ Error: ${error.message}`);
      result.errors.push(`Failed to create speaker ${speaker.name}: ${error.message}`);
    }
  }

  logger(`✅ Speaker processing complete: ${result.created} created, ${result.matched} matched, ${result.errors.length} errors`);
  return result;
}

export default {
  processLumaContent,
  processLumaContentBatch,
  findEventsNeedingProcessing,
  createSpeakersFromExtraction,
};
