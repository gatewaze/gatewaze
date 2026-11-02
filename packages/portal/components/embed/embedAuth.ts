'use client'

/**
 * Sign-in for portal embeds.
 *
 * A widget in an iframe on another site cannot see the portal's session:
 * browsers partition third-party storage and cookies. So it signs in through
 * a first-party popup (`/embed-auth`), which hands back an access token via
 * the API's one-time handoff (packages/api/src/routes/embed-handoff.ts):
 *
 *   1. Here: make a random secret; open the popup with sha256(secret).
 *   2. Popup: LFID sign-in if needed, then deposit its access token under
 *      that challenge.
 *   3. Here: poll /claim with the secret until the token arrives.
 *
 * The token is kept in the iframe's own (partitioned) localStorage until it
 * expires, then the popup runs again — instantly, while the portal session
 * lives. Only the access token ever crosses; never the refresh token.
 */

const STORAGE_KEY = 'gatewaze.embed.token.v1'
const POLL_MS = 1500
const POLL_LIMIT_MS = 5 * 60 * 1000
// Treat a token this close to expiry as already gone.
const EXPIRY_MARGIN_S = 60

export interface EmbedToken {
  access_token: string
  expires_at: number | null
}

function b64url(bytes: Uint8Array): string {
  let s = ''
  bytes.forEach((b) => { s += String.fromCharCode(b) })
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function isFresh(token: EmbedToken | null, nowS = Date.now() / 1000): boolean {
  if (!token || !token.access_token) return false
  return token.expires_at == null || token.expires_at - EXPIRY_MARGIN_S > nowS
}

export function loadToken(): EmbedToken | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const t = JSON.parse(raw)
    return isFresh(t) ? t : null
  } catch {
    return null
  }
}

export function saveToken(token: EmbedToken | null): void {
  try {
    if (token) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(token))
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch { /* storage blocked: the token lives in memory for this page */ }
}

/**
 * Open the sign-in popup and wait for its token. Must be called from a click
 * handler, or the browser blocks the popup.
 *
 * Polls until the token arrives, the signal aborts (the widget's Cancel), or
 * five minutes pass. It deliberately does not stop when `popup.closed` turns
 * true: once the popup visits an identity provider that sets
 * Cross-Origin-Opener-Policy, the browser reports it as closed while the user
 * is still signing in.
 *
 * @returns the token, or null if cancelled or timed out.
 */
export async function signInViaPopup(signal?: AbortSignal): Promise<EmbedToken | null> {
  const secret = b64url(crypto.getRandomValues(new Uint8Array(32)))
  // Open synchronously within the click, before any await.
  const popup = window.open('about:blank', 'gatewaze-embed-signin', 'popup,width=520,height=720')
  const challenge = await sha256Hex(secret)
  const url = `${window.location.origin}/embed-auth?ch=${challenge}`
  if (popup) popup.location.href = url
  else window.open(url, 'gatewaze-embed-signin', 'popup,width=520,height=720')

  const started = Date.now()
  while (Date.now() - started < POLL_LIMIT_MS) {
    if (signal?.aborted) return null
    await new Promise((r) => setTimeout(r, POLL_MS))
    try {
      const res = await fetch('/api/public/embed-handoff/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret }),
        cache: 'no-store',
      })
      if (res.ok) {
        const token = (await res.json()) as EmbedToken
        try { popup?.close() } catch { /* cross-origin or already closed */ }
        return token
      }
    } catch { /* network blip: keep polling */ }
  }
  return null
}
