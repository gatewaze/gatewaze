'use client'

import type { BrandConfig } from '@/config/brand'
import { EventTimelineCard } from './EventTimelineCard'
import type { EventGroup } from './utils'
import type { UserLocation } from '@/lib/location'

interface Props {
  group: EventGroup
  brandConfig: BrandConfig
  isLast: boolean
  userLocation?: UserLocation | null
}

export function EventTimelineGroup({ group, brandConfig, isLast, userLocation }: Props) {
  return (
    <div className="flex gap-4 sm:gap-6">
      {/* Timeline column — dotted line with double-circle indicator */}
      <div className="relative w-6 flex-shrink-0">
        {/* Dotted vertical line — starts below circle, ends before next circle */}
        {!isLast && (
          <div
            className="absolute left-1/2 -translate-x-1/2"
            style={{
              top: 28,
              bottom: -2,
              width: '1px',
              backgroundImage: 'linear-gradient(to bottom, var(--timeline-line-color, rgba(255,255,255,0.4)) 4px, transparent 4px)',
              backgroundSize: '1px 8px',
            }}
          />
        )}
        {/* Double circle — primaryColor border ring + small white dot */}
        <div
          className="absolute left-1/2 -translate-x-1/2 top-[4px] w-5 h-5 rounded-full border-[3px] bg-transparent"
          style={{ borderColor: brandConfig.primaryColor }}
        >
          <div className="absolute inset-0 m-auto w-2 h-2 rounded-full bg-white" />
        </div>
      </div>

      {/* Content column — date header + cards */}
      <div className="flex-1 min-w-0 pb-8">
        {/* Date header */}
        <div className="mb-3" suppressHydrationWarning>
          <span className="text-white font-semibold text-base sm:text-lg">{group.displayDate}</span>
          <span className="text-white/50 font-medium text-base sm:text-lg"> · {group.displayDay}</span>
        </div>

        {/* Event cards */}
        <div className="space-y-3">
          {group.events.map((event) => (
            <EventTimelineCard
              key={event.event_id}
              event={event}
              brandConfig={brandConfig}
              userLocation={userLocation}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
