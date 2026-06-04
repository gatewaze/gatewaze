/**
 * Module access map — pure projection of a resolved `PortalAccess` over the enabled rail items.
 * Decides, per module, whether the shell renders the admin surface, the public view, a sign-in
 * gate, or hides the module from the rail. The layout resolves access once (memoized, §9.2a) and
 * passes it here; this function performs NO IO. Spec §9.3 / §9.3a.
 */
import type { PortalAccess } from '@/lib/permissions/resolve'
import type { RailItem } from '@/lib/modules/enabledModules'

export type Access = 'admin' | 'public' | 'gated' | 'hidden'

export interface RowScope {
  newsletterIds?: string[]
  eventIds?: string[]
  calendarIds?: string[]
}

export type AccessReason =
  | 'super_admin'
  | 'feature_grant'
  | 'feature_no_rows'
  | 'public_module'
  | 'signed_in_member'
  | 'signed_out_member_gate'
  | 'admin_only_hidden'

export interface ModuleAccessEntry {
  access: Access
  scope?: RowScope
  reason: AccessReason
}

export type ModuleAccessMap = Record<string, ModuleAccessEntry>

/** Module ids whose admin surface is row-scoped (feature grant + per-record grants). */
const ROW_SCOPED = new Set(['newsletters', 'events'])

/** Map a module's feature key. v1: the feature equals the module id. */
function featureFor(moduleId: string): string {
  return moduleId
}

export function getModuleAccess(
  railItems: RailItem[],
  access: PortalAccess,
  isSignedIn: boolean,
): ModuleAccessMap {
  const map: ModuleAccessMap = {}
  const has = (f: string) => access.featureKeys.includes(f)

  for (const item of railItems) {
    const feature = featureFor(item.moduleId)
    let entry: ModuleAccessEntry

    if (access.isSuperAdmin) {
      entry = { access: 'admin', reason: 'super_admin' }
    } else if (ROW_SCOPED.has(item.moduleId)) {
      const scope = rowScopeFor(item.moduleId, access)
      const hasRows = scope != null && hasAnyRow(scope)
      if (has(feature) && hasRows) {
        entry = { access: 'admin', scope, reason: 'feature_grant' }
      } else if (has(feature)) {
        // Feature but no rows: show the admin surface with an empty/no-access state (§9.3a).
        entry = { access: 'admin', reason: 'feature_no_rows' }
      } else {
        // Row grant without feature → hidden from the rail (RLS still scopes data). §9.3a.
        entry = byVisibility(item, isSignedIn)
      }
    } else if (has(feature)) {
      entry = { access: 'admin', reason: 'feature_grant' }
    } else {
      entry = byVisibility(item, isSignedIn)
    }

    map[item.moduleId] = entry
  }

  return map
}

function byVisibility(item: RailItem, isSignedIn: boolean): ModuleAccessEntry {
  switch (item.visibility) {
    case 'public':
      return { access: 'public', reason: 'public_module' }
    case 'members':
      return isSignedIn
        ? { access: 'public', reason: 'signed_in_member' }
        : { access: 'gated', reason: 'signed_out_member_gate' }
    case 'admin':
    default:
      return { access: 'hidden', reason: 'admin_only_hidden' }
  }
}

function rowScopeFor(moduleId: string, access: PortalAccess): RowScope | undefined {
  if (moduleId === 'newsletters') {
    return { newsletterIds: access.newsletterScope.map((n) => n.collectionId) }
  }
  if (moduleId === 'events') {
    return {
      eventIds: access.eventScope.map((e) => e.eventId).filter((v): v is string => !!v),
      calendarIds: access.eventScope.map((e) => e.calendarId).filter((v): v is string => !!v),
    }
  }
  return undefined
}

function hasAnyRow(scope: RowScope): boolean {
  return Boolean(
    scope.newsletterIds?.length || scope.eventIds?.length || scope.calendarIds?.length,
  )
}
