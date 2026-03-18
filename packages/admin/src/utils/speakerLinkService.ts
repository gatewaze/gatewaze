// @ts-nocheck
/**
 * Speaker Link Service
 *
 * Handles creating and managing Short.io tracking links for event speakers.
 * Links include UTM parameters to track speaker attribution for registrations.
 */

import { getApiBaseUrl, getBrandId } from '@/config/brands';
import { supabase } from '@/lib/supabase';
import { stringToSlug } from './stringToSlug';

export interface SpeakerTrackingLink {
  speakerId: string;
  shortUrl: string;
  originalUrl: string;
  path: string;
  totalClicks: number;
  humanClicks: number;
  uniqueClicks: number;
  registrationCount: number;
  redirectId: string | null;
}

interface CreateLinkResponse {
  success: boolean;
  shortUrl?: string;
  path?: string;
  redirectId?: string;
  error?: string;
}

/**
 * Get the Short.io domain based on the current brand
 */
function getShortIoDomain(): string {
  const brandId = getBrandId();
  return brandId === 'mlops' ? 'go.mlops.community' : 'tech.tickets';
}

/**
 * Build the tracking URL with UTM parameters
 */
function buildTrackingUrl(eventLink: string, speakerId: string): string {
  const url = new URL(eventLink);
  url.searchParams.set('utm_source', 'speaker');
  url.searchParams.set('utm_medium', 'direct');
  url.searchParams.set('utm_campaign', speakerId);
  return url.toString();
}

/**
 * Generate a unique slug for the speaker link
 * Format: {eventId}-{speaker-name}
 * Handles collisions by appending numeric suffix
 */
async function generateUniqueSlug(
  eventId: string,
  speakerName: string,
  domain: string
): Promise<string> {
  const baseSlug = `${eventId}-${stringToSlug(speakerName)}`;
  let slug = baseSlug;
  let suffix = 1;

  // Check for existing slugs in the redirects table
  while (true) {
    const { data: existing } = await supabase
      .from('redirects')
      .select('id')
      .eq('path', slug)
      .eq('domain', domain)
      .maybeSingle();

    if (!existing) {
      break;
    }

    suffix++;
    slug = `${baseSlug}-${suffix}`;
  }

  return slug;
}

/**
 * Get or create a tracking link for a speaker
 * If a link already exists, returns it. Otherwise creates a new one.
 */
export async function getOrCreateSpeakerLink(
  speakerId: string,
  eventId: string,
  eventLink: string,
  speakerName: string
): Promise<SpeakerTrackingLink> {
  // First, check if a link already exists for this speaker
  const existingLink = await getSpeakerLink(speakerId);
  if (existingLink) {
    return existingLink;
  }

  // Create new link
  const domain = getShortIoDomain();
  const originalUrl = buildTrackingUrl(eventLink, speakerId);
  const path = await generateUniqueSlug(eventId, speakerName, domain);

  // Get auth token for API call
  const { data: session } = await supabase.auth.getSession();
  if (!session?.session?.access_token) {
    throw new Error('Not authenticated');
  }

  // Call the API to create the short link
  const apiBaseUrl = getApiBaseUrl();
  const response = await fetch(`${apiBaseUrl}/api/redirects/speaker-link`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.session.access_token}`,
    },
    body: JSON.stringify({
      speakerId,
      eventId,
      originalUrl,
      path,
      domain,
      speakerName,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to create speaker link: ${response.status} - ${errorText}`);
  }

  const result: CreateLinkResponse = await response.json();

  if (!result.success || !result.shortUrl) {
    throw new Error(result.error || 'Failed to create speaker link');
  }

  // Get registration count for this speaker
  const registrationCount = await getSpeakerRegistrationCount(eventId, speakerId);

  return {
    speakerId,
    shortUrl: result.shortUrl,
    originalUrl,
    path: result.path || path,
    totalClicks: 0,
    humanClicks: 0,
    uniqueClicks: 0,
    registrationCount,
    redirectId: result.redirectId || null,
  };
}

/**
 * Get an existing tracking link for a speaker
 * Returns null if no link exists
 */
export async function getSpeakerLink(speakerId: string): Promise<SpeakerTrackingLink | null> {
  const { data: redirect, error } = await supabase
    .from('redirects')
    .select('id, short_url, original_url, path, total_clicks, human_clicks, unique_clicks, domain')
    .eq('source_type', 'speaker')
    .eq('source_id', speakerId)
    .maybeSingle();

  if (error || !redirect) {
    return null;
  }

  // Extract event_id from the path (format: {eventId}-{speaker-slug})
  const eventIdMatch = redirect.path.match(/^([a-z0-9]+)-/);
  const eventId = eventIdMatch ? eventIdMatch[1] : '';

  // Get registration count
  const registrationCount = eventId
    ? await getSpeakerRegistrationCount(eventId, speakerId)
    : 0;

  return {
    speakerId,
    shortUrl: redirect.short_url,
    originalUrl: redirect.original_url,
    path: redirect.path,
    totalClicks: redirect.total_clicks || 0,
    humanClicks: redirect.human_clicks || 0,
    uniqueClicks: redirect.unique_clicks || 0,
    registrationCount,
    redirectId: redirect.id,
  };
}

/**
 * Get all speaker tracking links for an event
 * Queries the redirects table for all links with source_type='speaker'
 * that have paths starting with the eventId
 */
export async function getSpeakerLinksForEvent(
  eventId: string,
  speakerIds: string[]
): Promise<Record<string, SpeakerTrackingLink>> {
  if (speakerIds.length === 0) {
    return {};
  }

  // Query all redirects for these speakers
  const { data: redirects, error } = await supabase
    .from('redirects')
    .select('id, short_url, original_url, path, total_clicks, human_clicks, unique_clicks, source_id')
    .eq('source_type', 'speaker')
    .in('source_id', speakerIds);

  if (error || !redirects) {
    console.error('Error fetching speaker links:', error);
    return {};
  }

  // Get registration counts for all speakers in one query
  const registrationCounts = await getSpeakerRegistrationCounts(eventId, speakerIds);

  // Build the result map
  const result: Record<string, SpeakerTrackingLink> = {};

  for (const redirect of redirects) {
    const speakerId = redirect.source_id;
    result[speakerId] = {
      speakerId,
      shortUrl: redirect.short_url,
      originalUrl: redirect.original_url,
      path: redirect.path,
      totalClicks: redirect.total_clicks || 0,
      humanClicks: redirect.human_clicks || 0,
      uniqueClicks: redirect.unique_clicks || 0,
      registrationCount: registrationCounts[speakerId] || 0,
      redirectId: redirect.id,
    };
  }

  return result;
}

/**
 * Get the count of registrations attributed to a specific speaker
 * via UTM campaign tracking
 */
export async function getSpeakerRegistrationCount(
  eventId: string,
  speakerId: string
): Promise<number> {
  const { count, error } = await supabase
    .from('event_registrations')
    .select('*', { count: 'exact', head: true })
    .eq('event_id', eventId)
    .eq('utm_source', 'speaker')
    .eq('utm_campaign', speakerId);

  if (error) {
    console.error('Error counting speaker registrations:', error);
    return 0;
  }

  return count || 0;
}

/**
 * Get registration counts for multiple speakers in one query
 */
async function getSpeakerRegistrationCounts(
  eventId: string,
  speakerIds: string[]
): Promise<Record<string, number>> {
  if (speakerIds.length === 0) {
    return {};
  }

  // Query registrations with UTM tracking for these speakers
  const { data: registrations, error } = await supabase
    .from('event_registrations')
    .select('utm_campaign')
    .eq('event_id', eventId)
    .eq('utm_source', 'speaker')
    .in('utm_campaign', speakerIds);

  if (error || !registrations) {
    console.error('Error fetching speaker registration counts:', error);
    return {};
  }

  // Count registrations per speaker
  const counts: Record<string, number> = {};
  for (const reg of registrations) {
    const speakerId = reg.utm_campaign;
    if (speakerId) {
      counts[speakerId] = (counts[speakerId] || 0) + 1;
    }
  }

  return counts;
}

/**
 * Export all functions for use in components
 */
export const SpeakerLinkService = {
  getOrCreateSpeakerLink,
  getSpeakerLink,
  getSpeakerLinksForEvent,
  getSpeakerRegistrationCount,
};

export default SpeakerLinkService;
