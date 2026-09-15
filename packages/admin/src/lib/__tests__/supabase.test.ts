import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ auth: {} })),
}))

/**
 * The embedded mount is re-entered whenever a host router leaves the embed's
 * subtree and comes back. The module stays evaluated across that, so these
 * cover the second call rather than the first.
 */
describe('configureEmbedSupabase', () => {
  const CONFIG = { url: 'https://data.example.test', anonKey: 'anon-key', storageKeySuffix: 'lfx_embed' }

  beforeEach(() => {
    vi.resetModules()
  })

  it('accepts a repeat call with identical configuration once a client exists', async () => {
    const mod = await import('../supabase')
    mod.configureEmbedSupabase(CONFIG)
    // Force the lazy singleton into existence, as any read of `supabase` does.
    mod.getSupabase()

    // Regression: this threw, so navigating away from the embed and back
    // showed "The embedded admin module couldn't be loaded".
    expect(() => mod.configureEmbedSupabase(CONFIG)).not.toThrow()
  })

  it.each([
    ['a different project url', { ...CONFIG, url: 'https://other.example.test' }],
    ['a different anon key', { ...CONFIG, anonKey: 'other-key' }],
    ['a different storage key suffix', { ...CONFIG, storageKeySuffix: 'other_suffix' }],
  ])('still refuses %s after the client exists', async (_label, changed) => {
    const mod = await import('../supabase')
    mod.configureEmbedSupabase(CONFIG)
    mod.getSupabase()

    // The real hazard: the singleton is already built, so a differing
    // configuration cannot take effect and would strand callers silently.
    expect(() => mod.configureEmbedSupabase(changed)).toThrow(/different configuration/)
  })

  it('still allows the first configuration before any client exists', async () => {
    const mod = await import('../supabase')

    expect(() => mod.configureEmbedSupabase(CONFIG)).not.toThrow()
  })
})
