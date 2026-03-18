'use client'

import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'gatewaze-consent'

interface ConsentCategories {
  necessary: boolean
  analytics: boolean
  marketing: boolean
  functional: boolean
}

export interface ConsentState {
  hasConsent: boolean | null // null = not yet decided, true = consented, false = denied
  categories: ConsentCategories
  showBanner: boolean // Always false - custom-consent.js handles the banner
  grantConsent: () => void
  denyConsent: () => void
}

/**
 * Hook to read tracking consent state from the custom-consent.js system
 *
 * Note: The banner is handled by custom-consent.js (loaded in layout).
 * This hook only reads the consent state for use in tracking logic.
 *
 * Returns:
 * - hasConsent: true if any tracking consent given, false if all denied, null if not decided
 * - categories: Object with consent status for each category
 * - showBanner: Always false (banner is handled by custom-consent.js)
 * - grantConsent/denyConsent: Functions that delegate to custom-consent.js
 */
export function useConsent(): ConsentState {
  const [hasConsent, setHasConsent] = useState<boolean | null>(() => {
    return getStoredConsent()
  })

  const [categories, setCategories] = useState<ConsentCategories>(() => {
    return getStoredCategories()
  })

  // Listen for consent changes from custom-consent.js
  useEffect(() => {
    const handleConsentChange = (event: CustomEvent) => {
      const detail = event.detail as {
        consentGiven: boolean
        consentDenied: boolean
        categories: ConsentCategories
      }

      if (detail.consentGiven) {
        setHasConsent(true)
      } else if (detail.consentDenied) {
        setHasConsent(false)
      }

      if (detail.categories) {
        setCategories(detail.categories)
      }
    }

    document.addEventListener('cookieConsentChanged', handleConsentChange as EventListener)

    // Also check storage periodically in case consent was changed in another tab
    const checkStorage = () => {
      const stored = getStoredConsent()
      const storedCategories = getStoredCategories()
      setHasConsent(stored)
      setCategories(storedCategories)
    }

    window.addEventListener('storage', checkStorage)
    window.addEventListener('focus', checkStorage)

    return () => {
      document.removeEventListener('cookieConsentChanged', handleConsentChange as EventListener)
      window.removeEventListener('storage', checkStorage)
      window.removeEventListener('focus', checkStorage)
    }
  }, [])

  const grantConsent = useCallback(() => {
    // Delegate to custom-consent.js if available
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const consent = (window as any).techTicketsConsent
    if (consent?.acceptAll) {
      consent.acceptAll()
    }
  }, [])

  const denyConsent = useCallback(() => {
    // Delegate to custom-consent.js if available
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const consent = (window as any).techTicketsConsent
    if (consent?.rejectAll) {
      consent.rejectAll()
    }
  }, [])

  return {
    hasConsent,
    categories,
    showBanner: false, // Banner is handled by custom-consent.js
    grantConsent,
    denyConsent,
  }
}

/**
 * Get stored consent status from localStorage
 */
function getStoredConsent(): boolean | null {
  if (typeof localStorage === 'undefined') return null

  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return null

    const consent = JSON.parse(stored)
    if (consent.consentGiven) return true
    if (consent.consentDenied) return false
    return null
  } catch {
    return null
  }
}

/**
 * Get stored consent categories from localStorage
 */
function getStoredCategories(): ConsentCategories {
  if (typeof localStorage === 'undefined') {
    return {
      necessary: true,
      analytics: true,
      marketing: true,
      functional: true,
    }
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) {
      return {
        necessary: true,
        analytics: true, // Default to true (implicit consent)
        marketing: true,
        functional: true,
      }
    }

    const consent = JSON.parse(stored)
    return consent.categories || {
      necessary: true,
      analytics: true,
      marketing: true,
      functional: true,
    }
  } catch {
    return {
      necessary: true,
      analytics: true,
      marketing: true,
      functional: true,
    }
  }
}

/**
 * Check if a specific consent category is granted
 */
export function hasConsentFor(category: keyof ConsentCategories): boolean {
  if (typeof window === 'undefined') return false

  // Check custom-consent.js first
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const consent = (window as any).techTicketsConsent
  if (consent?.hasConsent) {
    return consent.hasConsent(category)
  }

  // Fall back to storage
  const categories = getStoredCategories()
  return categories[category] ?? false
}
