import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createServerTracker = vi.fn((_config: Record<string, unknown>) => ({ track: vi.fn(), page: vi.fn(), identify: vi.fn() }))
vi.mock('@gatewaze/tracking/server', () => ({ createServerTracker }))

const WRAPPER = 'https://lfx-segment.platform.linuxfoundation.org/latest/lfx-segment-analytics.min.js'

async function trackerConfig(kind: 'server' | 'relay') {
  const mod = await import('./server-tracking')
  if (kind === 'server') mod.getServerTracker()
  else mod.getRelayTracker()
  return createServerTracker.mock.calls[0][0]
}

describe('getServerTracker Segment leg', () => {
  beforeEach(() => {
    vi.resetModules()
    createServerTracker.mockClear()
    vi.stubEnv('SEGMENT_WRITE_KEY', 'server-wk')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('keeps the relay Segment leg when the LF wrapper is not configured', async () => {
    vi.stubEnv('LFX_SEGMENT_CDN_URL', '')
    expect((await trackerConfig('relay')).segmentWriteKey).toBe('server-wk')
  })

  it('turns the relay Segment leg off when the LF wrapper sends from the browser', async () => {
    vi.stubEnv('LFX_SEGMENT_CDN_URL', WRAPPER)
    expect((await trackerConfig('relay')).segmentWriteKey).toBeUndefined()
  })

  it('keeps Segment for server-originated events (RSVP Submitted) even with the wrapper on', async () => {
    vi.stubEnv('LFX_SEGMENT_CDN_URL', WRAPPER)
    expect((await trackerConfig('server')).segmentWriteKey).toBe('server-wk')
  })
})
