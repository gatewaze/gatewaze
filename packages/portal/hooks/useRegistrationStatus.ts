'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { getSupabaseClient } from '@/lib/supabase/client'

interface RegistrationCheckEvent {
  event_id: string
  enable_registration?: boolean | null
}

export function useRegistrationStatus(event: RegistrationCheckEvent) {
  const { user, isLoading: authLoading } = useAuth()
  const [isRegistered, setIsRegistered] = useState(false)
  const [isChecking, setIsChecking] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  // Listen for registration changes to trigger re-fetch
  useEffect(() => {
    const handler = () => setRefreshKey(k => k + 1)
    window.addEventListener('registration-changed', handler)
    return () => window.removeEventListener('registration-changed', handler)
  }, [])

  useEffect(() => {
    if (authLoading) return
    if (!user || !event.enable_registration) {
      setIsChecking(false)
      return
    }

    let cancelled = false
    async function check() {
      try {
        const supabase = getSupabaseClient()

        // Find customer by auth_user_id
        const { data: customer } = await supabase
          .from('customers')
          .select('id')
          .eq('auth_user_id', user!.id)
          .maybeSingle()

        if (!customer || cancelled) { setIsChecking(false); return }

        // Find member profiles for this customer
        const { data: profiles } = await supabase
          .from('member_profiles')
          .select('id')
          .eq('customer_id', customer.id)

        if (!profiles?.length || cancelled) { setIsChecking(false); return }

        // Check if any profile has a registration for this event
        const { data: registration } = await supabase
          .from('event_registrations')
          .select('id')
          .eq('event_id', event.event_id)
          .in('member_profile_id', profiles.map(p => p.id))
          .neq('status', 'cancelled')
          .limit(1)
          .maybeSingle()

        if (!cancelled) {
          setIsRegistered(!!registration)
          setIsChecking(false)
        }
      } catch (err) {
        console.error('Error checking registration status:', err)
        if (!cancelled) setIsChecking(false)
      }
    }

    check()
    return () => { cancelled = true }
  }, [user, authLoading, event.enable_registration, event.event_id, refreshKey])

  return { isRegistered, isChecking }
}
