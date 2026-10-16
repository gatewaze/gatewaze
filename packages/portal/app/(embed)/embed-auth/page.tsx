'use client'

import { useEffect, useState } from 'react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { signInHref } from '@/lib/signInHref'

/**
 * The embed sign-in popup. Opened by an embedded widget
 * (components/embed/embedAuth.ts) as `/embed-auth?ch=<challenge>`.
 *
 * First-party, so it sees the normal portal session. Without one it sends
 * the visitor through the usual sign-in (LFID) and comes back here. With one
 * it deposits its access token for the widget to collect under `ch`, then
 * closes. The challenge is a hash; only the widget holds the secret that
 * claims the token.
 *
 * Who may ask: only one of our own /embed/ pages. Otherwise any site could
 * open this URL with a challenge it made and, for a visitor already signed
 * in here, collect their token. The check reads `window.opener.location`,
 * which the browser allows only when the opener is same-origin — i.e. our
 * embed iframe; any other opener throws. The approval is written to this
 * origin's localStorage before any redirect, because once the popup has
 * visited the identity provider the browser may sever `window.opener`. Other
 * sites cannot write that storage.
 */

const CHALLENGE_RE = /^[0-9a-f]{64}$/
const APPROVAL_KEY = (ch: string) => `gatewaze.embed.approved.${ch}`
const APPROVAL_TTL_MS = 15 * 60 * 1000

function openerIsOurEmbed(): boolean {
  try {
    const o = window.opener
    if (!o || o === window) return false
    // Throws for a cross-origin opener.
    return o.location.origin === window.location.origin && o.location.pathname.startsWith('/embed/')
  } catch {
    return false
  }
}

function approve(ch: string) {
  try { window.localStorage.setItem(APPROVAL_KEY(ch), String(Date.now())) } catch { /* storage blocked */ }
}

function isApproved(ch: string): boolean {
  try {
    const at = Number(window.localStorage.getItem(APPROVAL_KEY(ch)))
    return Number.isFinite(at) && at > 0 && Date.now() - at < APPROVAL_TTL_MS
  } catch {
    return false
  }
}

function forget(ch: string) {
  try { window.localStorage.removeItem(APPROVAL_KEY(ch)) } catch { /* ignore */ }
}

export default function EmbedAuthPage() {
  const [state, setState] = useState<'working' | 'done' | 'bad-link' | 'not-from-widget' | 'error'>('working')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const ch = new URLSearchParams(window.location.search).get('ch') || ''
      if (!CHALLENGE_RE.test(ch)) { setState('bad-link'); return }

      if (!isApproved(ch)) {
        if (!openerIsOurEmbed()) { setState('not-from-widget'); return }
        approve(ch)
      }

      try {
        const { data } = await getSupabaseClient().auth.getSession()
        const session = data?.session
        if (!session) {
          window.location.replace(signInHref(`/embed-auth?ch=${ch}`))
          return
        }
        const res = await fetch('/api/public/embed-handoff/deposit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ challenge: ch }),
        })
        // 409: this link was already used — the widget has its token.
        if (!res.ok && res.status !== 409) throw new Error(String(res.status))
        forget(ch)
        if (cancelled) return
        setState('done')
        setTimeout(() => { try { window.close() } catch { /* not script-opened */ } }, 800)
      } catch {
        if (!cancelled) setState('error')
      }
    })()
    return () => { cancelled = true }
  }, [])

  const text = {
    working: 'Signing you in…',
    done: 'You’re signed in. You can close this window.',
    'bad-link': 'This sign-in link isn’t valid. Close this window and try again.',
    'not-from-widget': 'This sign-in window has to be opened from the widget. Close it and use the widget’s sign-in button.',
    error: 'Something went wrong signing you in. Close this window and try again.',
  }[state]

  return (
    <div className="gw-embed-root gw-embed-popup" data-theme="light">
      <main style={{ maxWidth: 420, margin: '0 auto', padding: '80px 24px 0', textAlign: 'center' }}>
        <p style={{ fontSize: 16, lineHeight: 1.6 }}>{text}</p>
      </main>
    </div>
  )
}
