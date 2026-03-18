'use client'

import { useState, useCallback, useRef } from 'react'
import type { UserLocation } from '@/lib/location'

export interface AISearchResult {
  event_id: string
  relevance_score: number
  match_reason: string
  is_upcoming: boolean
}

interface AISearchResponse {
  results: AISearchResult[]
  summary?: string
  error?: string
}

interface CachedResult {
  results: AISearchResult[]
  summary: string | null
  timestamp: number
}

interface UseEventSearchReturn {
  searchResults: AISearchResult[] | null
  summary: string | null
  isSearching: boolean
  error: string | null
  searchQuery: string
  performSearch: (query: string) => Promise<void>
  clearSearch: () => void
}

// Cache lives for the duration of the page session
const searchCache = new Map<string, CachedResult>()
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

export function useEventSearch(brandId: string, userLocation: UserLocation | null): UseEventSearchReturn {
  const [searchResults, setSearchResults] = useState<AISearchResult[] | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  const performSearch = useCallback(
    async (query: string) => {
      if (!query.trim()) {
        return
      }

      const trimmed = query.trim()
      setSearchQuery(trimmed)
      setError(null)

      // Check cache first
      const cacheKey = `${brandId}:${trimmed.toLowerCase()}`
      const cached = searchCache.get(cacheKey)
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        setSearchResults(cached.results)
        setSummary(cached.summary)
        return
      }

      // Abort any in-flight request
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setIsSearching(true)

      try {
        const response = await fetch('/api/ai-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: trimmed,
            brandId,
            userLocation: userLocation
              ? {
                  lat: userLocation.lat,
                  lng: userLocation.lng,
                }
              : undefined,
          }),
          signal: controller.signal,
        })

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          throw new Error(errorData.error || `Search failed with status ${response.status}`)
        }

        const data: AISearchResponse = await response.json()

        if (data.error) {
          throw new Error(data.error)
        }

        const results = data.results || []
        const summaryText = data.summary || null

        // Store in cache
        searchCache.set(cacheKey, {
          results,
          summary: summaryText,
          timestamp: Date.now(),
        })

        setSearchResults(results)
        setSummary(summaryText)
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        const errorMessage = err instanceof Error ? err.message : 'Search failed'
        setError(errorMessage)
        setSearchResults([])
        setSummary(null)
        console.error('Event search error:', err)
      } finally {
        setIsSearching(false)
      }
    },
    [brandId, userLocation]
  )

  const clearSearch = useCallback(() => {
    abortRef.current?.abort()
    setSearchResults(null)
    setSummary(null)
    setSearchQuery('')
    setError(null)
  }, [])

  return {
    searchResults,
    summary,
    isSearching,
    error,
    searchQuery,
    performSearch,
    clearSearch,
  }
}
