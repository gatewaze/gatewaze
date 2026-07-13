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
      className="gw-vp-poster"
      role="button"
      tabIndex={0}
      aria-label={`Play: ${title}`}
      onClick={() => { beaconPlay(youtubeId, title); setPlaying(true) }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); beaconPlay(youtubeId, title); setPlaying(true) } }}
    >
      <style>{POSTER_CSS}</style>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="gw-vp-img" src={thumb} alt="" />
      <span className="gw-vp-scrim" aria-hidden="true" />
      <span className="gw-vp-btn">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
      </span>
    </div>
  )
}

const POSTER_CSS = `
.gw-vp-poster {
  position: relative; aspect-ratio: 16 / 9; border-radius: inherit;
  overflow: hidden; background: #000; cursor: pointer;
}
.gw-vp-img {
  position: absolute; inset: 0; width: 100%; height: 100%;
  object-fit: cover; opacity: .92; transition: transform .5s ease, opacity .3s ease;
}
.gw-vp-scrim {
  position: absolute; inset: 0;
  background: radial-gradient(120% 90% at 50% 60%, transparent 40%, rgba(0,0,0,.35) 100%);
  transition: background .3s ease;
}
.gw-vp-btn {
  position: absolute; inset: 0; margin: auto; width: 84px; height: 58px;
  border-radius: 16px; background: var(--accent, #a78bfa); color: #111;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 8px 28px rgba(0,0,0,.45); padding-left: 3px;
  transition: transform .2s ease, box-shadow .2s ease;
}
.gw-vp-poster:hover .gw-vp-img { transform: scale(1.04); opacity: 1; }
.gw-vp-poster:hover .gw-vp-btn { transform: scale(1.08); box-shadow: 0 12px 36px rgba(0,0,0,.55); }
.gw-vp-poster:focus-visible { outline: 3px solid var(--accent, #a78bfa); outline-offset: 3px; }
`

export default VideoPlayer
