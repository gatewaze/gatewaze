'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import ImageGallery from 'react-image-gallery'
import 'react-image-gallery/styles/image-gallery.css'
import Image from 'next/image'
import { isLightColor } from '@/config/brand'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useEventContext } from './EventContext'
import { GlowBorder } from '@/components/ui/GlowBorder'
import { PhotoGrid } from './PhotoGrid'

// ─── Types ───────────────────────────────────────────────────
//
// This page is a client of the event-media module's public gallery API:
//   GET /api/public/event-media/events/:identifier/gallery
// (same-origin; the portal's next.config rewrite proxies /api/public/*
// to the API service). The legacy events_media* tables are gone.
//
// NOTE: the sponsor photo filter that used to live here was removed with
// the events_media retirement. It had been silently broken since the
// organiser rebuild — events_media_sponsor_tags is admin-only under RLS
// (anon reads return nothing) and its tags key on host_media ids, not
// the rows this page used to query. Reinstating it needs gallery-API
// support for sponsor tags, not a client-side join.

/** One album as the gallery API serves it. */
interface GalleryAlbum {
  album: string
  slug: string
  name: string
  count: number
  enhanced?: boolean
  xray?: boolean
}

/** One media row as the gallery API serves it. URLs are absolute. */
interface GalleryApiItem {
  id: string
  kind: 'photo' | 'video'
  url: string
  mime_type: string
  width: number | null
  height: number | null
  variants: Record<string, string | undefined>
  guest_name: string | null
  album_slug?: string
  created_at?: string
  /** Present when the album serves an enhanced copy: the untouched file. */
  original?: { url: string; thumb?: string; medium?: string }
}

interface GalleryResponse {
  event: { id: string; name: string | null; starts_at: string | null }
  albums: GalleryAlbum[]
  total: number
  items: GalleryApiItem[]
  next_offset: number | null
}

interface EventVideo {
  /** Set for YouTube videos (event_videos rows, or gallery items with a YouTube URL). */
  youtube_embed_url?: string
  /** Set for direct video files uploaded through the guest app. */
  file_url?: string
  /** Poster for direct files, when the API has one. */
  thumbnail_url?: string
  file_name: string
  caption?: string
}

interface LightboxItem {
  original: string
  thumbnail: string
}

// ─── Helpers ─────────────────────────────────────────────────

function getYouTubeVideoId(url: string): string | null {
  if (!url) return null
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\s?]+)/,
    /^([a-zA-Z0-9_-]{11})$/,
  ]
  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) return match[1]
  }
  return null
}

function getYouTubeThumbnail(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
}

function removeFileExtension(filename: string): string {
  const lastDotIndex = filename.lastIndexOf('.')
  if (lastDotIndex === -1) return filename
  return filename.substring(0, lastDotIndex)
}

/** The file name a download should save as, from the item's URL path. */
function fileNameFromUrl(url: string, fallback: string): string {
  try {
    const path = new URL(url, window.location.origin).pathname
    const last = path.substring(path.lastIndexOf('/') + 1)
    return last ? decodeURIComponent(last) : fallback
  } catch {
    return fallback
  }
}

/** The full-resolution image for the lightbox and the download button. */
function fullImageUrl(item: GalleryApiItem): string {
  return item.original?.url ?? item.url
}

// ─── Component ───────────────────────────────────────────────

const BATCH_SIZE = 50

/** What one gallery fetch produced. 'gone' = API 404 (no gallery). */
type GalleryPage = GalleryResponse | 'gone' | null

export function MediaContent() {
  const { event, useDarkText, primaryColor } = useEventContext()

  // Photos (current filter: all, or one album)
  const [items, setItems] = useState<GalleryApiItem[]>([])
  const [total, setTotal] = useState(0)
  const [allTotal, setAllTotal] = useState(0)
  const [nextOffset, setNextOffset] = useState<number | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [mounted, setMounted] = useState(false)

  // Albums
  const [albums, setAlbums] = useState<GalleryAlbum[]>([])
  const [selectedAlbumSlug, setSelectedAlbumSlug] = useState<string | null>(null)
  const [loadingAlbum, setLoadingAlbum] = useState(false)

  // Videos
  const [apiVideoItems, setApiVideoItems] = useState<EventVideo[]>([])
  const [linkedVideos, setLinkedVideos] = useState<EventVideo[]>([])
  const [showVideoLightbox, setShowVideoLightbox] = useState(false)
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0)

  // Lightbox
  const [showLightbox, setShowLightbox] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(0)

  const observerRef = useRef<HTMLDivElement>(null)
  // Media ids already folded into apiVideoItems, across pages.
  const seenVideoIdsRef = useRef<Set<string>>(new Set())

  const panelTheme = useMemo(() => ({
    panelBg: useDarkText ? 'bg-gray-900/15' : 'bg-white/15',
    panelBorder: useDarkText ? 'border border-gray-700/50' : 'border border-white/20',
    textColor: useDarkText ? 'text-gray-900' : 'text-white',
    textMuted: useDarkText ? 'text-gray-600' : 'text-white/70',
  }), [useDarkText])

  // ─── Supabase client helper (event_videos only) ──────────

  // Async signature kept so existing `await getSupabase()` call sites don't
  // change. Returns the singleton — see Header.tsx for the leak story.
  const getSupabase = useCallback(async () => getSupabaseClient(), [])

  // ─── Gallery API fetch ───────────────────────────────────

  const fetchGalleryPage = useCallback(async (
    albumSlug: string | null,
    offset: number,
  ): Promise<GalleryPage> => {
    try {
      const params = new URLSearchParams({ limit: String(BATCH_SIZE), offset: String(offset) })
      if (albumSlug) params.set('album', albumSlug)
      const res = await fetch(
        `/api/public/event-media/events/${encodeURIComponent(event.id)}/gallery?${params.toString()}`,
      )
      // 404 = this event has no gallery (no upload link with the gallery
      // switched on, and no portal-visible albums). The page's ordinary
      // "no media" state, not an error.
      if (res.status === 404) return 'gone'
      if (!res.ok) throw new Error(`gallery request failed: ${res.status}`)
      return (await res.json()) as GalleryResponse
    } catch (err) {
      console.error('Error loading media:', err)
      return null
    }
  }, [event.id])

  /** Fold a page's video items into the Videos section (dedupe by media id). */
  const collectApiVideos = useCallback((pageItems: GalleryApiItem[]) => {
    const fresh = pageItems.filter(
      (i) => i.kind === 'video' && !seenVideoIdsRef.current.has(i.id),
    )
    if (fresh.length === 0) return
    fresh.forEach((i) => seenVideoIdsRef.current.add(i.id))
    setApiVideoItems((prev) => [
      ...prev,
      ...fresh.map((i): EventVideo => {
        const ytId = getYouTubeVideoId(i.url)
        return ytId
          ? { youtube_embed_url: i.url, file_name: fileNameFromUrl(i.url, 'Video') }
          : {
              file_url: i.url,
              thumbnail_url: i.variants?.thumb,
              file_name: fileNameFromUrl(i.url, 'Video'),
              caption: i.guest_name ? `By ${i.guest_name}` : undefined,
            }
      }),
    ])
  }, [])

  const fetchInitialMedia = useCallback(async () => {
    setIsLoading(true)
    const page = await fetchGalleryPage(null, 0)
    if (page && page !== 'gone') {
      const photos = page.items.filter((i) => i.kind === 'photo')
      setItems(photos)
      collectApiVideos(page.items)
      setAlbums(page.albums)
      setTotal(page.total)
      setAllTotal(page.total)
      setNextOffset(page.next_offset)
    } else {
      // 'gone' and transient errors both render the empty state, as the
      // old page did when its queries returned nothing.
      setItems([])
      setAlbums([])
      setTotal(0)
      setAllTotal(0)
      setNextOffset(null)
    }
    setIsLoading(false)
  }, [fetchGalleryPage, collectApiVideos])

  const fetchVideos = useCallback(async () => {
    try {
      const supabase = await getSupabase()

      // Canonical `videos` linked via `event_videos` (P4 video object).
      // Guarded: tables may be absent per brand.
      const { data: linked, error: linkErr } = await supabase
        .from('event_videos')
        .select('sort_order, video:videos(url, title, caption:description, status, visibility)')
        .eq('event_uuid', event.id)
        .order('sort_order', { ascending: true })
      if (linkErr || !linked) {
        setLinkedVideos([])
        return
      }

      const out: EventVideo[] = []
      for (const row of linked as Array<{ video: unknown }>) {
        const v = (Array.isArray(row.video) ? row.video[0] : row.video) as
          | { url?: string; title?: string; caption?: string; status?: string; visibility?: string }
          | null
        if (!v?.url || v.status !== 'published' || v.visibility !== 'public') continue
        out.push({
          youtube_embed_url: v.url,
          file_name: v.title || 'Video',
          caption: v.caption,
        })
      }
      setLinkedVideos(out)
    } catch (err) {
      console.error('Error loading videos:', err)
    }
  }, [event.id, getSupabase])

  // Gallery videos first, then event_videos rows deduped against them by
  // YouTube id — the same dedupe the events_media/event_videos pair had,
  // so a recording that exists in both surfaces once.
  const videoItems = useMemo(() => {
    const merged: EventVideo[] = [...apiVideoItems]
    const seen = new Set(
      merged
        .map((v) => (v.youtube_embed_url ? getYouTubeVideoId(v.youtube_embed_url) : null))
        .filter(Boolean) as string[],
    )
    for (const v of linkedVideos) {
      const id = v.youtube_embed_url ? getYouTubeVideoId(v.youtube_embed_url) : null
      if (id && seen.has(id)) continue
      if (id) seen.add(id)
      merged.push(v)
    }
    return merged
  }, [apiVideoItems, linkedVideos])

  const fetchAlbumMedia = useCallback(async (albumSlug: string | null) => {
    setLoadingAlbum(true)
    const page = await fetchGalleryPage(albumSlug, 0)
    if (page && page !== 'gone') {
      setItems(page.items.filter((i) => i.kind === 'photo'))
      collectApiVideos(page.items)
      setTotal(page.total)
      setNextOffset(page.next_offset)
    } else {
      setItems([])
      setTotal(0)
      setNextOffset(null)
    }
    setLoadingAlbum(false)
  }, [fetchGalleryPage, collectApiVideos])

  // ─── Load more (infinite scroll) ────────────────────────

  const loadMoreMedia = useCallback(async () => {
    if (loadingMore || nextOffset === null) return
    setLoadingMore(true)
    const page = await fetchGalleryPage(selectedAlbumSlug, nextOffset)
    if (page && page !== 'gone') {
      const photos = page.items.filter((i) => i.kind === 'photo')
      setItems((prev) => [...prev, ...photos])
      collectApiVideos(page.items)
      setNextOffset(page.next_offset)
    } else {
      setNextOffset(null)
    }
    setLoadingMore(false)
  }, [loadingMore, nextOffset, selectedAlbumSlug, fetchGalleryPage, collectApiVideos])

  // ─── Initial load ────────────────────────────────────────

  useEffect(() => {
    setMounted(true)
    if (event.id) {
      fetchInitialMedia()
      fetchVideos()
    }
  }, [event.id, fetchInitialMedia, fetchVideos])

  // ─── Intersection Observer for lazy loading ──────────────

  useEffect(() => {
    if (!observerRef.current || nextOffset === null || loadingMore) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && nextOffset !== null && !loadingMore) {
          loadMoreMedia()
        }
      },
      { threshold: 0.1 }
    )
    observer.observe(observerRef.current)
    return () => observer.disconnect()
  }, [nextOffset, loadingMore, loadMoreMedia])

  // ─── Handlers ────────────────────────────────────────────

  const handleAlbumClick = (album: GalleryAlbum | null) => {
    const slug = album?.slug ?? null
    setSelectedAlbumSlug(slug)
    fetchAlbumMedia(slug)
  }

  const handlePhotoClick = (index: number) => {
    setCurrentIndex(index)
    setShowLightbox(true)
  }

  const handleDownload = async () => {
    const currentMedia = items[currentIndex]
    if (currentMedia) {
      try {
        const downloadUrl = fullImageUrl(currentMedia)
        const response = await fetch(downloadUrl)
        const blob = await response.blob()
        const blobUrl = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = blobUrl
        link.download = fileNameFromUrl(downloadUrl, 'photo')
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(blobUrl)
      } catch (error) {
        console.error('Error downloading image:', error)
      }
    }
  }

  // ─── Derived state ───────────────────────────────────────

  const photos = items.map((media) => ({
    id: media.id,
    media_url: media.variants?.thumb ?? media.url,
    caption: media.guest_name ?? undefined,
  }))

  const lightboxItems: LightboxItem[] = useMemo(() => items.map((media) => ({
    original: fullImageUrl(media),
    thumbnail: media.variants?.thumb ?? media.url,
  })), [items])

  const displayTotalCount = allTotal

  // ─── Render ──────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className={`text-center py-12 transition-opacity duration-500 ${mounted ? 'opacity-100' : 'opacity-0'}`}>
        <div
          className="loader mx-auto mb-4"
          style={{ '--primary-color': '#fff', '--secondary-color': primaryColor } as React.CSSProperties}
        />
        <p className={panelTheme.textMuted}>Loading media...</p>
      </div>
    )
  }

  if (allTotal === 0 && videoItems.length === 0) {
    return (
      <div className={`transition-opacity duration-500 ${mounted ? 'opacity-100' : 'opacity-0'}`}>
        <GlowBorder useDarkTheme={useDarkText}>
          <div className={`${panelTheme.panelBg} backdrop-blur-[10px] rounded-2xl overflow-hidden ${panelTheme.panelBorder} p-6 sm:p-8`}>
            <div className="text-center py-8">
              <svg className={`w-16 h-16 mx-auto mb-4 ${panelTheme.textMuted}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v13.5A1.5 1.5 0 003.75 21z" />
              </svg>
              <h2 className={`text-xl font-semibold ${panelTheme.textColor} mb-2`}>No media yet</h2>
              <p className={panelTheme.textMuted}>Photos and videos for this event will appear here.</p>
            </div>
          </div>
        </GlowBorder>
      </div>
    )
  }

  return (
    <div className={`space-y-6 transition-opacity duration-500 ${mounted ? 'opacity-100' : 'opacity-0'}`}>
      <h1 className={`text-2xl sm:text-3xl font-bold ${panelTheme.textColor}`}>Media</h1>

      {/* Videos section */}
      {videoItems.length > 0 && (
        <div>
          <h2 className={`flex items-center gap-2.5 text-lg font-semibold ${panelTheme.textColor} mb-4`}>
            <svg className="w-5 h-5" style={{ color: primaryColor }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
            </svg>
            Videos
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {videoItems.map((video, index) => {
              const videoId = video.youtube_embed_url ? getYouTubeVideoId(video.youtube_embed_url) : null
              if (!videoId && !video.file_url) return null
              const thumbSrc = videoId ? getYouTubeThumbnail(videoId) : video.thumbnail_url
              return (
                <button
                  key={index}
                  className="relative aspect-video rounded-xl overflow-hidden cursor-pointer border-0 p-0 bg-black transition-all duration-200 hover:scale-[1.02] hover:shadow-[0_8px_24px_rgba(0,0,0,0.15)]"
                  onClick={() => { setCurrentVideoIndex(index); setShowVideoLightbox(true) }}
                >
                  {thumbSrc && (
                    <Image
                      src={thumbSrc}
                      alt={video.caption || 'Video thumbnail'}
                      fill
                      sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                      className="object-cover"
                    />
                  )}
                  <div className="absolute inset-0 flex items-center justify-center pb-10 bg-gradient-to-b from-black/5 to-black/15 hover:from-black/10 hover:to-black/25 transition-all">
                    <svg className="w-12 h-12 text-white" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                  {video.file_name && (
                    <div className="absolute bottom-0 left-0 right-0 px-3 py-3 bg-gradient-to-t from-black/80 to-transparent text-white text-sm font-medium text-center truncate">
                      {removeFileExtension(video.file_name)}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Photos section */}
      <div>
        <h2 className={`flex items-center gap-2.5 text-lg font-semibold ${panelTheme.textColor} mb-4`}>
          <svg className="w-5 h-5" style={{ color: primaryColor }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v13.5A1.5 1.5 0 003.75 21z" />
          </svg>
          Photos
        </h2>

        {/* Album filter buttons */}
        {albums.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            <button
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer transition-all duration-200 relative ${
                !selectedAlbumSlug
                  ? 'border-transparent'
                  : `${useDarkText ? 'text-gray-600 border-gray-300 hover:border-gray-400 bg-white/40' : 'text-white/70 border-white/20 hover:border-white/40 bg-white/10'}`
              }`}
              style={!selectedAlbumSlug ? { backgroundColor: primaryColor, borderColor: primaryColor, color: isLightColor(primaryColor) ? '#000000' : '#ffffff' } : { borderWidth: '1.5px' }}
              onClick={() => handleAlbumClick(null)}
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v13.5A1.5 1.5 0 003.75 21z" />
              </svg>
              All photos
              {displayTotalCount > 0 && (
                <span
                  className="absolute -top-2 -right-2 rounded-full px-1.5 min-w-[18px] h-[18px] flex items-center justify-center text-[11px] font-semibold shadow"
                  style={
                    !selectedAlbumSlug
                      ? { backgroundColor: '#fff', color: primaryColor }
                      : { backgroundColor: useDarkText ? '#374151' : 'rgba(255,255,255,0.9)', color: useDarkText ? '#fff' : '#333' }
                  }
                >
                  {displayTotalCount}
                </span>
              )}
            </button>
            {albums.map((album) => (
              <button
                key={album.slug}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer transition-all duration-200 relative ${
                  selectedAlbumSlug === album.slug
                    ? 'border-transparent'
                    : `${useDarkText ? 'text-gray-600 border-gray-300 hover:border-gray-400 bg-white/40' : 'text-white/70 border-white/20 hover:border-white/40 bg-white/10'}`
                }`}
                style={selectedAlbumSlug === album.slug ? { backgroundColor: primaryColor, borderColor: primaryColor, color: isLightColor(primaryColor) ? '#000000' : '#ffffff' } : { borderWidth: '1.5px' }}
                onClick={() => handleAlbumClick(album)}
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                </svg>
                {album.name}
                {album.count > 0 && (
                  <span
                    className="absolute -top-2 -right-2 rounded-full px-1.5 min-w-[18px] h-[18px] flex items-center justify-center text-[11px] font-semibold shadow"
                    style={
                      selectedAlbumSlug === album.slug
                        ? { backgroundColor: '#fff', color: primaryColor }
                        : { backgroundColor: useDarkText ? '#374151' : 'rgba(255,255,255,0.9)', color: useDarkText ? '#fff' : '#333' }
                    }
                  >
                    {album.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Photo grid */}
        {loadingAlbum ? (
          <div className="flex flex-col items-center justify-center py-16 min-h-[300px]">
            <div
              className="loader mx-auto mb-4"
              style={{ '--primary-color': '#fff', '--secondary-color': primaryColor } as React.CSSProperties}
            />
            <p className={panelTheme.textMuted}>Loading album photos...</p>
          </div>
        ) : (
          <PhotoGrid photos={photos} onPhotoClick={handlePhotoClick} />
        )}

        {/* Loading more indicator */}
        {loadingMore && (
          <div className="flex flex-col items-center justify-center py-10">
            <div
              className="loader mx-auto mb-4"
              style={{ '--primary-color': '#fff', '--secondary-color': primaryColor } as React.CSSProperties}
            />
            <p className={panelTheme.textMuted}>Loading more photos...</p>
          </div>
        )}

        {/* Intersection observer target */}
        {nextOffset !== null && !loadingMore && !loadingAlbum && (
          <div ref={observerRef} className="h-[100px] w-full mt-5" />
        )}

        {/* End message */}
        {!selectedAlbumSlug && nextOffset === null && items.length > 0 && (
          <div className="text-center py-10 mt-5">
            <p className={panelTheme.textMuted}>All photos loaded ({total} total)</p>
          </div>
        )}
      </div>

      {/* ─── Photo Lightbox ───────────────────────────────── */}
      {showLightbox && lightboxItems.length > 0 && (
        <div className="fixed inset-0 bg-black/95 z-[10000] flex items-center justify-center">
          <div className="relative w-full h-full flex items-center justify-center">
            {/* Close button */}
            <button
              className="fixed top-5 left-5 w-11 h-11 bg-white/10 border-0 rounded-full text-white text-2xl cursor-pointer flex items-center justify-center transition-colors hover:bg-white/20 z-[10001]"
              onClick={() => setShowLightbox(false)}
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {/* Download button */}
            <button
              className="fixed top-5 right-5 w-11 h-11 bg-white/10 border-0 rounded-full text-white text-xl cursor-pointer flex items-center justify-center transition-colors hover:bg-white/20 z-[10001]"
              onClick={handleDownload}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
            </button>

            {/* Image gallery */}
            <ImageGallery
              items={lightboxItems}
              startIndex={currentIndex}
              showThumbnails={false}
              showPlayButton={false}
              showFullscreenButton={true}
              onSlide={(index) => setCurrentIndex(index)}
              additionalClass="custom-image-gallery"
            />

            {/* Credit — the gallery API carries the guest's name, not a caption */}
            {(() => {
              const currentMedia = items[currentIndex]
              return currentMedia?.guest_name ? (
                <div className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-black/70 backdrop-blur-[10px] px-6 py-4 rounded-lg max-w-[600px] z-[10001]">
                  <p className="text-white m-0 text-base text-center whitespace-pre-wrap">By {currentMedia.guest_name}</p>
                </div>
              ) : null
            })()}
          </div>

          {/* Lightbox styles */}
          <style>{`
            .custom-image-gallery { width: 100%; max-width: 90vw; max-height: 90vh; }
            .custom-image-gallery .image-gallery-slide img { max-height: 85vh; object-fit: contain; }
            @media (max-width: 768px) {
              .custom-image-gallery .image-gallery-slide img { max-height: calc(100vh - 120px); }
            }
          `}</style>
        </div>
      )}

      {/* ─── Video Lightbox ───────────────────────────────── */}
      {showVideoLightbox && videoItems.length > 0 && (() => {
        const currentVideo = videoItems[currentVideoIndex]
        const videoId = currentVideo?.youtube_embed_url ? getYouTubeVideoId(currentVideo.youtube_embed_url) : null
        if (!currentVideo || (!videoId && !currentVideo.file_url)) return null
        return (
          <div className="fixed inset-0 bg-black/95 z-[10000] flex items-center justify-center">
            <div className="relative w-full h-full flex items-center justify-center">
              {/* Close */}
              <button
                className="fixed top-5 left-5 w-11 h-11 bg-white/10 border-0 rounded-full text-white text-2xl cursor-pointer flex items-center justify-center transition-colors hover:bg-white/20 z-[10001]"
                onClick={() => setShowVideoLightbox(false)}
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              {/* Nav arrows */}
              {videoItems.length > 1 && (
                <>
                  <button
                    className="fixed left-5 top-1/2 -translate-y-1/2 w-[50px] h-[50px] bg-white/10 border-0 rounded-full text-white text-3xl cursor-pointer flex items-center justify-center transition-colors hover:bg-white/20 z-[10001]"
                    onClick={() => setCurrentVideoIndex((prev) => prev === 0 ? videoItems.length - 1 : prev - 1)}
                  >
                    &#8249;
                  </button>
                  <button
                    className="fixed right-5 top-1/2 -translate-y-1/2 w-[50px] h-[50px] bg-white/10 border-0 rounded-full text-white text-3xl cursor-pointer flex items-center justify-center transition-colors hover:bg-white/20 z-[10001]"
                    onClick={() => setCurrentVideoIndex((prev) => prev === videoItems.length - 1 ? 0 : prev + 1)}
                  >
                    &#8250;
                  </button>
                </>
              )}

              {/* YouTube embed, or the uploaded file itself */}
              <div className="w-[90vw] max-w-[1200px] aspect-video">
                {videoId ? (
                  <iframe
                    src={`https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`}
                    title={currentVideo.caption || 'Video'}
                    className="w-full h-full border-0 rounded-lg"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                ) : (
                  <video
                    src={currentVideo.file_url}
                    poster={currentVideo.thumbnail_url}
                    className="w-full h-full rounded-lg bg-black"
                    controls
                    autoPlay
                  />
                )}
              </div>

              {/* Caption */}
              {currentVideo.caption && (
                <div className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-black/70 backdrop-blur-[10px] px-6 py-4 rounded-lg max-w-[600px] z-[10001]">
                  <p className="text-white m-0 text-base text-center whitespace-pre-wrap">{currentVideo.caption}</p>
                </div>
              )}

              {/* Counter */}
              {videoItems.length > 1 && (
                <div className="fixed top-6 left-1/2 -translate-x-1/2 text-white text-sm bg-black/50 px-4 py-1.5 rounded-full z-[10001]">
                  {currentVideoIndex + 1} / {videoItems.length}
                </div>
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
