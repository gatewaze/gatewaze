import { useState, useEffect, useRef } from 'react'
import { getClientBrandConfig } from '@/config/brand'

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
 * and optionally fetches the customer profile from the customer-prefill edge function.
 *
 * @param eventIdentifier - The event identifier used as the sessionStorage key
 * @param fetchProfile - Whether to fetch the full customer profile (default: true)
 */
export function useEmailPrefill(_eventIdentifier?: string, fetchProfile = true): UseEmailPrefillResult {
  const [prefillEmail, setPrefillEmail] = useState<string | null>(null)
  const [prefillProfile, setPrefillProfile] = useState<PrefillProfile | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const fetchedRef = useRef(false)

  // Read email from sessionStorage (global key)
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem('prefill_email')
      if (stored) {
        setPrefillEmail(stored)
      }
    } catch {
      // sessionStorage not available (SSR)
    }
  }, [])

  // Fetch customer profile if email is available
  useEffect(() => {
    if (!prefillEmail || !fetchProfile || fetchedRef.current) return
    fetchedRef.current = true
    setIsLoading(true)

    const fetchCustomerProfile = async () => {
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
          console.error('Customer prefill failed:', response.status)
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
          // No customer found — still provide email
          setPrefillProfile({ email: prefillEmail, first_name: '', last_name: '', company: '', job_title: '' })
        }
      } catch (err) {
        console.error('Error fetching customer prefill:', err)
        setPrefillProfile({ email: prefillEmail, first_name: '', last_name: '', company: '', job_title: '' })
      } finally {
        setIsLoading(false)
      }
    }

    fetchCustomerProfile()
  }, [prefillEmail, fetchProfile])

  return { prefillEmail, prefillProfile, isLoading }
}
