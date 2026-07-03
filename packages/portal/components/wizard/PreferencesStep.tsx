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
 * Wizard step for communication preferences — shows the same subscribable lists
 * as the Subscription Centre (public, non-internal, active lists) and writes the
 * user's choices to `list_subscriptions` immediately on toggle.
 *
 * Only rendered when the `lists` module is enabled.
 */
export function PreferencesStep({ brandConfig, userEmail }: Props) {
  const primaryColor = brandConfig.primaryColor
  const [items, setItems] = useState<ListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const sb = getSupabaseClient()
        const [listsRes, subsRes] = await Promise.all([
          // Internal/staff lists are never offered for self-service subscription.
          sb.from('lists')
            .select('id, name, description, default_subscribed')
            .eq('is_active', true)
            .eq('is_internal', false)
            .order('name'),
          userEmail
            ? sb.from('list_subscriptions').select('list_id, subscribed').eq('email', userEmail)
            : Promise.resolve({ data: [] as { list_id: string; subscribed: boolean }[], error: null }),
        ])
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
        const lists = ((listsRes.data as { id: string; name: string; description: string | null; default_subscribed: boolean | null }[]) || [])
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
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [userEmail])

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

  return (
    <div className="space-y-5">
      <p className="text-white/70 text-sm text-center mb-2">
        Choose how you&apos;d like to hear from us.
      </p>

      {loading ? (
        <p className="text-white/50 text-sm text-center py-4">Loading preferences…</p>
      ) : loadError ? (
        <p className="text-white/50 text-sm text-center py-4">
          We couldn&apos;t load the subscription options right now — you can set these any time from your profile.
        </p>
      ) : items.length === 0 ? (
        <p className="text-white/50 text-sm text-center py-4">No subscription options available right now.</p>
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
