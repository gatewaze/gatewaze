/**
 * Portal access resolver — resolves the signed-in user's portal RBAC into a serializable
 * `PortalAccess` the shell uses to gate the rail + public-vs-admin rendering. Spec §9.2 / §9.2a.
 *
 * Reuses the existing admin-permission RPCs (no parallel system):
 *   - admin_get_features(p_admin_id)        → explicit feature grants (incl. active portal_managers, §13.2a)
 *   - is_super_admin()                       → all-access short-circuit
 *   - admin_get_my_newsletters()             → newsletter row-scope (may not exist yet → [])
 *   - admin_get_my_assigned_events()         → event/calendar row-scope (events module)
 *
 * Must be called with an AUTHENTICATED server client (carries the user's session so auth.uid()
 * resolves inside the SECURITY DEFINER RPCs). Fails CLOSED to member-level access on error.
 *
 * INVARIANT (§9.1): `role` is descriptive only — never an authorization primitive.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export type PortalRole = 'super_admin' | 'admin' | 'editor' | 'portal_manager'

export interface NewsletterScopeEntry {
  collectionId: string
  name: string
  permissionLevel: 'view' | 'edit' | 'manage'
  permissionSource: 'super_admin' | 'direct' | 'group'
}

export interface EventScopeEntry {
  eventId?: string
  calendarId?: string
  name: string
  permissionLevel: 'view' | 'edit' | 'manage'
  permissionSource: string
}

export interface PortalAccess {
  isManager: boolean
  isSuperAdmin: boolean
  /** Active admin account of ANY role (super_admin/admin/editor via is_admin()),
   *  regardless of feature grants — used for read-only affordances like draft
   *  nav previews, never for write authorization. */
  hasAdminAccount: boolean
  /** Descriptive only — do NOT authorize on this (§13.2a). */
  role: PortalRole | null
  featureKeys: string[]
  newsletterScope: NewsletterScopeEntry[]
  eventScope: EventScopeEntry[]
  /** True when access was returned fail-closed due to a resolver error (observability, §16). */
  degraded?: boolean
}

export const ZERO_ACCESS: PortalAccess = {
  isManager: false,
  isSuperAdmin: false,
  hasAdminAccount: false,
  role: null,
  featureKeys: [],
  newsletterScope: [],
  eventScope: [],
}

type Row = Record<string, unknown>
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const level = (v: unknown): 'view' | 'edit' | 'manage' =>
  v === 'view' || v === 'manage' ? v : 'edit' // normalize (§9.1): boolean-only checks → 'edit'

/**
 * Resolve portal access for the given auth user id (null ⇒ anonymous → member-level).
 * `supabase` MUST be an authenticated (session-carrying) server client.
 */
export async function resolvePortalAccess(
  supabase: SupabaseClient,
  authUserId: string | null,
): Promise<PortalAccess> {
  if (!authUserId) return ZERO_ACCESS

  try {
    const [featuresRes, superRes, adminRes, nlRes, evRes] = await Promise.all([
      supabase.rpc('admin_get_features', { p_admin_id: authUserId }),
      supabase.rpc('is_super_admin'),
      supabase.rpc('is_admin'),
      supabase.rpc('admin_get_my_newsletters'),
      supabase.rpc('admin_get_my_assigned_events'),
    ])

    // A hard failure of the core feature RPC ⇒ fail closed (degraded), not open.
    if (featuresRes.error) {
      console.warn('[portal-access] admin_get_features failed:', featuresRes.error.message)
      return { ...ZERO_ACCESS, degraded: true }
    }

    const featureKeys = Array.isArray(featuresRes.data)
      ? (featuresRes.data as Row[]).map((r) => str(r.feature)).filter((f): f is string => !!f)
      : []

    const isSuperAdmin = superRes.data === true
    // Best-effort: an error here only loses a read-only affordance.
    const hasAdminAccount = isSuperAdmin || adminRes.data === true

    // Row-scope RPCs are best-effort: the newsletters one may not exist yet (PGRST202 → error).
    const newsletterScope: NewsletterScopeEntry[] =
      !nlRes.error && Array.isArray(nlRes.data)
        ? (nlRes.data as Row[])
            .map((r) => ({
              collectionId: str(r.collection_id) ?? '',
              name: str(r.name) ?? '',
              permissionLevel: level(r.permission_level),
              permissionSource: (str(r.permission_source) as NewsletterScopeEntry['permissionSource']) ?? 'direct',
            }))
            .filter((n) => n.collectionId)
        : []

    const eventScope: EventScopeEntry[] =
      !evRes.error && Array.isArray(evRes.data)
        ? (evRes.data as Row[]).map((r) => ({
            eventId: str(r.event_id) ?? str(r.id),
            calendarId: str(r.calendar_id),
            name: str(r.name) ?? str(r.title) ?? '',
            permissionLevel: level(r.permission_level),
            permissionSource: str(r.permission_source) ?? 'direct',
          }))
        : []

    const isManager =
      isSuperAdmin || featureKeys.length > 0 || newsletterScope.length > 0 || eventScope.length > 0

    return {
      isManager,
      isSuperAdmin,
      hasAdminAccount,
      // descriptive only; we don't fetch the literal role (not load-bearing — §9.1)
      role: isSuperAdmin ? 'super_admin' : isManager ? 'portal_manager' : null,
      featureKeys,
      newsletterScope,
      eventScope,
    }
  } catch (err) {
    console.warn('[portal-access] resolver error, failing closed:', err)
    return { ...ZERO_ACCESS, degraded: true }
  }
}
