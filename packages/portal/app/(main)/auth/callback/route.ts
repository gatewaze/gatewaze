import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Auth callback handler for magic link sign-in.
 *
 * This route handles the redirect from Supabase magic link emails.
 * It exchanges the auth code for a session and writes the session cookies
 * back on the redirect response so the browser stays signed in.
 *
 * Uses @supabase/ssr's createServerClient with full cookie handlers so
 * the session is persisted to HTTP cookies (not just localStorage) —
 * that's what makes the subsequent page render see the user as signed in.
 */
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const redirectTo = requestUrl.searchParams.get('redirectTo') || '/'
  const error = requestUrl.searchParams.get('error')
  const errorDescription = requestUrl.searchParams.get('error_description')

  // Handle error from Supabase (e.g., expired link)
  if (error) {
    const signInUrl = new URL('/sign-in', requestUrl.origin)
    signInUrl.searchParams.set('error', errorDescription || error)
    return NextResponse.redirect(signInUrl)
  }

  if (!code) {
    // No code — nothing to do, send them to sign-in
    return NextResponse.redirect(new URL('/sign-in', requestUrl.origin))
  }

  // Public URL used for cookie storage key so the browser's cookies match
  // what the client will look for on subsequent requests.
  const publicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  // Internal URL used for the actual REST calls (container-to-container)
  const internalUrl = process.env.SUPABASE_URL || publicUrl

  if (!publicUrl || !anonKey) {
    console.error('[auth/callback] Missing Supabase configuration')
    return NextResponse.redirect(new URL('/sign-in?error=Configuration+error', requestUrl.origin))
  }

  // We need to capture cookies Supabase sets during exchangeCodeForSession
  // and attach them to our redirect response so the browser stores them.
  // Build the response first, then pass its cookie jar to the Supabase client.
  const response = NextResponse.redirect(new URL(redirectTo, requestUrl.origin))
  const cookieStore = await cookies()

  const supabase = createServerClient(publicUrl, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          try {
            cookieStore.set(name, value, options)
          } catch {
            // Ignore — cookieStore.set may throw in read-only contexts
          }
          // Also write to the response so the browser actually stores them.
          response.cookies.set({ name, value, ...options })
        })
      },
    },
    // Rewrite REST/auth requests to the internal URL when it differs from
    // the public URL (common in Docker setups where the portal reaches
    // supabase via supabase-kong:8000 internally but the browser uses a
    // traefik hostname).
    ...(internalUrl !== publicUrl
      ? {
          global: {
            fetch: (input: RequestInfo | URL, init?: RequestInit) => {
              const url =
                typeof input === 'string'
                  ? input
                  : input instanceof URL
                    ? input.toString()
                    : input.url
              const rewritten = url.replace(publicUrl, internalUrl!)
              return fetch(rewritten, init)
            },
          },
        }
      : {}),
  })

  // Exchange the code for a session — setAll() above will write the cookies.
  const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

  if (exchangeError) {
    console.error('[auth/callback] Auth code exchange error:', exchangeError)
    const signInUrl = new URL('/sign-in', requestUrl.origin)
    signInUrl.searchParams.set('error', 'Failed to sign in. The link may have expired.')
    return NextResponse.redirect(signInUrl)
  }

  if (!data.session) {
    console.error('[auth/callback] exchangeCodeForSession returned no session')
    return NextResponse.redirect(new URL('/sign-in?error=Session+not+created', requestUrl.origin))
  }

  console.log(`[auth/callback] signed in user ${data.session.user.email}, redirecting to ${redirectTo}`)
  return response
}
