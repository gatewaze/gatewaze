'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

export function InviteRsvpBanner() {
  const [shortCode, setShortCode] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const code = localStorage.getItem('invite_short_code')
    if (code) setShortCode(code)
  }, [])

  if (!shortCode || dismissed) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-xs animate-in fade-in slide-in-from-bottom-2">
      <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center">
            <svg className="w-4 h-4 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900">Your RSVP</p>
            <p className="text-xs text-gray-500 mt-0.5">View or edit your response</p>
            <Link
              href={`/i/${shortCode}`}
              className="inline-block mt-2 text-xs font-medium text-indigo-600 hover:text-indigo-800"
            >
              Open RSVP &rarr;
            </Link>
          </div>
          <button
            onClick={() => {
              setDismissed(true)
              localStorage.removeItem('invite_short_code')
            }}
            className="flex-shrink-0 text-gray-400 hover:text-gray-600 cursor-pointer"
            aria-label="Dismiss"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
