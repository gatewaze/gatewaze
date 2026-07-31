import { NextRequest, NextResponse } from 'next/server'

/**
 * Public short-link redirect: https://<this-host>/go/<slug>
 *
 * Slugs are scoped PER HOST: the backing Umami link's slug is
 * `${host}--${slug}` (minted by POST /api/redirects/create-bulk), so
 * the portal and every sites-module site get independent slug spaces
 * while sharing this one route — a custom-domain site resolves its own
 * links simply because the Host header differs.
 *
 * Resolution is deterministic (host + slug → internal slug), so no DB
 * lookup happens here; the analytics module's /a/q proxy does the
 * actual Umami lookup and click recording. Client IP + UA are
 * forwarded so click sessions get real geo/device attribution.
 */

const API_URL = (
  process.env.GATEWAZE_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  ''
).replace(/\/+$/, '')

const SLUG_RE = /^[A-Za-z0-9._~-]{1,80}$/

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  if (!API_URL || !SLUG_RE.test(slug)) {
    return new NextResponse('Not found', { status: 404 })
  }
  const host = (req.headers.get('x-forwarded-host') || req.headers.get('host') || '')
    .split(':')[0]
    .toLowerCase()

  const headers: Record<string, string> = {
    'X-Forwarded-For': req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '',
    'User-Agent': req.headers.get('user-agent') ?? '',
    ...(req.headers.get('referer') ? { Referer: req.headers.get('referer') as string } : {}),
  }

  // Host-scoped slug first; bare slug as fallback for links minted
  // before host scoping (or hand-created directly in Umami).
  for (const internal of [`${host}--${slug}`, slug]) {
    try {
      const upstream = await fetch(`${API_URL}/a/q/${encodeURIComponent(internal)}`, {
        headers,
        redirect: 'manual',
      })
      const location = upstream.headers.get('location')
      if (upstream.status >= 300 && upstream.status < 400 && location) {
        return NextResponse.redirect(location, { status: 307, headers: { 'Cache-Control': 'no-store' } })
      }
    } catch {
      /* fall through */
    }
  }
  return new NextResponse('Not found', { status: 404 })
}
