/**
 * Generates a portal module registry from all module sources
 * (gatewaze.config.ts + database module_sources table).
 *
 * Resolves module sources the same way the API/admin does:
 *   - Config file moduleSources (local paths, git repos)
 *   - Database module_sources table (user-added, uploaded)
 *
 * Convention: files named `_param.tsx` become `[param]` dynamic segments
 * in the route path (e.g., `_slug.tsx` → `/blog/[slug]`).
 *
 * Outputs:
 *   - generated-portal-modules.ts  — route registry with lazy imports
 *   - generated-portal-rewrites.json — Next.js rewrites for clean URLs
 *   - generated-modules-dirs.json — resolved module source directories for webpack
 *
 * Run: npx tsx scripts/generate-module-registry.ts
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, statSync } from 'fs'
import { resolve, relative, dirname, isAbsolute } from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const PROJECT_ROOT = resolve(__dirname, '../../..')
const OUTPUT_PATH = resolve(__dirname, '../lib/modules/generated-portal-modules.ts')
const REWRITES_PATH = resolve(__dirname, '../lib/modules/generated-portal-rewrites.json')
const DIRS_PATH = resolve(__dirname, '../lib/modules/generated-modules-dirs.json')
const PREFIXES_PATH = resolve(__dirname, '../lib/modules/generated-module-prefixes.json')
const CONFIG_PATH = resolve(PROJECT_ROOT, 'gatewaze.config.ts')

// ---------------------------------------------------------------------------
// Config parsing (mirrors shared/modules/loader.ts)
// ---------------------------------------------------------------------------

interface SourceEntry {
  url: string
  path?: string
  branch?: string
}

function parseConfigSources(): SourceEntry[] {
  try {
    const rawContent = readFileSync(CONFIG_PATH, 'utf-8')
    const content = rawContent.replace(/\/\/.*$/gm, '')

    const sourcesMatch = content.match(/moduleSources\s*:\s*\[([\s\S]*?)\]/)
    const sources: SourceEntry[] = []

    if (sourcesMatch) {
      const strings = sourcesMatch[1].match(/['"]([^'"]+)['"]/g)
      if (strings) {
        for (const s of strings) {
          sources.push(normalizeSource(s.slice(1, -1)))
        }
      }
      const objMatches = sourcesMatch[1].matchAll(
        /\{\s*url\s*:\s*['"]([^'"]+)['"]\s*(?:,\s*path\s*:\s*['"]([^'"]+)['"])?\s*(?:,\s*branch\s*:\s*['"]([^'"]+)['"])?\s*\}/g
      )
      for (const m of objMatches) {
        sources.push({
          url: m[1],
          path: m[2] || undefined,
          branch: m[3] || undefined,
        })
      }
    }

    if (sources.length === 0) {
      sources.push({ url: '../gatewaze-modules/modules' })
    }

    return sources
  } catch {
    return [{ url: '../gatewaze-modules/modules' }]
  }
}

/**
 * Fetch additional module sources from the database.
 * Returns empty array if DB is unavailable.
 */
async function fetchDbSources(): Promise<SourceEntry[]> {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    console.log('[generate-module-registry] No Supabase credentials — skipping DB sources')
    return []
  }

  try {
    // Use fetch directly to avoid needing @supabase/supabase-js as a script dependency
    const response = await fetch(`${url}/rest/v1/module_sources?select=url,path,branch`, {
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
      },
    })

    if (!response.ok) {
      console.warn(`[generate-module-registry] DB sources fetch failed: ${response.status}`)
      return []
    }

    const rows = await response.json() as { url: string; path: string | null; branch: string | null }[]
    return rows.map(row => ({
      url: row.url,
      path: row.path ?? undefined,
      branch: row.branch ?? undefined,
    }))
  } catch (err) {
    console.warn('[generate-module-registry] Could not fetch DB sources:', err)
    return []
  }
}

function normalizeSource(source: string): SourceEntry {
  const [url, fragment] = source.split('#')
  if (!fragment) return { url }
  const params = new URLSearchParams(fragment)
  return {
    url,
    path: params.get('path') ?? undefined,
    branch: params.get('branch') ?? undefined,
  }
}

function isGitUrl(url: string): boolean {
  return (
    url.startsWith('https://') ||
    url.startsWith('git://') ||
    url.startsWith('git@') ||
    url.endsWith('.git')
  )
}

function cloneOrUpdateRepo(gitUrl: string, branch: string | undefined): string | null {
  const cacheDir = resolve(PROJECT_ROOT, '.gatewaze-modules')
  const repoSlug = gitUrl
    .replace(/^(https?:\/\/|git:\/\/|git@)/, '')
    .replace(/\.git$/, '')
    .replace(/[^a-zA-Z0-9-]/g, '-')
  const repoDir = resolve(cacheDir, repoSlug)

  try {
    mkdirSync(cacheDir, { recursive: true })

    if (existsSync(resolve(repoDir, '.git'))) {
      const branchArg = branch ? `origin ${branch}` : ''
      execSync(`git -C "${repoDir}" pull ${branchArg} --ff-only 2>/dev/null || true`, {
        stdio: 'pipe',
      })
    } else {
      const branchFlag = branch ? `--branch ${branch}` : ''
      execSync(`git clone --depth 1 ${branchFlag} "${gitUrl}" "${repoDir}"`, {
        stdio: 'pipe',
      })
    }

    return repoDir
  } catch (err) {
    console.error(`[generate-module-registry] Failed to clone ${gitUrl}:`, err)
    return null
  }
}

function resolveSources(sources: SourceEntry[]): string[] {
  const resolved: string[] = []

  for (const source of sources) {
    // Skip malformed entries (e.g., from regex parsing raw JS expressions)
    if (source.url.includes('process.env') || source.url.includes('\n') || source.url.includes('\r')) {
      continue
    }

    if (isGitUrl(source.url)) {
      const localPath = cloneOrUpdateRepo(source.url, source.branch)
      if (localPath) {
        resolved.push(source.path ? resolve(localPath, source.path) : localPath)
      }
    } else {
      const absPath = isAbsolute(source.url) ? source.url : resolve(PROJECT_ROOT, source.url)
      resolved.push(source.path ? resolve(absPath, source.path) : absPath)
    }
  }

  return resolved
}

/**
 * Merge config + DB sources, deduplicating by url+path.
 */
function mergeSources(configSources: SourceEntry[], dbSources: SourceEntry[]): SourceEntry[] {
  const seen = new Set<string>()
  const merged: SourceEntry[] = []

  for (const source of [...configSources, ...dbSources]) {
    const key = `${source.url}|${source.path ?? ''}`
    if (!seen.has(key)) {
      seen.add(key)
      merged.push(source)
    }
  }

  return merged
}

// ---------------------------------------------------------------------------
// Module discovery
// ---------------------------------------------------------------------------

interface PortalPageDef {
  path: string
  componentPath: string
  moduleId: string
}

/**
 * Convert a directory name or filename stem to a Next.js route segment.
 * - `_slug` (legacy underscore-prefix) → `[slug]`
 * - `[slug]` (Next.js convention) → `[slug]`
 * - anything else → as-is
 */
function nameToRouteSegment(name: string): string {
  if (name.startsWith('_')) {
    return `[${name.slice(1)}]`
  }
  return name
}

/**
 * Recursively walk a portal/pages/ directory tree, producing one PortalPageDef
 * per .tsx/.ts file found.
 *
 * Conventions:
 *  - `index.tsx` at any level represents that directory's root route.
 *  - `foo.tsx` adds a static `/foo` segment.
 *  - `_foo.tsx` adds a dynamic `[foo]` segment (legacy flat convention).
 *  - `[foo]/...` is a directory whose contents nest under a dynamic `[foo]` segment.
 *
 * Examples (for moduleId 'calendars'):
 *  - portal/pages/index.tsx          → /calendars
 *  - portal/pages/[slug]/index.tsx   → /calendars/[slug]
 *  - portal/pages/[slug]/events.tsx  → /calendars/[slug]/events
 *  - portal/pages/[slug]/_sub.tsx    → /calendars/[slug]/[sub]   (still works)
 */
function walkPortalPagesDir(
  rootDir: string,
  currentDir: string,
  segments: string[],
  moduleId: string,
  pages: PortalPageDef[]
) {
  if (!existsSync(currentDir)) return
  let entries: string[]
  try {
    entries = readdirSync(currentDir)
  } catch {
    return
  }

  for (const entry of entries) {
    const fullPath = resolve(currentDir, entry)
    let st
    try {
      st = statSync(fullPath)
    } catch {
      continue
    }

    if (st.isDirectory()) {
      // Skip hidden directories. Underscore-prefixed dirs (e.g. _shared) are
      // treated as private (not routed) so modules can colocate helpers.
      if (entry.startsWith('.')) continue
      if (entry.startsWith('_') && !entry.startsWith('_')) continue

      // _foo as a *directory* is reserved for private (e.g. _components, _utils);
      // dynamic directories must use the [foo] convention.
      if (entry.startsWith('_')) continue

      // [foo] dynamic directory
      if (entry.startsWith('[') && entry.endsWith(']')) {
        const segment = entry // already in `[foo]` form
        walkPortalPagesDir(rootDir, fullPath, [...segments, segment], moduleId, pages)
        continue
      }

      // Static directory
      walkPortalPagesDir(rootDir, fullPath, [...segments, entry], moduleId, pages)
      continue
    }

    if (!st.isFile()) continue
    if (!entry.endsWith('.tsx') && !entry.endsWith('.ts')) continue

    const name = entry.replace(/\.tsx?$/, '')
    // Skip `_meta.json` etc. — they're not pages.
    if (name.startsWith('.')) continue

    // Compute the route path for this file.
    let routeSegments: string[]
    if (name === 'index') {
      routeSegments = segments
    } else {
      routeSegments = [...segments, nameToRouteSegment(name)]
    }

    const routePath = '/' + [moduleId, ...routeSegments].filter(Boolean).join('/')

    // Component import path: drop the .tsx extension
    const componentPath = fullPath.replace(/\.tsx?$/, '')

    pages.push({
      path: routePath,
      componentPath,
      moduleId,
    })
  }
}

/**
 * Sort routes so that more specific (static) routes appear before less specific
 * (dynamic) routes at any given level. This matters for `findModulePage()`'s
 * pattern matching — we want `/calendars/[slug]/events` to be tried before
 * `/calendars/[slug]/[sub]`.
 *
 * Strategy: longer paths first, then within the same length, fewer dynamic
 * segments first.
 */
function sortPortalPages(pages: PortalPageDef[]): PortalPageDef[] {
  return [...pages].sort((a, b) => {
    const aSegs = a.path.split('/').filter(Boolean)
    const bSegs = b.path.split('/').filter(Boolean)
    if (aSegs.length !== bSegs.length) return bSegs.length - aSegs.length
    const aDyn = aSegs.filter(s => s.startsWith('[')).length
    const bDyn = bSegs.filter(s => s.startsWith('[')).length
    if (aDyn !== bDyn) return aDyn - bDyn
    return a.path.localeCompare(b.path)
  })
}

function discoverPortalModules(sourceDirs: string[]): PortalPageDef[] {
  const pages: PortalPageDef[] = []

  for (const sourceDir of sourceDirs) {
    if (!existsSync(sourceDir)) {
      console.warn(`[generate-module-registry] Source dir not found: ${sourceDir}`)
      continue
    }

    const moduleDirs = readdirSync(sourceDir).filter(name => {
      if (name.startsWith('.') || name.startsWith('_')) return false
      try {
        return statSync(resolve(sourceDir, name)).isDirectory()
      } catch {
        return false
      }
    })

    for (const moduleDir of moduleDirs) {
      const pagesDir = resolve(sourceDir, moduleDir, 'portal', 'pages')
      if (!existsSync(pagesDir)) continue
      walkPortalPagesDir(pagesDir, pagesDir, [], moduleDir, pages)
    }
  }

  return sortPortalPages(pages)
}

// ---------------------------------------------------------------------------
// Event page discovery (portal/event-pages/)
// ---------------------------------------------------------------------------

interface EventPageDef {
  slug: string
  moduleId: string
  componentPath: string
  label: string
  icon: string
  order: number
  requiresLocalStorage?: string
}

function discoverEventPages(sourceDirs: string[]): EventPageDef[] {
  const eventPages: EventPageDef[] = []

  for (const sourceDir of sourceDirs) {
    if (!existsSync(sourceDir)) continue

    const moduleDirs = readdirSync(sourceDir).filter(name => {
      if (name.startsWith('.') || name.startsWith('_')) return false
      return statSync(resolve(sourceDir, name)).isDirectory()
    })

    for (const moduleDir of moduleDirs) {
      const eventPagesDir = resolve(sourceDir, moduleDir, 'portal', 'event-pages')
      if (!existsSync(eventPagesDir)) continue

      // Load metadata
      let meta: Record<string, { label?: string; icon?: string; order?: number; requiresLocalStorage?: string }> = {}
      const metaPath = resolve(eventPagesDir, '_meta.json')
      if (existsSync(metaPath)) {
        try {
          meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
        } catch {}
      }

      const pageFiles = readdirSync(eventPagesDir).filter(f =>
        (f.endsWith('.tsx') || f.endsWith('.ts')) && !f.startsWith('_')
      )

      for (const file of pageFiles) {
        const slug = file.replace(/\.tsx?$/, '')
        const absPath = resolve(eventPagesDir, slug)
        const pageMeta = meta[slug] || {}

        eventPages.push({
          slug,
          moduleId: moduleDir,
          componentPath: absPath,
          label: pageMeta.label || slug.charAt(0).toUpperCase() + slug.slice(1),
          icon: pageMeta.icon || 'page',
          order: pageMeta.order ?? 100,
          requiresLocalStorage: pageMeta.requiresLocalStorage,
        })
      }
    }
  }

  return eventPages
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

async function generate() {
  const configSources = parseConfigSources()
  const dbSources = await fetchDbSources()

  // Handle EXTRA_MODULE_SOURCES env var (comma-separated paths)
  // The config file references this via a spread operator that the regex parser can't evaluate
  const extraSources: SourceEntry[] = (process.env.EXTRA_MODULE_SOURCES || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => ({ url: s }))

  const allSources = mergeSources([...configSources, ...extraSources], dbSources)
  const sourceDirs = resolveSources(allSources)

  console.log(`[generate-module-registry] Resolved ${sourceDirs.length} source dir(s) from ${configSources.length} config + ${dbSources.length} DB source(s):`)
  for (const dir of sourceDirs) {
    console.log(`  ${dir}`)
  }

  const pages = discoverPortalModules(sourceDirs)
  const eventPages = discoverEventPages(sourceDirs)

  const entries: string[] = []
  for (const page of pages) {
    entries.push(
      `  { path: '${page.path}', moduleId: '${page.moduleId}', component: () => import('${page.componentPath}') },`
    )
  }

  const output = `// AUTO-GENERATED — do not edit manually
// Run: npx tsx scripts/generate-module-registry.ts

import type { ComponentType } from 'react'

export interface PortalModulePage {
  path: string
  moduleId: string
  component: () => Promise<{ default: ComponentType<any> }>
}

export const portalModulePages: PortalModulePage[] = [
${entries.join('\n')}
]

export function findModulePage(pathname: string): PortalModulePage | undefined {
  // Try exact match first
  const exact = portalModulePages.find(p => p.path === pathname)
  if (exact) return exact

  // Try dynamic segment match (e.g., /blog/[slug] matches /blog/my-post)
  for (const page of portalModulePages) {
    if (!page.path.includes('[')) continue
    const pattern = page.path.replace(/\\[([^\\]]+)\\]/g, '([^/]+)')
    const regex = new RegExp('^' + pattern + '$')
    if (regex.test(pathname)) return page
  }

  return undefined
}

/**
 * Extract dynamic params from a route pattern matched against a pathname.
 * e.g., extractParams('/forms/[slug]', '/forms/meetup-organizer') → { slug: 'meetup-organizer' }
 */
export function extractParams(routePath: string, pathname: string): Record<string, string> {
  const params: Record<string, string> = {}
  const routeSegments = routePath.split('/').filter(Boolean)
  const pathSegments = pathname.split('/').filter(Boolean)

  for (let i = 0; i < routeSegments.length; i++) {
    const seg = routeSegments[i]
    const match = seg.match(/^\\[([^\\]]+)\\]$/)
    if (match && pathSegments[i]) {
      params[match[1]] = pathSegments[i]
    }
  }

  return params
}
`

  writeFileSync(OUTPUT_PATH, output, 'utf-8')

  // Generate Next.js rewrites
  const modulePrefixes = [...new Set(pages.map(p => p.moduleId))]
  const rewrites = modulePrefixes.flatMap(prefix => [
    { source: `/${prefix}/:path*`, destination: `/m/${prefix}/:path*` },
    { source: `/${prefix}`, destination: `/m/${prefix}` },
  ])
  writeFileSync(REWRITES_PATH, JSON.stringify(rewrites, null, 2), 'utf-8')

  // Export resolved source directories for next.config.ts webpack alias
  writeFileSync(DIRS_PATH, JSON.stringify(sourceDirs, null, 2), 'utf-8')

  // Export module prefixes for middleware URL rewriting
  writeFileSync(PREFIXES_PATH, JSON.stringify(modulePrefixes, null, 2), 'utf-8')

  // Generate event pages registry
  const EVENT_PAGES_PATH = resolve(__dirname, '../lib/modules/generated-event-pages.ts')
  const eventPageEntries: string[] = []
  for (const ep of eventPages) {
    eventPageEntries.push(
      `  { slug: '${ep.slug}', moduleId: '${ep.moduleId}', label: '${ep.label}', icon: '${ep.icon}', order: ${ep.order}, requiresLocalStorage: ${ep.requiresLocalStorage ? `'${ep.requiresLocalStorage}'` : 'undefined'}, component: () => import('${ep.componentPath}') },`
    )
  }

  const eventPagesOutput = `// AUTO-GENERATED — do not edit manually
// Run: npx tsx scripts/generate-module-registry.ts

import type { ComponentType } from 'react'

export interface EventModulePage {
  slug: string
  moduleId: string
  label: string
  icon: string
  order: number
  requiresLocalStorage?: string
  component: () => Promise<{ default: ComponentType<any> }>
}

export const eventModulePages: EventModulePage[] = [
${eventPageEntries.join('\n')}
]

export function findEventModulePage(slug: string): EventModulePage | undefined {
  return eventModulePages.find(p => p.slug === slug)
}
`

  writeFileSync(EVENT_PAGES_PATH, eventPagesOutput, 'utf-8')

  console.log(`[generate-module-registry] Wrote ${pages.length} portal pages to ${relative(PROJECT_ROOT, OUTPUT_PATH)}`)
  for (const page of pages) {
    console.log(`  ${page.moduleId}: ${page.path}`)
  }
  if (eventPages.length > 0) {
    console.log(`[generate-module-registry] Wrote ${eventPages.length} event pages to ${relative(PROJECT_ROOT, EVENT_PAGES_PATH)}`)
    for (const ep of eventPages) {
      console.log(`  ${ep.moduleId}: /events/{id}/${ep.slug}`)
    }
  }
}

generate()
