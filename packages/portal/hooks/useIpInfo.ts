'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import type { UserLocation } from '@/lib/location'

interface IpInfoData {
  ip: string
  city?: string
  region?: string
  country?: string
  loc?: string // "lat,lng" format
  org?: string
  postal?: string
  timezone?: string
}

interface UseIpInfoReturn {
  ipInfo: IpInfoData | null
  userLocation: UserLocation | null
  isLoading: boolean
  error: string | null
  refetch: () => Promise<void>
}

const IP_INFO_CACHE_KEY = 'gatewaze_ip_info'
const IP_INFO_CACHE_TTL = 1000 * 60 * 30 // 30 minutes

interface CachedIpInfo {
  data: IpInfoData
  timestamp: number
}

function getCachedIpInfo(): IpInfoData | null {
  if (typeof window === 'undefined') return null

  try {
    const cached = localStorage.getItem(IP_INFO_CACHE_KEY)
    if (!cached) return null

    const { data, timestamp }: CachedIpInfo = JSON.parse(cached)
    const isExpired = Date.now() - timestamp > IP_INFO_CACHE_TTL

    if (isExpired) {
      localStorage.removeItem(IP_INFO_CACHE_KEY)
      return null
    }

    return data
  } catch {
    return null
  }
}

function setCachedIpInfo(data: IpInfoData): void {
  if (typeof window === 'undefined') return

  try {
    const cacheEntry: CachedIpInfo = {
      data,
      timestamp: Date.now(),
    }
    localStorage.setItem(IP_INFO_CACHE_KEY, JSON.stringify(cacheEntry))
  } catch {
    // Ignore storage errors
  }
}

function parseLocation(loc: string | undefined): UserLocation | null {
  if (!loc) return null

  const parts = loc.split(',')
  if (parts.length !== 2) return null

  const lat = parseFloat(parts[0])
  const lng = parseFloat(parts[1])

  if (isNaN(lat) || isNaN(lng)) return null

  return { lat, lng }
}

/**
 * Hook for fetching user's IP-based location information
 * Uses ipinfo.io (free, no auth required)
 * Caches result in localStorage for 30 minutes
 */
export function useIpInfo(): UseIpInfoReturn {
  const [ipInfo, setIpInfo] = useState<IpInfoData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchIpInfo = useCallback(async () => {
    // Check cache first
    const cached = getCachedIpInfo()
    if (cached) {
      setIpInfo(cached)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch('https://ipinfo.io/json')

      if (!response.ok) {
        throw new Error('Failed to fetch IP info')
      }

      const data = await response.json()

      const ipInfoData: IpInfoData = {
        ip: data.ip,
        city: data.city,
        region: data.region,
        country: data.country,
        loc: data.loc,
        org: data.org,
        postal: data.postal,
        timezone: data.timezone,
      }

      // Cache the result
      setCachedIpInfo(ipInfoData)
      setIpInfo(ipInfoData)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to get location'
      setError(errorMessage)
      console.error('Error fetching IP info:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchIpInfo()
  }, [fetchIpInfo])

  // Parse location from "lat,lng" string - memoize to prevent unnecessary re-renders
  const userLocation = useMemo<UserLocation | null>(() => {
    if (!ipInfo?.loc) return null
    const parsed = parseLocation(ipInfo.loc)
    if (!parsed) return null
    return {
      ...parsed,
      city: ipInfo.city,
      region: ipInfo.region,
      country: ipInfo.country,
    }
  }, [ipInfo?.loc, ipInfo?.city, ipInfo?.region, ipInfo?.country])

  return {
    ipInfo,
    userLocation,
    isLoading,
    error,
    refetch: fetchIpInfo,
  }
}
