/**
 * Portal client-side Sentry init. Loaded automatically by
 * @sentry/nextjs in the browser bundle. No-op when SENTRY_DSN is
 * unset.
 *
 * Region: US for all brands per spec OQ #2.
 */

import * as Sentry from '@sentry/nextjs'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
    tracesSampleRate: parseFloat(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? '0'),
    initialScope: {
      tags: {
        service: 'portal-client',
        brand: process.env.NEXT_PUBLIC_BRAND ?? 'default',
      },
    },
  })
}
