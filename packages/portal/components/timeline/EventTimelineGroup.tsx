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
        {/* Timeline node — smaller white dot inside a bigger white ring (bullseye). Centered inside
            a box the height of the date line so it lines up with the date text. */}
        <div className="flex h-6 sm:h-7 items-center justify-center">
          <div
            className="w-[18px] h-[18px] rounded-full flex items-center justify-center"
            style={{ border: '2px solid #fff' }}
          >
            <div className="rounded-full" style={{ width: 6, height: 6, backgroundColor: '#fff' }} />
          </div>
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
