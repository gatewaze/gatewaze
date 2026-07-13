import { cache } from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getServerBrand, getBrandConfigById } from '@/config/brand'
import { createServerSupabase } from '@/lib/supabase/server'
import { VideoPlayer } from '@/components/video/VideoPlayer'
import { RelatedInline } from '@/components/RelatedInline'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const YT_ID_RE = /^[A-Za-z0-9_-]{6,20}$/

interface VideoRow {
  id: string
  provider_video_id: string
  url: string
  title: string
  description: string | null
  thumbnail_url: string | null
  published_at: string | null
  channel_title: string | null
  speakers: unknown
}

// Cached per-request so generateMetadata + the page share one query. Accepts
// either the canonical uuid (how related cards link) or the YouTube id (nicer
// shareable URL). Only published/public videos resolve — anon RLS enforces the
// same, this keeps the 404 honest for drafts.
const getVideo = cache(async (idParam: string): Promise<VideoRow | null> => {
  const brand = await getServerBrand()
  const supabase = await createServerSupabase(brand)
  const col = 'id, provider_video_id, url, title, description, thumbnail_url, published_at, channel_title, speakers'
  const q = supabase.from('videos').select(col).eq('status', 'published').eq('visibility', 'public')
  const { data } = UUID_RE.test(idParam)
    ? await q.eq('id', idParam).maybeSingle()
    : YT_ID_RE.test(idParam)
      ? await q.eq('provider_video_id', idParam).maybeSingle()
      : { data: null }
  return (data as VideoRow | null) ?? null
})

function speakerNames(speakers: unknown): string[] {
  if (!Array.isArray(speakers)) return []
  return speakers
    .map((s) => (s && typeof s === 'object' ? (s as Record<string, unknown>).name : null))
    .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const video = await getVideo(id)
  if (!video) return { title: 'Video' }
  const brand = await getServerBrand()
  const brandConfig = await getBrandConfigById(brand)
  const desc = (video.description ?? '').slice(0, 200) || `Watch on ${brandConfig.name}`
  const image = video.thumbnail_url ?? `https://i.ytimg.com/vi/${video.provider_video_id}/hqdefault.jpg`
  return {
    title: `${video.title} — ${brandConfig.name}`,
    description: desc,
    openGraph: { title: video.title, description: desc, type: 'video.other', siteName: brandConfig.name, images: [image] },
    twitter: { card: 'summary_large_image', title: video.title, description: desc, images: [image] },
  }
}

export default async function VideoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const video = await getVideo(id)
  if (!video) notFound()

  const names = speakerNames(video.speakers)
  const when = video.published_at
    ? new Date(video.published_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : ''
  const metaLine = [video.channel_title, when].filter(Boolean).join(' · ')

  return (
    <main style={{ maxWidth: 880, margin: '0 auto', padding: '32px 20px 64px' }}>
      <VideoPlayer
        youtubeId={video.provider_video_id}
        title={video.title}
        poster={video.thumbnail_url ?? undefined}
      />

      <h1 style={{ margin: '20px 0 6px', fontSize: 26, lineHeight: 1.25, fontWeight: 700, color: 'var(--ink)' }}>
        {video.title}
      </h1>

      {metaLine && (
        <p style={{ margin: '0 0 4px', fontSize: 13.5, color: 'var(--ink-3)' }}>{metaLine}</p>
      )}
      {names.length > 0 && (
        <p style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--ink-2, var(--ink-3))' }}>{names.join(', ')}</p>
      )}

      {video.description && (
        <p style={{ margin: '16px 0', fontSize: 15, lineHeight: 1.6, color: 'var(--ink-2, var(--ink-3))', whiteSpace: 'pre-wrap' }}>
          {video.description}
        </p>
      )}

      <p style={{ marginTop: 20 }}>
        <a href={video.url} target="_blank" rel="noopener noreferrer"
           style={{ fontSize: 13.5, color: 'var(--accent, #a78bfa)', textDecoration: 'none' }}>
          Watch on YouTube ↗
        </a>
      </p>

      <RelatedInline sourceType="video" sourceId={video.id} surface="video-page" />
    </main>
  )
}
