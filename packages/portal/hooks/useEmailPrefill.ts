import { useState, useEffect, useRef, useSyncExternalStore } from 'react'
import { getClientBrandConfig } from '@/config/brand'

const noopSubscribe = () => () => {}
function readPrefillEmail(): string | null {
  try {
    return sessionStorage.getItem('prefill_email') || null
  } catch {
    return null // sessionStorage not available
  }
}

export interface PrefillProfile {
  email: string
  first_name: string
  last_name: string
  company: string
  job_title: string
}

interface UseEmailPrefillResult {
  prefillEmail: string | null
  prefillProfile: PrefillProfile | null
  isLoading: boolean
}

/**
 * Hook that reads a pre-fill email from sessionStorage (stored by EventLayoutClient)
 * and optionally fetches the person profile from the customer-prefill edge function.
 *
 * @param eventIdentifier - The event identifier used as the sessionStorage key
 * @param fetchProfile - Whether to fetch the full person profile (default: true)
 */
export function useEmailPrefill(_eventIdentifier?: string, fetchProfile = true): UseEmailPrefillResult {
  // Read email from sessionStorage (global key). Null on the server and during
  // hydration; the stored value once on the client.
  const prefillEmail = useSyncExternalStore(noopSubscribe, readPrefillEmail, () => null)
  const [prefillProfile, setPrefillProfile] = useState<PrefillProfile | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const fetchedRef = useRef(false)

  // Fetch person profile if email is available
  useEffect(() => {
    if (!prefillEmail || !fetchProfile || fetchedRef.current) return
    fetchedRef.current = true
    setIsLoading(true)

    const fetchPersonProfile = async () => {
      try {
        const config = getClientBrandConfig()
        const response = await fetch(`${config.supabaseUrl}/functions/v1/customer-prefill`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': config.supabaseAnonKey,
          },
          body: JSON.stringify({ email: prefillEmail }),
        })

        if (!response.ok) {
          console.error('Person prefill failed:', response.status)
          setPrefillProfile({ email: prefillEmail, first_name: '', last_name: '', company: '', job_title: '' })
          return
        }

        const data = await response.json()
        if (data.found && data.profile) {
          setPrefillProfile({
            email: prefillEmail,
            first_name: data.profile.first_name || '',
            last_name: data.profile.last_name || '',
            company: data.profile.company || '',
            job_title: data.profile.job_title || '',
          })
        } else {
          // No person found — still provide email
          setPrefillProfile({ email: prefillEmail, first_name: '', last_name: '', company: '', job_title: '' })
        }
      } catch (err) {
        console.error('Error fetching person prefill:', err)
        setPrefillProfile({ email: prefillEmail, first_name: '', last_name: '', company: '', job_title: '' })
      } finally {
        setIsLoading(false)
      }
    }

    fetchPersonProfile()
  }, [prefillEmail, fetchProfile])

  return { prefillEmail, prefillProfile, isLoading }
}
