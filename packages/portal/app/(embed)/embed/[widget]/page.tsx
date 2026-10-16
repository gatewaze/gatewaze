import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getEnabledModules } from '@/lib/modules/enabledModules'
import { getServerBrandConfig, isLightColor } from '@/config/brand'
import { EmbedHost } from '@/components/embed/EmbedHost'

/**
 * `/embed/<widget>` — a module widget for an iframe on another site.
 * See components/embed/EmbedHost.tsx for what the widget receives, and
 * lib/frame-policy.ts for who may frame it.
 *
 * Appearance, so the embedding site can match it (styles/embed.css):
 *   ?theme=light|dark       default light
 *   ?bg=card|transparent    default card; transparent blends into the host
 *   ?accent=RRGGBB          button colour (hex, with or without #); default
 *                           the brand colour
 */

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { robots: { index: false, follow: false } }

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) || ''
}

export default async function EmbedPage({
  params,
  searchParams,
}: {
  params: Promise<{ widget: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { widget } = await params
  if (!/^[a-z0-9-]{1,40}$/.test(widget)) notFound()
  const q = await searchParams
  const brand = await getServerBrandConfig()

  const theme = one(q.theme) === 'dark' ? 'dark' : 'light'
  const bg = one(q.bg) === 'transparent' ? 'transparent' : 'card'
  // Only a 6-digit hex reaches the style attribute; anything else falls back.
  const rawAccent = one(q.accent).replace(/^#/, '')
  const accent = /^[0-9a-fA-F]{6}$/.test(rawAccent)
    ? `#${rawAccent.toLowerCase()}`
    : (/^#[0-9a-fA-F]{6}$/.test(brand.primaryColor || '') ? brand.primaryColor : null)
  const onAccent = accent ? (isLightColor(accent) ? '#000000' : '#ffffff') : null

  const modules = await getEnabledModules()
  return (
    <EmbedHost
      appearance={{ theme, bg, accent, onAccent }}
      widget={widget}
      enabledModuleIds={[...modules.enabledIds]}
      enabledFeatures={[...modules.enabledFeatures]}
    />
  )
}
