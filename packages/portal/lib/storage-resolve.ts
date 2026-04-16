/**
 * Portal-side helper for resolving storage paths to full URLs.
 *
 * Takes a row (or list of rows) from the database and rewrites any URL-bearing
 * columns that now hold relative storage paths into full public URLs, using the
 * configured storage bucket URL. Idempotent — rows already containing full URLs
 * pass through unchanged.
 *
 * See specs/spec-relative-storage-paths.md.
 */

import { toPublicUrl } from '@gatewaze/shared'

/**
 * Fields on the `events` table that store internal image paths. Keep in sync with
 * spec-relative-storage-paths.md §Data migration.
 */
const EVENT_IMAGE_FIELDS = [
  'screenshot_url',
  'event_logo',
  'badge_logo',
  'event_featured_image',
  'venue_map_image',
] as const

/**
 * Fields on the `people` table that may store storage paths.
 */
const PEOPLE_IMAGE_FIELDS = ['avatar_url', 'avatar_storage_path'] as const

function resolveFields<T>(
  row: T | null | undefined,
  fields: readonly string[],
  bucketUrl: string,
): T | null | undefined {
  if (!row) return row
  const src = row as unknown as Record<string, unknown>
  let changed = false
  const out: Record<string, unknown> = { ...src }
  for (const f of fields) {
    const v = src[f]
    if (typeof v === 'string' && v.length > 0) {
      const resolved = toPublicUrl(v, bucketUrl)
      if (resolved !== v) {
        out[f] = resolved
        changed = true
      }
    }
  }
  return (changed ? (out as unknown as T) : row)
}

/** Resolve image fields on a single event row. */
export function resolveEventImages<T>(
  event: T | null | undefined,
  bucketUrl: string,
): T | null | undefined {
  return resolveFields(event, EVENT_IMAGE_FIELDS, bucketUrl)
}

/** Resolve image fields on an array of event rows. */
export function resolveEventImagesList<T>(events: T[], bucketUrl: string): T[] {
  return events.map((e) => resolveEventImages(e, bucketUrl) as T)
}

/** Resolve avatar/image fields on a single person row. */
export function resolvePersonImages<T>(
  person: T | null | undefined,
  bucketUrl: string,
): T | null | undefined {
  return resolveFields(person, PEOPLE_IMAGE_FIELDS, bucketUrl)
}

/** Resolve a generic storage path string to a full URL. */
export function resolveStorageUrl(
  path: string | null | undefined,
  bucketUrl: string,
): string | null {
  return toPublicUrl(path, bucketUrl)
}
