/**
 * URL Slug Utilities
 *
 * Converts text to URL-friendly slugs and generates event identifiers
 * in the format: {slugified-title}-{event_id}
 */

/**
 * Convert a string to a URL-friendly slug
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '') // Remove everything except lowercase alphanumeric, spaces, hyphens
    .replace(/[\s-]+/g, '-') // Replace spaces and multiple hyphens with single hyphen
    .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens
}

/**
 * Generate an event slug from title and event_id
 * Format: {slugified-title}-{event_id}
 * Example: "coding-agents-ai-driven-dev-conference-b68wjx"
 */
export function generateEventSlug(title: string, eventId: string): string {
  const titleSlug = slugify(title)
  if (!titleSlug) return eventId
  return `${titleSlug}-${eventId}`
}

/**
 * Extract event_id from the end of a slug.
 * The event_id is always the last hyphen-separated segment.
 * Example: "coding-agents-ai-driven-dev-conference-b68wjx" → "b68wjx"
 */
export function extractEventIdFromSlug(slug: string): string {
  const parts = slug.split('-')
  return parts[parts.length - 1]
}
