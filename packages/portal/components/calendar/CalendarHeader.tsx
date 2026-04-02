'use client'

import type { Calendar } from '@/types/calendar'

interface Props {
  calendar: Calendar
}

export function CalendarHeader({ calendar }: Props) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-3">
        {calendar.logo_url && (
          <img
            src={calendar.logo_url}
            alt={calendar.name}
            className="w-10 h-10 rounded-lg object-cover"
          />
        )}
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white">
            {calendar.name}
          </h1>
          {calendar.description && (
            <p className="text-white/60 text-sm mt-1">{calendar.description}</p>
          )}
        </div>
      </div>
    </div>
  )
}
