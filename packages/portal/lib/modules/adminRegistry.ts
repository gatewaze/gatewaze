/**
 * Admin-page matcher for the workspace shell's /admin/[module]/[[...path]] mount route.
 * Matches a requested (moduleId, path segments) against the generated admin registry, preferring
 * the most specific route (static segments outrank dynamic), and extracts named params. Spec §8.4.
 */
import { adminModulePages, type AdminModulePage } from './generated-admin-modules'

export interface AdminPageMatch {
  page: AdminModulePage
  params: Record<string, string>
}

interface Compiled {
  page: AdminModulePage
  segments: string[]
  rank: number
}

/** '/[id]/editions' → ['[id]','editions']; '/' → []. */
function toSegments(path: string): string[] {
  return path.split('/').filter(Boolean)
}

/** Specificity: static segment = 2, dynamic = 1; longer paths outrank shorter. */
function rankOf(segments: string[]): number {
  return segments.reduce((acc, s) => acc + (s.startsWith('[') ? 1 : 2), 0) * 100 + segments.length
}

const compiled: Compiled[] = adminModulePages
  .map((page) => {
    const segments = toSegments(page.path)
    return { page, segments, rank: rankOf(segments) }
  })
  .sort((a, b) => b.rank - a.rank) // most specific first

/**
 * Find the admin page for a module + path. `pathSegments` are the URL segments AFTER the module id
 * (e.g. ['editions'] for /admin/newsletters/editions). Returns null when nothing matches.
 */
export function findAdminModulePage(moduleId: string, pathSegments: string[]): AdminPageMatch | null {
  for (const c of compiled) {
    if (c.page.moduleId !== moduleId) continue
    if (c.segments.length !== pathSegments.length) continue
    const params: Record<string, string> = {}
    let ok = true
    for (let i = 0; i < c.segments.length; i++) {
      const seg = c.segments[i]
      if (seg.startsWith('[') && seg.endsWith(']')) {
        params[seg.slice(1, -1)] = pathSegments[i]
      } else if (seg !== pathSegments[i]) {
        ok = false
        break
      }
    }
    if (ok) return { page: c.page, params }
  }
  return null
}

/** Whether a module has ANY admin pages registered (used to render an empty state vs 404). */
export function moduleHasAdminPages(moduleId: string): boolean {
  return adminModulePages.some((p) => p.moduleId === moduleId)
}
