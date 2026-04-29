'use client'

import { useEffect } from 'react'

/**
 * Route-segment error boundary for the (bare) layout (login, RSVP,
 * etc). Smaller fallback UI since (bare) pages have no header/footer.
 * Spec §7.4 task 4.10.
 */

export default function BareErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[bare/error] boundary caught:', error)
  }, [error])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-12">
      <h1 className="text-xl font-semibold text-white mb-2">Something went wrong.</h1>
      <p className="text-white/70 max-w-md text-center mb-6">
        An unexpected error stopped this page from loading.
      </p>
      <button
        onClick={reset}
        className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-white border border-white/20"
        type="button"
      >
        Try again
      </button>
      {error.digest && (
        <p className="mt-6 text-xs text-white/40 font-mono">Error ref: {error.digest}</p>
      )}
    </div>
  )
}
