import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getEnabledModules } from '@/lib/modules/enabledModules'
import { EmbedHost } from '@/components/embed/EmbedHost'

/**
 * `/embed/<widget>` — a module widget for an iframe on another site.
 * See components/embed/EmbedHost.tsx for what the widget receives, and
 * lib/frame-policy.ts for who may frame it.
 */

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { robots: { index: false, follow: false } }

export default async function EmbedPage({ params }: { params: Promise<{ widget: string }> }) {
  const { widget } = await params
  if (!/^[a-z0-9-]{1,40}$/.test(widget)) notFound()
  const modules = await getEnabledModules()
  return (
    <EmbedHost
      widget={widget}
      enabledModuleIds={[...modules.enabledIds]}
      enabledFeatures={[...modules.enabledFeatures]}
    />
  )
}
