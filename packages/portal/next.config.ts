import type { NextConfig } from 'next'
import { existsSync, readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load generated module source directories (produced by generate-module-registry.ts)
const dirsPath = resolve(__dirname, 'lib/modules/generated-modules-dirs.json')
const moduleDirs: string[] = existsSync(dirsPath)
  ? JSON.parse(readFileSync(dirsPath, 'utf-8'))
  : []

/**
 * Build the next/image `remotePatterns` allow-list. Static entries cover
 * external services (Luma, LinkedIn, etc.); dynamic entries are derived from
 * the running deployment's Supabase URL(s) so each brand's own storage host
 * is allowed without per-brand config edits.
 */
function buildRemotePatterns() {
  const staticEntries = [
    { protocol: 'https' as const, hostname: '**.supabase.co' },
    { protocol: 'https' as const, hostname: 'lu.ma' },
    { protocol: 'https' as const, hostname: 'images.lumacdn.com' },
    // User avatar sources
    { protocol: 'https' as const, hostname: 'www.gravatar.com' },
    { protocol: 'https' as const, hostname: '*.licdn.com' },
    { protocol: 'https' as const, hostname: 'media.licdn.com' },
    // Customer.io profile pics
    { protocol: 'https' as const, hostname: 'cdn.customer.io' },
    // Generic image hosts that brands commonly use
    { protocol: 'https' as const, hostname: 'images.unsplash.com' },
    { protocol: 'https' as const, hostname: '**.cloudfront.net' },
    // YouTube thumbnails (MediaContent video previews)
    { protocol: 'https' as const, hostname: 'i.ytimg.com' },
    { protocol: 'https' as const, hostname: 'img.youtube.com' },
  ]

  const dynamic: Array<{ protocol: 'http' | 'https'; hostname: string }> = []
  const seen = new Set<string>()
  const addHostFromUrl = (raw: string | undefined) => {
    if (!raw) return
    try {
      const parsed = new URL(raw)
      const protocol = parsed.protocol.replace(':', '') === 'https' ? 'https' : 'http'
      const key = `${protocol}://${parsed.hostname}`
      if (seen.has(key)) return
      seen.add(key)
      dynamic.push({ protocol, hostname: parsed.hostname })
    } catch {
      /* ignore unparseable URL */
    }
  }

  // Self-host / per-brand Supabase hosts (where uploaded images live).
  addHostFromUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)
  addHostFromUrl(process.env.SUPABASE_URL)

  // Operator escape hatch: comma-separated extra hosts.
  const extras = (process.env.IMAGE_REMOTE_HOSTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  for (const h of extras) {
    // Accept either bare hostname or a full URL — addHostFromUrl handles URLs;
    // for bare hostnames, allow both http + https since we can't tell.
    if (h.includes('://')) addHostFromUrl(h)
    else {
      const key = `*://${h}`
      if (!seen.has(key)) {
        seen.add(key)
        dynamic.push({ protocol: 'http', hostname: h })
        dynamic.push({ protocol: 'https', hostname: h })
      }
    }
  }

  return [...staticEntries, ...dynamic]
}

/**
 * Decide whether to bypass next/image optimization entirely.
 *
 * The optimizer runs inside the portal container and fetches the original
 * image to transform it. When the storage host is a `.localhost` name (dev
 * docker-compose with `/etc/hosts` on the host machine only), the container
 * can't resolve it and 500s. Browsers loading the URL directly work fine —
 * `/etc/hosts` is on the same machine — so `unoptimized: true` is the right
 * answer here: the `<Image>` element just emits the configured URL and the
 * browser fetches straight from Supabase Storage.
 *
 * Operators can force-set this either way via `NEXT_IMAGE_UNOPTIMIZED=true`
 * or `NEXT_IMAGE_UNOPTIMIZED=false`.
 */
function shouldDisableImageOptimizer(): boolean {
  const explicit = process.env.NEXT_IMAGE_UNOPTIMIZED
  if (explicit === 'true' || explicit === '1') return true
  if (explicit === 'false' || explicit === '0') return false
  // Auto-detect: any *.localhost host in either Supabase URL.
  const candidates = [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_URL].filter(Boolean) as string[]
  for (const raw of candidates) {
    try {
      const host = new URL(raw).hostname
      if (host.endsWith('.localhost') || host === 'localhost') return true
    } catch {
      /* ignore unparseable URL */
    }
  }
  return false
}

// Detect the OpenNext / Cloudflare Workers build path. The CI workflow
// portal-deploy.yml sets OPENNEXT_BUILD=1 before invoking next build so
// we can swap incompatible features (sharp-based image optimizer,
// `output: 'standalone'`) for their Workers-friendly equivalents
// without touching the K8s build pipeline. See
// spec-portal-on-cloudflare-workers §4.6 / §4.1.
const isOpenNextBuild = process.env.OPENNEXT_BUILD === '1' || process.env.OPENNEXT_BUILD === 'true'

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Transpile shared workspace package and module portal components
  transpilePackages: ['@gatewaze/shared'],

  webpack: (config) => {
    // `@gatewaze-modules/<module>` resolves to the first matching module
    // dir on disk. Mirrors the tsconfig path alias so portal code can do
    // `import { eventsListingSchema } from '@gatewaze-modules/events/listing-schema'`
    // under both the dev local-checkout layout and the container layout.
    const moduleAliasPaths = moduleDirs.length > 0
      ? moduleDirs
      : [
          resolve(__dirname, '../../../gatewaze-modules/modules'),
          resolve(__dirname, '../../../premium-gatewaze-modules/modules'),
          resolve(__dirname, '../../../lf-gatewaze-modules/modules'),
        ]
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      '@gatewaze-modules': moduleAliasPaths,
    }

    if (moduleDirs.length > 0) {
      // Ensure module files can import packages from the portal's node_modules
      config.resolve.modules = [
        ...(config.resolve.modules || ['node_modules']),
        resolve(__dirname, 'node_modules'),
        resolve(__dirname, '../../node_modules'),
      ]

      // Allow SWC to transpile .tsx/.ts from external module directories
      for (const rule of config.module.rules || []) {
        if (rule && typeof rule === 'object' && rule.oneOf) {
          for (const oneOfRule of rule.oneOf) {
            const test = oneOfRule?.test?.toString() || ''
            if (oneOfRule?.include && (test.includes('tsx') || test.includes('jsx') || test.includes('ts'))) {
              if (!Array.isArray(oneOfRule.include)) {
                oneOfRule.include = [oneOfRule.include]
              }
              for (const dir of moduleDirs) {
                oneOfRule.include.push(dir)
              }
            }
          }
        }
      }
    }
    return config
  },

  // Move dev indicator to bottom-right to avoid overlapping cookie consent button
  devIndicators: {
    position: 'bottom-right',
  },

  // Standalone output. Required by both the K8s containerized build
  // (Dockerfile copies .next/standalone/) AND by @opennextjs/cloudflare
  // (the Workers adapter reads standalone output as its build input —
  // see https://opennext.js.org/cloudflare/get-started). The first
  // staging deploy attempt set this to `undefined` on the OpenNext
  // path, which made `next build`'s "Collect page data" step fail
  // when it couldn't resolve emitted browser assets — standalone
  // forces Next to emit them in a stable layout that downstream
  // tools (and OpenNext) rely on.
  output: 'standalone',

  // Skip type checking in build (handled separately in CI)
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },

  // Image optimization domains. Add new hosts here when migrating an
  // <img> to next/image so the bundler can fetch + transform the
  // remote asset at request time.
  //
  // The Supabase storage host varies per deployment — Cloud uses
  // `*.supabase.co`, self-host uses whatever `SUPABASE_URL` /
  // `NEXT_PUBLIC_SUPABASE_URL` is set to (e.g. `supabase.brand.com` in
  // production, `supabase.brand.localhost` in dev). Derive those at
  // config-load time so we don't need a manual entry per brand. Operators
  // can also add extras via the comma-separated `IMAGE_REMOTE_HOSTS` env.
  //
  // unoptimized: when the storage host is a `.localhost` name, the Next.js
  // optimizer (which runs inside the portal container) can't resolve it via
  // /etc/hosts (those entries live on the host machine), so it 500s when
  // trying to fetch the original to transform. Disable optimization for
  // these dev setups — the browser loads the URL directly. Production
  // (Supabase Cloud or any public TLD) keeps optimization on.
  images: isOpenNextBuild
    ? {
        // On Workers, the built-in optimizer (sharp) doesn't run. Use
        // Cloudflare Image Resizing via the custom loader. See
        // spec-portal-on-cloudflare-workers §4.6 + lib/imageLoader.ts.
        // remotePatterns are still honoured for the next/image
        // allow-list — Cloudflare's resizing worker will reject hosts
        // not allowlisted in the zone's Image Resizing settings.
        loader: 'custom',
        loaderFile: './lib/imageLoader.ts',
        remotePatterns: buildRemotePatterns(),
      }
    : {
        remotePatterns: buildRemotePatterns(),
        unoptimized: shouldDisableImageOptimizer(),
      },

  // Headers for caching static assets
  async headers() {
    return [
      {
        source: '/js/cookieconsent/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        source: '/policies/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=3600',
          },
        ],
      },
    ]
  },
}

export default nextConfig
