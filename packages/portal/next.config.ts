import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Transpile shared workspace package
  transpilePackages: ['@gatewaze/shared'],

  // Move dev indicator to bottom-right to avoid overlapping cookie consent button
  devIndicators: {
    position: 'bottom-right',
  },

  // Standalone output for containerized deployment
  output: 'standalone',

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
