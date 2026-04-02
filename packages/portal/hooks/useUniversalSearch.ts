'use client'

import { useState, useCallback, useRef } from 'react'
import type { UserLocation } from '@/lib/location'

export interface UniversalSearchResult {
  content_type: 'event' | 'blog'
  id: string
  slug: string
  title: string
  relevance_score: number
  match_reason: string
  is_upcoming?: boolean
  image_url?: string | null
  subtitle?: string | null
}

interface SearchResponse {
  results: UniversalSearchResult[]
  summary?: string
  error?: string
}

interface CachedResult {
  results: UniversalSearchResult[]
  summary: string | null
  timestamp: number
}

const searchCache = new Map<string, CachedResult>()
const CACHE_TTL_MS = 5 * 60 * 1000

export function useUniversalSearch(brandId: string, userLocation: UserLocation | null) {
  const [results, setResults] = useState<UniversalSearchResult[] | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  const performSearch = useCallback(
    async (query: string) => {
      if (!query.trim()) return

      const trimmed = query.trim()
      setSearchQuery(trimmed)
      setError(null)

      const cacheKey = `universal:${brandId}:${trimmed.toLowerCase()}`
      const cached = searchCache.get(cacheKey)
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        setResults(cached.results)
        setSummary(cached.summary)
        return
      }

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
              ? { lat: userLocation.lat, lng: userLocation.lng }
              : undefined,
          }),
          signal: controller.signal,
        })

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          throw new Error(errorData.error || `Search failed with status ${response.status}`)
        }

        const data: SearchResponse = await response.json()
        if (data.error) throw new Error(data.error)

        const searchResults = data.results || []
        const summaryText = data.summary || null

        searchCache.set(cacheKey, {
          results: searchResults,
          summary: summaryText,
          timestamp: Date.now(),
        })

        setResults(searchResults)
        setSummary(summaryText)
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        const errorMessage = err instanceof Error ? err.message : 'Search failed'
        setError(errorMessage)
        setResults([])
        setSummary(null)
        console.error('Universal search error:', err)
      } finally {
        setIsSearching(false)
      }
    },
    [brandId, userLocation]
  )

  const clearSearch = useCallback(() => {
    abortRef.current?.abort()
    setResults(null)
    setSummary(null)
    setSearchQuery('')
    setError(null)
  }, [])

  return {
    results,
    summary,
    isSearching,
    error,
    searchQuery,
    performSearch,
    clearSearch,
  }
}
