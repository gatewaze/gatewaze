import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  buildTalkSurface,
  encodeStoragePath,
  groupPhotosByAlbum,
  indexTalkSurface,
  isSafeYoutubeId,
  mediaSummaryLabel,
  talkPhotoUrl,
  worthNotingOf,
  youtubeThumbUrl,
  type AgendaTalkMedia,
  type AlbumMatchRow,
  type RecapVideoRow,
  type TalkPhotoRow,
} from '../agendaTalkSurface'

const SUPABASE = 'https://db.example.supabase.co'

function video(over: Partial<RecapVideoRow> = {}): RecapVideoRow {
  return {
    id: 'vid-row-1',
    video_id: 'dQw4w9WgXcQ',
    raw_title: 'Agents in production - Jane Doe, Acme',
    summary: { worth_noting: 'Latency, not accuracy, is what killed the first rollout.' },
    agenda_entry_id: 'entry-1',
    ...over,
  }
}

function photoRow(over: Partial<TalkPhotoRow> = {}): TalkPhotoRow {
  return {
    album_id: 'album-1',
    storage_path: 'events/seoul/keynote/001.jpg',
    alt_text: 'Jane on stage',
    caption: null,
    filename: '001.jpg',
    width: 3000,
    height: 2000,
    ...over,
  }
}

describe('isSafeYoutubeId', () => {
  it('accepts a standard YouTube id', () => {
    expect(isSafeYoutubeId('dQw4w9WgXcQ')).toBe(true)
  })

  it('rejects anything that could escape an iframe src or a thumbnail URL', () => {
    // raw playlist metadata is third-party text, not a vetted id
    expect(isSafeYoutubeId('abc/../../evil')).toBe(false)
    expect(isSafeYoutubeId('abc?autoplay=1&x=y')).toBe(false)
    expect(isSafeYoutubeId('abc"onload="alert(1)')).toBe(false)
    expect(isSafeYoutubeId('javascript:alert(1)')).toBe(false)
    expect(isSafeYoutubeId('short')).toBe(false)
    expect(isSafeYoutubeId('a'.repeat(21))).toBe(false)
    expect(isSafeYoutubeId(null)).toBe(false)
    expect(isSafeYoutubeId(42)).toBe(false)
  })
})

describe('youtubeThumbUrl', () => {
  it('builds an i.ytimg.com URL for a valid id', () => {
    expect(youtubeThumbUrl('dQw4w9WgXcQ')).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg')
  })

  it('returns null rather than a malformed URL', () => {
    expect(youtubeThumbUrl('../../evil')).toBeNull()
  })
})

describe('encodeStoragePath', () => {
  it('encodes each segment and keeps the separators', () => {
    expect(encodeStoragePath('events/seoul 2026/day one.jpg'))
      .toBe('events/seoul%202026/day%20one.jpg')
  })

  it('encodes characters that would otherwise terminate the path', () => {
    expect(encodeStoragePath('a/b&c=d.jpg')).toBe('a/b%26c%3Dd.jpg')
  })

  it('rejects traversal', () => {
    // storage_path comes from operator-named Drive folders, so ../ is reachable
    expect(encodeStoragePath('../../secrets/key.jpg')).toBeNull()
    expect(encodeStoragePath('events/../../etc/passwd')).toBeNull()
  })

  it('rejects an absolute path, a scheme and a protocol-relative host', () => {
    expect(encodeStoragePath('/etc/passwd')).toBeNull()
    expect(encodeStoragePath('https://evil.test/x.jpg')).toBeNull()
    expect(encodeStoragePath('javascript:alert(1)')).toBeNull()
    expect(encodeStoragePath('\\\\evil.test\\x.jpg')).toBeNull()
  })

  it('rejects a smuggled query or fragment', () => {
    expect(encodeStoragePath('a.jpg?width=99999')).toBeNull()
    expect(encodeStoragePath('a.jpg#frag')).toBeNull()
  })

  it('rejects control characters, empty segments and non-strings', () => {
    expect(encodeStoragePath('a\n/b.jpg')).toBeNull()
    expect(encodeStoragePath('a//b.jpg')).toBeNull()
    expect(encodeStoragePath('a/./b.jpg')).toBeNull()
    expect(encodeStoragePath('')).toBeNull()
    expect(encodeStoragePath('   ')).toBeNull()
    expect(encodeStoragePath(null)).toBeNull()
    expect(encodeStoragePath(`${'a'.repeat(1025)}.jpg`)).toBeNull()
  })
})

describe('talkPhotoUrl', () => {
  const saved = { ...process.env }

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_BUNNY_CDN_ENABLED
    delete process.env.NEXT_PUBLIC_BUNNY_PULLZONE_URL
  })

  afterEach(() => {
    process.env.NEXT_PUBLIC_BUNNY_CDN_ENABLED = saved.NEXT_PUBLIC_BUNNY_CDN_ENABLED
    process.env.NEXT_PUBLIC_BUNNY_PULLZONE_URL = saved.NEXT_PUBLIC_BUNNY_PULLZONE_URL
  })

  it('falls back to the direct storage URL with no pull zone configured', () => {
    expect(talkPhotoUrl(SUPABASE, 'media', 'events/a.jpg'))
      .toBe(`${SUPABASE}/storage/v1/object/public/media/events/a.jpg`)
  })

  it('routes through the CDN with a resize when a pull zone is configured', () => {
    process.env.NEXT_PUBLIC_BUNNY_CDN_ENABLED = 'true'
    process.env.NEXT_PUBLIC_BUNNY_PULLZONE_URL = 'https://cdn.example.net'
    const url = talkPhotoUrl(SUPABASE, 'media', 'events/a.jpg', 400)
    expect(url).toContain('https://cdn.example.net/storage/v1/object/public/media/events/a.jpg')
    // a strip must not pull the full-size conference original
    expect(url).toContain('width=400')
    expect(url).toContain('quality=80')
  })

  it('tolerates a trailing slash on the Supabase URL', () => {
    expect(talkPhotoUrl(`${SUPABASE}/`, 'media', 'a.jpg'))
      .toBe(`${SUPABASE}/storage/v1/object/public/media/a.jpg`)
  })

  it('returns null for an unusable path or bucket rather than a broken URL', () => {
    expect(talkPhotoUrl(SUPABASE, 'media', '../../x.jpg')).toBeNull()
    expect(talkPhotoUrl(SUPABASE, 'MEDIA/../', 'a.jpg')).toBeNull()
    expect(talkPhotoUrl(SUPABASE, 'media', null)).toBeNull()
    expect(talkPhotoUrl('', 'media', 'a.jpg')).toBeNull()
  })
})

describe('worthNotingOf', () => {
  it('reads the line out of the summary jsonb', () => {
    expect(worthNotingOf({ worth_noting: 'Latency beat accuracy.' })).toBe('Latency beat accuracy.')
  })

  it('collapses whitespace so a multi-line summary stays one line', () => {
    expect(worthNotingOf({ worth_noting: ' a\n\n  b \t c ' })).toBe('a b c')
  })

  it('bounds the length', () => {
    expect(worthNotingOf({ worth_noting: 'x'.repeat(900) })?.length).toBe(500)
  })

  it('returns null for a missing, empty or non-object summary', () => {
    expect(worthNotingOf(null)).toBeNull()
    expect(worthNotingOf({})).toBeNull()
    expect(worthNotingOf({ worth_noting: '   ' })).toBeNull()
    expect(worthNotingOf({ worth_noting: 42 })).toBeNull()
    expect(worthNotingOf([{ worth_noting: 'x' }])).toBeNull()
    expect(worthNotingOf('worth_noting')).toBeNull()
  })
})

describe('groupPhotosByAlbum', () => {
  it('groups by album and caps each album', () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      photoRow({ storage_path: `a/${i}.jpg`, filename: `${i}.jpg` }))
    rows.push(photoRow({ album_id: 'album-2', storage_path: 'b/0.jpg' }))
    const grouped = groupPhotosByAlbum(rows, 6)
    expect(grouped.get('album-1')).toHaveLength(6)
    expect(grouped.get('album-2')).toHaveLength(1)
  })

  it('falls back from alt_text to caption to filename for the alt attribute', () => {
    const grouped = groupPhotosByAlbum([
      photoRow({ storage_path: 'a/1.jpg', alt_text: 'alt' }),
      photoRow({ storage_path: 'a/2.jpg', alt_text: null, caption: 'cap' }),
      photoRow({ storage_path: 'a/3.jpg', alt_text: null, caption: null, filename: 'f.jpg' }),
      photoRow({ storage_path: 'a/4.jpg', alt_text: null, caption: null, filename: null }),
    ])
    expect(grouped.get('album-1')?.map((p) => p.alt)).toEqual(['alt', 'cap', 'f.jpg', ''])
  })

  it('drops rows whose storage path could not be made into a URL', () => {
    const grouped = groupPhotosByAlbum([
      photoRow({ storage_path: '../escape.jpg' }),
      photoRow({ storage_path: null }),
      photoRow({ storage_path: 'a/ok.jpg' }),
    ])
    expect(grouped.get('album-1')?.map((p) => p.storage_path)).toEqual(['a/ok.jpg'])
  })

  it('drops rows with no album id', () => {
    expect(groupPhotosByAlbum([photoRow({ album_id: null })]).size).toBe(0)
  })

  it('keeps width and height only when numeric', () => {
    const [p] = groupPhotosByAlbum([photoRow({ width: null, height: 2000 })]).get('album-1')!
    expect(p.width).toBeNull()
    expect(p.height).toBe(2000)
  })
})

describe('buildTalkSurface', () => {
  const photos = new Map([['album-1', groupPhotosByAlbum([photoRow()]).get('album-1')!]])
  const match: AlbumMatchRow = { album_id: 'album-1', album_name: 'Seoul 2026 / Keynote', video_id: 'vid-row-1' }

  it('joins entry → video → album → photos', () => {
    const [talk] = buildTalkSurface([video()], [match], photos)
    expect(talk.entry_id).toBe('entry-1')
    expect(talk.youtube_id).toBe('dQw4w9WgXcQ')
    expect(talk.worth_noting).toBe('Latency, not accuracy, is what killed the first rollout.')
    // the leaf of the Drive path, not the whole breadcrumb
    expect(talk.album).toBe('Keynote')
    expect(talk.photos).toHaveLength(1)
  })

  it('joins the album on the video ROW uuid, not the YouTube id', () => {
    // conference_recap_album_matches.video_id is a FK to
    // conference_recap_videos.id; the same column name on the videos table
    // holds the YouTube id. Keying on the wrong one silently loses photos.
    const wrongKey: AlbumMatchRow = { ...match, video_id: 'dQw4w9WgXcQ' }
    expect(buildTalkSurface([video()], [wrongKey], photos)[0].photos).toEqual([])
  })

  it('still surfaces a video whose album never matched', () => {
    const [talk] = buildTalkSurface([video()], [], new Map())
    expect(talk.youtube_id).toBe('dQw4w9WgXcQ')
    expect(talk.photos).toEqual([])
    expect(talk.album).toBeNull()
  })

  it('still surfaces photos for a video whose id did not validate', () => {
    const [talk] = buildTalkSurface([video({ video_id: 'bad/id' })], [match], photos)
    expect(talk.youtube_id).toBeNull()
    expect(talk.photos).toHaveLength(1)
  })

  it('omits an entry with nothing to show, so it renders as it does today', () => {
    expect(buildTalkSurface(
      [video({ video_id: null, summary: null })],
      [],
      new Map(),
    )).toEqual([])
  })

  it('ignores a video with no agenda entry', () => {
    expect(buildTalkSurface([video({ agenda_entry_id: null })], [match], photos)).toEqual([])
  })

  it('keeps one video per entry, first one wins', () => {
    const out = buildTalkSurface(
      [video(), video({ id: 'vid-row-2', video_id: 'AAAAAAAAAAA' })],
      [match],
      photos,
    )
    expect(out).toHaveLength(1)
    expect(out[0].youtube_id).toBe('dQw4w9WgXcQ')
  })

  it('names no album when the matched album had no public photos', () => {
    const [talk] = buildTalkSurface([video()], [match], new Map())
    expect(talk.album).toBeNull()
  })

  it('ignores an album match with no album id', () => {
    const [talk] = buildTalkSurface([video()], [{ ...match, album_id: null }], photos)
    expect(talk.photos).toEqual([])
  })
})

describe('mediaSummaryLabel', () => {
  const base: AgendaTalkMedia = {
    entry_id: 'e', youtube_id: null, video_title: null, worth_noting: null, album: null, photos: [],
  }
  const onePhoto = groupPhotosByAlbum([photoRow()]).get('album-1')!
  const twoPhotos = groupPhotosByAlbum([photoRow(), photoRow({ storage_path: 'a/2.jpg' })]).get('album-1')!

  it('names the recording when there is one', () => {
    expect(mediaSummaryLabel({ ...base, youtube_id: 'dQw4w9WgXcQ' })).toBe('Watch the talk')
    expect(mediaSummaryLabel({ ...base, youtube_id: 'dQw4w9WgXcQ', photos: twoPhotos }))
      .toBe('Watch the talk · 2 photos')
  })

  it('does not promise a recording when there is none', () => {
    expect(mediaSummaryLabel({ ...base, photos: onePhoto })).toBe('1 photo')
    expect(mediaSummaryLabel({ ...base, worth_noting: 'x', photos: twoPhotos })).toBe('Recap note · 2 photos')
    expect(mediaSummaryLabel({ ...base, worth_noting: 'x' })).toBe('Recap note')
  })
})

describe('indexTalkSurface', () => {
  it('keys the payload by agenda entry id', () => {
    const talks = buildTalkSurface([video()], [], new Map())
    expect(indexTalkSurface(talks).get('entry-1')?.youtube_id).toBe('dQw4w9WgXcQ')
  })

  it('tolerates a missing or malformed payload', () => {
    expect(indexTalkSurface(undefined).size).toBe(0)
    expect(indexTalkSurface(null).size).toBe(0)
    expect(indexTalkSurface([{ entry_id: 1 } as unknown as AgendaTalkMedia]).size).toBe(0)
  })
})
