import { cache } from 'react'
import { cookies } from 'next/headers'
import { getEnabledModules, type RailItem } from './enabledModules'
import { getViewableDraftModuleIds } from './draftAccess'
import { createAuthenticatedServerSupabase } from '@/lib/supabase/server'
import { getServerBrandConfig } from '@/config/brand'

/**
 * Module visibility for the related-content resolver.
 *
 * A related card must never surface a module the CURRENT VIEWER can't see in
 * the portal nav — the nav is the operator's visibility contract:
 *   - hidden modules are invisible to everyone;
 *   - draft modules are visible only to authorised previewers
 *     (getViewableDraftModuleIds — fail-closed);
 *   - visibility 'members' rail items require a signed-in session (the seam
 *     for future member-tier gating lives on RailItem.visibility);
 *   - visibility 'admin' rail items are admin surfaces, never related content.
 *
 * Returns the allowed module ids plus href prefixes for mapping a card's
 * destination back to its module.
 */

export interface RelatedVisibility {
  allowed: Set<string>
  prefixes: Array<{ prefix: string; moduleId: string }>
}

async function hasSession(): Promise<boolean> {
  try {
    const cookieStore = await cookies()
    const hasAuthCookie = cookieStore.getAll().some((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name))
    if (!hasAuthCookie) return false
    const brand = (await getServerBrandConfig()).id
    const supabase = await createAuthenticatedServerSupabase(brand)
    const { data } = await supabase.auth.getUser()
    return !!data.user?.id
  } catch {
    return false
  }
}

export const getRelatedVisibility = cache(async (): Promise<RelatedVisibility> => {
  const allowed = new Set<string>()
  const prefixes: Array<{ prefix: string; moduleId: string }> = []
  try {
    const modules = await getEnabledModules()
    const draftIds = await getViewableDraftModuleIds()
    const membersItems = modules.railItems.some((r) => r.visibility === 'members')
    const signedIn = membersItems ? await hasSession() : false

    const admit = (r: RailItem) => {
      allowed.add(r.moduleId)
      if (r.href && r.href.startsWith('/')) prefixes.push({ prefix: r.href, moduleId: r.moduleId })
    }
    for (const r of modules.railItems) {
      if (r.moduleId === 'home') continue
      if (r.visibility === 'public') admit(r)
      else if (r.visibility === 'members' && signedIn) admit(r)
      // 'admin' rail items are admin surfaces, not public content — never related
    }
    for (const r of modules.draftRailItems) {
      if (draftIds.has(r.moduleId)) admit(r)
    }
    // longest prefix first so /events/hosts-style nesting maps correctly
    prefixes.sort((a, b) => b.prefix.length - a.prefix.length)
  } catch {
    // fail closed: resolution errors must never widen visibility
  }
  return { allowed, prefixes }
})

/** Card type -> owning module, for destinations the nav prefixes can't map
 *  (external canonical blog articles, absolute URLs). */
const TYPE_MODULE: Record<string, string> = {
  resource: 'resources',
  event: 'events',
  blog: 'blog',
}

/**
 * The module a related card belongs to, or null when unmappable (custom
 * 'link' pins to arbitrary destinations — operator-authored, ungated here).
 */
export function moduleForCard(
  card: { href: string; type: string },
  visibility: RelatedVisibility,
): string | null {
  if (card.href.startsWith('/')) {
    for (const { prefix, moduleId } of visibility.prefixes) {
      if (card.href === prefix || card.href.startsWith(`${prefix}/`)) return moduleId
    }
  }
  return TYPE_MODULE[card.type] ?? null
}
