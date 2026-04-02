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

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Transpile shared workspace package and module portal components
  transpilePackages: ['@gatewaze/shared'],

  webpack: (config) => {
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

  // Standalone output for containerized deployment
  output: 'standalone',

  // Skip type checking in build (handled separately in CI)
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },

  // Image optimization domains
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
      },
      {
        protocol: 'https',
        hostname: 'lu.ma',
      },
      {
        protocol: 'https',
        hostname: 'images.lumacdn.com',
      },
    ],
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
