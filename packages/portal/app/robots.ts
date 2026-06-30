import type { MetadataRoute } from 'next'
import { getServerBrandConfig } from '@/config/brand'

export const dynamic = 'force-dynamic'

// Paths that no crawler — human-search or AI — should index. Auth/account
// surfaces and the API (which has its own machine-readable contracts at
// /api/v1 + /.well-known/openapi.json) are off-limits; everything else is open.
const DISALLOW = ['/api/', '/auth/', '/profile/', '/sign-in/', '/admin/']

// AI / LLM crawlers we explicitly welcome. Agent traffic is a goal for this
// portal, so we list these by name and Allow them rather than relying on the
// generic `*` rule — some are blocked by default elsewhere, and naming them
// signals intent (and pre-empts any conservative default a CDN might apply).
const AI_CRAWLERS = [
  // OpenAI
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  // Anthropic
  'ClaudeBot',
  'Claude-Web',
  'anthropic-ai',
  'Claude-SearchBot',
  // Perplexity
  'PerplexityBot',
  'Perplexity-User',
  // Google / Apple / others (the *-Extended agents gate AI training/grounding)
  'Google-Extended',
  'Applebot-Extended',
  'Amazonbot',
  'Meta-ExternalAgent',
  'cohere-ai',
  'DuckAssistBot',
  'CCBot',
  'YouBot',
]

export default async function robots(): Promise<MetadataRoute.Robots> {
  const brandConfig = await getServerBrandConfig()
  const baseUrl = `https://${brandConfig.domain}`

  return {
    rules: [
      // Explicit welcome for AI agents — same access boundary as everyone else.
      { userAgent: AI_CRAWLERS, allow: '/', disallow: DISALLOW },
      // Everyone else.
      { userAgent: '*', allow: '/', disallow: DISALLOW },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  }
}
