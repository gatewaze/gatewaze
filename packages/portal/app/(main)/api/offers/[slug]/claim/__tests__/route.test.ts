import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// Pins the shared-offer claim route: input is validated before the RPC is
// called, only the RPC's own statuses map to responses, the code is only
// returned for 'claimed', and the per-IP limit holds.

const rpc = vi.fn()
// people lookup: from('people').select().eq().not().limit() -> { data }
let existingPeople: unknown[] = []
let lastPattern = ''
const from = vi.fn(() => {
  const q = {
    select: () => q,
    eq: () => q,
    ilike: (_col: string, pattern: string) => { lastPattern = pattern; return q },
    not: () => q,
    limit: async () => ({ data: existingPeople, error: null }),
  }
  return q
})
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ rpc, from }),
}))

// Run after() callbacks inline so the test can await their effect.
const pending: Promise<unknown>[] = []
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: (fn: () => unknown) => { pending.push(Promise.resolve(fn())) } }
})
const fetchMock = vi.fn()

import { POST } from '../route'

let ipCounter = 0
function call(slug: string, body: unknown, ip?: string) {
  const req = new NextRequest(`http://app.test/api/offers/${slug}/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip ?? `10.0.0.${++ipCounter}` },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  return POST(req, { params: Promise.resolve({ slug }) })
}

describe('POST /api/offers/[slug]/claim', () => {
  beforeEach(() => {
    vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key')
    rpc.mockReset()
    existingPeople = []
    pending.length = 0
    fetchMock.mockReset().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('creates the person and auth user for a new address through people-signup, without a magic link', async () => {
    rpc.mockResolvedValue({ data: [{ status: 'claimed', code: 'FREE2026' }], error: null })
    const res = await call('free-tickets', { email: 'New@Example.com' }, '198.51.100.7')
    expect(res.status).toBe(200)
    await Promise.all(pending)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://project.supabase.co/functions/v1/people-signup')
    const body = JSON.parse(init.body)
    expect(body).toEqual({ email: 'new@example.com', source: 'discount_offer_claim' })
    expect(body).not.toHaveProperty('app') // app: 'portal' would send a magic link
    expect(init.headers['x-forwarded-for']).toBe('198.51.100.7')
  })

  it('escapes LIKE wildcards in the existing-person lookup', async () => {
    rpc.mockResolvedValue({ data: [{ status: 'claimed', code: 'FREE2026' }], error: null })
    await call('free-tickets', { email: 'first_last@example.com' })
    await Promise.all(pending)
    expect(lastPattern).toBe('first\\_last@example.com')
  })

  it('does not forward a forwarded-for value that is not an IP address', async () => {
    rpc.mockResolvedValue({ data: [{ status: 'claimed', code: 'FREE2026' }], error: null })
    await call('free-tickets', { email: 'new@example.com' }, 'not-an-ip')
    await Promise.all(pending)
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('x-forwarded-for')
  })

  it('leaves a known person with an auth user alone', async () => {
    existingPeople = [{ id: 'p1' }]
    rpc.mockResolvedValue({ data: [{ status: 'claimed', code: 'FREE2026' }], error: null })
    await call('free-tickets', { email: 'known@example.com' })
    await Promise.all(pending)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('creates nobody when the claim is refused', async () => {
    rpc.mockResolvedValue({ data: [{ status: 'closed', code: null }], error: null })
    await call('free-tickets', { email: 'new@example.com' })
    await Promise.all(pending)
    expect(pending).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns the code and passes a normalised email to the RPC', async () => {
    rpc.mockResolvedValue({ data: [{ status: 'claimed', code: 'FREE2026' }], error: null })
    const res = await call('free-tickets', { email: '  Person@Example.COM ' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ code: 'FREE2026' })
    expect(rpc).toHaveBeenCalledWith('events_claim_shared_offer', {
      p_slug: 'free-tickets',
      p_email: 'person@example.com',
      p_source: 'offer-page',
    })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it.each([
    ['closed', 410],
    ['bad_email', 400],
    ['not_found', 404],
    ['something_else', 404],
  ])('maps RPC status %s to %i without a code', async (status, http) => {
    rpc.mockResolvedValue({ data: [{ status, code: 'LEAKED' }], error: null })
    const res = await call('free-tickets', { email: 'a@b.co' })
    expect(res.status).toBe(http)
    expect(await res.json()).not.toHaveProperty('code')
  })

  it.each([
    ['an invalid slug', '../admin', { email: 'a@b.co' }, 404],
    ['an uppercase slug', 'Free-Tickets', { email: 'a@b.co' }, 404],
    ['no email', 'free-tickets', {}, 400],
    ['a malformed email', 'free-tickets', { email: 'not-an-email' }, 400],
    ['an address with PostgREST filter characters', 'free-tickets', { email: 'a@b.co,id.not.is.null' }, 400],
    ['an address with a wildcard', 'free-tickets', { email: 'a%@b.co' }, 400],
    ['a non-JSON body', 'free-tickets', 'email=a@b.co', 400],
  ])('rejects %s before calling the RPC', async (_label, slug, body, http) => {
    const res = await call(slug, body)
    expect(res.status).toBe(http)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('hides RPC errors', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'relation does not exist' } })
    const res = await call('free-tickets', { email: 'a@b.co' })
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('relation')
  })

  it('rate-limits one IP after 20 requests a minute', async () => {
    rpc.mockResolvedValue({ data: [{ status: 'claimed', code: 'X' }], error: null })
    const statuses: number[] = []
    for (let i = 0; i < 21; i++) statuses.push((await call('free-tickets', { email: 'a@b.co' }, '203.0.113.9')).status)
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true)
    expect(statuses[20]).toBe(429)
  })
})
