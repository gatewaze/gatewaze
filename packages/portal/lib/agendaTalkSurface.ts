/**
 * The agenda as the recap's shop window — shared shaping and URL helpers.
 *
 * spec-event-agenda-schedule-import.md §10.1. After a conference, an
 * attendee returning to the event page should find each talk on the agenda
 * (recording, the recap's "worth noting" line, session photos) rather than
 * having to discover the separate recap resource.
 *
 * Nothing is copied into the agenda tables. The chain is read live:
 *
 *   events_agenda_entries.id
 *     ← conference_recap_videos.agenda_entry_id   (recap migration 009)
 *         gives the YouTube id, the raw title and summary.worth_noting
 *     ← conference_recap_album_matches.video_id   (recap migration 008)
 *         that row's album_id is the matched photo album
 *     ← host_media.album_id
 *         the photos (public + approved only)
 *
 * So a re-run of the recap is reflected immediately and a deleted recap
 * leaves no orphan content on the agenda.
 *
 * Note the naming trap in the two recap tables: `conference_recap_videos.id`
 * is the row uuid while `conference_recap_videos.video_id` is the YouTube id,
 * and `conference_recap_album_matches.video_id` is a FK to the row uuid — not
 * the YouTube id. The route joins on the uuid and only ever renders the
 * YouTube id.
 *
 * Everything here is pure and runs on both sides: the API route uses the
 * shaping half, the agenda component uses the URL half.
 */

import { getBunnyImageUrl } from './bunnyNet'

/** Max photos rendered in one entry's strip. */
export const PHOTOS_PER_TALK = 6

/**
 * A YouTube video id. Every value that reaches an iframe `src` or an
 * i.ytimg.com URL passes this first: `raw_title`, `video_id` and the album
 * names all originate from imported programme data and third-party playlist
 * metadata, so none of them is trusted to be URL-safe.
 */
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{6,20}$/

/** A Supabase Storage bucket name. */
const BUCKET_RE = /^[a-z0-9][a-z0-9._-]{1,62}$/

export function isSafeYoutubeId(value: unknown): value is string {
  return typeof value === 'string' && YOUTUBE_ID_RE.test(value)
}

export function youtubeThumbUrl(youtubeId: string): string | null {
  return isSafeYoutubeId(youtubeId) ? `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg` : null
}

/**
 * Encode a storage path for use inside a public object URL.
 *
 * `host_media.storage_path` is written by the recap's Drive ingest from
 * operator-supplied folder and file names, so it is attacker-influenced
 * text, not a vetted path. Rejecting rather than sanitising keeps the
 * failure visible: a path that traverses, is absolute, carries a scheme,
 * or smuggles a query/fragment gets no URL at all.
 */
export function encodeStoragePath(storagePath: unknown): string | null {
  if (typeof storagePath !== 'string') return null
  const path = storagePath.trim()
  if (path.length === 0 || path.length > 1024) return null
  // No scheme, no protocol-relative host, no absolute path, no traversal,
  // no query/fragment, no control characters or whitespace smuggling.
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return null
  if (path.startsWith('/') || path.startsWith('\\')) return null
  if (path.includes('..') || path.includes('\\')) return null
  if (/[?#]/.test(path)) return null
  if (/[\u0000-\u001f\u007f]/.test(path)) return null
  const segments = path.split('/')
  if (segments.some((s) => s.length === 0 || s === '.')) return null
  return segments.map(encodeURIComponent).join('/')
}

/**
 * Browser URL for one session photo, Bunny CDN first.
 *
 * Built the way `MediaContent` builds its gallery URLs — the public object
 * URL on the brand's own Supabase host, then handed to `getBunnyImageUrl`
 * with a resize so a strip pulls ~400px thumbnails off the CDN rather than
 * full-size conference originals. `getBunnyImageUrl` returns the input
 * unchanged when no pull zone is configured, so this degrades to the direct
 * storage URL on a brand without the CDN.
 */
export function talkPhotoUrl(
  supabaseUrl: string,
  bucket: string,
  storagePath: unknown,
  width = 400,
): string | null {
  if (!supabaseUrl || !BUCKET_RE.test(bucket)) return null
  const encoded = encodeStoragePath(storagePath)
  if (!encoded) return null
  const base = supabaseUrl.replace(/\/+$/, '')
  const publicUrl = `${base}/storage/v1/object/public/${bucket}/${encoded}`
  return getBunnyImageUrl(publicUrl, { width, quality: 80, fit: 'cover' })
}

// ─── Wire shape ──────────────────────────────────────────────────────────

export interface AgendaTalkPhoto {
  /** Raw storage path — the browser composes the URL with its own brand config. */
  storage_path: string
  alt: string
  width: number | null
  height: number | null
}

export interface AgendaTalkMedia {
  /** The matched agenda entry (events_agenda_entries.id). */
  entry_id: string
  /** YouTube id of the matched recording, when it passed validation. */
  youtube_id: string | null
  /** The recording's title, for the player's accessible label. */
  video_title: string | null
  /** The recap summary's `worth_noting` line, when the recap produced one. */
  worth_noting: string | null
  /** Leaf name of the matched photo album, for the strip's caption. */
  album: string | null
  photos: AgendaTalkPhoto[]
}

export interface AgendaTalkSurface {
  /** Storage bucket the photo paths live in. */
  bucket: string
  talks: AgendaTalkMedia[]
}

// ─── Shaping (used by the API route) ─────────────────────────────────────

/** `conference_recap_videos` row, as the route selects it. */
export interface RecapVideoRow {
  id: string
  video_id: string | null
  raw_title: string | null
  summary: unknown
  agenda_entry_id: string | null
}

/** `conference_recap_album_matches` row, as the route selects it. */
export interface AlbumMatchRow {
  album_id: string | null
  album_name: string | null
  /** FK to `conference_recap_videos.id` — the row uuid, NOT the YouTube id. */
  video_id: string | null
}

/** `host_media` row, as the route selects it. */
export interface TalkPhotoRow {
  album_id: string | null
  storage_path: string | null
  alt_text: string | null
  caption: string | null
  filename: string | null
  width: number | null
  height: number | null
}

const MAX_TEXT = 500
const MAX_ALT = 300
const MAX_ALBUM = 120

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  // Collapse whitespace so a multi-line AI summary stays a single line in a
  // card, and bound the length so one bad row cannot bloat the response.
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length === 0 ? null : text.slice(0, max)
}

/** The recap summary's `worth_noting`, if the jsonb has a usable one. */
export function worthNotingOf(summary: unknown): string | null {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return null
  return cleanText((summary as Record<string, unknown>).worth_noting, MAX_TEXT)
}

/**
 * Group photo rows by album, keeping at most `cap` per album.
 *
 * The route fetches photos for every matched album in one query, so the
 * per-album cap has to be applied here rather than in SQL (PostgREST has no
 * per-group LIMIT). Rows with an unusable storage path are dropped, never
 * rendered as a broken image.
 */
export function groupPhotosByAlbum(
  rows: TalkPhotoRow[],
  cap = PHOTOS_PER_TALK,
): Map<string, AgendaTalkPhoto[]> {
  const byAlbum = new Map<string, AgendaTalkPhoto[]>()
  for (const row of rows) {
    if (!row.album_id || typeof row.album_id !== 'string') continue
    if (!encodeStoragePath(row.storage_path)) continue
    const bucketList = byAlbum.get(row.album_id) ?? []
    if (bucketList.length >= cap) continue
    bucketList.push({
      storage_path: row.storage_path as string,
      alt: cleanText(row.alt_text, MAX_ALT) ?? cleanText(row.caption, MAX_ALT) ?? cleanText(row.filename, MAX_ALT) ?? '',
      width: typeof row.width === 'number' ? row.width : null,
      height: typeof row.height === 'number' ? row.height : null,
    })
    byAlbum.set(row.album_id, bucketList)
  }
  return byAlbum
}

/**
 * Project the matched recap rows onto agenda entries.
 *
 * One entry may only carry one recording (§7.2: "Each entry may match at
 * most one canonical video"); if the data somehow holds two, the first wins
 * deterministically rather than being guessed at. An entry whose video has
 * no album match, or whose album has no public photos, still gets its video
 * and worth-noting line — the strip is simply absent.
 */
export function buildTalkSurface(
  videos: RecapVideoRow[],
  albumMatches: AlbumMatchRow[],
  photosByAlbum: Map<string, AgendaTalkPhoto[]>,
): AgendaTalkMedia[] {
  // video row uuid → matched album
  const albumByVideoRow = new Map<string, { id: string; name: string | null }>()
  for (const m of albumMatches) {
    if (!m.video_id || !m.album_id) continue
    if (albumByVideoRow.has(m.video_id)) continue
    albumByVideoRow.set(m.video_id, { id: m.album_id, name: m.album_name ?? null })
  }

  const out: AgendaTalkMedia[] = []
  const seenEntries = new Set<string>()
  for (const video of videos) {
    const entryId = video.agenda_entry_id
    if (!entryId || typeof entryId !== 'string' || seenEntries.has(entryId)) continue

    const youtubeId = isSafeYoutubeId(video.video_id) ? video.video_id : null
    const worthNoting = worthNotingOf(video.summary)
    const album = albumByVideoRow.get(video.id)
    const photos = album ? photosByAlbum.get(album.id) ?? [] : []

    // Nothing to show means nothing to render — the entry stays exactly as
    // it is today rather than growing an empty disclosure.
    if (!youtubeId && !worthNoting && photos.length === 0) continue

    seenEntries.add(entryId)
    out.push({
      entry_id: entryId,
      youtube_id: youtubeId,
      video_title: cleanText(video.raw_title, MAX_TEXT),
      worth_noting: worthNoting,
      album: photos.length > 0 && album?.name
        ? cleanText(album.name.split(' / ').pop() ?? album.name, MAX_ALBUM)
        : null,
      photos,
    })
  }
  return out
}

/**
 * Label for the collapsed disclosure, saying what is actually behind it.
 *
 * "Show more" would be a lie on an entry whose recap produced photos but no
 * recording, and a visitor should not have to open it to find out.
 */
export function mediaSummaryLabel(media: AgendaTalkMedia): string {
  const count = media.photos.length
  const photos = count === 1 ? '1 photo' : `${count} photos`
  if (media.youtube_id) return count > 0 ? `Watch the talk · ${photos}` : 'Watch the talk'
  if (count > 0) return media.worth_noting ? `Recap note · ${photos}` : photos
  return 'Recap note'
}

/** Index a surface payload by agenda entry id, for render-time lookup. */
export function indexTalkSurface(talks: AgendaTalkMedia[] | undefined | null): Map<string, AgendaTalkMedia> {
  const map = new Map<string, AgendaTalkMedia>()
  for (const talk of talks ?? []) {
    if (talk && typeof talk.entry_id === 'string') map.set(talk.entry_id, talk)
  }
  return map
}
