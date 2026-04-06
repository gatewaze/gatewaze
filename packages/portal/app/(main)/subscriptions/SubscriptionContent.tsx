'use client'

import { useState, useEffect } from 'react'
import type { BrandConfig } from '@/config/brand'
import { useAuth } from '@/hooks/useAuth'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { PageHeader } from '@/components/ui/PageHeader'
import { PortalButton } from '@/components/ui/PortalButton'
import { getSupabaseClient } from '@/lib/supabase/client'

interface TopicLabel {
  id: string
  list_id: string
  label: string
  description: string | null
  default_subscribed: boolean
}

interface Subscription {
  list_id: string
  subscribed: boolean
}

interface SubscriptionContentProps {
  brandConfig: BrandConfig
}

export function SubscriptionContent({ brandConfig }: SubscriptionContentProps) {
  const { user } = useAuth()
  const supabase = getSupabaseClient()

  const [topics, setTopics] = useState<TopicLabel[]>([])
  const [subscriptions, setSubscriptions] = useState<Map<string, boolean>>(new Map())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    if (user?.email) {
      loadData()
    }
  }, [user?.email])

  async function loadData() {
    try {
      // Load active public lists from the lists module
      const { data: listsData } = await supabase
        .from('lists')
        .select('id, slug, name, description, default_subscribed')
        .eq('is_active', true)
        .eq('is_public', true)
        .order('name')

      const mappedTopics = (listsData || []).map((l: any) => ({
        id: l.id,
        list_id: l.id,
        label: l.name,
        description: l.description,
        default_subscribed: l.default_subscribed ?? false,
      }))
      setTopics(mappedTopics)

      // Load user's subscriptions
      if (user?.email) {
        const { data: subData } = await supabase
          .from('list_subscriptions')
          .select('list_id, subscribed')
          .eq('email', user.email)

        const subMap = new Map<string, boolean>()
        for (const sub of subData || []) {
          subMap.set(sub.list_id, sub.subscribed)
        }

        // Apply defaults for lists without explicit subscriptions
        for (const topic of mappedTopics) {
          if (!subMap.has(topic.list_id)) {
            subMap.set(topic.list_id, topic.default_subscribed)
          }
        }

        setSubscriptions(subMap)
      }
    } catch (error) {
      console.error('Error loading subscriptions:', error)
    } finally {
      setLoading(false)
    }
  }

  async function handleToggle(listId: string, subscribed: boolean) {
    if (!user?.email) return

    setSaving(listId)
    try {
      const now = new Date().toISOString()
      const { error } = await supabase
        .from('list_subscriptions')
        .upsert({
          list_id: listId,
          email: user.email,
          subscribed,
          subscribed_at: subscribed ? now : null,
          unsubscribed_at: subscribed ? null : now,
          source: 'portal',
          updated_at: now,
        }, { onConflict: 'list_id,email' })

      if (error) throw error

      setSubscriptions(prev => {
        const next = new Map(prev)
        next.set(listId, subscribed)
        return next
      })
    } catch (error) {
      console.error('Error updating subscription:', error)
    } finally {
      setSaving(null)
    }
  }

  if (!user) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <PageHeader
          title="Email Preferences"
          subtitle="Sign in to manage your email subscriptions"
        />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <PageHeader
        title="Email Preferences"
        subtitle="Choose which emails you'd like to receive"
      />

      <div className="mt-8 space-y-4">
        {loading ? (
          <GlassPanel padding="p-8">
            <div className="flex items-center justify-center">
              <div className="animate-spin w-6 h-6 border-2 border-white/30 border-t-white rounded-full" />
              <span className="ml-3 text-white/60">Loading preferences...</span>
            </div>
          </GlassPanel>
        ) : topics.length === 0 ? (
          <GlassPanel padding="p-8">
            <p className="text-center text-white/60">
              No email topics are available at this time.
            </p>
          </GlassPanel>
        ) : (
          topics.map((topic) => {
            const isSubscribed = subscriptions.get(topic.list_id) ?? topic.default_subscribed
            const isSaving = saving === topic.list_id

            return (
              <GlassPanel key={topic.id} padding="p-5">
                <div className="flex items-center justify-between">
                  <div className="flex-1 mr-4">
                    <h3 className="text-white font-medium">{topic.label}</h3>
                    {topic.description && (
                      <p className="text-sm text-white/60 mt-1">{topic.description}</p>
                    )}
                  </div>
                  <button
                    onClick={() => handleToggle(topic.list_id, !isSubscribed)}
                    disabled={isSaving}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-white/20 focus:ring-offset-2 focus:ring-offset-transparent ${
                      isSubscribed ? 'bg-green-500' : 'bg-white/20'
                    } ${isSaving ? 'opacity-50' : ''}`}
                    role="switch"
                    aria-checked={isSubscribed}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        isSubscribed ? 'translate-x-5' : 'translate-x-0'
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
            Subscribed as {user.email}.{' '}
            You can also unsubscribe via the link at the bottom of any email.
          </p>
        </GlassPanel>
      </div>
    </div>
  )
}
