/**
 * Shared Customer.io helpers for edge functions.
 *
 * All functions are no-ops when CUSTOMERIO_SITE_ID / CUSTOMERIO_API_KEY
 * are not set, so deployments without the CIO module work without errors.
 */

const siteId = Deno.env.get('CUSTOMERIO_SITE_ID') ?? '';
const apiKey = Deno.env.get('CUSTOMERIO_API_KEY') ?? '';
const appApiKey = Deno.env.get('CUSTOMERIO_APP_API_KEY') ?? '';

/** True when the basic CIO Track API credentials are configured. */
export const isCIOConfigured = Boolean(siteId && apiKey);

/** True when the CIO App API key is also available. */
export const isCIOAppConfigured = Boolean(isCIOConfigured && appApiKey);

function authHeader(): string {
  return `Basic ${btoa(`${siteId}:${apiKey}`)}`;
}

/**
 * Create or update a customer in Customer.io via the Track API.
 * No-op if CIO is not configured.
 */
export async function upsertCIOCustomer(
  identifier: string,
  attributes: Record<string, unknown>,
): Promise<boolean> {
  if (!isCIOConfigured) return false;
  try {
    const res = await fetch(
      `https://track.customer.io/api/v1/customers/${encodeURIComponent(identifier)}`,
      {
        method: 'PUT',
        headers: {
          Authorization: authHeader(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(attributes),
      },
    );
    return res.ok;
  } catch (err) {
    console.error('[cio] upsertCIOCustomer failed:', err);
    return false;
  }
}

/**
 * Track an event for a customer in Customer.io.
 * No-op if CIO is not configured.
 */
export async function trackCIOEvent(
  identifier: string,
  eventName: string,
  data: Record<string, unknown> = {},
): Promise<boolean> {
  if (!isCIOConfigured) return false;
  try {
    const res = await fetch(
      `https://track.customer.io/api/v1/customers/${encodeURIComponent(identifier)}/events`,
      {
        method: 'POST',
        headers: {
          Authorization: authHeader(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: eventName, data }),
      },
    );
    return res.ok;
  } catch (err) {
    console.error('[cio] trackCIOEvent failed:', err);
    return false;
  }
}

/**
 * Look up a customer's cio_id via the CIO App API.
 * Returns null if CIO App API is not configured or the lookup fails.
 */
export async function lookupCIOId(email: string): Promise<string | null> {
  if (!isCIOAppConfigured) return null;
  try {
    const res = await fetch(
      `https://api.customer.io/v1/customers?email=${encodeURIComponent(email)}`,
      {
        headers: {
          Authorization: `Bearer ${appApiKey}`,
        },
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.results?.[0]?.id ?? null;
  } catch (err) {
    console.error('[cio] lookupCIOId failed:', err);
    return null;
  }
}
