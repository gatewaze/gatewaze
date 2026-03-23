/**
 * Cvent REST API client
 *
 * Handles OAuth token management and the three API calls needed to register
 * an attendee:
 *   1. findOrCreateContact  – upsert a person by email
 *   2. addAttendee          – register the contact for an event
 *   3. listAdmissionItems   – used by the admin UI to populate the dropdown
 *
 * Credentials are expected as environment variables:
 *   CVENT_CLIENT_ID
 *   CVENT_CLIENT_SECRET
 */

const CVENT_BASE = 'https://api-platform.cvent.com/ea'
const TOKEN_URL = `${CVENT_BASE}/oauth2/token`

// ---------------------------------------------------------------------------
// Token cache (per-isolate, reused across requests in the same Edge runtime)
// ---------------------------------------------------------------------------
let _cachedToken: string | null = null
let _tokenExpiresAt = 0

async function getToken(clientId: string, clientSecret: string): Promise<string> {
  const now = Date.now()
  if (_cachedToken && now < _tokenExpiresAt - 30_000) {
    return _cachedToken
  }

  const credentials = btoa(`${clientId}:${clientSecret}`)
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}`,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Cvent OAuth failed (${res.status}): ${text}`)
  }

  const json = await res.json()
  _cachedToken = json.access_token as string
  // expires_in is in seconds; default to 3600 if missing
  _tokenExpiresAt = now + (json.expires_in ?? 3600) * 1000
  console.log(`Cvent OAuth token obtained | length: ${_cachedToken!.length} | token_type: ${json.token_type} | token_format: ${json.token_type === 'Bearer' ? 'JWT' : 'opaque'}`)
  return _cachedToken!
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function cventFetch(
  path: string,
  method: 'GET' | 'POST' | 'PATCH',
  token: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; data: any }> {
  // NOTE: Cvent's API Gateway has a 10,240-byte total header limit. Their OAuth
  // JWT embeds scope claims making the token large. We keep headers minimal.
  // Content-Type is only sent for POST/PATCH (required for Cvent to parse JSON body).
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  }
  if (method === 'POST' || method === 'PATCH') {
    headers['Content-Type'] = 'application/json'
  }

  console.log(`Cvent API ${method} ${path} | token length: ${token.length}`)

  const res = await fetch(`${CVENT_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  let data: any = null
  const text = await res.text()
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { raw: text }
  }

  // 413 = Cvent's API Gateway rejects the request because the OAuth JWT
  // exceeds its 10,240-byte total header limit.
  if (res.status === 413) {
    let scopeCount = 'unknown'
    try {
      const parts = token.split('.')
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
        const scp = payload.scp
        scopeCount = String(Array.isArray(scp) ? scp.length : scp ? 1 : 0)
      }
    } catch { /* ignore */ }
    data = {
      raw: `Cvent API Gateway header size limit exceeded. The OAuth token has ${scopeCount} scope `
        + `claims making it ${token.length} bytes — too large for their infrastructure. `
        + 'Please contact Cvent support and ask them to increase their API Gateway header '
        + 'size limit or configure shorter tokens for this OAuth client.',
    }
  }

  return { ok: res.ok, status: res.status, data }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CventContact {
  id: string
  firstName?: string
  lastName?: string
  primaryEmail?: string
}

export interface CventAdmissionItem {
  id: string
  name: string
  code?: string
}

export interface CventSyncResult {
  success: boolean
  error?: string
  contactId?: string
  attendeeId?: string
  action?: 'created' | 'already_exists' | 'updated'
}

/**
 * Find an existing Cvent contact by email, or create one if not found.
 */
export async function findOrCreateContact(
  token: string,
  email: string,
  firstName?: string,
  lastName?: string
): Promise<{ success: boolean; error?: string; contactId?: string }> {
  // Search for existing contact by primary email
  const searchRes = await cventFetch('/contacts/search', 'POST', token, {
    filter: `primaryEmail eq '${email}'`,
    fields: ['id', 'firstName', 'lastName', 'primaryEmail'],
  })

  if (!searchRes.ok) {
    return {
      success: false,
      error: `contacts/search failed (${searchRes.status}): ${JSON.stringify(searchRes.data)}`,
    }
  }

  if (searchRes.data?.data?.length > 0) {
    const contact = searchRes.data.data[0] as CventContact
    // Update name fields if we have them and they're missing
    if ((firstName || lastName) && (!contact.firstName || !contact.lastName)) {
      await cventFetch(`/contacts/${contact.id}`, 'PATCH', token, {
        firstName: firstName || contact.firstName,
        lastName: lastName || contact.lastName,
      })
    }
    return { success: true, contactId: contact.id }
  }

  // Create new contact
  const createRes = await cventFetch('/contacts', 'POST', token, {
    primaryEmail: email,
    firstName: firstName || '',
    lastName: lastName || '',
  })

  if (!createRes.ok) {
    return {
      success: false,
      error: `Failed to create Cvent contact (${createRes.status}): ${JSON.stringify(createRes.data)}`,
    }
  }

  const newContact = createRes.data as CventContact
  return { success: true, contactId: newContact.id }
}

/**
 * Register a contact as an attendee for a Cvent event.
 * Idempotent – returns success even if already registered.
 */
export async function addAttendee(
  token: string,
  cventEventId: string,
  contactId: string,
  admissionItemId: string
): Promise<CventSyncResult> {
  const res = await cventFetch(`/events/${cventEventId}/attendees`, 'POST', token, {
    contactId,
    admissionItemId,
    status: 'Accepted',
  })

  if (res.ok) {
    return { success: true, contactId, attendeeId: res.data?.id, action: 'created' }
  }

  // 409 Conflict = already registered
  if (res.status === 409) {
    return { success: true, contactId, action: 'already_exists' }
  }

  return {
    success: false,
    error: `Failed to add attendee (${res.status}): ${JSON.stringify(res.data)}`,
  }
}

/**
 * List admission items for a Cvent event (for the admin UI dropdown).
 */
export async function listAdmissionItems(
  clientId: string,
  clientSecret: string,
  cventEventId: string
): Promise<{ success: boolean; error?: string; items?: CventAdmissionItem[] }> {
  let token: string
  try {
    token = await getToken(clientId, clientSecret)
  } catch (err: any) {
    return { success: false, error: err.message }
  }

  const res = await cventFetch(`/events/${cventEventId}/admission-items`, 'GET', token)

  if (!res.ok) {
    return {
      success: false,
      error: `Failed to list admission items (${res.status}): ${JSON.stringify(res.data)}`,
    }
  }

  const items = (res.data?.data ?? res.data ?? []) as CventAdmissionItem[]
  return { success: true, items }
}

/**
 * Sync a single registrant to Cvent.
 * Handles the full flow: get token → find/create contact → add attendee.
 */
export async function syncRegistrantToCvent(
  clientId: string,
  clientSecret: string,
  cventEventId: string,
  admissionItemId: string,
  email: string,
  firstName?: string,
  lastName?: string
): Promise<CventSyncResult> {
  let token: string
  try {
    token = await getToken(clientId, clientSecret)
  } catch (err: any) {
    return { success: false, error: err.message }
  }

  const contactResult = await findOrCreateContact(token, email, firstName, lastName)
  if (!contactResult.success || !contactResult.contactId) {
    return { success: false, error: contactResult.error }
  }

  const attendeeResult = await addAttendee(token, cventEventId, contactResult.contactId, admissionItemId)
  return { ...attendeeResult, contactId: contactResult.contactId }
}
