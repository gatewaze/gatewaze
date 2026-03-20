'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { REGION_NAMES, REGION_CODES } from '@/lib/regions'
import { isLightColor, getClientBrandConfig } from '@/config/brand'
import { getEventTypeOptions, slugifyTopic } from '@/hooks/useEventFilters'
import { useTopicTaxonomy } from '@/hooks/useTopicTaxonomy'

interface Props {
  region: string | null
  eventType: string | null
  topics: string[]
  availableTypes: Set<string>
  onToggleType: (type: string) => void
  onToggleRegion: (code: string | null) => void
  onToggleTopic: (topic: string) => void
  primaryColor: string
  nearMe: boolean
  onToggleNearMe: () => void
  showNearMe: boolean
  nearMeLabel: string
}

export function EventFilters({
  region,
  eventType,
  topics,
  availableTypes,
  onToggleType,
  onToggleRegion,
  onToggleTopic,
  primaryColor,
  nearMe,
  onToggleNearMe,
  showNearMe,
  nearMeLabel,
}: Props) {
  const allTypeOptions = getEventTypeOptions()
  const visibleTypes = allTypeOptions.filter((opt) => availableTypes.has(opt.value))
  const brandConfig = getClientBrandConfig()
  const showTopics = brandConfig.eventTopicsEnabled

  return (
    <div className="flex flex-col items-center gap-2 mb-10 sm:flex-row sm:justify-between">
      {/* Event type pills */}
      <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
        <button
          onClick={() => eventType ? onToggleType(eventType) : undefined}
          className={`cursor-pointer px-3 py-1.5 text-base font-medium transition-all duration-200 border
            ${
              !eventType
                ? 'shadow-lg border-transparent'
                : 'text-white/70 bg-white/10 border-white/10 hover:text-white hover:bg-white/15'
            }`}
          style={{ borderRadius: 'var(--radius-control)', ...(!eventType ? { backgroundColor: primaryColor, color: isLightColor(primaryColor) ? '#000000' : '#ffffff' } : {}) }}
        >
          All
        </button>
        {visibleTypes.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onToggleType(opt.value)}
            className={`cursor-pointer px-3 py-1.5 text-base font-medium transition-all duration-200 border
              ${
                eventType === opt.value
                  ? 'shadow-lg border-transparent'
                  : 'text-white/70 bg-white/10 border-white/10 hover:text-white hover:bg-white/15'
              }`}
            style={{ borderRadius: 'var(--radius-control)', ...(eventType === opt.value ? { backgroundColor: primaryColor, color: isLightColor(primaryColor) ? '#000000' : '#ffffff' } : {}) }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Region, Near Me & Topic dropdowns */}
      <div className="flex items-center justify-center gap-2">
        {showNearMe && (
          <button
            onClick={onToggleNearMe}
            className={`cursor-pointer flex items-center gap-1.5 px-3 py-1.5 text-base font-medium
                       transition-all duration-200 border
                       ${
                         nearMe
                           ? 'shadow-lg border-transparent'
                           : 'text-white/70 bg-white/10 border-white/10 hover:text-white hover:bg-white/15'
                       }`}
            style={{ borderRadius: 'var(--radius-control)', ...(nearMe ? { backgroundColor: primaryColor, color: isLightColor(primaryColor) ? '#000000' : '#ffffff' } : {}) }}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
              />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="hidden sm:inline">{nearMe ? `Within ${nearMeLabel}` : 'Near me'}</span>
          </button>
        )}
        <RegionDropdown
          selectedRegion={region}
          onToggleRegion={onToggleRegion}
          primaryColor={primaryColor}
        />
        {showTopics && (
          <TopicDropdown
            selectedTopics={topics}
            onToggleTopic={onToggleTopic}
            primaryColor={primaryColor}
          />
        )}
      </div>
    </div>
  )
}

function RegionDropdown({
  selectedRegion,
  onToggleRegion,
  primaryColor,
}: {
  selectedRegion: string | null
  onToggleRegion: (code: string | null) => void
  primaryColor: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const label = selectedRegion ? REGION_NAMES[selectedRegion] : 'Region'

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`cursor-pointer flex items-center gap-1.5 px-3 py-1.5 text-base font-medium transition-all duration-200 border
          ${
            selectedRegion
              ? 'shadow-lg border-transparent'
              : 'text-white/70 bg-white/10 border-white/10 hover:text-white hover:bg-white/15'
          }`}
        style={{ borderRadius: 'var(--radius-control)', ...(selectedRegion ? { backgroundColor: primaryColor, color: isLightColor(primaryColor) ? '#000000' : '#ffffff' } : {}) }}
      >
        {label}
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (() => {
        const light = isLightColor(primaryColor)
        return (
        <div className="absolute z-50 top-full mt-2 left-0 backdrop-blur-xl border shadow-2xl py-1 min-w-[180px]"
          style={{
            borderRadius: 'var(--radius-control)',
            backgroundColor: light ? 'rgba(255,255,255,0.95)' : `${primaryColor}DD`,
            borderColor: light ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.15)',
          }}
        >
          {REGION_CODES.map((code) => (
              <button
                key={code}
                onClick={() => {
                  onToggleRegion(code)
                  setOpen(false)
                }}
                className="cursor-pointer w-full text-left px-4 py-2 text-base transition-colors"
                style={
                  selectedRegion === code
                    ? { backgroundColor: light ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.15)', color: light ? '#000000' : '#ffffff', fontWeight: 500 }
                    : { color: light ? 'rgba(26,26,46,0.7)' : 'rgba(255,255,255,0.8)' }
                }
              >
                {REGION_NAMES[code]}
              </button>
            )
          )}
        </div>
        )
      })()}
    </div>
  )
}

type TopicEntry = { category: string; subcategory?: string; topic: string }

function TopicDropdown({
  selectedTopics,
  onToggleTopic,
  primaryColor,
}: {
  selectedTopics: string[]
  onToggleTopic: (topic: string) => void
  primaryColor: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const ref = useRef<HTMLDivElement>(null)
  const topicsData = useTopicTaxonomy()

  const allTopics = useMemo(() => {
    const entries: TopicEntry[] = []
    for (const [category, value] of Object.entries(topicsData)) {
      if (Array.isArray(value)) {
        for (const topic of value) {
          entries.push({ category, topic })
        }
      } else {
        for (const [subcategory, topics] of Object.entries(value as Record<string, string[]>)) {
          for (const topic of topics) {
            entries.push({ category, subcategory, topic })
          }
        }
      }
    }
    return entries
  }, [topicsData])

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const searchLower = search.toLowerCase()
  const isSearching = search.length > 0

  // Group by category, filter by search
  const grouped = useMemo(() => {
    const map = new Map<string, { subcategories: Map<string, string[]>; directTopics: string[] }>()

    for (const entry of allTopics) {
      if (isSearching && !entry.topic.toLowerCase().includes(searchLower)) continue

      if (!map.has(entry.category)) {
        map.set(entry.category, { subcategories: new Map(), directTopics: [] })
      }
      const cat = map.get(entry.category)!

      if (entry.subcategory) {
        if (!cat.subcategories.has(entry.subcategory)) {
          cat.subcategories.set(entry.subcategory, [])
        }
        cat.subcategories.get(entry.subcategory)!.push(entry.topic)
      } else {
        cat.directTopics.push(entry.topic)
      }
    }

    return map
  }, [allTopics, isSearching, searchLower])

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }

  const hasTopics = selectedTopics.length > 0

  // Hide entirely if no topics are configured
  if (allTopics.length === 0) return null

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`cursor-pointer flex items-center gap-1.5 px-3 py-1.5 text-base font-medium transition-all duration-200 border
          ${
            hasTopics
              ? 'shadow-lg border-transparent'
              : 'text-white/70 bg-white/10 border-white/10 hover:text-white hover:bg-white/15'
          }`}
        style={{ borderRadius: 'var(--radius-control)', ...(hasTopics ? { backgroundColor: primaryColor, color: isLightColor(primaryColor) ? '#000000' : '#ffffff' } : {}) }}
      >
        Topics
        {hasTopics && (
          <span className="ml-0.5 px-1.5 py-0.5 rounded-full text-xs font-medium bg-white/20">
            {selectedTopics.length}
          </span>
        )}
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (() => {
        const light = isLightColor(primaryColor)
        const panelBg = light ? 'rgba(255,255,255,0.95)' : undefined
        const panelBorder = light ? 'rgba(0,0,0,0.1)' : undefined
        const textColor = light ? '#000000' : undefined
        const textFaint = light ? 'rgba(26,26,46,0.4)' : 'rgba(255,255,255,0.4)'
        return (
        <div
          className="absolute z-50 top-full mt-2 left-0 sm:left-auto sm:right-0 backdrop-blur-xl border shadow-2xl w-[300px] max-h-[400px] flex flex-col"
          style={{
            borderRadius: 'var(--radius-control)',
            backgroundColor: light ? 'rgba(255,255,255,0.95)' : `${primaryColor}DD`,
            borderColor: light ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.15)',
          }}
        >
          {/* Search input */}
          <div className="p-2 border-b" style={{ borderColor: light ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)' }}>
            <input
              type="text"
              placeholder="Search topics..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-3 py-1.5 border rounded-lg text-base focus:outline-none"
              style={{
                backgroundColor: light ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.1)',
                borderColor: light ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)',
                color: textColor || '#ffffff',
              }}
              autoFocus
            />
          </div>

          {/* Topic list */}
          <div className="overflow-y-auto flex-1 py-1">
            {grouped.size === 0 ? (
              <div className="px-4 py-3 text-base" style={{ color: textFaint }}>No topics found</div>
            ) : (
              Array.from(grouped.entries()).map(([category, { subcategories, directTopics }]) => {
                const isExpanded = isSearching || expandedCategories.has(category)
                return (
                  <div key={category}>
                    <button
                      onClick={() => toggleCategory(category)}
                      className="cursor-pointer w-full text-left px-4 py-2 text-base font-medium flex items-center gap-2"
                      style={{ color: light ? 'rgba(26,26,46,0.9)' : 'rgba(255,255,255,0.9)' }}
                    >
                      <svg
                        className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        style={{ color: textFaint }}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                      {category}
                    </button>
                    {isExpanded && (
                      <div>
                        {directTopics.map((topic) => (
                          <TopicCheckbox
                            key={topic}
                            topic={topic}
                            checked={selectedTopics.includes(slugifyTopic(topic))}
                            onToggle={onToggleTopic}
                            primaryColor={primaryColor}
                            indent={1}
                          />
                        ))}
                        {Array.from(subcategories.entries()).map(([sub, topics]) => (
                          <div key={sub}>
                            <div className="px-8 py-1 text-xs font-medium uppercase tracking-wider" style={{ color: textFaint }}>
                              {sub}
                            </div>
                            {topics.map((topic) => (
                              <TopicCheckbox
                                key={topic}
                                topic={topic}
                                checked={selectedTopics.includes(slugifyTopic(topic))}
                                onToggle={onToggleTopic}
                                primaryColor={primaryColor}
                                indent={2}
                              />
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>
        )
      })()}
    </div>
  )
}

function TopicCheckbox({
  topic,
  checked,
  onToggle,
  primaryColor,
  indent,
}: {
  topic: string
  checked: boolean
  onToggle: (topic: string) => void
  primaryColor: string
  indent: number
}) {
  const light = isLightColor(primaryColor)
  return (
    <button
      onClick={() => onToggle(topic)}
      className="cursor-pointer w-full text-left py-1.5 text-base flex items-center gap-2"
      style={{
        paddingLeft: indent === 2 ? '2.5rem' : '1.75rem',
        color: light ? 'rgba(26,26,46,0.7)' : 'rgba(255,255,255,0.7)',
      }}
    >
      <span
        className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors`}
        style={{
          backgroundColor: checked ? primaryColor : undefined,
          borderColor: checked ? 'transparent' : (light ? 'rgba(26,26,46,0.2)' : 'rgba(255,255,255,0.3)'),
        }}
      >
        {checked && (
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: light ? '#000000' : '#ffffff' }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        )}
      </span>
      {topic}
    </button>
  )
}
