'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getClientBrandConfig } from '@/config/brand'
import { ModuleSlot, hasPortalSlot } from '@/lib/modules/ModuleSlot'
import { isFresh, loadToken, saveToken, signInViaPopup, type EmbedToken } from './embedAuth'

/**
 * Hosts one embeddable widget: the portal slot `embed:<widget>` that a module
 * registers in its manifest `portalSlots`.
 *
 * The widget gets one prop, `embedAuth`:
 *   - client   — a Supabase client acting as the signed-in user (null when
 *                signed out). RLS applies exactly as on the portal.
 *   - user     — { id, email } once signed in.
 *   - loading  — true while the stored token is being checked.
 *   - signIn() — opens the LFID popup (call from a click). Resolves true on
 *                success.
 *   - signingIn / cancelSignIn() — for a "waiting for sign-in" state.
 *   - signOut()
 *   - notify(name) — tell the embedding page something happened
 *                ('signed-in', 'requested', …). Names only, never data.
 *
 * The embedding page receives `{ source: 'gatewaze-embed', type, … }`
 * messages: `resize` with the content height, and `event` with a name.
 * They carry no personal data, so they go to any parent ('*').
 */

export interface EmbedAuth {
  client: SupabaseClient | null
  user: { id: string; email: string | null } | null
  loading: boolean
  signingIn: boolean
  signIn: () => Promise<boolean>
  cancelSignIn: () => void
  signOut: () => void
  notify: (name: string) => void
}

function post(message: Record<string, unknown>) {
  try {
    if (window.parent && window.parent !== window) window.parent.postMessage({ source: 'gatewaze-embed', ...message }, '*')
  } catch { /* no parent */ }
}

export function EmbedHost({ widget, enabledModuleIds, enabledFeatures }: {
  widget: string
  enabledModuleIds: string[]
  enabledFeatures: string[]
}) {
  const [token, setToken] = useState<EmbedToken | null>(null)
  const [user, setUser] = useState<EmbedAuth['user']>(null)
  const [loading, setLoading] = useState(true)
  const [signingIn, setSigningIn] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const client = useMemo(() => {
    if (!token) return null
    const config = getClientBrandConfig()
    return createClient(config.supabaseUrl, config.supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token.access_token}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
  }, [token])

  // Check a token (stored or fresh from the popup) with Supabase Auth and
  // read who it belongs to. A bad or expired token signs the widget out.
  const adopt = useCallback(async (t: EmbedToken | null) => {
    if (!t || !isFresh(t)) { saveToken(null); setToken(null); setUser(null); return false }
    const config = getClientBrandConfig()
    const probe = createClient(config.supabaseUrl, config.supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data, error } = await probe.auth.getUser(t.access_token)
    if (error || !data?.user) { saveToken(null); setToken(null); setUser(null); return false }
    saveToken(t)
    setToken(t)
    setUser({ id: data.user.id, email: data.user.email ?? null })
    return true
  }, [])

  useEffect(() => {
    adopt(loadToken()).finally(() => setLoading(false))
  }, [adopt])

  // Sign out when the token runs out, so the widget never acts on a dead one.
  useEffect(() => {
    if (!token?.expires_at) return undefined
    const ms = (token.expires_at - 60) * 1000 - Date.now()
    const t = setTimeout(() => { saveToken(null); setToken(null); setUser(null) }, Math.max(0, ms))
    return () => clearTimeout(t)
  }, [token])

  // Report our height so the embedding page can size the iframe.
  useEffect(() => {
    const send = () => post({ type: 'resize', height: Math.ceil(document.documentElement.scrollHeight) })
    send()
    const ro = new ResizeObserver(send)
    ro.observe(document.body)
    return () => ro.disconnect()
  }, [])

  const signIn = useCallback(async () => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setSigningIn(true)
    try {
      const t = await signInViaPopup(ac.signal)
      const ok = t ? await adopt(t) : false
      if (ok) post({ type: 'event', name: 'signed-in' })
      return ok
    } finally {
      if (abortRef.current === ac) setSigningIn(false)
    }
  }, [adopt])

  const embedAuth: EmbedAuth = {
    client,
    user,
    loading,
    signingIn,
    signIn,
    cancelSignIn: () => { abortRef.current?.abort(); setSigningIn(false) },
    signOut: () => { saveToken(null); setToken(null); setUser(null) },
    notify: (name: string) => { if (/^[a-z0-9-]{1,40}$/.test(name)) post({ type: 'event', name }) },
  }

  const slotName = `embed:${widget}`
  let available = false
  try { available = hasPortalSlot(slotName, new Set(enabledModuleIds), new Set(enabledFeatures)) } catch { available = false }
  if (!available) {
    return <p className="pub-empty" style={{ padding: 16 }}>This widget isn’t available.</p>
  }

  return (
    <ModuleSlot
      name={slotName}
      enabledModuleIds={enabledModuleIds}
      enabledFeatures={enabledFeatures}
      props={{ embedAuth }}
    />
  )
}

export default EmbedHost
