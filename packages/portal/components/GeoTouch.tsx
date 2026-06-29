'use client'

import { useEffect } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { getClientBrandConfig } from '@/config/brand'

/**
 * Refreshes the signed-in user's IP-derived details (city/country/timezone/raw IP)
 * once per browser session. The people-signup `geo_refresh` fast-path geolocates
 * the caller's IP and updates only the geo attributes (scoped to the caller's own
 * person via their JWT). Sign-in already refreshes geo; this covers return visits
 * on a persisted session.
 */
export function GeoTouch() {
  const { user, session } = useAuth()

  useEffect(() => {
    if (!user?.email || !session?.access_token) return
    try {
      if (sessionStorage.getItem('gw_geo_touched') === '1') return
      sessionStorage.setItem('gw_geo_touched', '1')
    } catch {
      // sessionStorage unavailable — proceed without throttle.
    }

    const config = getClientBrandConfig()
    fetch(`${config.supabaseUrl}/functions/v1/people-signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ email: user.email, source: 'portal_visit', geo_refresh: true }),
    }).catch(() => { /* best-effort */ })
  }, [user?.email, session?.access_token])

  return null
}
