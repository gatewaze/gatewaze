import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

// Lazy initialization of Supabase client
let supabase = null;

// Extract Supabase project ref from JWT token to construct direct URL
function extractProjectRef(jwt) {
  try {
    const payload = jwt.split('.')[1];
    const decoded = JSON.parse(Buffer.from(payload, 'base64').toString());
    return decoded.ref;
  } catch {
    return null;
  }
}

function getSupabaseClient() {
  if (!supabase) {
    // Check if we're running with a specific brand
    const brandId = process.env.VITE_BRAND_ID;

    if (brandId) {
      // Load brand-specific environment file with override
      const brandEnvFile = `.env.${brandId}.local`;
      const result = dotenv.config({ path: resolve(rootDir, brandEnvFile), override: true });

      if (!result.error) {
        console.log(`✅ Event image service loaded ${Object.keys(result.parsed).length} variables from ${brandEnvFile}`);
      }
    } else {
      // Load environment variables from .env.local as fallback
      dotenv.config({ path: '.env.local' });
    }

    // Supabase configuration - use environment variables for brand-specific database
    let supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://data.tech.tickets';

    // Use service role key for server-side storage operations (bypasses RLS)
    // Falls back to anon key if service role not available
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ||
                        process.env.VITE_SUPABASE_ANON_KEY ||
                        process.env.SUPABASE_ANON_KEY;

    const keyType = process.env.SUPABASE_SERVICE_ROLE_KEY ? 'service_role' : 'anon';

    // If using a custom domain (not *.supabase.co), extract project ref from JWT
    // and provide direct URL as fallback for Docker containers that may not resolve custom domains
    if (!supabaseUrl.includes('supabase.co')) {
      const projectRef = extractProjectRef(supabaseKey);
      if (projectRef) {
        // Use direct Supabase URL for server-side operations (Docker containers)
        const directUrl = `https://${projectRef}.supabase.co`;
        console.log(`📊 Event image service: Custom domain detected (${supabaseUrl})`);
        console.log(`📊 Using direct Supabase URL for storage: ${directUrl}`);
        supabaseUrl = directUrl;
      }
    }

    console.log(`📊 Event image service connecting to: ${supabaseUrl} (${keyType})`);

    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
  }

  return supabase;
}

/**
 * Upload an event preview image to Supabase Storage
 * @param {Buffer} imageBuffer - The image buffer to upload
 * @param {string} eventId - The event ID
 * @param {string} fileExtension - File extension (default: 'jpg')
 * @returns {Promise<{success: boolean, url?: string, error?: string, path?: string}>}
 */
export async function uploadEventImage(imageBuffer, eventId, fileExtension = 'jpg') {
  try {
    const fileName = `${eventId}.${fileExtension}`;
    const filePath = `event-previews/${fileName}`;

    console.log(`  📤 Uploading event image to Supabase: ${filePath}`);

    // Upload file to storage
    const { data, error } = await getSupabaseClient().storage
      .from('event-images')
      .upload(filePath, imageBuffer, {
        upsert: true, // Overwrite existing files
        contentType: `image/${fileExtension === 'jpg' ? 'jpeg' : fileExtension}`,
        cacheControl: '3600', // Cache for 1 hour
      });

    if (error) {
      console.error(`  ❌ Failed to upload event image: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }

    // Get public URL
    const { data: urlData } = getSupabaseClient().storage
      .from('event-images')
      .getPublicUrl(data.path);

    console.log(`  ✅ Event image uploaded successfully: ${urlData.publicUrl}`);

    return {
      success: true,
      url: urlData.publicUrl,
      path: data.path,
    };
  } catch (error) {
    console.error(`  ❌ Error uploading event image: ${error.message}`);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Delete an event image from Supabase Storage
 * @param {string} imagePath - The storage path of the image
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function deleteEventImage(imagePath) {
  try {
    console.log(`  🗑️  Deleting event image from Supabase: ${imagePath}`);

    const { error } = await getSupabaseClient().storage
      .from('event-images')
      .remove([imagePath]);

    if (error) {
      console.error(`  ❌ Failed to delete event image: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }

    console.log(`  ✅ Event image deleted successfully`);

    return {
      success: true,
    };
  } catch (error) {
    console.error(`  ❌ Error deleting event image: ${error.message}`);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Get event image URL from storage path
 * @param {string} imagePath - The storage path
 * @returns {string} - The public URL
 */
export function getEventImageUrl(imagePath) {
  const { data } = getSupabaseClient().storage
    .from('event-images')
    .getPublicUrl(imagePath);

  return data.publicUrl;
}

/**
 * Check if event image exists in storage
 * @param {string} eventId - The event ID
 * @returns {Promise<boolean>}
 */
export async function eventImageExists(eventId) {
  try {
    const filePath = `event-previews/${eventId}.jpg`;
    const { data, error } = await getSupabaseClient().storage
      .from('event-images')
      .list('event-previews', {
        search: `${eventId}.jpg`,
      });

    if (error) {
      return false;
    }

    return data && data.length > 0;
  } catch {
    return false;
  }
}

/**
 * Update event screenshot status in database
 * @param {string} eventId - The event UUID
 * @param {boolean} success - Whether screenshot generation was successful
 * @param {string|null} screenshotUrl - The URL of the screenshot
 * @param {number} retries - Number of retries
 * @returns {Promise<boolean>}
 */
export async function updateScreenshotStatus(eventId, success, screenshotUrl = null, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // Use RPC function to bypass RLS policies (same as UI does)
      const { data, error } = await getSupabaseClient().rpc('update_event_screenshot_status', {
        p_event_id: eventId,
        p_screenshot_generated: success,
        p_screenshot_url: screenshotUrl || null,
        p_screenshot_generated_at: success ? new Date().toISOString() : null,
      });

      if (error) {
        console.error(`  ❌ Database update failed for ${eventId} (attempt ${attempt}):`, error.message);
        if (attempt === retries) return false;
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
        continue;
      }

      // RPC returns true/false, not a data array
      if (data === true) {
        console.log(`  📊 Database updated for ${eventId}: screenshot_generated=${success}`);
        return true;
      } else {
        console.error(`  ❌ Update failed for ${eventId} (attempt ${attempt})`);
        if (attempt === retries) return false;
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
      }
    } catch (error) {
      console.error(`  ❌ Database update error for ${eventId} (attempt ${attempt}):`, error.message);
      if (attempt === retries) return false;
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
    }
  }
  return false;
}
