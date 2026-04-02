'use client'

import { useEffect, useState, useMemo } from 'react'
import { getClientBrandConfig } from '@/config/brand'
import { useEventContext } from './EventContext'
import { GlowBorder } from '@/components/ui/GlowBorder'

interface Sponsor {
  id: string
  sponsor_id: string
  sponsorship_tier: string | null
  name: string
  logo_url: string | null
  website: string | null
  description: string | null
}

const TIER_ORDER: Record<string, number> = {
  platinum: 1,
  gold: 2,
  silver: 3,
  bronze: 4,
  partner: 5,
  exhibitor: 6,
}

const TIER_LABELS: Record<string, string> = {
  platinum: 'Platinum sponsors',
  gold: 'Gold sponsors',
  silver: 'Silver sponsors',
  bronze: 'Bronze sponsors',
  partner: 'Partners',
  exhibitor: 'Exhibitors',
}

export function SponsorsContent() {
  const { event, useDarkText, primaryColor } = useEventContext()
  const [sponsors, setSponsors] = useState<Sponsor[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const panelTheme = useMemo(() => ({
    panelBg: useDarkText ? 'bg-gray-900/15' : 'bg-white/15',
    panelBorder: useDarkText ? 'border border-gray-700/50' : 'border border-white/20',
    textColor: useDarkText ? 'text-gray-900' : 'text-white',
    textMuted: useDarkText ? 'text-gray-600' : 'text-white/70',
  }), [useDarkText])

  useEffect(() => {
    async function fetchSponsors() {
      setIsLoading(true)
      try {
        const config = getClientBrandConfig()
        const { createClient } = await import('@supabase/supabase-js')
        const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey)

        const { data, error } = await supabase
          .from('events_sponsors')
          .select(`
            id,
            sponsor_id,
            sponsorship_tier,
            sponsors (
              id,
              name,
              logo_url,
              website,
              description
            )
          `)
          .eq('event_id', event.event_id)
          .eq('is_active', true)

        if (error) {
          console.error('Error fetching sponsors:', error)
          return
        }

        // Flatten the data and add sponsor details
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const flattenedSponsors: Sponsor[] = (data || []).map((item: any) => ({
          id: item.id,
          sponsor_id: item.sponsor_id,
          sponsorship_tier: item.sponsorship_tier,
          name: item.sponsors?.name || 'Unknown Sponsor',
          logo_url: item.sponsors?.logo_url || null,
          website: item.sponsors?.website || null,
          description: item.sponsors?.description || null,
        }))

        // Sort by tier order
        flattenedSponsors.sort((a, b) => {
          const orderA = TIER_ORDER[a.sponsorship_tier || ''] || 99
          const orderB = TIER_ORDER[b.sponsorship_tier || ''] || 99
          return orderA - orderB
        })

        setSponsors(flattenedSponsors)
      } catch (err) {
        console.error('Error fetching sponsors:', err)
      } finally {
        setIsLoading(false)
      }
    }

    if (event.event_id) {
      fetchSponsors()
    }
  }, [event.event_id])

  if (isLoading) {
    return (
      <div className="text-center py-12">
        <div
          className="loader mx-auto mb-4"
          style={{
            '--primary-color': '#fff',
            '--secondary-color': primaryColor,
          } as React.CSSProperties}
        />
        <p className={panelTheme.textMuted}>Loading sponsors...</p>
      </div>
    )
  }

  if (sponsors.length === 0) {
    return (
      <GlowBorder useDarkTheme={useDarkText}>
        <div className={`${panelTheme.panelBg} backdrop-blur-[10px] rounded-2xl overflow-hidden ${panelTheme.panelBorder} p-6 sm:p-8`}>
          <div className="text-center py-8">
            <svg
              className={`w-16 h-16 mx-auto mb-4 ${panelTheme.textMuted}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
            <h2 className={`text-xl font-semibold ${panelTheme.textColor} mb-2`}>
              Sponsors coming soon
            </h2>
            <p className={panelTheme.textMuted}>
              Sponsors for this event will be announced soon.
            </p>
          </div>
        </div>
      </GlowBorder>
    )
  }

  // Group sponsors by tier
  const sponsorsByTier = sponsors.reduce((acc, sponsor) => {
    const tier = sponsor.sponsorship_tier || 'other'
    if (!acc[tier]) {
      acc[tier] = []
    }
    acc[tier].push(sponsor)
    return acc
  }, {} as Record<string, Sponsor[]>)

  // Get sorted tier keys
  const sortedTiers = Object.keys(sponsorsByTier).sort((a, b) => {
    const orderA = TIER_ORDER[a] || 99
    const orderB = TIER_ORDER[b] || 99
    return orderA - orderB
  })

  return (
    <div className="space-y-8">
      <h1 className={`text-2xl sm:text-3xl font-bold ${panelTheme.textColor}`}>Sponsors</h1>

      {sortedTiers.map((tier) => (
        <div key={tier}>
          <h2 className={`text-lg font-semibold ${panelTheme.textColor} mb-4`}>
            {TIER_LABELS[tier] || 'Sponsors'}
          </h2>
          <div className={`grid gap-4 ${
            tier === 'platinum' ? 'grid-cols-1 sm:grid-cols-2' :
            tier === 'gold' ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' :
            'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4'
          }`}>
            {sponsorsByTier[tier].map((sponsor) => (
              <SponsorCard
                key={sponsor.id}
                sponsor={sponsor}
                tier={tier}
                useDarkText={useDarkText}
                primaryColor={primaryColor}
                panelTheme={panelTheme}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

interface SponsorCardProps {
  sponsor: Sponsor
  tier: string
  useDarkText: boolean
  primaryColor: string
  panelTheme: {
    panelBg: string
    panelBorder: string
    textColor: string
    textMuted: string
  }
}

function SponsorCard({ sponsor, tier, useDarkText, primaryColor, panelTheme }: SponsorCardProps) {
  const isPremiumTier = tier === 'platinum' || tier === 'gold'

  const content = (
    <GlowBorder useDarkTheme={useDarkText} className="h-full">
      <div className={`${panelTheme.panelBg} backdrop-blur-[10px] rounded-2xl overflow-hidden ${panelTheme.panelBorder} p-4 sm:p-5 h-full flex flex-col group transition-all duration-200 ${sponsor.website ? 'hover:scale-[1.02] cursor-pointer' : ''}`}>
        {/* Logo */}
        <div className={`flex items-center justify-center ${isPremiumTier ? 'h-24 sm:h-32' : 'h-16 sm:h-20'} mb-3`}>
          {sponsor.logo_url ? (
            <img
              src={sponsor.logo_url}
              alt={sponsor.name}
              className={`max-h-full max-w-full object-contain ${useDarkText ? '' : 'brightness-0 invert'} group-hover:brightness-100 group-hover:invert-0 transition-all duration-300`}
            />
          ) : (
            <div
              className={`${isPremiumTier ? 'text-2xl sm:text-3xl' : 'text-lg sm:text-xl'} font-bold text-center`}
              style={{ color: primaryColor }}
            >
              {sponsor.name}
            </div>
          )}
        </div>

        {/* Name (only show if we have a logo) */}
        {sponsor.logo_url && (
          <h3 className={`font-semibold ${panelTheme.textColor} text-center ${isPremiumTier ? 'text-base' : 'text-sm'} truncate`}>
            {sponsor.name}
          </h3>
        )}

        {/* Description (only for premium tiers) */}
        {isPremiumTier && sponsor.description && (
          <p className={`text-xs ${panelTheme.textMuted} mt-2 line-clamp-3 text-center`}>
            {sponsor.description}
          </p>
        )}

        {/* Website indicator */}
        {sponsor.website && (
          <div className={`mt-auto pt-3 flex items-center justify-center gap-1 ${panelTheme.textMuted} text-xs`}>
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            <span>Visit website</span>
          </div>
        )}
      </div>
    </GlowBorder>
  )

  if (sponsor.website) {
    return (
      <a
        href={sponsor.website}
        target="_blank"
        rel="noopener noreferrer"
        className="block h-full"
      >
        {content}
      </a>
    )
  }

  return content
}
