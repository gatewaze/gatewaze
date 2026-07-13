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
const TOPIC_RE = /^[a-z0-9][a-z0-9-]{0,60}$/

interface VideoRow {
  id: string
  provider_video_id: string
  url: string
  title: string
  description: string | null
  thumbnail_url: string | null
  published_at: string | null
  duration_seconds: number | null
  channel_title: string | null
  speakers: unknown
  topics: unknown
}

// Cached per-request so generateMetadata + the page share one query. Accepts
// either the canonical uuid (how related cards link) or the YouTube id (nicer
// shareable URL). Only published/public videos resolve — anon RLS enforces the
// same, this keeps the 404 honest for drafts.
const getVideo = cache(async (idParam: string): Promise<VideoRow | null> => {
  const brand = await getServerBrand()
  const supabase = await createServerSupabase(brand)
  const col = 'id, provider_video_id, url, title, description, thumbnail_url, published_at, duration_seconds, channel_title, speakers, topics'
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

function topicTags(topics: unknown): string[] {
  if (!Array.isArray(topics)) return []
  return [...new Set(topics.filter((t): t is string => typeof t === 'string' && TOPIC_RE.test(t)))].slice(0, 8)
}

function humanTopic(slug: string): string {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatDuration(secs: number | null): string | null {
  if (!secs || secs <= 0) return null
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
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
  const tags = topicTags(video.topics)
  const when = video.published_at
    ? new Date(video.published_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : ''
  const duration = formatDuration(video.duration_seconds)
  const eyebrow: Array<{ text: string; clock?: boolean }> = [
    ...(video.channel_title ? [{ text: video.channel_title }] : []),
    ...(when ? [{ text: when }] : []),
    ...(duration ? [{ text: duration, clock: true }] : []),
  ]

  return (
    <main className="gw-video">
      <style>{VIDEO_CSS}</style>

      <div className="gw-video-stage">
        <VideoPlayer
          youtubeId={video.provider_video_id}
          title={video.title}
          poster={video.thumbnail_url ?? undefined}
        />
      </div>

      <article className="gw-video-body">
        {eyebrow.length > 0 && (
          <div className="gw-video-eyebrow">
            {eyebrow.map((part) => (
              <span key={part.text} className="gw-video-eyebrow-part">
                {part.clock && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ marginRight: 4, verticalAlign: '-1px' }}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" strokeLinecap="round" /></svg>
                )}
                {part.text}
              </span>
            ))}
          </div>
        )}

        <h1 className="gw-video-title">{video.title}</h1>

        {names.length > 0 && (
          <div className="gw-video-speakers">
            {names.map((n) => (
              <span key={n} className="gw-video-chip">{n}</span>
            ))}
          </div>
        )}

        {video.description && (
          <p className="gw-video-desc">{video.description}</p>
        )}

        {tags.length > 0 && (
          <div className="gw-video-topics">
            {tags.map((t) => (
              <span key={t} className="gw-video-tag">{humanTopic(t)}</span>
            ))}
          </div>
        )}
      </article>

      <RelatedInline sourceType="video" sourceId={video.id} surface="video-page" />
    </main>
  )
}

const VIDEO_CSS = `
.gw-video { max-width: 940px; margin: 0 auto; padding: 28px 20px 72px; }
.gw-video-stage {
  border-radius: 16px; overflow: hidden;
  box-shadow: 0 18px 50px -18px rgba(0,0,0,.55), 0 0 0 1px var(--line);
  background: #000;
}
.gw-video-body {
  margin-top: 26px; padding: 24px 26px;
  background: var(--paper, rgba(var(--ui-text), 0.03));
  border: 1px solid var(--line);
  border-radius: 16px;
}
.gw-video-eyebrow {
  display: flex; flex-wrap: wrap; align-items: center; gap: 10px;
  font-size: 12px; font-weight: 600; letter-spacing: .03em;
  color: var(--ink-3); text-transform: uppercase; margin-bottom: 12px;
}
.gw-video-eyebrow-part { display: inline-flex; align-items: center; }
.gw-video-eyebrow-part:not(:last-child)::after {
  content: ""; width: 3px; height: 3px; border-radius: 50%;
  background: var(--ink-3); opacity: .6; margin-left: 10px;
}
.gw-video-title {
  margin: 0 0 16px; font-size: clamp(22px, 3.4vw, 30px);
  line-height: 1.22; font-weight: 800; color: var(--ink); letter-spacing: -0.01em;
}
.gw-video-speakers { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 18px; }
.gw-video-chip {
  display: inline-flex; align-items: center; padding: 5px 12px;
  font-size: 13px; font-weight: 600; color: var(--ink);
  background: rgba(var(--ui-text), 0.06); border: 1px solid var(--line);
  border-radius: 999px;
}
.gw-video-desc {
  margin: 0; font-size: 15.5px; line-height: 1.65;
  color: var(--ink-2, var(--ink-3)); white-space: pre-wrap;
}
.gw-video-topics { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 20px; }
.gw-video-tag {
  font-size: 12px; font-weight: 600; color: var(--accent, #a78bfa);
  background: color-mix(in srgb, var(--accent, #a78bfa) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent, #a78bfa) 30%, transparent);
  padding: 4px 10px; border-radius: 8px; letter-spacing: .01em;
}
@media (max-width: 560px) {
  .gw-video-body { padding: 20px 18px; border-radius: 14px; }
  .gw-video-stage { border-radius: 12px; }
}
`
