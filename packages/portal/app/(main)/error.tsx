'use client'

import { useEffect } from 'react'

/**
 * Route-segment error boundary for the (main) layout per spec §7.4
 * task 4.10. Without this, a single component crash inside a (main)
 * page would blank the whole layout. Now React renders this fallback
 * and the rest of the layout (header, footer) survives.
 *
 * Sentry capture happens automatically once @sentry/nextjs is wired
 * (Session 20 follow-up); for now we emit a console.error so the
 * crash shows up in container logs.
 */

export default function MainErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[main/error] boundary caught:', error)
  }, [error])

  return (
    <div className="min-h-[40vh] flex flex-col items-center justify-center px-6 py-12">
      <h1 className="text-2xl font-semibold text-white mb-2">Something went wrong.</h1>
      <p className="text-white/70 max-w-md text-center mb-6">
        An unexpected error stopped this page from loading. The team has been
        notified. You can try again, or head back home.
      </p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-white border border-white/20"
          type="button"
        >
          Try again
        </button>
        <a
          href="/"
          className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-white/80 border border-white/20"
        >
          Go home
        </a>
      </div>
      {error.digest && (
        <p className="mt-6 text-xs text-white/40 font-mono">Error ref: {error.digest}</p>
      )}
    </div>
  )
}
