/**
 * Admin-side Sentry init. Mirrors the API-side wrapper
 * (packages/api/src/lib/sentry.ts) — opt-in, no-op when DSN unset.
 *
 * Vite exposes env vars prefixed VITE_*; the build pipeline must set
 * VITE_SENTRY_DSN at deploy time. The default (unset) keeps Sentry
 * out of the bundle's runtime path entirely.
 *
 * Region: US for all brands per resolved spec OQ #2.
 */

import * as Sentry from '@sentry/react'

let initialized = false

export function initSentry(): void {
  if (initialized) return
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined
  if (!dsn) return

  Sentry.init({
    dsn,
    environment: (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined) ?? import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE as string | undefined,
    tracesSampleRate: parseFloat(
      (import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE as string | undefined) ?? '0',
    ),
    initialScope: {
      tags: {
        service: 'admin',
        brand: (import.meta.env.VITE_BRAND as string | undefined) ?? 'default',
      },
    },
  })

  initialized = true
}

export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (!initialized) return
  Sentry.captureException(err, context ? { extra: context } : undefined)
}

export { Sentry }
