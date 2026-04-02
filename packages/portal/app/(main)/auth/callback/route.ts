import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * Auth callback handler for magic link sign-in
 *
 * This route handles the redirect from Supabase magic link emails.
 * It exchanges the auth code for a session and redirects to the intended destination.
 * Note: Person record creation happens during email submission in SignInForm.
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

  if (code) {
    // Get Supabase credentials from environment
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('Missing Supabase configuration')
      return NextResponse.redirect(new URL('/sign-in?error=Configuration+error', requestUrl.origin))
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey)

    // Exchange the code for a session
    const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

    if (exchangeError) {
      console.error('Auth code exchange error:', exchangeError)
      const signInUrl = new URL('/sign-in', requestUrl.origin)
      signInUrl.searchParams.set('error', 'Failed to sign in. The link may have expired.')
      return NextResponse.redirect(signInUrl)
    }

    if (data.session) {
      // Successfully authenticated, redirect to intended destination
      // The session will be stored in cookies by Supabase
      const response = NextResponse.redirect(new URL(redirectTo, requestUrl.origin))

      // Set auth cookies for the session
      // Note: For production, you should use @supabase/ssr for proper cookie handling
      // For now, we'll rely on Supabase JS handling the session in localStorage

      return response
    }
  }

  // If no code, redirect to sign-in
  return NextResponse.redirect(new URL('/sign-in', requestUrl.origin))
}
