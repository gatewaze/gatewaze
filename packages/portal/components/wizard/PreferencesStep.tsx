'use client'

import { useEffect, useState } from 'react'
import type { BrandConfig } from '@/config/brand'
import { isLightColor } from '@/config/brand'
import { getSupabaseClient } from '@/lib/supabase/client'

interface Props {
  brandConfig: BrandConfig
  /** Email of the signed-in user whose subscriptions we read/write. */
  userEmail: string
}

interface ListItem {
  id: string
  name: string
  description: string | null
  subscribed: boolean
}

/**
 * When the instance configures `event_consent_text` (platform settings →
 * brandConfig.eventConsentText), event emails are not a preference:
 * participating in an event is itself the authorization to be emailed about
 * future events. The event-updates list is then not offered as a checkbox
 * here — the configured notice is shown as fixed text instead. The notice
 * renders from the server-supplied brand config alone, never gated on the
 * client-side lists fetch, so a failed fetch can suppress the checkboxes
 * but never the disclosure. Unsubscribing later remains possible from the
 * Subscription Centre and email footer links; instances that set the
 * consent text should keep event-updates public so that surface stays
 * reachable. With no text configured, the list stays an ordinary checkbox.
 * Slug must match the luma module's auto-subscribe
 * (gatewaze-modules: modules/luma/functions/_shared/lumaRegistration.ts).
 */
const EVENT_UPDATES_SLUG = 'event-updates'

/**
 * Wizard step for communication preferences — shows the same subscribable lists
 * as the Subscription Centre (public, non-internal, active lists) and writes the
 * user's choices to `list_subscriptions` immediately on toggle.
 *
 * Only rendered when the `lists` module is enabled.
 */
export function PreferencesStep({ brandConfig, userEmail }: Props) {
  const primaryColor = brandConfig.primaryColor
  const eventConsentText = brandConfig.eventConsentText.trim()
  const [items, setItems] = useState<ListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // Cap the load at 8s. Supabase PostgREST cold-path latency on the `lists`
    // table has been observed at 10-12s from inside the cluster (measured
    // 2026-07-06). Without this cap the wizard sat on "Loading preferences…"
    // indefinitely and the user couldn't finish onboarding. Falling through
    // to the graceful loadError state lets them click Complete and set
    // preferences later from their profile.
    const LOAD_TIMEOUT_MS = 8000
    async function load() {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS)
      try {
        const sb = getSupabaseClient()
        // Internal/staff lists are never offered for self-service subscription.
        const listsPromise = sb.from('lists')
          .select('id, slug, name, description, default_subscribed')
          .eq('is_active', true)
          .eq('is_internal', false)
          .order('name')
          .abortSignal(controller.signal)
        const subsPromise = userEmail
          ? sb.from('list_subscriptions')
              .select('list_id, subscribed')
              .eq('email', userEmail)
              .abortSignal(controller.signal)
          : Promise.resolve({ data: [] as { list_id: string; subscribed: boolean }[], error: null })
        const [listsRes, subsRes] = await Promise.all([listsPromise, subsPromise])
        if (cancelled) return
        // A failed read is NOT "no options configured" — during a backend
        // outage this used to render the misleading empty-state message.
        if (listsRes.error) {
          console.error('Failed to load subscription lists:', listsRes.error)
          setLoadError(true)
          return
        }
        const subMap = new Map<string, boolean>(
          (((subsRes as { data: { list_id: string; subscribed: boolean }[] | null }).data) || []).map(s => [s.list_id, s.subscribed]),
        )
        const allLists = (listsRes.data as { id: string; slug: string | null; name: string; description: string | null; default_subscribed: boolean | null }[]) || []
        const lists = allLists
          .filter(l => !eventConsentText || l.slug !== EVENT_UPDATES_SLUG)
          .map(l => ({
            id: l.id,
            name: l.name,
            description: l.description,
            subscribed: subMap.has(l.id) ? !!subMap.get(l.id) : !!l.default_subscribed,
          }))
        setItems(lists)
        setLoadError(false)
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load subscription lists:', err)
          setLoadError(true)
        }
      } finally {
        clearTimeout(timeout)
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [userEmail, eventConsentText])

  async function toggle(id: string, subscribed: boolean) {
    if (!userEmail) return
    setSavingId(id)
    setItems(prev => prev.map(it => (it.id === id ? { ...it, subscribed } : it)))
    try {
      const sb = getSupabaseClient()
      const now = new Date().toISOString()
      const { error } = await sb.from('list_subscriptions').upsert({
        list_id: id,
        email: userEmail,
        subscribed,
        subscribed_at: subscribed ? now : null,
        unsubscribed_at: subscribed ? null : now,
        source: 'portal',
        updated_at: now,
      }, { onConflict: 'list_id,email' })
      if (error) throw error
    } catch (err) {
      // Revert the optimistic flip so the checkbox never lies about what was saved.
      console.error('Failed to save subscription preference:', err)
      setItems(prev => prev.map(it => (it.id === id ? { ...it, subscribed: !subscribed } : it)))
    } finally {
      setSavingId(null)
    }
  }

  // With the notice showing and no other lists to offer, there is no choice
  // to make — don't render a header that promises one.
  const settledEmptyWithNotice = !loading && !loadError && !!eventConsentText && items.length === 0

  return (
    <div className="space-y-5">
      {!settledEmptyWithNotice && (
        <p className="text-white/70 text-sm text-center mb-2">
          Choose how you&apos;d like to hear from us.
        </p>
      )}

      {eventConsentText && (
        <p className="text-white/70 text-xs rounded-md p-3 bg-white/5 border border-white/10">
          {eventConsentText}
        </p>
      )}

      {loading ? (
        <p className="text-white/50 text-sm text-center py-4">Loading preferences…</p>
      ) : loadError ? (
        <p className="text-white/50 text-sm text-center py-4">
          We couldn&apos;t load the subscription options right now — you can set these any time from your profile.
        </p>
      ) : items.length === 0 ? (
        // With the consent notice showing, an otherwise-empty list is a normal
        // state (event emails are covered by the notice), not a problem to report.
        eventConsentText ? null : (
          <p className="text-white/50 text-sm text-center py-4">No subscription options available right now.</p>
        )
      ) : (
        <div className="space-y-3">
          {items.map(item => (
            <label key={item.id} className="flex items-start gap-3 cursor-pointer group">
              <div className="relative flex-shrink-0 mt-0.5">
                <input
                  type="checkbox"
                  checked={item.subscribed}
                  disabled={savingId === item.id}
                  onChange={(e) => toggle(item.id, e.target.checked)}
                  className="sr-only peer"
                />
                <div
                  className="w-5 h-5 rounded border-2 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-transparent"
                  style={{
                    borderColor: item.subscribed ? primaryColor : 'rgba(255,255,255,0.4)',
                    backgroundColor: item.subscribed ? primaryColor : 'transparent',
                  }}
                >
                  {item.subscribed && (
                    <svg className="w-full h-full" viewBox="0 0 20 20" fill="currentColor" style={{ color: isLightColor(primaryColor) ? '#000000' : '#ffffff' }}>
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
              </div>
              <div>
                <span className="text-white text-sm font-medium">{item.name}</span>
                {item.description && (
                  <p className="text-white/50 text-xs mt-1">{item.description}</p>
                )}
              </div>
            </label>
          ))}
        </div>
      )}

      <p className="text-white/40 text-xs text-center">
        You can change these at any time in your profile settings.
      </p>
    </div>
  )
}
