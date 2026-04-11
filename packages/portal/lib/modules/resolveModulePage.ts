import { existsSync, readdirSync, statSync } from 'fs'
import { resolve, isAbsolute } from 'path'
import { createClient } from '@supabase/supabase-js'

/**
 * Dynamically resolve a module portal page at request time.
 *
 * Scans all module source directories (from config + DB) for modules
 * that have portal/pages/ matching the requested path.
 *
 * This allows modules to be enabled/disabled or new module sources to be
 * added without requiring a portal rebuild.
 */

interface ResolvedPage {
  moduleId: string
  filePath: string // absolute path to the .tsx file on disk
}

// Cache source directories for 60s
let sourceDirsCache: string[] | null = null
let sourceDirsCacheTime = 0
const SOURCE_DIRS_CACHE_TTL = 60_000

/**
 * Get all module source directories from config file + database.
 */
async function getSourceDirs(): Promise<string[]> {
  const now = Date.now()
  if (sourceDirsCache && now - sourceDirsCacheTime < SOURCE_DIRS_CACHE_TTL) {
    return sourceDirsCache
  }

  const dirs: string[] = []

  // 1. Parse config file sources
  const projectRoot = findProjectRoot()
  const configSources = parseConfigSources(projectRoot)
  for (const source of configSources) {
    const absPath = isAbsolute(source.url) ? source.url : resolve(projectRoot, source.url)
    const dir = source.path ? resolve(absPath, source.path) : absPath
    if (existsSync(dir)) dirs.push(dir)
  }

  // 2. Fetch DB sources
  const dbDirs = await fetchDbSourceDirs(projectRoot)
  for (const dir of dbDirs) {
    if (!dirs.includes(dir) && existsSync(dir)) {
      dirs.push(dir)
    }
  }

  sourceDirsCache = dirs
  sourceDirsCacheTime = now
  return dirs
}

function findProjectRoot(): string {
  // In Docker: /app is the project root, modules at /gatewaze-modules/modules
  // Locally: packages/portal is 2 levels below project root
  if (existsSync('/app/gatewaze.config.ts')) return '/app'
  // Walk up from cwd to find gatewaze.config.ts
  let dir = process.cwd()
  for (let i = 0; i < 5; i++) {
    if (existsSync(resolve(dir, 'gatewaze.config.ts'))) return dir
    dir = resolve(dir, '..')
  }
  return process.cwd()
}

interface SourceEntry {
  url: string
  path?: string
}

function parseConfigSources(projectRoot: string): SourceEntry[] {
  try {
    const { readFileSync } = require('fs')
    const configPath = resolve(projectRoot, 'gatewaze.config.ts')
    const rawContent = readFileSync(configPath, 'utf-8')
    const content = rawContent.replace(/\/\/.*$/gm, '')

    const sourcesMatch = content.match(/moduleSources\s*:\s*\[([\s\S]*?)\]/)
    const sources: SourceEntry[] = []

    if (sourcesMatch) {
      const strings = sourcesMatch[1].match(/['"]([^'"]+)['"]/g)
      if (strings) {
        for (const s of strings) {
          const val = s.slice(1, -1)
          const [url, fragment] = val.split('#')
          if (fragment) {
            const params = new URLSearchParams(fragment)
            sources.push({ url, path: params.get('path') ?? undefined })
          } else {
            sources.push({ url })
          }
        }
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

async function fetchDbSourceDirs(projectRoot: string): Promise<string[]> {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return []

  try {
    const supabase = createClient(url, key, {
      global: { fetch: (url, options = {}) => fetch(url, { ...options, cache: 'no-store' }) },
    })

    const { data } = await supabase
      .from('module_sources')
      .select('url, path')

    if (!data) return []

    return data.map((row: { url: string; path: string | null }) => {
      const absPath = isAbsolute(row.url) ? row.url : resolve(projectRoot, row.url)
      return row.path ? resolve(absPath, row.path) : absPath
    }).filter((dir: string) => existsSync(dir))
  } catch {
    return []
  }
}

/**
 * Convert URL pathname segments to a module page file at runtime.
 *
 * Supports nested directories with mixed static and dynamic segments:
 *   /calendars                  → calendars/portal/pages/index.tsx
 *   /calendars/berlin           → calendars/portal/pages/[slug]/index.tsx
 *   /calendars/berlin/events    → calendars/portal/pages/[slug]/events.tsx
 *   /blog/my-post               → blog/portal/pages/_slug.tsx OR blog/portal/pages/[slug].tsx
 *
 * Resolution rules at each segment:
 *   1. Try a static directory matching the segment.
 *   2. Try a static file `<segment>.tsx` (only at the final segment).
 *   3. Fall back to a `[param]` directory (or legacy `_param.tsx` file at final segment).
 *
 * Static matches always win over dynamic matches.
 */
export async function resolveModulePage(pathname: string): Promise<ResolvedPage | null> {
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length === 0) return null

  const moduleId = segments[0]
  const restSegments = segments.slice(1)
  const sourceDirs = await getSourceDirs()

  for (const sourceDir of sourceDirs) {
    const moduleDir = resolve(sourceDir, moduleId)
    const pagesDir = resolve(moduleDir, 'portal', 'pages')

    if (!existsSync(pagesDir)) continue

    const filePath = resolveSegments(pagesDir, restSegments)
    if (filePath) return { moduleId, filePath }
  }

  return null
}

/**
 * Recursively walk a portal/pages/ tree to resolve a sequence of URL segments
 * to a file. Returns the absolute path to the .tsx file (with extension), or null.
 */
function resolveSegments(currentDir: string, segments: string[]): string | null {
  // No more segments to consume — look for an index file in this directory.
  if (segments.length === 0) {
    return findPageFile(currentDir, 'index')
  }

  const [head, ...rest] = segments
  if (!head) return null

  // 1. Static directory match
  const staticDir = resolve(currentDir, head)
  if (existsSync(staticDir)) {
    try {
      if (statSync(staticDir).isDirectory()) {
        const nested = resolveSegments(staticDir, rest)
        if (nested) return nested
      }
    } catch {}
  }

  // 2. If this is the final segment, try a static file `<head>.tsx`.
  if (rest.length === 0) {
    const staticFile = findPageFile(currentDir, head)
    if (staticFile) return staticFile
  }

  // 3. Dynamic directory match: look for any [param] directory at this level.
  let entries: string[] = []
  try {
    entries = readdirSync(currentDir)
  } catch {
    return null
  }
  const dynamicDirs = entries.filter(name => {
    if (!name.startsWith('[') || !name.endsWith(']')) return false
    try {
      return statSync(resolve(currentDir, name)).isDirectory()
    } catch {
      return false
    }
  })
  for (const dynDir of dynamicDirs) {
    const nested = resolveSegments(resolve(currentDir, dynDir), rest)
    if (nested) return nested
  }

  // 4. Legacy fallback: at the final segment, look for `_param.tsx`.
  if (rest.length === 0) {
    const underscoreFiles = entries.filter(f => f.startsWith('_') && (f.endsWith('.tsx') || f.endsWith('.ts')))
    if (underscoreFiles.length > 0) {
      const file = underscoreFiles[0]
      return resolve(currentDir, file)
    }
  }

  return null
}

function findPageFile(pagesDir: string, name: string): string | null {
  for (const ext of ['.tsx', '.ts']) {
    const filePath = resolve(pagesDir, name + ext)
    if (existsSync(filePath)) return filePath
  }
  return null
}
