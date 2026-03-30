import { notFound } from 'next/navigation'
import { getEnabledModules } from '@/lib/modules/enabledModules'

export default async function EventsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const modules = await getEnabledModules()
  if (!modules.enabledIds.has('events')) {
    notFound()
  }

  return <>{children}</>
}
