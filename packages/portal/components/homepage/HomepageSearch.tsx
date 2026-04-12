'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import type { BrandConfig } from '@/config/brand'
import { isLightColor } from '@/config/brand'
import { useUniversalSearch, type UniversalSearchResult } from '@/hooks/useUniversalSearch'

interface Props {
  brandConfig: BrandConfig
}

export function HomepageSearch({ brandConfig }: Props) {
  const [inputValue, setInputValue] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const { results, summary, isSearching, performSearch, clearSearch } = useUniversalSearch(
    brandConfig.id,
    null
  )

  const handleChange = useCallback((value: string) => {
    setInputValue(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (!value.trim()) {
      clearSearch()
      return
    }

    debounceRef.current = setTimeout(() => {
      performSearch(value)
    }, 400)
  }, [performSearch, clearSearch])

  const handleClear = useCallback(() => {
    setInputValue('')
    clearSearch()
    inputRef.current?.focus()
  }, [clearSearch])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') handleClear()
  }, [handleClear])

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const hasResults = results !== null

  return (
    <div className="max-w-2xl mx-auto">
      {/* Search input */}
      <div className="relative">
        <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
          {isSearching ? (
            <svg className="w-5 h-5 text-white/40 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          ) : (
            <svg className="w-5 h-5 text-white/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
          )}
        </div>
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search for content..."
          className="w-full py-4 pl-12 pr-12 text-base text-white placeholder-white/40
                     rounded-2xl focus:outline-none focus:brightness-125
                     transition-all duration-200"
          style={{
            backgroundColor: `rgba(255,255,255,var(--glass-opacity,0.05))`,
            border: `1px solid rgba(255,255,255,var(--glass-border-opacity,0.1))`,
            boxShadow: inputValue ? `0 0 0 1px ${brandConfig.primaryColor}40` : undefined,
          }}
        />
        {inputValue && (
          <button
            onClick={handleClear}
            className="absolute inset-y-0 right-4 flex items-center text-white/40 hover:text-white/70 transition-colors"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Search results */}
      {hasResults && (
        <div className="mt-4">
          {summary && (
            <p className="text-white/50 text-sm mb-3">{summary}</p>
          )}
          {results.length > 0 ? (
            <div className="space-y-2">
              {results.map((result) => (
                <SearchResultItem
                  key={`${result.content_type}-${result.id}`}
                  result={result}
                  brandConfig={brandConfig}
                />
              ))}
            </div>
          ) : (
            <p className="text-white/50 text-sm text-center py-6">
              No results found. Try different keywords.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function SearchResultItem({ result, brandConfig }: { result: UniversalSearchResult; brandConfig: BrandConfig }) {
  const href = result.content_type === 'event'
    ? `/events/${result.slug}`
    : `/blog/${result.slug}`

  const typeLabel = result.content_type === 'event' ? 'Event' : 'Blog'
  const typeColor = result.content_type === 'event'
    ? brandConfig.primaryColor
    : '#a78bfa' // purple for blog

  return (
    <Link href={href} className="block group">
      <div className="flex items-center gap-3 p-3 rounded-xl hover:brightness-110 transition-all duration-200"
           style={{ backgroundColor: `rgba(255,255,255,var(--glass-opacity,0.05))`, border: `1px solid rgba(255,255,255,var(--glass-border-opacity,0.1))` }}>
        {/* Image thumbnail */}
        {result.image_url ? (
          <div className="flex-shrink-0 w-12 h-12 rounded-lg overflow-hidden bg-white/5">
            <img src={result.image_url} alt="" className="w-full h-full object-cover" />
          </div>
        ) : (
          <div
            className="flex-shrink-0 w-12 h-12 rounded-lg flex items-center justify-center text-sm font-medium"
            style={{ backgroundColor: typeColor + '20', color: typeColor }}
          >
            {result.content_type === 'event' ? (
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            ) : (
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
              </svg>
            )}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-white text-base font-medium truncate group-hover:text-white/90">
              {result.title}
            </h3>
            <span
              className="flex-shrink-0 text-xs font-medium px-2 py-0.5 rounded-full"
              style={{ backgroundColor: typeColor + '20', color: typeColor }}
            >
              {typeLabel}
            </span>
          </div>
          {result.subtitle && (
            <p className="text-white/50 text-sm mt-0.5 truncate">{result.subtitle}</p>
          )}
          <p className="text-white/30 text-sm mt-0.5 truncate">{result.match_reason}</p>
        </div>
      </div>
    </Link>
  )
}
