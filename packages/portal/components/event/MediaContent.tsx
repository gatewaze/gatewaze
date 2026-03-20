'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import ImageGallery from 'react-image-gallery'
import 'react-image-gallery/styles/image-gallery.css'
import { getClientBrandConfig, isLightColor } from '@/config/brand'
import { useEventContext } from './EventContext'
import { GlowBorder } from '@/components/ui/GlowBorder'
import { PhotoGrid } from './PhotoGrid'
import { isBunnyCDNEnabled, getBunnyImageUrl } from '@/lib/bunnyNet'

// ─── Types ───────────────────────────────────────────────────

interface EventMedia {
  id: string
  event_id: string
  file_name: string
  storage_path: string
  file_type: 'photo' | 'video'
  thumbnail_path?: string
  metadata?: {
    medium_path?: string
    processed?: boolean
  }
  caption?: string
  created_at?: string
  youtube_embed_url?: string
}

interface EventMediaAlbum {
  id: string
  event_id: string
  name: string
  description?: string
  sort_order: number
  media_count?: number
}

interface EventSponsor {
  id: string
  event_id: string
  sponsor_id: string
  sponsorship_tier: string
  is_active: boolean
  sponsor: {
    id: string
    name: string
    slug: string
    logo_url?: string
  }
  media_count?: number
}

interface EventVideo {
  youtube_embed_url: string
  file_name: string
  caption?: string
}

interface GalleryItem {
  original: string
  thumbnail: string
  description?: string
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

// ─── Component ───────────────────────────────────────────────

const BATCH_SIZE = 50

export function MediaContent() {
  const { event, useDarkText, primaryColor, brandConfig } = useEventContext()

  // State
  const [mediaItems, setMediaItems] = useState<EventMedia[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [mounted, setMounted] = useState(false)

  // Albums
  const [albums, setAlbums] = useState<EventMediaAlbum[]>([])
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null)
  const [albumMediaItems, setAlbumMediaItems] = useState<EventMedia[]>([])
  const [loadingAlbum, setLoadingAlbum] = useState(false)

  // Sponsors
  const [sponsors, setSponsors] = useState<EventSponsor[]>([])
  const [selectedSponsorId, setSelectedSponsorId] = useState<string | null>(null)
  const [sponsorMediaItems, setSponsorMediaItems] = useState<EventMedia[]>([])
  const [loadingSponsor, setLoadingSponsor] = useState(false)
  const [sponsorFilteredAlbums, setSponsorFilteredAlbums] = useState<EventMediaAlbum[]>([])

  // Videos
  const [videoItems, setVideoItems] = useState<EventVideo[]>([])
  const [showVideoLightbox, setShowVideoLightbox] = useState(false)
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0)

  // Lightbox
  const [showLightbox, setShowLightbox] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [galleryItems, setGalleryItems] = useState<GalleryItem[]>([])

  const observerRef = useRef<HTMLDivElement>(null)

  const panelTheme = useMemo(() => ({
    panelBg: useDarkText ? 'bg-gray-900/15' : 'bg-white/15',
    panelBorder: useDarkText ? 'border border-gray-700/50' : 'border border-white/20',
    textColor: useDarkText ? 'text-gray-900' : 'text-white',
    textMuted: useDarkText ? 'text-gray-600' : 'text-white/70',
  }), [useDarkText])

  // ─── Supabase client helper ──────────────────────────────

  const getSupabase = useCallback(async () => {
    const config = getClientBrandConfig()
    const { createClient } = await import('@supabase/supabase-js')
    return createClient(config.supabaseUrl, config.supabaseAnonKey)
  }, [])

  // ─── Media URL helper ────────────────────────────────────

  const getMediaPublicUrl = useCallback((
    storagePath: string,
    transform?: { width?: number; height?: number; quality?: number; resize?: 'cover' | 'contain' | 'fill' },
    options?: { disableCDN?: boolean }
  ): string => {
    const storageBaseUrl = brandConfig.supabaseUrl
    const publicUrl = `${storageBaseUrl}/storage/v1/object/public/media/${storagePath}`

    if (options?.disableCDN) return publicUrl

    if (isBunnyCDNEnabled()) {
      return getBunnyImageUrl(publicUrl, transform ? {
        width: transform.width,
        height: transform.height,
        quality: transform.quality,
        fit: transform.resize,
      } : undefined)
    }

    // Fallback: use Supabase image transformation API when transforms are requested
    if (transform && (transform.width || transform.height)) {
      const renderUrl = `${storageBaseUrl}/storage/v1/render/image/public/media/${storagePath}`
      const params = new URLSearchParams()
      if (transform.width) params.append('width', transform.width.toString())
      if (transform.height) params.append('height', transform.height.toString())
      if (transform.quality) params.append('quality', transform.quality.toString())
      if (transform.resize) params.append('resize', transform.resize)
      return `${renderUrl}?${params.toString()}`
    }

    return publicUrl
  }, [brandConfig.supabaseUrl])

  // ─── Gallery item builder ────────────────────────────────

  const buildGalleryItems = useCallback((media: EventMedia[]): GalleryItem[] => {
    return media.map((item) => ({
      original: item.metadata?.medium_path
        ? getMediaPublicUrl(item.metadata.medium_path)
        : getMediaPublicUrl(item.storage_path, { width: 800, height: 800, quality: 85, resize: 'contain' }),
      thumbnail: item.thumbnail_path
        ? getMediaPublicUrl(item.thumbnail_path)
        : getMediaPublicUrl(item.storage_path, { width: 350, height: 350, quality: 80, resize: 'contain' }),
      description: item.caption,
    }))
  }, [getMediaPublicUrl])

  // ─── Fetch functions ─────────────────────────────────────

  const fetchInitialMedia = useCallback(async () => {
    try {
      setIsLoading(true)
      const supabase = await getSupabase()

      // Count total photos
      const { count } = await supabase
        .from('events_media')
        .select('*', { count: 'exact', head: true })
        .eq('event_id', event.event_id)
        .eq('file_type', 'photo')

      setTotalCount(count || 0)

      // Fetch first batch
      const { data: mediaData } = await supabase
        .from('events_media')
        .select('*')
        .eq('event_id', event.event_id)
        .eq('file_type', 'photo')
        .order('created_at', { ascending: true })
        .range(0, BATCH_SIZE - 1)

      const media = (mediaData || []) as EventMedia[]
      setMediaItems(media)
      setHasMore(media.length === BATCH_SIZE && media.length < (count || 0))
      setGalleryItems(buildGalleryItems(media))
    } catch (err) {
      console.error('Error loading media:', err)
    } finally {
      setIsLoading(false)
    }
  }, [event.event_id, getSupabase, buildGalleryItems])

  const fetchAlbums = useCallback(async () => {
    try {
      const supabase = await getSupabase()
      const { data: albumData } = await supabase
        .from('events_media_albums')
        .select('*')
        .eq('event_id', event.event_id)
        .order('sort_order')

      if (albumData) {
        const albumsWithCounts = await Promise.all(
          albumData.map(async (album: EventMediaAlbum) => {
            const { count } = await supabase
              .from('events_media_album_items')
              .select('*', { count: 'exact', head: true })
              .eq('album_id', album.id)
            return { ...album, media_count: count || 0 }
          })
        )
        setAlbums(albumsWithCounts)
      }
    } catch (err) {
      console.error('Error loading albums:', err)
    }
  }, [event.event_id, getSupabase])

  const fetchSponsors = useCallback(async () => {
    try {
      const supabase = await getSupabase()

      const { data: sponsorData } = await supabase
        .from('events_sponsors')
        .select(`*, sponsor:events_sponsor_profiles(id, name, slug, logo_url)`)
        .eq('event_id', event.event_id)
        .eq('is_active', true)
        .order('sponsorship_tier')

      // Get all media IDs for this event
      const { data: allMediaForEvent } = await supabase
        .from('events_media')
        .select('id')
        .eq('event_id', event.event_id)
        .eq('file_type', 'photo')

      const mediaIds = allMediaForEvent?.map((m: { id: string }) => m.id) || []

      if (mediaIds.length > 0 && sponsorData && sponsorData.length > 0) {
        // Fetch sponsor tags in batches
        const chunkSize = 50
        const allTags: { event_sponsor_id: string; media_id: string }[] = []
        for (let i = 0; i < mediaIds.length; i += chunkSize) {
          const chunk = mediaIds.slice(i, i + chunkSize)
          const { data: tags } = await supabase
            .from('events_media_sponsor_tags')
            .select('event_sponsor_id, media_id')
            .in('media_id', chunk)
          if (tags) allTags.push(...tags)
        }

        const sponsorMediaCounts = new Map<string, number>()
        allTags.forEach((tag: { event_sponsor_id: string }) => {
          const count = sponsorMediaCounts.get(tag.event_sponsor_id) || 0
          sponsorMediaCounts.set(tag.event_sponsor_id, count + 1)
        })

        const sponsorsWithCounts = (sponsorData as EventSponsor[]).map((s) => ({
          ...s,
          media_count: sponsorMediaCounts.get(s.id) || 0,
        }))

        setSponsors(sponsorsWithCounts.filter((s) => (s.media_count ?? 0) > 0))
      } else {
        setSponsors([])
      }
    } catch (err) {
      console.error('Error loading sponsors:', err)
    }
  }, [event.event_id, getSupabase])

  const fetchVideos = useCallback(async (eventSponsorId?: string | null) => {
    try {
      const supabase = await getSupabase()

      let videoIds: string[] | null = null
      if (eventSponsorId) {
        const { data: sponsorTags } = await supabase
          .from('events_media_sponsor_tags')
          .select('media_id')
          .eq('event_sponsor_id', eventSponsorId)
        if (!sponsorTags || sponsorTags.length === 0) {
          setVideoItems([])
          return
        }
        videoIds = sponsorTags.map((tag: { media_id: string }) => tag.media_id)
      }

      let query = supabase
        .from('events_media')
        .select('*')
        .eq('event_id', event.event_id)
        .eq('file_type', 'video')
        .order('created_at', { ascending: true })

      if (videoIds) {
        query = query.in('id', videoIds)
      }

      const { data: videoData } = await query

      if (videoData && videoData.length > 0) {
        const videos = videoData
          .filter((v: EventMedia) => !!v.youtube_embed_url)
          .map((v: EventMedia) => ({
            youtube_embed_url: v.youtube_embed_url!,
            file_name: v.file_name,
            caption: v.caption,
          }))
        setVideoItems(videos)
      } else {
        setVideoItems([])
      }
    } catch (err) {
      console.error('Error loading videos:', err)
    }
  }, [event.event_id, getSupabase])

  const fetchAlbumMedia = useCallback(async (albumId: string, eventSponsorId?: string | null) => {
    try {
      setLoadingAlbum(true)
      const supabase = await getSupabase()

      const { data: albumItems } = await supabase
        .from('events_media_album_items')
        .select('media_id')
        .eq('album_id', albumId)
        .order('sort_order')

      if (albumItems && albumItems.length > 0) {
        let mediaIds = albumItems.map((item: { media_id: string }) => item.media_id)

        // Filter by sponsor if needed
        if (eventSponsorId) {
          const { data: sponsorTags } = await supabase
            .from('events_media_sponsor_tags')
            .select('media_id')
            .eq('event_sponsor_id', eventSponsorId)
          if (sponsorTags) {
            const sponsorMediaIds = new Set(sponsorTags.map((tag: { media_id: string }) => tag.media_id))
            mediaIds = mediaIds.filter((id: string) => sponsorMediaIds.has(id))
          }
        }

        if (mediaIds.length === 0) {
          setAlbumMediaItems([])
          return
        }

        const { data: mediaData } = await supabase
          .from('events_media')
          .select('*')
          .in('id', mediaIds)
          .eq('file_type', 'photo')

        if (mediaData) {
          const sortedMedia = mediaIds
            .map((id: string) => mediaData.find((m: EventMedia) => m.id === id))
            .filter(Boolean) as EventMedia[]
          setAlbumMediaItems(sortedMedia)
        }
      } else {
        setAlbumMediaItems([])
      }
    } catch (err) {
      console.error('Error loading album media:', err)
    } finally {
      setLoadingAlbum(false)
    }
  }, [getSupabase])

  const fetchSponsorMedia = useCallback(async (eventSponsorId: string) => {
    try {
      setLoadingSponsor(true)
      const supabase = await getSupabase()

      const { data: sponsorTags } = await supabase
        .from('events_media_sponsor_tags')
        .select('media_id')
        .eq('event_sponsor_id', eventSponsorId)

      if (sponsorTags && sponsorTags.length > 0) {
        const mediaIds = sponsorTags.map((tag: { media_id: string }) => tag.media_id)
        const { data: mediaData } = await supabase
          .from('events_media')
          .select('*')
          .in('id', mediaIds)
          .eq('file_type', 'photo')
          .order('created_at', { ascending: true })

        setSponsorMediaItems((mediaData || []) as EventMedia[])
      } else {
        setSponsorMediaItems([])
      }
    } catch (err) {
      console.error('Error loading sponsor media:', err)
    } finally {
      setLoadingSponsor(false)
    }
  }, [getSupabase])

  const fetchSponsorFilteredAlbums = useCallback(async (eventSponsorId: string) => {
    try {
      const supabase = await getSupabase()

      const { data: sponsorTags } = await supabase
        .from('events_media_sponsor_tags')
        .select('media_id')
        .eq('event_sponsor_id', eventSponsorId)

      if (!sponsorTags || sponsorTags.length === 0) {
        setSponsorFilteredAlbums([])
        return
      }

      const sponsorMediaIds = new Set(sponsorTags.map((tag: { media_id: string }) => tag.media_id))

      const { data: albumData } = await supabase
        .from('events_media_albums')
        .select('*')
        .eq('event_id', event.event_id)
        .order('sort_order')

      if (!albumData) {
        setSponsorFilteredAlbums([])
        return
      }

      const albumsWithCounts = await Promise.all(
        albumData.map(async (album: EventMediaAlbum) => {
          const { data: albumItems } = await supabase
            .from('events_media_album_items')
            .select('media_id')
            .eq('album_id', album.id)
          if (!albumItems) return { ...album, media_count: 0 }
          const count = albumItems.filter((item: { media_id: string }) => sponsorMediaIds.has(item.media_id)).length
          return { ...album, media_count: count }
        })
      )

      setSponsorFilteredAlbums(albumsWithCounts.filter((a) => a.media_count > 0))
    } catch (err) {
      console.error('Error loading sponsor-filtered albums:', err)
      setSponsorFilteredAlbums([])
    }
  }, [event.event_id, getSupabase])

  // ─── Load more (infinite scroll) ────────────────────────

  const loadMoreMedia = useCallback(async () => {
    if (loadingMore || !hasMore) return
    try {
      setLoadingMore(true)
      const supabase = await getSupabase()
      const offset = mediaItems.length

      const { data: mediaData } = await supabase
        .from('events_media')
        .select('*')
        .eq('event_id', event.event_id)
        .eq('file_type', 'photo')
        .order('created_at', { ascending: true })
        .range(offset, offset + BATCH_SIZE - 1)

      const newMedia = (mediaData || []) as EventMedia[]
      const updatedMedia = [...mediaItems, ...newMedia]
      setMediaItems(updatedMedia)
      setHasMore(newMedia.length === BATCH_SIZE && updatedMedia.length < totalCount)
      setGalleryItems(buildGalleryItems(updatedMedia))
    } catch (err) {
      console.error('Error loading more media:', err)
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, hasMore, mediaItems, event.event_id, totalCount, getSupabase, buildGalleryItems])

  // ─── Initial load ────────────────────────────────────────

  useEffect(() => {
    setMounted(true)
    if (event.event_id) {
      fetchInitialMedia()
      fetchAlbums()
      fetchSponsors()
      fetchVideos()
    }
  }, [event.event_id, fetchInitialMedia, fetchAlbums, fetchSponsors, fetchVideos])

  // ─── Intersection Observer for lazy loading ──────────────

  useEffect(() => {
    if (!observerRef.current || !hasMore || loadingMore || selectedAlbumId || selectedSponsorId) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore && !selectedAlbumId && !selectedSponsorId) {
          loadMoreMedia()
        }
      },
      { threshold: 0.1 }
    )
    observer.observe(observerRef.current)
    return () => observer.disconnect()
  }, [hasMore, loadingMore, selectedAlbumId, selectedSponsorId, loadMoreMedia])

  // ─── Handlers ────────────────────────────────────────────

  const handleAlbumClick = (album: EventMediaAlbum | null) => {
    if (album) {
      setSelectedAlbumId(album.id)
      fetchAlbumMedia(album.id, selectedSponsorId)
    } else {
      setSelectedAlbumId(null)
      setAlbumMediaItems([])
      if (totalCount > mediaItems.length) setHasMore(true)
    }
  }

  const handleSponsorChange = (sponsorId: string) => {
    if (sponsorId) {
      const sponsor = sponsors.find((s) => s.id === sponsorId)
      if (sponsor) {
        setSelectedSponsorId(sponsor.id)
        setSelectedAlbumId(null)
        setAlbumMediaItems([])
        fetchSponsorMedia(sponsor.id)
        fetchVideos(sponsor.id)
        fetchSponsorFilteredAlbums(sponsor.id)
      }
    } else {
      setSelectedSponsorId(null)
      setSponsorMediaItems([])
      setSponsorFilteredAlbums([])
      setSelectedAlbumId(null)
      setAlbumMediaItems([])
      fetchVideos()
      if (totalCount > mediaItems.length) setHasMore(true)
    }
  }

  const handlePhotoClick = (index: number) => {
    const currentMediaArray = selectedAlbumId
      ? albumMediaItems
      : selectedSponsorId
        ? sponsorMediaItems
        : mediaItems

    setCurrentIndex(index)
    setGalleryItems(buildGalleryItems(currentMediaArray))
    setShowLightbox(true)
  }

  const handleDownload = async () => {
    const currentMedia = selectedAlbumId
      ? albumMediaItems[currentIndex]
      : selectedSponsorId
        ? sponsorMediaItems[currentIndex]
        : mediaItems[currentIndex]

    if (currentMedia) {
      try {
        const downloadUrl = getMediaPublicUrl(currentMedia.storage_path, undefined, { disableCDN: true })
        const response = await fetch(downloadUrl)
        const blob = await response.blob()
        const blobUrl = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = blobUrl
        link.download = currentMedia.file_name
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

  const displayMedia = selectedAlbumId
    ? albumMediaItems
    : selectedSponsorId
      ? sponsorMediaItems
      : mediaItems

  const photos = displayMedia.map((media) => ({
    id: media.id,
    media_url: media.thumbnail_path
      ? getMediaPublicUrl(media.thumbnail_path)
      : getMediaPublicUrl(media.storage_path, { width: 350, height: 350, quality: 80, resize: 'contain' }),
    caption: media.caption,
  }))

  const displayAlbums = selectedSponsorId ? sponsorFilteredAlbums : albums
  const displayTotalCount = selectedSponsorId ? sponsorMediaItems.length : totalCount

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

  if (totalCount === 0 && videoItems.length === 0) {
    return (
      <div className={`transition-opacity duration-500 ${mounted ? 'opacity-100' : 'opacity-0'}`}>
        <GlowBorder useDarkTheme={useDarkText}>
          <div className={`${panelTheme.panelBg} backdrop-blur-[10px] rounded-2xl shadow-2xl overflow-hidden ${panelTheme.panelBorder} p-6 sm:p-8`}>
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
      <h1 className={`text-2xl sm:text-3xl font-bold ${panelTheme.textColor} drop-shadow-md`}>Media</h1>

      {/* Sponsor filter */}
      {sponsors.length > 0 && (
        <div
          className="flex items-center gap-3 justify-center p-4 rounded-xl"
          style={{ backgroundColor: useDarkText ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.1)' }}
        >
          <label className={`text-sm font-semibold ${panelTheme.textColor}`}>Sponsor:</label>
          <select
            className="px-3 py-2 text-sm border border-white/30 rounded-lg bg-white/60 text-gray-900 cursor-pointer transition-colors focus:outline-none"
            style={{ minWidth: '200px' }}
            value={selectedSponsorId || ''}
            onChange={(e) => handleSponsorChange(e.target.value)}
          >
            <option value="">All</option>
            {sponsors.map((sponsor) => (
              <option key={sponsor.id} value={sponsor.id}>
                {sponsor.sponsor.name} ({sponsor.media_count || 0})
              </option>
            ))}
          </select>
        </div>
      )}

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
              const videoId = getYouTubeVideoId(video.youtube_embed_url)
              if (!videoId) return null
              return (
                <button
                  key={index}
                  className="relative aspect-video rounded-xl overflow-hidden cursor-pointer border-0 p-0 bg-black transition-all duration-200 hover:scale-[1.02] hover:shadow-[0_8px_24px_rgba(0,0,0,0.15)]"
                  onClick={() => { setCurrentVideoIndex(index); setShowVideoLightbox(true) }}
                >
                  <img
                    src={getYouTubeThumbnail(videoId)}
                    alt={video.caption || 'Video thumbnail'}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 flex items-center justify-center pb-10 bg-gradient-to-b from-black/5 to-black/15 hover:from-black/10 hover:to-black/25 transition-all">
                    <svg className="w-12 h-12 text-white drop-shadow-lg" fill="currentColor" viewBox="0 0 24 24">
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
        {(() => {
          if (selectedSponsorId && loadingSponsor) return null
          if (displayAlbums.length === 0 && !selectedSponsorId) return null

          return (
            <div className="flex flex-wrap gap-2 mb-4">
              <button
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer transition-all duration-200 relative ${
                  !selectedAlbumId
                    ? 'border-transparent'
                    : `${useDarkText ? 'text-gray-600 border-gray-300 hover:border-gray-400 bg-white/40' : 'text-white/70 border-white/20 hover:border-white/40 bg-white/10'}`
                }`}
                style={!selectedAlbumId ? { backgroundColor: primaryColor, borderColor: primaryColor, color: isLightColor(primaryColor) ? '#000000' : '#ffffff' } : { borderWidth: '1.5px' }}
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
                      !selectedAlbumId
                        ? { backgroundColor: '#fff', color: primaryColor }
                        : { backgroundColor: useDarkText ? '#374151' : 'rgba(255,255,255,0.9)', color: useDarkText ? '#fff' : '#333' }
                    }
                  >
                    {displayTotalCount}
                  </span>
                )}
              </button>
              {displayAlbums.map((album) => (
                <button
                  key={album.id}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer transition-all duration-200 relative ${
                    selectedAlbumId === album.id
                      ? 'border-transparent'
                      : `${useDarkText ? 'text-gray-600 border-gray-300 hover:border-gray-400 bg-white/40' : 'text-white/70 border-white/20 hover:border-white/40 bg-white/10'}`
                  }`}
                  style={selectedAlbumId === album.id ? { backgroundColor: primaryColor, borderColor: primaryColor, color: isLightColor(primaryColor) ? '#000000' : '#ffffff' } : { borderWidth: '1.5px' }}
                  onClick={() => handleAlbumClick(album)}
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                  </svg>
                  {album.name}
                  {album.media_count !== undefined && album.media_count > 0 && (
                    <span
                      className="absolute -top-2 -right-2 rounded-full px-1.5 min-w-[18px] h-[18px] flex items-center justify-center text-[11px] font-semibold shadow"
                      style={
                        selectedAlbumId === album.id
                          ? { backgroundColor: '#fff', color: primaryColor }
                          : { backgroundColor: useDarkText ? '#374151' : 'rgba(255,255,255,0.9)', color: useDarkText ? '#fff' : '#333' }
                      }
                    >
                      {album.media_count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )
        })()}

        {/* Photo grid */}
        {loadingAlbum || loadingSponsor ? (
          <div className="flex flex-col items-center justify-center py-16 min-h-[300px]">
            <div
              className="loader mx-auto mb-4"
              style={{ '--primary-color': '#fff', '--secondary-color': primaryColor } as React.CSSProperties}
            />
            <p className={panelTheme.textMuted}>Loading {loadingAlbum ? 'album' : 'sponsor'} photos...</p>
          </div>
        ) : (
          <PhotoGrid photos={photos} onPhotoClick={handlePhotoClick} />
        )}

        {/* Loading more indicator */}
        {loadingMore && !selectedAlbumId && !selectedSponsorId && (
          <div className="flex flex-col items-center justify-center py-10">
            <div
              className="loader mx-auto mb-4"
              style={{ '--primary-color': '#fff', '--secondary-color': primaryColor } as React.CSSProperties}
            />
            <p className={panelTheme.textMuted}>Loading more photos...</p>
          </div>
        )}

        {/* Intersection observer target */}
        {!selectedAlbumId && !selectedSponsorId && hasMore && !loadingMore && (
          <div ref={observerRef} className="h-[100px] w-full mt-5" />
        )}

        {/* End message */}
        {!selectedAlbumId && !selectedSponsorId && !hasMore && mediaItems.length > 0 && (
          <div className="text-center py-10 mt-5">
            <p className={panelTheme.textMuted}>All photos loaded ({totalCount} total)</p>
          </div>
        )}
      </div>

      {/* ─── Photo Lightbox ───────────────────────────────── */}
      {showLightbox && galleryItems.length > 0 && (
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
              items={galleryItems}
              startIndex={currentIndex}
              showThumbnails={false}
              showPlayButton={false}
              showFullscreenButton={true}
              onSlide={(index) => setCurrentIndex(index)}
              additionalClass="custom-image-gallery"
            />

            {/* Caption */}
            {(() => {
              const currentMedia = selectedAlbumId
                ? albumMediaItems[currentIndex]
                : selectedSponsorId
                  ? sponsorMediaItems[currentIndex]
                  : mediaItems[currentIndex]
              return currentMedia?.caption ? (
                <div className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-black/70 backdrop-blur-[10px] px-6 py-4 rounded-lg max-w-[600px] z-[10001]">
                  <p className="text-white m-0 text-base text-center whitespace-pre-wrap">{currentMedia.caption}</p>
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
        const videoId = currentVideo ? getYouTubeVideoId(currentVideo.youtube_embed_url) : null
        if (!videoId) return null
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

              {/* YouTube embed */}
              <div className="w-[90vw] max-w-[1200px] aspect-video">
                <iframe
                  src={`https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`}
                  title={currentVideo.caption || 'Video'}
                  className="w-full h-full border-0 rounded-lg"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
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
