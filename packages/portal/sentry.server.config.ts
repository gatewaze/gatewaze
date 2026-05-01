/**
 * Portal server-side Sentry init. Loaded automatically by
 * @sentry/nextjs in Node runtime (route handlers, RSC, middleware).
 * No-op when SENTRY_DSN is unset.
 */

import * as Sentry from '@sentry/nextjs'

const dsn = process.env.SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0'),
    initialScope: {
      tags: {
        service: 'portal-server',
        brand: process.env.BRAND ?? 'default',
      },
    },
  })
}
