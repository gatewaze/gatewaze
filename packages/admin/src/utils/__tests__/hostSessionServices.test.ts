import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The real lib/supabase in host-session mode, with fetch stubbed: checks the
// services that build URLs or sign out against it.
const toastError = vi.fn()
vi.mock('sonner', () => ({ toast: { error: (...args: unknown[]) => toastError(...args) } }))

beforeEach(() => {
  vi.resetModules()
  toastError.mockClear()
  vi.stubEnv('VITE_AUTH_MODE', 'host-session')
  vi.stubEnv('VITE_SUPABASE_URL', window.location.origin)
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
  vi.stubEnv('VITE_SUPABASE_PUBLIC_URL', 'https://project.supabase.co')
  vi.stubEnv('VITE_SLACK_CLIENT_ID', 'slack-client')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('OAuth URLs in host-session mode', () => {
  it('Slack redirect_uri uses the real Supabase URL', async () => {
    const { getSlackOAuthUrl } = await import('../slackService')

    const url = new URL(getSlackOAuthUrl('event-1'))

    expect(url.searchParams.get('redirect_uri')).toBe('https://project.supabase.co/functions/v1/slack-oauth-callback')
  })

  it('Google Sheets authorize URL uses the real Supabase URL', async () => {
    const { getGoogleOAuthUrl } = await import('../googleSheetsService')

    const url = getGoogleOAuthUrl('event-1', 'registration' as never, 'https://admin.example/x')

    expect(url.startsWith('https://project.supabase.co/functions/v1/google-sheets-oauth/authorize?')).toBe(true)
  })
})

describe('SupabaseAuthService.signOut', () => {
  it('host-session: a failed logout POST is surfaced, not reported as success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    const { SupabaseAuthService } = await import('../supabaseAuth')

    const { error } = await SupabaseAuthService.signOut()

    expect(error).toMatch(/500/)
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('Sign-out did not complete'))
  })

  it('host-session: a successful logout shows no error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })))
    const { SupabaseAuthService } = await import('../supabaseAuth')

    await expect(SupabaseAuthService.signOut()).resolves.toEqual({ error: null })
    expect(toastError).not.toHaveBeenCalled()
  })
})
