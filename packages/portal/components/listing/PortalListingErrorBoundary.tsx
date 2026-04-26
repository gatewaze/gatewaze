/**
 * Server-rendered error UI for portal listing SSR failures.
 *
 * Behaves like a Next.js error.tsx but is invoked synchronously from a
 * Server Component (try/catch around `loader.load`) so the SSR snapshot
 * captures a coherent error page rather than a partial layout. Brand
 * chrome stays intact thanks to the layout wrapping every page.
 */

import Link from 'next/link';

interface Props {
  error: unknown;
  /** Path to retry. Defaults to current pathname (caller passes it in). */
  retryHref?: string;
  /** Optional fallback link (e.g. brand home). */
  homeHref?: string;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'error' in err) {
    const inner = (err as { error?: { message?: string } }).error;
    if (inner?.message) return inner.message;
  }
  return 'Unknown error';
}

export function PortalListingErrorBoundary({ error, retryHref, homeHref = '/' }: Props) {
  if (process.env.NODE_ENV !== 'production') {
    console.error('[PortalListingErrorBoundary]', error);
  }
  const message = describeError(error);
  return (
    <div className="max-w-2xl mx-auto px-6 py-16 text-center">
      <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/10 flex items-center justify-center">
        <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m0-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.75c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285zm0 13.036h.008v.008H12v-.008z" />
        </svg>
      </div>
      <h1 className="text-2xl text-white/90" style={{ fontWeight: 'var(--font-weight-heading, 600)' }}>
        We couldn&apos;t load this list right now
      </h1>
      <p className="mt-2 text-sm text-white/50">
        {message}
      </p>
      <div className="mt-6 flex justify-center gap-3">
        {retryHref ? (
          <Link
            href={retryHref}
            className="px-4 py-2 text-sm font-medium text-white/80 hover:text-white bg-white/10 hover:bg-white/15 transition-colors"
            style={{ borderRadius: 'var(--radius-control)' }}
          >
            Retry
          </Link>
        ) : null}
        <Link
          href={homeHref}
          className="px-4 py-2 text-sm font-medium text-white/60 hover:text-white/90 bg-transparent border border-white/15 hover:border-white/30 transition-colors"
          style={{ borderRadius: 'var(--radius-control)' }}
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
