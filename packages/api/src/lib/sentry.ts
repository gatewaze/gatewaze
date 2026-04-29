/**
 * Sentry initialisation for the API, worker, and scheduler entrypoints.
 *
 * The DSN is opt-in: if SENTRY_DSN is unset, every export below is a
 * no-op. This keeps the SDK out of the request path for self-host
 * operators who don't run Sentry. With the DSN set, Sentry captures
 * uncaughtException / unhandledRejection automatically and surfaces
 * Pino-logged errors when the integration's tags are attached.
 *
 * The `code` field on ApiError instances (lib/errors.ts) is propagated
 * as a Sentry tag so alerts can filter on `internal_error` only,
 * avoiding noise from `rate_limited` or `validation_failed`.
 *
 * Region: US for all brands per resolved spec OQ #2.
 *
 * Required env:
 *   SENTRY_DSN          — set to enable
 *   SENTRY_ENVIRONMENT  — staging | production | self-host (defaults
 *                         to NODE_ENV)
 *   SENTRY_RELEASE      — image tag or git SHA (recommended)
 */

import * as Sentry from '@sentry/node';

let initialized = false;

interface InitOptions {
  service: 'api' | 'worker' | 'scheduler';
}

export function initSentry({ service }: InitOptions): void {
  if (initialized) return;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'unknown',
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0'),
    initialScope: {
      tags: {
        service,
        brand: process.env.BRAND ?? 'default',
      },
    },
    // Don't capture rate-limited / validation failures by default —
    // they're expected.
    beforeSend(event) {
      const code = event.tags?.['error.code'];
      if (code === 'rate_limited' || code === 'validation_failed') return null;
      return event;
    },
  });

  initialized = true;
}

export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (!initialized) return;
  Sentry.captureException(err, context ? { extra: context } : undefined);
}

/**
 * Wires uncaughtException + unhandledRejection handlers. Both log via
 * Pino (caller-supplied), report to Sentry if initialised, then exit
 * non-zero so the process manager (k8s/PM2) can restart the process.
 *
 * Call once per Node entrypoint, after Pino has been initialised.
 */
export function installCrashHandlers(opts: {
  log: (level: 'error', obj: object, msg: string) => void;
  flushTimeoutMs?: number;
}): void {
  const flushMs = opts.flushTimeoutMs ?? 2000;

  process.on('uncaughtException', (err: Error) => {
    opts.log('error', { err: { message: err.message, stack: err.stack } }, 'uncaught exception');
    captureException(err, { source: 'uncaughtException' });
    if (initialized) Sentry.flush(flushMs).finally(() => process.exit(1));
    else process.exit(1);
  });

  process.on('unhandledRejection', (reason: unknown) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    opts.log('error', { err: { message: err.message, stack: err.stack } }, 'unhandled rejection');
    captureException(err, { source: 'unhandledRejection' });
    if (initialized) Sentry.flush(flushMs).finally(() => process.exit(1));
    else process.exit(1);
  });
}

export { Sentry };
