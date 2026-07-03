/**
 * Build the sign-in URL, carrying the page the user is on so they return to it
 * after authenticating. Works for both auth flows: magic-link (redirectTo query
 * param on the callback) and LFID (the button stores it in localStorage before
 * the Auth0 hop; the sign-in page honours it when the session lands).
 */
export function signInHref(pathname: string | null | undefined): string {
  const path = pathname && pathname !== '/' && pathname.startsWith('/') ? pathname : ''
  return `/sign-in?sso=1${path ? `&redirectTo=${encodeURIComponent(path)}` : ''}`
}
