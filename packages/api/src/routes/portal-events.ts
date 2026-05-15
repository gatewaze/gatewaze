// Portal-public read endpoints for the events resource.
// Per spec-portal-on-cloudflare-workers §4.2 / §5.2.
//
// These routes are mounted at `/api/portal/events` and exposed publicly
// (no JWT). They run under the anon Supabase client so PostgREST RLS
// continues to enforce visibility (i.e. only `is_live_in_production =
// true` rows surface). Responses are designed to be CDN-friendly:
//
//   - Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=86400
//   - Cache-Tag: events:list, event:<id>, event:<id>:speakers, etc.
//
// The `cdn.aaif.live` Worker (per spec-api-cache-and-revalidation)
// honours both headers. Surrogate-key purges (via webhook) target the
// `Cache-Tag` values so a single mutation can invalidate exactly the
// pages that depend on it.
//
// The portal continues to read direct from Supabase for authenticated
// per-viewer pages (RSVP status, talk-edit forms, etc.). Those don't
// belong on the CDN.

import { getAnonSupabase } from '../lib/supabase.js';
import { labeledRouter } from '../lib/router-registry.js';
import { logger } from '../lib/logger.js';

export const portalEventsRouter = labeledRouter('public');

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

// Default cache window for portal-public reads. 60s browser, 5min edge,
// 24h serve-stale-on-error. Tuned so a missed webhook invalidation
// auto-recovers within 5 minutes, while a CDN outage doesn't black out
// the public site.
const DEFAULT_CACHE_HEADER =
  'public, max-age=60, s-maxage=300, stale-while-revalidate=86400, stale-if-error=86400';

// Apply standard cache + tag headers to the response. `tags` map to
// surrogate-key invalidations downstream (webhooks call
// `revalidateTag(...)` on Next + a purge endpoint on cdn.aaif.live).
function setCacheHeaders(
  res: { setHeader: (name: string, value: string) => void },
  tags: string[],
  cacheControl: string = DEFAULT_CACHE_HEADER,
): void {
  res.setHeader('Cache-Control', cacheControl);
  if (tags.length > 0) {
    // Cloudflare reads `Cache-Tag` (comma-separated) for surrogate-key
    // purging. Next.js reads its own internal cache via the `next` opt
    // on the consumer side; tags are passed through unchanged.
    res.setHeader('Cache-Tag', tags.join(','));
  }
  // Defence-in-depth against multi-brand cache poisoning. Each brand
  // runs its own API/CDN pair so the Host varies per tenant; a shared
  // cache MUST key on it.
  res.setHeader('Vary', 'Host, Authorization');
}

// ---------------------------------------------------------------------------
// Field selectors — keep the API surface contract narrow
// ---------------------------------------------------------------------------

// Mirror of `EVENT_SELECT_FIELDS_STABLE` from
// packages/portal/app/(main)/events/[identifier]/(portal)/layout.tsx.
// Stable across every supported events schema. Optional columns added
// by later migrations (`nearby_hotels`) are appended in
// EVENT_SELECT_FIELDS_FULL and gracefully retried-without on 42703.
const EVENT_SELECT_FIELDS_STABLE = `
  id,
  event_id,
  event_slug,
  event_title,
  event_start,
  event_end,
  event_timezone,
  event_city,
  event_region,
  event_country_code,
  event_location,
  venue_address,
  event_description,
  listing_intro,
  luma_processed_html,
  meetup_processed_html,
  event_link,
  event_logo,
  screenshot_url,
  enable_registration,
  enable_native_registration,
  enable_call_for_speakers,
  enable_agenda,
  luma_event_id,
  is_live_in_production,
  gradient_color_1,
  gradient_color_2,
  gradient_color_3,
  portal_theme,
  theme_colors,
  talk_duration_options,
  register_button_text,
  page_content,
  recommended_event_id,
  gradual_eventslug,
  venue_content,
  venue_map_image,
  event_latitude,
  event_longitude,
  addedpage_content,
  addedpage_title
`;
const EVENT_SELECT_FIELDS_FULL = `${EVENT_SELECT_FIELDS_STABLE},nearby_hotels`;

// Subset used by event listings (upcoming/past). Trimmed to keep the
// listing payload small — a list of 1000 events with the full select
// would push 5MB+ over the wire.
const EVENT_LISTING_FIELDS = `
  event_id,
  event_slug,
  event_title,
  event_start,
  event_end,
  event_timezone,
  event_city,
  event_region,
  event_country_code,
  event_location,
  venue_address,
  event_description,
  listing_intro,
  event_logo,
  screenshot_url,
  gradient_color_1,
  gradient_color_2,
  gradient_color_3,
  event_type,
  event_topics
`;

// PostgREST "Max Rows" project setting caps responses at 1000. Page
// through them rather than relying on a client-side .limit() that
// PostgREST silently truncates. Matches packages/portal/lib/events.ts.
const PAGE_SIZE = 1000;
const MAX_PAGES = 20;

// True when PostgREST 400'd because a column in our SELECT doesn't
// exist (brand hasn't applied a recent migration). Retry with the
// stable fields only.
function isMissingColumnError(err: { message?: string; code?: string } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === '42703') return true;
  return /column .* does not exist/i.test(err.message || '');
}

// Strip whitespace introduced by the multi-line SELECT template.
function compactSelect(s: string): string {
  return s.replace(/\s+/g, '');
}

// Slug-aware identifier match. Mirrors getEvent() in the portal layout
// so routes accept any of: full slug, raw event_id, slug-with-trailing-id.
async function fetchEventByIdentifier(
  supabase: ReturnType<typeof getAnonSupabase>,
  identifier: string,
): Promise<Record<string, unknown> | null> {
  async function fetchByColumn(column: 'event_slug' | 'event_id', value: string) {
    const tryFields = async (fields: string) =>
      supabase
        .from('events')
        .select(compactSelect(fields))
        .eq(column, value)
        .eq('is_live_in_production', true)
        .maybeSingle();
    const first = await tryFields(EVENT_SELECT_FIELDS_FULL);
    if (first.error && isMissingColumnError(first.error)) {
      const fallback = await tryFields(EVENT_SELECT_FIELDS_STABLE);
      return (fallback.data as Record<string, unknown> | null) ?? null;
    }
    return (first.data as Record<string, unknown> | null) ?? null;
  }

  let event = await fetchByColumn('event_slug', identifier);
  if (!event) event = await fetchByColumn('event_id', identifier);

  // Fallback: extract event_id from end of slug ("a-summit-tk06c2" → "tk06c2").
  if (!event && identifier.includes('-')) {
    const extractedId = identifier.split('-').pop();
    if (extractedId && extractedId !== identifier) {
      event = await fetchByColumn('event_id', extractedId);
    }
  }
  return event;
}

// ---------------------------------------------------------------------------
// GET /api/portal/events — paginated listing
//   ?direction=upcoming|past|all   default: upcoming
//   ?limit=N                       default: 100, max: 1000
//   ?offset=N                      default: 0
// ---------------------------------------------------------------------------
portalEventsRouter.get('/', async (req, res) => {
  try {
    const direction = (req.query.direction as string) || 'upcoming';
    if (!['upcoming', 'past', 'all'].includes(direction)) {
      return res.status(400).json({ error: 'direction must be upcoming, past, or all' });
    }
    const limitRaw = parseInt(req.query.limit as string, 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), PAGE_SIZE) : 100;
    const offset = Math.max(parseInt(req.query.offset as string, 10) || 0, 0);

    const supabase = getAnonSupabase();
    const now = new Date().toISOString();

    let q = supabase
      .from('events')
      .select(compactSelect(EVENT_LISTING_FIELDS), { count: 'exact' })
      .eq('is_live_in_production', true)
      .eq('is_listed', true);

    if (direction === 'upcoming') {
      q = q
        .or(`event_start.gte.${now},event_start.is.null`)
        .order('event_start', { ascending: true, nullsFirst: false });
    } else if (direction === 'past') {
      q = q
        .lt('event_start', now)
        .order('event_start', { ascending: false });
    } else {
      q = q.order('event_start', { ascending: false, nullsFirst: false });
    }

    const { data, error, count } = await q.range(offset, offset + limit - 1);
    if (error) throw error;

    setCacheHeaders(res, ['events:list', `events:list:${direction}`]);
    res.json({ data: data ?? [], total: count ?? null, limit, offset });
  } catch (err) {
    logger.error({ err }, 'portal-events: failed to list events');
    res.status(500).json({ error: 'Failed to list events' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/portal/events/all — convenience: paginate through everything
// (matches packages/portal/lib/events.ts getEvents() which paginates the
// `events` table for the home/upcoming/past pages).
// ---------------------------------------------------------------------------
portalEventsRouter.get('/all', async (_req, res) => {
  try {
    const supabase = getAnonSupabase();
    const now = new Date().toISOString();

    async function paginate(direction: 'upcoming' | 'past'): Promise<unknown[]> {
      const out: unknown[] = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        const from = page * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;
        let q = supabase
          .from('events')
          .select(compactSelect(EVENT_LISTING_FIELDS))
          .eq('is_live_in_production', true)
          .eq('is_listed', true);
        q = direction === 'upcoming'
          ? q
              .or(`event_start.gte.${now},event_start.is.null`)
              .order('event_start', { ascending: true, nullsFirst: false })
          : q.lt('event_start', now).order('event_start', { ascending: false });
        const { data, error } = await q.range(from, to);
        if (error) throw error;
        const rows = (data as unknown[]) ?? [];
        out.push(...rows);
        if (rows.length < PAGE_SIZE) break;
      }
      return out;
    }

    const [upcoming, past] = await Promise.all([paginate('upcoming'), paginate('past')]);
    setCacheHeaders(res, ['events:list', 'events:list:all']);
    res.json({ upcoming, past, all: [...upcoming, ...past] });
  } catch (err) {
    logger.error({ err }, 'portal-events: failed to list all events');
    res.status(500).json({ error: 'Failed to list events' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/portal/events/:identifier — single event by slug or event_id
// ---------------------------------------------------------------------------
portalEventsRouter.get('/:identifier', async (req, res) => {
  try {
    const identifier = req.params.identifier;
    if (!identifier) return res.status(400).json({ error: 'identifier required' });

    const supabase = getAnonSupabase();
    const event = await fetchEventByIdentifier(supabase, identifier);
    if (!event) {
      // Cache 404s briefly so a hot mistyped URL doesn't hammer the DB.
      setCacheHeaders(res, [`event:${identifier}`], 'public, max-age=30, s-maxage=60');
      return res.status(404).json({ error: 'Event not found' });
    }

    const eventId = (event.event_id as string) || identifier;
    const eventUuid = (event.id as string) || identifier;
    setCacheHeaders(res, [`event:${eventId}`, `event:uuid:${eventUuid}`]);
    res.json(event);
  } catch (err) {
    logger.error({ err, identifier: req.params.identifier }, 'portal-events: failed to fetch event');
    res.status(500).json({ error: 'Failed to fetch event' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/portal/events/:identifier/counts — speakers / sponsors /
// competitions / discounts / media counts + hasVirtualEvent flag.
// One call replaces six round-trips from the event-detail layout.
// ---------------------------------------------------------------------------
portalEventsRouter.get('/:identifier/counts', async (req, res) => {
  try {
    const identifier = req.params.identifier;
    const supabase = getAnonSupabase();

    // Need both event_id (for sponsors/competitions/discounts/media) and
    // id (for speakers + live_event_config). Fetch the event row first.
    const event = await fetchEventByIdentifier(supabase, identifier);
    if (!event) {
      setCacheHeaders(res, [`event:${identifier}`], 'public, max-age=30, s-maxage=60');
      return res.status(404).json({ error: 'Event not found' });
    }
    const eventUuid = event.id as string;
    const eventId = event.event_id as string;

    // Six counts in parallel. `head: true` keeps the response payload
    // tiny — we only care about the count, not the rows.
    const [
      speakersConfirmed,
      speakersPlaceholder,
      sponsorsCount,
      competitionsCount,
      discountsCount,
      mediaCount,
      virtualConfig,
    ] = await Promise.all([
      supabase
        .from('events_speakers_with_details')
        .select('*', { count: 'exact', head: true })
        .eq('event_uuid', eventUuid)
        .eq('status', 'confirmed'),
      supabase
        .from('events_speakers_with_details')
        .select('*', { count: 'exact', head: true })
        .eq('event_uuid', eventUuid)
        .eq('status', 'placeholder'),
      supabase
        .from('events_sponsors')
        .select('*', { count: 'exact', head: true })
        .eq('event_id', eventId)
        .eq('is_active', true),
      supabase
        .from('events_competitions')
        .select('*', { count: 'exact', head: true })
        .eq('event_id', eventId)
        .eq('status', 'active'),
      supabase
        .from('events_discounts')
        .select('*', { count: 'exact', head: true })
        .eq('event_id', eventId)
        .eq('status', 'active'),
      supabase
        .from('events_media')
        .select('*', { count: 'exact', head: true })
        .eq('event_id', eventId)
        .eq('file_type', 'photo'),
      supabase
        .from('live_event_config')
        .select('id', { count: 'exact', head: true })
        .eq('event_id', eventUuid),
    ]);

    // Confirmed speakers if any, else fall back to placeholders. Mirrors
    // getSpeakerCount() in the portal layout.
    const confirmed = speakersConfirmed.count ?? 0;
    const placeholders = speakersPlaceholder.count ?? 0;
    const speakerCount = confirmed > 0 ? confirmed : placeholders;

    setCacheHeaders(res, [
      `event:${eventId}:counts`,
      `event:uuid:${eventUuid}:counts`,
      `event:${eventId}:speakers`,
      `event:${eventId}:sponsors`,
      `event:${eventId}:competitions`,
      `event:${eventId}:discounts`,
      `event:${eventId}:media`,
    ]);
    res.json({
      eventId,
      eventUuid,
      speakerCount,
      sponsorCount: sponsorsCount.count ?? 0,
      competitionCount: competitionsCount.count ?? 0,
      discountCount: discountsCount.count ?? 0,
      mediaCount: mediaCount.count ?? 0,
      hasVirtualEvent: (virtualConfig.count ?? 0) > 0,
    });
  } catch (err) {
    logger.error({ err, identifier: req.params.identifier }, 'portal-events: failed to fetch counts');
    res.status(500).json({ error: 'Failed to fetch counts' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/portal/events/:identifier/speakers — full speaker rows
// (events_speakers_with_details view)
// ---------------------------------------------------------------------------
portalEventsRouter.get('/:identifier/speakers', async (req, res) => {
  try {
    const identifier = req.params.identifier;
    const status = (req.query.status as string) || 'confirmed';
    if (!['confirmed', 'placeholder', 'any'].includes(status)) {
      return res.status(400).json({ error: 'status must be confirmed, placeholder, or any' });
    }

    const supabase = getAnonSupabase();
    const event = await fetchEventByIdentifier(supabase, identifier);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    const eventUuid = event.id as string;
    const eventId = event.event_id as string;

    let q = supabase
      .from('events_speakers_with_details')
      .select('*')
      .eq('event_uuid', eventUuid);
    if (status !== 'any') q = q.eq('status', status);

    const { data, error } = await q;
    if (error) throw error;

    setCacheHeaders(res, [`event:${eventId}:speakers`]);
    res.json({ data: data ?? [] });
  } catch (err) {
    logger.error({ err, identifier: req.params.identifier }, 'portal-events: failed to fetch speakers');
    res.status(500).json({ error: 'Failed to fetch speakers' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/portal/events/:identifier/sponsors — active sponsors
// ---------------------------------------------------------------------------
portalEventsRouter.get('/:identifier/sponsors', async (req, res) => {
  try {
    const identifier = req.params.identifier;
    const supabase = getAnonSupabase();
    const event = await fetchEventByIdentifier(supabase, identifier);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    const eventId = event.event_id as string;

    const { data, error } = await supabase
      .from('events_sponsors')
      .select('*')
      .eq('event_id', eventId)
      .eq('is_active', true)
      .order('display_order', { ascending: true, nullsFirst: false });
    if (error) throw error;

    setCacheHeaders(res, [`event:${eventId}:sponsors`]);
    res.json({ data: data ?? [] });
  } catch (err) {
    logger.error({ err, identifier: req.params.identifier }, 'portal-events: failed to fetch sponsors');
    res.status(500).json({ error: 'Failed to fetch sponsors' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/portal/events/:identifier/talks — talks list (with speakers via view)
// ---------------------------------------------------------------------------
portalEventsRouter.get('/:identifier/talks', async (req, res) => {
  try {
    const identifier = req.params.identifier;
    const supabase = getAnonSupabase();
    const event = await fetchEventByIdentifier(supabase, identifier);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    const eventId = event.event_id as string;

    const { data, error } = await supabase
      .from('events_talks_with_speakers')
      .select('*')
      .eq('event_id', eventId);
    if (error) throw error;

    setCacheHeaders(res, [`event:${eventId}:talks`]);
    res.json({ data: data ?? [] });
  } catch (err) {
    logger.error({ err, identifier: req.params.identifier }, 'portal-events: failed to fetch talks');
    res.status(500).json({ error: 'Failed to fetch talks' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/portal/events/:identifier/agenda — agenda entries + tracks
// ---------------------------------------------------------------------------
portalEventsRouter.get('/:identifier/agenda', async (req, res) => {
  try {
    const identifier = req.params.identifier;
    const supabase = getAnonSupabase();
    const event = await fetchEventByIdentifier(supabase, identifier);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    const eventUuid = event.id as string;
    const eventId = event.event_id as string;

    // Entries + tracks in parallel — both keyed off the event uuid.
    const [entriesRes, tracksRes] = await Promise.all([
      supabase
        .from('events_agenda_entries')
        .select('*')
        .eq('event_uuid', eventUuid)
        .order('start_time', { ascending: true, nullsFirst: false }),
      supabase
        .from('events_agenda_tracks')
        .select('*')
        .eq('event_uuid', eventUuid)
        .order('display_order', { ascending: true, nullsFirst: false }),
    ]);
    if (entriesRes.error) throw entriesRes.error;
    if (tracksRes.error) throw tracksRes.error;

    setCacheHeaders(res, [`event:${eventId}:agenda`]);
    res.json({ entries: entriesRes.data ?? [], tracks: tracksRes.data ?? [] });
  } catch (err) {
    logger.error({ err, identifier: req.params.identifier }, 'portal-events: failed to fetch agenda');
    res.status(500).json({ error: 'Failed to fetch agenda' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/portal/events/:identifier/competitions — active competitions
// ---------------------------------------------------------------------------
portalEventsRouter.get('/:identifier/competitions', async (req, res) => {
  try {
    const identifier = req.params.identifier;
    const supabase = getAnonSupabase();
    const event = await fetchEventByIdentifier(supabase, identifier);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    const eventId = event.event_id as string;

    const { data, error } = await supabase
      .from('events_competitions')
      .select('*')
      .eq('event_id', eventId)
      .eq('status', 'active')
      .order('created_at', { ascending: false });
    if (error) throw error;

    setCacheHeaders(res, [`event:${eventId}:competitions`]);
    res.json({ data: data ?? [] });
  } catch (err) {
    logger.error({ err, identifier: req.params.identifier }, 'portal-events: failed to fetch competitions');
    res.status(500).json({ error: 'Failed to fetch competitions' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/portal/events/:identifier/discounts — active discounts
// ---------------------------------------------------------------------------
portalEventsRouter.get('/:identifier/discounts', async (req, res) => {
  try {
    const identifier = req.params.identifier;
    const supabase = getAnonSupabase();
    const event = await fetchEventByIdentifier(supabase, identifier);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    const eventId = event.event_id as string;

    const { data, error } = await supabase
      .from('events_discounts')
      .select('*')
      .eq('event_id', eventId)
      .eq('status', 'active')
      .order('created_at', { ascending: false });
    if (error) throw error;

    setCacheHeaders(res, [`event:${eventId}:discounts`]);
    res.json({ data: data ?? [] });
  } catch (err) {
    logger.error({ err, identifier: req.params.identifier }, 'portal-events: failed to fetch discounts');
    res.status(500).json({ error: 'Failed to fetch discounts' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/portal/events/:identifier/media — photos + albums
// ---------------------------------------------------------------------------
portalEventsRouter.get('/:identifier/media', async (req, res) => {
  try {
    const identifier = req.params.identifier;
    const supabase = getAnonSupabase();
    const event = await fetchEventByIdentifier(supabase, identifier);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    const eventId = event.event_id as string;

    const [mediaRes, albumsRes] = await Promise.all([
      supabase
        .from('events_media')
        .select('*')
        .eq('event_id', eventId)
        .order('created_at', { ascending: false }),
      supabase
        .from('events_media_albums')
        .select('*')
        .eq('event_id', eventId)
        .order('display_order', { ascending: true, nullsFirst: false }),
    ]);
    if (mediaRes.error) throw mediaRes.error;
    // Albums table is optional (module may not be installed). 42P01 =
    // undefined_table; treat as "no albums" rather than 500.
    const albums =
      albumsRes.error && /relation .* does not exist/i.test(albumsRes.error.message || '')
        ? []
        : albumsRes.data ?? [];

    setCacheHeaders(res, [`event:${eventId}:media`]);
    res.json({ media: mediaRes.data ?? [], albums });
  } catch (err) {
    logger.error({ err, identifier: req.params.identifier }, 'portal-events: failed to fetch media');
    res.status(500).json({ error: 'Failed to fetch media' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/portal/events/:identifier/recommended — single recommended event
// ---------------------------------------------------------------------------
portalEventsRouter.get('/:identifier/recommended', async (req, res) => {
  try {
    const identifier = req.params.identifier;
    const supabase = getAnonSupabase();
    const event = await fetchEventByIdentifier(supabase, identifier);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    const eventId = event.event_id as string;
    const recommendedId = event.recommended_event_id as string | null;
    if (!recommendedId) {
      setCacheHeaders(res, [`event:${eventId}:recommended`]);
      return res.json({ data: null });
    }

    const { data } = await supabase
      .from('events')
      .select(
        'id, event_id, event_title, event_start, event_end, event_city, event_country_code, screenshot_url, event_logo, event_link, register_button_text, enable_registration',
      )
      .eq('id', recommendedId)
      .eq('is_live_in_production', true)
      .maybeSingle();

    setCacheHeaders(res, [`event:${eventId}:recommended`]);
    res.json({ data: data ?? null });
  } catch (err) {
    logger.error({ err, identifier: req.params.identifier }, 'portal-events: failed to fetch recommended');
    res.status(500).json({ error: 'Failed to fetch recommended event' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/portal/events/:identifier/ad-pixels — Reddit + Meta pixel IDs
// (RPC wrapper). Returns env-fallback values when the integration row
// is missing.
// ---------------------------------------------------------------------------
portalEventsRouter.get('/:identifier/ad-pixels', async (req, res) => {
  try {
    const identifier = req.params.identifier;
    const supabase = getAnonSupabase();
    const event = await fetchEventByIdentifier(supabase, identifier);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    const eventId = event.event_id as string;

    const [redditRes, metaRes] = await Promise.all([
      supabase.rpc('integrations_get_ad_platform_config', { p_event_id: eventId, p_platform: 'reddit' }),
      supabase.rpc('integrations_get_ad_platform_config', { p_event_id: eventId, p_platform: 'meta' }),
    ]);

    const config: { reddit?: { pixelId: string }; meta?: { pixelId: string } } = {};
    const redditPixelId = (redditRes.data as { credentials?: { pixel_id?: string } } | null)?.credentials?.pixel_id;
    const metaPixelId = (metaRes.data as { credentials?: { pixel_id?: string } } | null)?.credentials?.pixel_id;
    if (redditPixelId) config.reddit = { pixelId: redditPixelId };
    else if (process.env.REDDIT_PIXEL_ID) config.reddit = { pixelId: process.env.REDDIT_PIXEL_ID };
    if (metaPixelId) config.meta = { pixelId: metaPixelId };
    else if (process.env.META_PIXEL_ID) config.meta = { pixelId: process.env.META_PIXEL_ID };

    setCacheHeaders(res, [`event:${eventId}:ad-pixels`]);
    res.json(config);
  } catch (err) {
    logger.error({ err, identifier: req.params.identifier }, 'portal-events: failed to fetch ad-pixels');
    res.status(500).json({ error: 'Failed to fetch ad-pixels' });
  }
});
