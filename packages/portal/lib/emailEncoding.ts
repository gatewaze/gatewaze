const PASSPHRASE = 'HideMe'

/**
 * Encode an email address using XOR with passphrase + Base64 (URL-safe).
 * Matches the encoding used in gatewaze-frontend.
 */
export function encodeEmail(email: string): string {
  if (!email) return ''
  const emailLower = email.toLowerCase()
  const bytes: number[] = []
  for (let i = 0; i < emailLower.length; i++) {
    bytes.push(emailLower.charCodeAt(i) ^ PASSPHRASE.charCodeAt(i % PASSPHRASE.length))
  }
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

/**
 * Decode an encoded email string (XOR with passphrase + Base64 URL-safe).
 * Returns the decoded email or null if decoding fails.
 */
export function decodeEmail(encoded: string): string | null {
  if (!encoded) return null
  try {
    // Restore standard Base64 characters
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
    // Add padding if needed
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const decoded = atob(padded)
    const bytes: string[] = []
    for (let i = 0; i < decoded.length; i++) {
      bytes.push(String.fromCharCode(decoded.charCodeAt(i) ^ PASSPHRASE.charCodeAt(i % PASSPHRASE.length)))
    }
    const result = bytes.join('')
    // Basic email validation
    if (result.includes('@') && result.includes('.')) {
      return result
    }
    return null
  } catch {
    return null
  }
}

/**
 * Extract an email address from URL search params.
 * Checks `email=`, `utm_medium=`, and `e=` parameters.
 * Decodes encoded values automatically.
 */
export function getEmailFromParams(searchParams: URLSearchParams): string | null {
  // Direct email parameter
  const email = searchParams.get('email')
  if (email && email.includes('@')) {
    return email.toLowerCase().trim()
  }

  // Encoded email in utm_medium (from Customer.io email_encoded attribute)
  const utmMedium = searchParams.get('utm_medium')
  if (utmMedium) {
    const decoded = decodeEmail(utmMedium)
    if (decoded) return decoded
  }

  // Shorthand encoded email parameter
  const e = searchParams.get('e')
  if (e) {
    const decoded = decodeEmail(e)
    if (decoded) return decoded
  }

  return null
}
