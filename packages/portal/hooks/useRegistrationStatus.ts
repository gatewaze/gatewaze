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

        // Find person by auth_user_id
        const { data: person } = await supabase
          .from('people')
          .select('id')
          .eq('auth_user_id', user!.id)
          .maybeSingle()

        if (!person || cancelled) { setIsChecking(false); return }

        // Find people profiles for this person
        const { data: profiles } = await supabase
          .from('people_profiles')
          .select('id')
          .eq('person_id', person.id)

        if (!profiles?.length || cancelled) { setIsChecking(false); return }

        // Check if any profile has a registration for this event
        const { data: registration } = await supabase
          .from('events_registrations')
          .select('id')
          .eq('event_id', event.event_id)
          .in('people_profile_id', profiles.map(p => p.id))
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
