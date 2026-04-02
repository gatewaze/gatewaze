/**
 * Bunny.net CDN Integration
 * Proxies Supabase Storage through Bunny CDN with watermarking
 */

interface BunnyConfig {
  pullzoneUrl: string;
  enabled: boolean;
}

function getBunnyConfig(): BunnyConfig {
  return {
    pullzoneUrl: import.meta.env.VITE_BUNNY_PULLZONE_URL || '',
    enabled: import.meta.env.VITE_BUNNY_CDN_ENABLED === 'true',
  };
}

interface WatermarkOptions {
  watermark?: string; // Path to watermark image
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
  opacity?: number; // 0.0 to 1.0
  margin?: number; // Pixels from edge
  size?: number; // Percentage of image width (0.15 = 15%)
}

interface ResizeOptions {
  width?: number;
  height?: number;
  quality?: number; // 1-100
  fit?: 'contain' | 'cover' | 'fill';
}

/**
 * Get brand-specific watermark configuration
 */
function getBrandWatermarkConfig(): WatermarkOptions {
  return {
    watermark: 'storage/v1/object/public/event-media/watermarks/gatewaze-logo.png',
    position: 'bottom-right',
    opacity: 0.7,
    margin: 20,
    size: 0.12,
  };
}

/**
 * Check if Bunny CDN is enabled
 */
export function isBunnyCDNEnabled(): boolean {
  const config = getBunnyConfig();
  return config.enabled && !!config.pullzoneUrl;
}

/**
 * Convert Supabase Storage URL to Bunny CDN URL with transformations
 * Bunny CDN handles all image transformations to save Supabase quota
 */
export function getBunnyImageUrl(
  supabaseUrl: string,
  options: {
    watermark?: boolean; // Apply brand watermark (reserved for future use)
    customWatermark?: WatermarkOptions; // Custom watermark settings (reserved for future use)
    resize?: ResizeOptions; // Resize options - Bunny CDN will handle these
  } = {}
): string {
  const config = getBunnyConfig();

  // If Bunny CDN is disabled, return original Supabase URL
  if (!config.enabled || !config.pullzoneUrl) {
    return supabaseUrl;
  }

  try {
    const url = new URL(supabaseUrl);

    // Use /storage/v1/object/public/ path (not /render/image/) to get original image
    // This avoids using Supabase's transformation quota
    let imagePath = url.pathname;
    if (imagePath.includes('/render/image/public/')) {
      imagePath = imagePath.replace('/render/image/public/', '/object/public/');
    }

    // Build Bunny CDN URL
    const bunnyBaseUrl = config.pullzoneUrl.replace(/\/$/, '');
    let bunnyUrl = `${bunnyBaseUrl}${imagePath}`;

    // Add Bunny CDN transformation parameters
    const params = new URLSearchParams();

    if (options.resize) {
      if (options.resize.width) {
        params.append('width', options.resize.width.toString());
      }
      if (options.resize.height) {
        params.append('height', options.resize.height.toString());
      }
      if (options.resize.quality) {
        params.append('quality', options.resize.quality.toString());
      }

      // Map resize mode to Bunny CDN aspect_ratio parameter
      if (options.resize.fit === 'cover') {
        params.append('aspect_ratio', 'crop');
      } else if (options.resize.fit === 'fill') {
        params.append('aspect_ratio', 'fill');
      }
      // For 'contain' or undefined, don't add aspect_ratio - Bunny will maintain aspect ratio
    }

    const queryString = params.toString();
    if (queryString) {
      bunnyUrl += `?${queryString}`;
    }

    return bunnyUrl;
  } catch (error) {
    console.error('[getBunnyImageUrl] Failed to parse URL:', error);
    return supabaseUrl;
  }
}

/**
 * Convert Supabase URL to Bunny CDN URL without watermark
 * Useful for video files or when watermark is not desired
 */
export function getBunnyCDNUrl(
  supabaseUrl: string,
  resize?: ResizeOptions
): string {
  return getBunnyImageUrl(supabaseUrl, {
    watermark: false,
    resize,
  });
}
