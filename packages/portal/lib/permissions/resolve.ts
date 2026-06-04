/**
 * Portal access resolver — resolves the signed-in user's portal RBAC into a serializable
 * `PortalAccess` the shell uses to gate the rail + public-vs-admin rendering.
 *
 * PHASE 2 STATUS: this returns member-level (zero-grant) access for everyone. The real
 * implementation (Phase 3, spec §9.2/§9.2a) resolves the `admin_profiles` row + calls
 * `admin_get_features` / `admin_get_my_newsletters` / `admin_get_my_assigned_events`, with the
 * anonymous fast-path and request-scoped memoization. Kept here so the shell + access mapper are
 * built against the final shape now and Phase 3 is a drop-in.
 *
 * INVARIANT (spec §9.1): `role` is descriptive only — never an authorization primitive.
 */

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
  role: null,
  featureKeys: [],
  newsletterScope: [],
  eventScope: [],
}

/**
 * Resolve portal access for the given auth user id (null ⇒ anonymous).
 * Phase 2: always member-level. Phase 3 will add the `admin_profiles` lookup + RPC calls.
 */
export async function resolvePortalAccess(authUserId: string | null): Promise<PortalAccess> {
  if (!authUserId) return ZERO_ACCESS
  // Phase 3: load admin_profiles row; if present + active, call the feature/row-scope RPCs.
  return ZERO_ACCESS
}
