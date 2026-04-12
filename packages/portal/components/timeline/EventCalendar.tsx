'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import type { Event } from '@/types/event'
import type { BrandConfig } from '@/config/brand'
import { isLightColor } from '@/config/brand'
import { stripEmojis } from '@/lib/text'

interface Props {
  events: Event[]
  brandConfig: BrandConfig
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export function EventCalendar({ events, brandConfig }: Props) {
  const [currentDate, setCurrentDate] = useState(() => new Date())

  const currentYear = currentDate.getFullYear()
  const currentMonth = currentDate.getMonth()

  // Group events by date key (YYYY-MM-DD)
  const eventsByDate = useMemo(() => {
    const map = new Map<string, Event[]>()
    for (const event of events) {
      const date = new Date(event.event_start)
      const dateKey = date.toISOString().split('T')[0]
      if (!map.has(dateKey)) {
        map.set(dateKey, [])
      }
      map.get(dateKey)!.push(event)
    }
    return map
  }, [events])

  // Get calendar days for current month
  const calendarDays = useMemo(() => {
    const firstDay = new Date(currentYear, currentMonth, 1)
    const lastDay = new Date(currentYear, currentMonth + 1, 0)
    const startPadding = firstDay.getDay()
    const daysInMonth = lastDay.getDate()

    const days: Array<{ date: Date | null; events: Event[] }> = []

    // Add padding for days before the first day of month
    for (let i = 0; i < startPadding; i++) {
      days.push({ date: null, events: [] })
    }

    // Add days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(currentYear, currentMonth, day)
      const dateKey = date.toISOString().split('T')[0]
      days.push({
        date,
        events: eventsByDate.get(dateKey) || [],
      })
    }

    return days
  }, [currentYear, currentMonth, eventsByDate])

  const goToPreviousMonth = () => {
    setCurrentDate(new Date(currentYear, currentMonth - 1, 1))
  }

  const goToNextMonth = () => {
    setCurrentDate(new Date(currentYear, currentMonth + 1, 1))
  }

  const goToToday = () => {
    setCurrentDate(new Date())
  }

  const today = new Date()
  const isToday = (date: Date | null) => {
    if (!date) return false
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    )
  }

  return (
    <div className="w-full max-w-7xl mx-auto">
      {/* Calendar Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl sm:text-2xl font-semibold text-white">
          {MONTHS[currentMonth]} {currentYear}
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={goToToday}
            className="px-3 py-1.5 text-sm text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          >
            Today
          </button>
          <button
            onClick={goToPreviousMonth}
            className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
            aria-label="Previous month"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            onClick={goToNextMonth}
            className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
            aria-label="Next month"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: `rgba(255,255,255,var(--glass-opacity,0.05))`, backdropFilter: `blur(var(--glass-blur,4px))`, WebkitBackdropFilter: `blur(var(--glass-blur,4px))`, border: `1px solid rgba(255,255,255,var(--glass-border-opacity,0.1))` }}>
        {/* Day Headers */}
        <div className="grid grid-cols-7 border-b border-white/10">
          {DAYS.map((day) => (
            <div key={day} className="py-3 text-center text-sm font-medium text-white/60">
              {day}
            </div>
          ))}
        </div>

        {/* Calendar Days */}
        <div className="grid grid-cols-7">
          {calendarDays.map((day, index) => (
            <div
              key={index}
              className={`min-h-[80px] sm:min-h-[100px] p-1 sm:p-2 border-b border-r border-white/5
                         ${day.date ? 'hover:bg-white/5' : 'bg-white/[0.02]'}
                         ${index % 7 === 6 ? 'border-r-0' : ''}`}
            >
              {day.date && (
                <>
                  {/* Day Number */}
                  <div
                    className={`text-sm mb-1 w-7 h-7 flex items-center justify-center rounded-full
                               ${isToday(day.date) ? 'font-semibold' : 'text-white/70'}`}
                    style={isToday(day.date) ? { backgroundColor: brandConfig.primaryColor, color: isLightColor(brandConfig.primaryColor) ? '#000000' : '#ffffff' } : undefined}
                  >
                    {day.date.getDate()}
                  </div>

                  {/* Events */}
                  <div className="space-y-1">
                    {day.events.slice(0, 2).map((event) => (
                      <Link
                        key={event.event_id}
                        href={`/events/${event.event_slug || event.event_id}`}
                        className="block text-xs px-1.5 py-0.5 rounded truncate
                                   hover:opacity-80 transition-opacity"
                        style={{ backgroundColor: brandConfig.primaryColor, color: isLightColor(brandConfig.primaryColor) ? '#000000' : '#ffffff' }}
                        title={stripEmojis(event.event_title)}
                      >
                        {stripEmojis(event.event_title)}
                      </Link>
                    ))}
                    {day.events.length > 2 && (
                      <div className="text-xs text-white/50 px-1.5">+{day.events.length - 2} more</div>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
