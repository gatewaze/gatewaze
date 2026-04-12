'use client'

import { useState, useEffect, useCallback } from 'react'

interface Props {
  onSearch: (query: string) => void
  onClear: () => void
  isSearching: boolean
  primaryColor: string
  initialQuery?: string
}

export function TimelineSearch({ onSearch, onClear, isSearching, primaryColor, initialQuery }: Props) {
  const [query, setQuery] = useState(initialQuery || '')
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery || '')

  // Debounce the query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query)
    }, 400)

    return () => clearTimeout(timer)
  }, [query])

  // Trigger search when debounced query changes
  // Note: onSearch intentionally excluded from deps - we only want to trigger on query change
  useEffect(() => {
    if (debouncedQuery.trim()) {
      onSearch(debouncedQuery.trim())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery])

  const handleClear = useCallback(() => {
    setQuery('')
    setDebouncedQuery('')
    onClear()
  }, [onClear])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClear()
      }
    },
    [handleClear]
  )

  return (
    <div className="relative">
      <input
        type="text"
        placeholder="Search events..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        className="w-full sm:w-72 px-4 py-3 pr-10
                   text-white placeholder-white/50
                   focus:outline-none focus:brightness-125
                   transition-all duration-200"
        style={{
          borderRadius: 'var(--radius-control-outer)',
          backgroundColor: `rgba(255,255,255,var(--glass-opacity,0.05))`,
          backdropFilter: `blur(var(--glass-blur,4px))`,
          WebkitBackdropFilter: `blur(var(--glass-blur,4px))`,
          border: `1px solid rgba(255,255,255,var(--glass-border-opacity,0.1))`,
          boxShadow: query ? `0 0 0 1px ${primaryColor}40` : undefined,
        }}
      />
      <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center">
        {isSearching ? (
          <LoadingSpinner />
        ) : query ? (
          <button
            onClick={handleClear}
            className="cursor-pointer text-white/50 hover:text-white transition-colors duration-200"
            aria-label="Clear search"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        ) : (
          <MagnifyingGlassIcon />
        )}
      </div>
    </div>
  )
}

function MagnifyingGlassIcon() {
  return (
    <svg className="w-4 h-4 text-white/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
      />
    </svg>
  )
}

function LoadingSpinner() {
  return (
    <svg className="w-4 h-4 text-white/50 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  )
}
