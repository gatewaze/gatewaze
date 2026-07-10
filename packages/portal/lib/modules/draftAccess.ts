import { cache } from 'react'
import { cookies } from 'next/headers'
import { getEnabledModules, type RailItem } from './enabledModules'
import { createAuthenticatedServerSupabase } from '@/lib/supabase/server'
import { resolvePortalAccess, type PortalAccess } from '@/lib/permissions/resolve'
import { getServerBrandConfig } from '@/config/brand'

/**
 * Draft-mode visibility (Settings → Branding → Portal navigation).
 *
 * A nav item marked `draft` is invisible on every PUBLIC surface (nav, home
 * sections, pages, sitemap/feeds//md) exactly like `hidden` — but authorised
 * viewers get the menu item (badged) and the pages, so unreleased modules can
 * be reviewed in place. Authorised = anyone with an ACTIVE ADMIN ACCOUNT of
 * any role (super_admin/admin/editor — previewing is read-only, so no feature
 * grants are required), plus feature-grant holders such as portal managers
 * who may not hold an admin_profiles row.
 */
export function permittedDraftRailItems(draftRailItems: RailItem[], access: PortalAccess): RailItem[] {
  if (draftRailItems.length === 0) return []
  return draftRailItems.filter(
    (r) => access.hasAdminAccount || access.isSuperAdmin || access.featureKeys.includes(r.moduleId),
  )
}

/**
 * Module ids whose draft pages the CURRENT REQUEST'S viewer may see.
 * Deduped per request via React cache(); resolves the session only when draft
 * items exist and an auth cookie is present, so anonymous/public traffic pays
 * nothing.
 */
export const getViewableDraftModuleIds = cache(async (): Promise<Set<string>> => {
  const none = new Set<string>()
  try {
    const modules = await getEnabledModules()
    if (modules.draftRailItems.length === 0) return none

    const cookieStore = await cookies()
    const hasAuthCookie = cookieStore.getAll().some((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name))
    if (!hasAuthCookie) return none

    const brand = (await getServerBrandConfig()).id
    const supabase = await createAuthenticatedServerSupabase(brand)
    const { data } = await supabase.auth.getUser()
    if (!data.user?.id) return none

    const access = await resolvePortalAccess(supabase, data.user.id)
    return new Set(permittedDraftRailItems(modules.draftRailItems, access).map((r) => r.moduleId))
  } catch {
    // Fail closed: an error resolving access never exposes draft content.
    return none
  }
})
