import { notFound, redirect } from 'next/navigation'
import { Suspense } from 'react'
import { getEnabledModules, isModuleEnabled } from '@/lib/modules/enabledModules'
import { findModulePage, extractParams } from '@/lib/modules/generated-portal-modules'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ path: string[] }>
}

export default async function ModulePage({ params }: Props) {
  const { path } = await params
  const pathname = '/' + path.join('/')

  const page = findModulePage(pathname)
  if (!page) {
    notFound()
  }

  // Check that the module is enabled
  const modules = await getEnabledModules()
  if (!isModuleEnabled(modules, page.moduleId)) {
    redirect('/')
  }

  // Extract dynamic params from route pattern (e.g., /forms/[slug] → { slug: 'meetup-organizer' })
  const moduleParams = extractParams(page.path, pathname)

  // Lazy-load and render the module's page component
  const { default: PageComponent } = await page.component()

  // Pass API URL from server env so client components can reach the API service
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || ''

  return (
    <Suspense fallback={null}>
      <PageComponent params={moduleParams} apiUrl={apiUrl} />
    </Suspense>
  )
}
