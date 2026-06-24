'use client'

import { useState, useEffect, useCallback } from 'react'
import type { BrandConfig } from '@/config/brand'
import { useAuth } from '@/hooks/useAuth'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { PageHeader } from '@/components/ui/PageHeader'
import { getSupabaseClient } from '@/lib/supabase/client'

interface ListItem {
  list_id: string
  label: string
  description: string | null
  subscribed: boolean
}

// Shape returned by the newsletter-unsubscribe `preferences` action.
interface ItemSource {
  id: string
  name: string
  description: string | null
  subscribed: boolean
}

interface SubscriptionContentProps {
  brandConfig: BrandConfig
}

/**
 * Subscription Centre. Two entry modes:
 *  - **Token mode** (`?token=` from an email footer link): no login required.
 *    The HMAC-signed token identifies the recipient; we read + write their
 *    subscriptions through the `newsletter-unsubscribe` edge function (which
 *    verifies the token server-side and uses the service role).
 *  - **Auth mode** (signed-in portal user, no token): read + write directly as
 *    that user.
 * Both render the same per-list toggle UI.
 */
export function SubscriptionContent({ brandConfig: _brandConfig }: SubscriptionContentProps) {
  const { user } = useAuth()
  const supabase = getSupabaseClient()

  // undefined = not yet read from the URL; null = no token (auth mode);
  // string = token mode.
  const [token, setToken] = useState<string | null | undefined>(undefined)
  // `requestedUnsub` is set when the visible footer link arrived with
  // `?unsub=1`. We DON'T act on it automatically — instead we show a
  // confirmation panel ([[feedback_unsubscribe_confirmation_scanner_safe]]).
  // Corporate email scanners (Mimecast TTP, Defender ATP) execute JS when
  // they pre-fetch links, so an on-mount XHR mutates state without the
  // recipient ever opening the message. The confirmation step closes that
  // hole. The RFC 8058 `List-Unsubscribe` header path stays one-click (POST
  // straight to the edge function); mailbox providers send it, scanners
  // don't parse mail headers as actionable URLs.
  const [requestedUnsub, setRequestedUnsub] = useState(false)
  const [pendingListId, setPendingListId] = useState<string | null>(null)
  const [tokenEmail, setTokenEmail] = useState<string | null>(null)
  const [tokenError, setTokenError] = useState<string | null>(null)
  const [unsubscribedName, setUnsubscribedName] = useState<string | null>(null)

  const [items, setItems] = useState<ListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    setRequestedUnsub(params.get('unsub') === '1')
    setToken(params.get('token'))
  }, [])

  // Calls the edge function in read mode (never sets unsubscribe=true). Used
  // for both the plain preferences view AND the confirmation panel — we need
  // the lists loaded so we can show which list the recipient is about to
  // unsubscribe from. The actual unsubscribe is a separate confirm action.
  const loadViaToken = useCallback(async (t: string) => {
    setLoading(true)
    setTokenError(null)
    try {
      const { data, error } = await supabase.functions.invoke('newsletter-unsubscribe', {
        body: { token: t, action: 'preferences', unsubscribe: false },
      })
      if (error || !data?.success) {
        setTokenError('This link is invalid or has expired. Please use the link in a more recent email, or sign in to manage your preferences.')
        return
      }
      setTokenEmail(data.email)
      const lists: ItemSource[] = data.lists ?? []
      setItems(
        lists.map((l) => ({ list_id: l.id, label: l.name, description: l.description, subscribed: l.subscribed })),
      )
    } finally {
      setLoading(false)
    }
  }, [supabase])

  // After the user clicks "Confirm unsubscribe" on the confirmation panel,
  // POST through to flip the token's own list to subscribed=false. Mirrors
  // the prior auto-on-mount behaviour but gated on a human click.
  const confirmUnsubscribe = useCallback(async () => {
    if (!token) return
    setConfirming(true)
    try {
      const { data, error } = await supabase.functions.invoke('newsletter-unsubscribe', {
        body: { token, action: 'preferences', unsubscribe: true },
      })
      if (error || !data?.success) {
        setTokenError('We could not process the unsubscribe. Please try again or contact support.')
        return
      }
      const lists: ItemSource[] = data.lists ?? []
      setItems(
        lists.map((l) => ({ list_id: l.id, label: l.name, description: l.description, subscribed: l.subscribed })),
      )
      const unsubbed = lists.find((l) => l.id === (data.unsubscribedListId as string | null))
      setUnsubscribedName(unsubbed?.name ?? 'that list')
      setPendingListId(null)
      setRequestedUnsub(false)
    } finally {
      setConfirming(false)
    }
  }, [supabase, token])

  const loadViaAuth = useCallback(async () => {
    setLoading(true)
    try {
      interface ListRow { id: string; name: string; description: string | null; is_public: boolean; default_subscribed: boolean | null }
      interface SubRow { list_id: string; subscribed: boolean }
      const [listsRes, subsRes] = await Promise.all([
        // Internal/staff lists are never offered in the Subscription Centre.
        supabase.from('lists').select('id, name, description, is_public, default_subscribed').eq('is_active', true).eq('is_internal', false).order('name'),
        user?.email
          ? supabase.from('list_subscriptions').select('list_id, subscribed').eq('email', user.email)
          : Promise.resolve({ data: [] as SubRow[] }),
      ])
      const allLists = (listsRes.data ?? []) as ListRow[]
      const subData = (subsRes.data ?? []) as SubRow[]
      const subMap = new Map(subData.map((s) => [s.list_id, s.subscribed]))
      setItems(
        allLists
          .filter((l) => l.is_public || subMap.has(l.id))
          .map((l) => ({
            list_id: l.id,
            label: l.name,
            description: l.description,
            subscribed: subMap.has(l.id) ? !!subMap.get(l.id) : !!l.default_subscribed,
          })),
      )
    } catch (err) {
      console.error('Error loading subscriptions:', err)
    } finally {
      setLoading(false)
    }
  }, [supabase, user?.email])

  useEffect(() => {
    if (token === undefined) return // wait until URL is read
    if (token) {
      // Always load in read-only mode — even when `?unsub=1` is present.
      // Mutation is deferred to confirmUnsubscribe() on explicit click.
      loadViaToken(token)
      return
    }
    if (user?.email) loadViaAuth()
    else setLoading(false)
  }, [token, user?.email, loadViaToken, loadViaAuth])

  // Read which list the token was minted for. The token is HMAC-signed —
  // we can't FORGE one, but we can DECODE the payload to surface a
  // human-readable list name on the confirmation panel before the user
  // commits. Server-side verification still gates the mutation.
  useEffect(() => {
    if (!requestedUnsub || !token || pendingListId) return
    try {
      const [encoded] = token.split('.')
      const decoded = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'))
      const [, listId] = decoded.split(':')
      if (listId) setPendingListId(listId)
    } catch {
      // Malformed token — the confirmation panel falls back to a generic
      // label; the server still rejects the request when confirmed.
    }
  }, [requestedUnsub, token, pendingListId])

  const pendingListLabel = pendingListId
    ? items.find((i) => i.list_id === pendingListId)?.label ?? 'this list'
    : 'this list'

  async function handleToggle(listId: string, subscribed: boolean) {
    setSaving(listId)
    try {
      if (token) {
        const { data, error } = await supabase.functions.invoke('newsletter-unsubscribe', {
          body: { token, action: 'set', list_id: listId, subscribed },
        })
        if (error || !data?.success) return
      } else if (user?.email) {
        const now = new Date().toISOString()
        const { error } = await supabase.from('list_subscriptions').upsert({
          list_id: listId,
          email: user.email,
          subscribed,
          subscribed_at: subscribed ? now : null,
          unsubscribed_at: subscribed ? null : now,
          source: 'portal',
          updated_at: now,
        }, { onConflict: 'list_id,email' })
        if (error) throw error
      } else {
        return
      }
      setItems((prev) => prev.map((i) => (i.list_id === listId ? { ...i, subscribed } : i)))
    } catch (err) {
      console.error('Error updating subscription:', err)
    } finally {
      setSaving(null)
    }
  }

  // Token link that failed validation.
  if (token && tokenError) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <PageHeader title="Email Preferences" subtitle="" />
        <GlassPanel padding="p-8">
          <p className="text-center text-white/70">{tokenError}</p>
        </GlassPanel>
      </div>
    )
  }

  // Auth mode with no signed-in user and no token.
  if (token === null && !user) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <PageHeader title="Email Preferences" subtitle="Sign in to manage your email subscriptions" />
      </div>
    )
  }

  const subtitle = token
    ? (tokenEmail ? `Managing subscriptions for ${tokenEmail}` : 'Manage your email subscriptions')
    : "Choose which emails you'd like to receive"

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <PageHeader title="Email Preferences" subtitle={subtitle} />

      {requestedUnsub && !unsubscribedName && !loading && (
        <GlassPanel padding="p-6" className="mt-6 border border-yellow-500/30">
          <p className="text-white/90 text-center text-base">
            You&apos;re about to unsubscribe from{' '}
            <span className="font-medium text-white">{pendingListLabel}</span>.
          </p>
          <p className="text-white/60 text-center text-sm mt-2">
            This extra step protects you from accidental unsubscribes triggered by corporate email scanners.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 mt-5 justify-center">
            <button
              onClick={confirmUnsubscribe}
              disabled={confirming}
              className="px-5 py-2.5 rounded-md bg-red-600 hover:bg-red-500 text-white font-medium transition disabled:opacity-50"
            >
              {confirming ? 'Unsubscribing…' : 'Confirm unsubscribe'}
            </button>
            <button
              onClick={() => { setRequestedUnsub(false); setPendingListId(null) }}
              disabled={confirming}
              className="px-5 py-2.5 rounded-md bg-white/10 hover:bg-white/20 text-white font-medium transition disabled:opacity-50"
            >
              Keep me subscribed
            </button>
          </div>
        </GlassPanel>
      )}

      {unsubscribedName && (
        <GlassPanel padding="p-4" className="mt-6 border border-green-500/30">
          <p className="text-sm text-white/80 text-center">
            You&apos;ve been unsubscribed from <span className="font-medium text-white">{unsubscribedName}</span>.
            You can re-subscribe or adjust any of your other subscriptions below.
          </p>
        </GlassPanel>
      )}

      <div className="mt-8 space-y-4">
        {loading ? (
          <GlassPanel padding="p-8">
            <div className="flex items-center justify-center">
              <div className="animate-spin w-6 h-6 border-2 border-white/30 border-t-white rounded-full" />
              <span className="ml-3 text-white/60">Loading preferences...</span>
            </div>
          </GlassPanel>
        ) : items.length === 0 ? (
          <GlassPanel padding="p-8">
            <p className="text-center text-white/60">No email topics are available at this time.</p>
          </GlassPanel>
        ) : (
          items.map((topic) => {
            const isSaving = saving === topic.list_id
            return (
              <GlassPanel key={topic.list_id} padding="p-5">
                <div className="flex items-center justify-between">
                  <div className="flex-1 mr-4">
                    <h3 className="text-white font-medium">{topic.label}</h3>
                    {topic.description && <p className="text-sm text-white/60 mt-1">{topic.description}</p>}
                  </div>
                  <button
                    onClick={() => handleToggle(topic.list_id, !topic.subscribed)}
                    disabled={isSaving}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-white/20 focus:ring-offset-2 focus:ring-offset-transparent ${
                      topic.subscribed ? 'bg-green-500' : 'bg-white/20'
                    } ${isSaving ? 'opacity-50' : ''}`}
                    role="switch"
                    aria-checked={topic.subscribed}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        topic.subscribed ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </GlassPanel>
            )
          })
        )}

        <GlassPanel padding="p-5">
          <p className="text-xs text-white/40 text-center">
            {token
              ? (tokenEmail ? `These are the subscriptions for ${tokenEmail}.` : 'Manage your subscriptions below.')
              : user
                ? `Subscribed as ${user.email}. You can also unsubscribe via the link at the bottom of any email.`
                : ''}
          </p>
        </GlassPanel>
      </div>
    </div>
  )
}
