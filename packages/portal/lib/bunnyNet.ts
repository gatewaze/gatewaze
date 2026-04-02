/**
 * Bunny.net CDN Integration
 * Proxies Supabase Storage through Bunny CDN for optimized image delivery
 */

interface ResizeOptions {
  width?: number
  height?: number
  quality?: number
  fit?: 'contain' | 'cover' | 'fill'
}

function getBunnyConfig() {
  const pullzoneUrl = process.env.NEXT_PUBLIC_BUNNY_PULLZONE_URL || ''
  const enabled = process.env.NEXT_PUBLIC_BUNNY_CDN_ENABLED === 'true'
  return { pullzoneUrl, enabled }
}

export function isBunnyCDNEnabled(): boolean {
  const config = getBunnyConfig()
  return config.enabled && !!config.pullzoneUrl
}

export function getBunnyImageUrl(
  supabaseUrl: string,
  resize?: ResizeOptions
): string {
  const config = getBunnyConfig()

  if (!config.enabled || !config.pullzoneUrl) {
    return supabaseUrl
  }

  try {
    const url = new URL(supabaseUrl)

    // Use /storage/v1/object/public/ path to get original image (avoids Supabase transformation quota)
    let imagePath = url.pathname
    if (imagePath.includes('/render/image/public/')) {
      imagePath = imagePath.replace('/render/image/public/', '/object/public/')
    }

    const bunnyBaseUrl = config.pullzoneUrl.replace(/\/$/, '')
    let bunnyUrl = `${bunnyBaseUrl}${imagePath}`

    const params = new URLSearchParams()
    if (resize) {
      if (resize.width) params.append('width', resize.width.toString())
      if (resize.height) params.append('height', resize.height.toString())
      if (resize.quality) params.append('quality', resize.quality.toString())
      if (resize.fit === 'cover') params.append('aspect_ratio', 'crop')
      else if (resize.fit === 'fill') params.append('aspect_ratio', 'fill')
    }

    const queryString = params.toString()
    if (queryString) {
      bunnyUrl += `?${queryString}`
    }

    return bunnyUrl
  } catch {
    return supabaseUrl
  }
}
