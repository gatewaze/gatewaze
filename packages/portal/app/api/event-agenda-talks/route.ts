import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rate-limit'
import {
  buildTalkSurface,
  groupPhotosByAlbum,
  PHOTOS_PER_TALK,
  type AgendaTalkPhoto,
  type AgendaTalkSurface,
  type AlbumMatchRow,
  type RecapVideoRow,
  type TalkPhotoRow,
} from '@/lib/agendaTalkSurface'

/**
 * The agenda's talk surface — spec-event-agenda-schedule-import.md §10.1.
 *
 * GET /api/event-agenda-talks?event=<event uuid>
 *   → { bucket, talks: [{ entry_id, youtube_id, worth_noting, photos … }] }
 *
 * Why a server route rather than a browser read: the recap tables are
 * admin-only under RLS (conference-recap migration 001 generates
 * `*_select_admin ... USING (public.is_admin())`, and 008 repeats it for
 * the album matches). A portal visitor reading them with the anon key gets
 * zero rows, not an error — the feature would silently never appear. So the
 * join runs here with the service role, and only the already-public
 * projection is returned.
 *
 * Everything the service role buys is spent back on gates:
 *   - the event must exist and have `enable_agenda` on (same gate as the
 *     page, re-checked server-side — the client's claim is not evidence);
 *   - only recaps linked to THIS event, and only published ones, so an
 *     in-progress recap's unreviewed AI output never leaks;
 *   - photos must be `access_level = 'public'` AND `is_approved`, AND hosted
 *     by this event (`host_kind`/`host_id`) — `album_id` carries no FK, so
 *     a stray match row must not be able to address another host's media.
 *
 * Every table here belongs to a module a brand may not have installed. A
 * missing table or column degrades to an empty payload, which renders the
 * agenda exactly as it is today.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Ceiling on photo rows per query — bounds the response on a 90-entry agenda. */
const MAX_PHOTO_ROWS = 600
/** Rows to ask for per album before the ceiling bites. */
const PHOTO_FETCH_PER_ALBUM = 24
/** Passes over the album set. Rows come back ordered by album, so each pass
 *  fully covers every album but (at most) the one the ceiling cut in half —
 *  a handful of passes therefore reaches every album without ever issuing a
 *  query per agenda entry. */
const MAX_PHOTO_PASSES = 4

const EMPTY: AgendaTalkSurface = { bucket: 'media', talks: [] }

/**
 * An empty payload.
 *
 * `transient: true` for a failure we could not classify — a 5-minute public
 * cache would otherwise freeze one Supabase hiccup into "this event has no
 * recap" for every visitor behind the same cache.
 */
function empty(transient = false) {
  return NextResponse.json(EMPTY, {
    headers: { 'Cache-Control': transient ? 'no-store' : 'public, max-age=300' },
  })
}

function getServiceSupabase(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  // Null rather than throw: a deployment without a service key still serves
  // the agenda, just without the recap surface.
  if (!url || !key) return null
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

/** True when a PostgREST error means "this module is not installed here". */
function isMissingSchema(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  // 42P01 undefined_table, 42703 undefined_column, PGRST205 unknown relation.
  return error.code === '42P01' || error.code === '42703' || error.code === 'PGRST205'
}

/**
 * Photos for every matched album, batched.
 *
 * PostgREST has no per-group LIMIT, so a single `.in('album_id', …)` over 90
 * albums would be unbounded. Instead each pass asks for a bounded page
 * ordered by album, then re-asks only for the albums the ceiling never
 * reached. Bounded in both rows and round trips.
 */
async function fetchAlbumPhotos(
  supabase: SupabaseClient,
  eventId: string,
  albumIds: string[],
): Promise<Map<string, AgendaTalkPhoto[]>> {
  const rows: TalkPhotoRow[] = []
  let pending = albumIds
  for (let pass = 0; pass < MAX_PHOTO_PASSES && pending.length > 0; pass++) {
    const limit = Math.min(pending.length * PHOTO_FETCH_PER_ALBUM, MAX_PHOTO_ROWS)
    const { data, error } = await supabase
      .from('host_media')
      .select('album_id, storage_path, alt_text, caption, filename, width, height')
      .eq('host_kind', 'event')
      .eq('host_id', eventId)
      .eq('access_level', 'public')
      .eq('is_approved', true)
      .in('album_id', pending)
      .order('album_id', { ascending: true })
      .order('filename', { ascending: true })
      .limit(limit)
    if (error || !data || data.length === 0) break
    rows.push(...(data as TalkPhotoRow[]))
    const covered = new Set(data.map((r) => (r as TalkPhotoRow).album_id))
    const next = pending.filter((id) => !covered.has(id))
    // No progress (every pending album already answered) — stop.
    if (next.length === pending.length) break
    pending = next
  }
  return groupPhotosByAlbum(rows, PHOTOS_PER_TALK)
}

export async function GET(req: NextRequest) {
  try {
    // One agenda page load is one call, so a generous ceiling still stops a
    // caller from using the service-role fan-out (five queries per request)
    // as an amplifier.
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    const limit = checkRateLimit(`event-agenda-talks:${ip}`, 60, 60_000)
    if (!limit.allowed) {
      return NextResponse.json(EMPTY, {
        status: 429,
        headers: { 'Retry-After': String(limit.retryAfter ?? 60) },
      })
    }

    const eventId = new URL(req.url).searchParams.get('event') ?? ''
    if (!UUID_RE.test(eventId)) return empty()

    const supabase = getServiceSupabase()
    if (!supabase) return empty()

    // 1/5 — the gate. `enable_agenda` is the flag that shows the agenda tab
    // at all; `is_live_in_production` is what every other portal read of
    // `events` requires (lib/events.ts:53 and the feeds, sitemap and event
    // pages beside it). Both matter here, because on the service role this
    // route is the only authorization boundary there is — without the
    // second one, a draft or taken-down event would still hand out its
    // recordings and photos to anyone holding the uuid.
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, enable_agenda, is_live_in_production')
      .eq('id', eventId)
      .eq('enable_agenda', true)
      .eq('is_live_in_production', true)
      .maybeSingle<{ id: string; enable_agenda: boolean | null; is_live_in_production: boolean | null }>()
    if (eventError) return empty(!isMissingSchema(eventError))
    if (!event || event.enable_agenda !== true || event.is_live_in_production !== true) return empty()

    // 2/5 — published recaps linked to this event.
    const { data: recaps, error: recapError } = await supabase
      .from('conference_recaps')
      .select('id')
      .eq('event_id', eventId)
      .eq('item_status', 'published')
      .not('published_at', 'is', null)
    if (recapError) {
      // A missing table means the recap module is not installed here, which
      // is a permanent answer and safe to cache. Anything else is transient.
      if (isMissingSchema(recapError)) return empty()
      console.warn(JSON.stringify({ event: 'agenda.talk_surface.recaps_failed', message: recapError.message }))
      return empty(true)
    }
    const recapIds = (recaps ?? []).map((r) => (r as { id: string }).id)
    if (recapIds.length === 0) return empty()

    // 3/5 — canonical videos that the matcher tied to an agenda entry.
    const { data: videoRows, error: videoError } = await supabase
      .from('conference_recap_videos')
      .select('id, video_id, raw_title, summary, agenda_entry_id')
      .in('recap_id', recapIds)
      .is('duplicate_of', null)
      .not('agenda_entry_id', 'is', null)
    if (videoError) {
      if (isMissingSchema(videoError)) return empty()
      console.warn(JSON.stringify({ event: 'agenda.talk_surface.videos_failed', message: videoError.message }))
      return empty(true)
    }
    const videos = (videoRows ?? []) as RecapVideoRow[]
    if (videos.length === 0) return empty()

    // 4/5 — the album matched to each of those videos. `video_id` here is a
    // FK to conference_recap_videos.id (the row uuid), not the YouTube id.
    let albumMatches: AlbumMatchRow[] = []
    const { data: matchRows, error: matchError } = await supabase
      .from('conference_recap_album_matches')
      .select('album_id, album_name, video_id')
      .in('recap_id', recapIds)
      .in('video_id', videos.map((v) => v.id))
      .not('album_id', 'is', null)
    if (matchError) {
      // Photos are additive: a brand running an older recap module still
      // gets videos and worth-noting lines.
      if (!isMissingSchema(matchError)) {
        console.warn(JSON.stringify({ event: 'agenda.talk_surface.albums_failed', message: matchError.message }))
      }
    } else {
      albumMatches = (matchRows ?? []) as AlbumMatchRow[]
    }

    // 5/5 — the photos themselves.
    let photosByAlbum = new Map<string, AgendaTalkPhoto[]>()
    const albumIds = [...new Set(albumMatches.map((m) => m.album_id).filter((id): id is string => !!id))]
    if (albumIds.length > 0) {
      try {
        photosByAlbum = await fetchAlbumPhotos(supabase, eventId, albumIds)
      } catch (err) {
        console.warn(JSON.stringify({
          event: 'agenda.talk_surface.photos_failed',
          message: err instanceof Error ? err.message : String(err),
        }))
      }
    }

    const payload: AgendaTalkSurface = {
      bucket: process.env.HOST_MEDIA_BUCKET || 'media',
      talks: buildTalkSurface(videos, albumMatches, photosByAlbum),
    }
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'public, max-age=300' } })
  } catch (err) {
    console.warn(JSON.stringify({
      event: 'agenda.talk_surface.error',
      message: err instanceof Error ? err.message : String(err),
    }))
    return empty(true)
  }
}
