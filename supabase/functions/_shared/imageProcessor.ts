// Image processing utilities using ImageMagick WASM
// This is the recommended approach for Supabase Edge Functions

import {
  ImageMagick,
  initializeImageMagick,
  MagickFormat,
  MagickGeometry,
  Percentage,
} from 'npm:@imagemagick/magick-wasm@0.0.30'

export interface ProcessedImages {
  thumbnail: Uint8Array
  medium: Uint8Array
  thumbnailWidth: number
  thumbnailHeight: number
  mediumWidth: number
  mediumHeight: number
}

// Initialize ImageMagick once
let imageMagickInitialized = false

async function ensureImageMagickInitialized() {
  if (!imageMagickInitialized) {
    const wasmBytes = await Deno.readFile(
      new URL(
        'magick.wasm',
        import.meta.resolve('npm:@imagemagick/magick-wasm@0.0.30')
      )
    )
    await initializeImageMagick(wasmBytes)
    imageMagickInitialized = true
  }
}

/**
 * Process an image to create thumbnail and medium versions with sharpening
 * Optimized to reduce CPU usage by creating both versions in separate reads
 */
export async function processImage(imageBuffer: Uint8Array): Promise<ProcessedImages> {
  try {
    await ensureImageMagickInitialized()

    let thumbnailWidth = 0
    let thumbnailHeight = 0
    let mediumWidth = 0
    let mediumHeight = 0
    let thumbnail: Uint8Array
    let medium: Uint8Array

    // First, create a copy of the buffer to avoid detached buffer issues
    const buffer1 = new Uint8Array(imageBuffer)
    const buffer2 = new Uint8Array(imageBuffer)

    // Create thumbnail (350px wide) with lower quality for speed
    thumbnail = ImageMagick.read(buffer1, (img) => {
      const aspectRatio = img.height / img.width
      thumbnailWidth = 350
      thumbnailHeight = Math.round(thumbnailWidth * aspectRatio)

      // Resize
      img.resize(thumbnailWidth, thumbnailHeight)

      // Very light sharpening to reduce CPU time
      img.sharpen(0, 0.3)

      // Encode as JPEG with 80% quality (lower for speed)
      img.quality = 80
      return img.write(MagickFormat.Jpeg, (data) => data)
    })

    // Create medium (800px wide, or original if smaller)
    medium = ImageMagick.read(buffer2, (img) => {
      const aspectRatio = img.height / img.width
      mediumWidth = Math.min(800, img.width)
      mediumHeight = Math.round(mediumWidth * aspectRatio)

      // Resize
      img.resize(mediumWidth, mediumHeight)

      // Very light sharpening to reduce CPU time
      img.sharpen(0, 0.3)

      // Encode as JPEG with 85% quality (lower for speed)
      img.quality = 85
      return img.write(MagickFormat.Jpeg, (data) => data)
    })

    return {
      thumbnail,
      medium,
      thumbnailWidth,
      thumbnailHeight,
      mediumWidth,
      mediumHeight,
    }
  } catch (error) {
    console.error('Error in processImage:', error)
    throw new Error(
      `Image processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

/**
 * Generate storage paths for processed images
 */
export function generateImagePaths(originalPath: string): {
  thumbnailPath: string
  mediumPath: string
} {
  // Replace /original/ with /thumbnail/ or /medium/
  const thumbnailPath = originalPath
    .replace('/original/', '/thumbnail/')
    .replace(/\.\w+$/, '.jpg')

  const mediumPath = originalPath
    .replace('/original/', '/medium/')
    .replace(/\.\w+$/, '.jpg')

  return { thumbnailPath, mediumPath }
}
