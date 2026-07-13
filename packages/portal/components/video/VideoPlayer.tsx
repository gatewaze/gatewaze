'use client'

// Lightweight YouTube facade for the in-portal video page: shows the poster
// until the visitor clicks, then swaps in a privacy-mode (youtube-nocookie)
// iframe. Mirrors the resources talk-card facade — including the `video_play`
// beacon to /api/t so Signals attributes a play back to a gw_sig-tagged visit.

import { useState } from 'react'

interface Props {
  youtubeId: string
  title: string
  poster?: string
}

function beaconPlay(youtubeId: string, title: string): void {
  try {
    navigator.sendBeacon('/api/t', new Blob([JSON.stringify({
      type: 'track',
      event: 'video_play',
      properties: { video_id: youtubeId, talk: title },
      client: { url: location.href, path: location.pathname + location.search, title: document.title },
    })], { type: 'application/json' }))
  } catch { /* tracking must never break playback */ }
}

export function VideoPlayer({ youtubeId, title, poster }: Props) {
  const [playing, setPlaying] = useState(false)
  const thumb = poster || `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`

  if (playing) {
    return (
      <div style={{ position: 'relative', aspectRatio: '16 / 9', borderRadius: 12, overflow: 'hidden', background: '#000' }}>
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&rel=0`}
          title={title}
          allow="autoplay; fullscreen; encrypted-media; picture-in-picture; accelerometer; gyroscope; clipboard-write"
          allowFullScreen
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
        />
      </div>
    )
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Play: ${title}`}
      onClick={() => { beaconPlay(youtubeId, title); setPlaying(true) }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); beaconPlay(youtubeId, title); setPlaying(true) } }}
      style={{ position: 'relative', aspectRatio: '16 / 9', borderRadius: 12, overflow: 'hidden', background: '#000', cursor: 'pointer' }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={thumb} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.9 }} />
      <span style={{ position: 'absolute', inset: 0, margin: 'auto', width: 72, height: 50, borderRadius: 14, background: 'var(--accent, #a78bfa)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#111' }}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
      </span>
    </div>
  )
}

export default VideoPlayer
