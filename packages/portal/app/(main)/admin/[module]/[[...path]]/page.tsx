import { cookies } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import { createElement } from 'react'
import { getServerBrandConfig } from '@/config/brand'
import { createAuthenticatedServerSupabase } from '@/lib/supabase/server'
import { getEnabledModules } from '@/lib/modules/enabledModules'
import { resolvePortalAccess, ZERO_ACCESS } from '@/lib/permissions/resolve'
import { getModuleAccess } from '@/lib/modules/access'
import { findAdminModulePage, moduleHasAdminPages } from '@/lib/modules/adminRegistry'

interface RouteParams {
  module: string
  path?: string[]
}

/**
 * Workspace-shell admin mount: /admin/<module>/<...path>. Defense-in-depth access re-check (the
 * shell layout already gated the rail, but this segment is reachable directly), then lazy-mounts the
 * module's admin page from the generated registry. Spec §6.3 / §9.4.
 */
export default async function AdminModulePage({ params }: { params: Promise<RouteParams> }) {
  const { module, path = [] } = await params

  // --- Re-resolve access for THIS request (defense in depth) ----------------
  const brand = (await getServerBrandConfig()).id
  const modules = await getEnabledModules()
  const cookieStore = await cookies()
  const hasAuthCookie = cookieStore.getAll().some((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name))

  let access = ZERO_ACCESS
  let isSignedIn = false
  if (hasAuthCookie) {
    const supabase = await createAuthenticatedServerSupabase(brand)
    const { data } = await supabase.auth.getUser()
    const userId = data.user?.id ?? null
    isSignedIn = Boolean(userId)
    access = await resolvePortalAccess(supabase, userId)
  }
  const accessMap = getModuleAccess(modules.railItems, access, isSignedIn)
  const entry = accessMap[module]
  const railItem = modules.railItems.find((r) => r.moduleId === module)

  // --- Authorization decisions (§9.4) ---------------------------------------
  if (!entry || !railItem) {
    // Unknown / not-enabled / hidden module → indistinguishable 404 (enumeration safety).
    notFound()
  }
  if (entry.access !== 'admin') {
    if (!isSignedIn && railItem.visibility === 'public') {
      // `next` is a server-known relative path → safe (no open-redirect).
      const next = encodeURIComponent(`/admin/${module}${path.length ? '/' + path.join('/') : ''}`)
      redirect(`/sign-in?next=${next}`)
    }
    if (railItem.href && railItem.visibility === 'public') {
      redirect(railItem.href) // signed-in-no-rights → the module's public view
    }
    notFound() // members/admin-only without rights → 404 (don't reveal the admin route)
  }

  // --- Mount the module admin page ------------------------------------------
  const match = findAdminModulePage(module, path)
  if (!match) {
    if (moduleHasAdminPages(module)) notFound()
    // Module is granted but ships no portal admin pages yet — graceful placeholder while the
    // module's admin/pages/* are wired + the registry regenerated.
    return (
      <div className="gw-view-error">
        <div className="gw-view-error-title">{railItem.full || railItem.label} admin</div>
        <p className="gw-view-error-text">
          This module&apos;s admin screens aren&apos;t available in the portal yet.
        </p>
      </div>
    )
  }

  const mod = await match.page.component()
  const Component = mod.default
  return createElement(Component as React.ComponentType<Record<string, unknown>>, {
    moduleId: module,
    path,
    routeParams: match.params,
    scope: entry.scope,
    access: entry,
  })
}
