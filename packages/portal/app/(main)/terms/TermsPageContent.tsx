'use client'

import { PortalPageLayout } from '@/components/ui/PortalPageLayout'
import { PageHeader } from '@/components/ui/PageHeader'
import { GlassPanel } from '@/components/ui/GlassPanel'
import type { BrandConfig } from '@/config/brand'
import { sanitizeHtml } from '@/lib/sanitize-html'

interface Props {
  brandConfig: BrandConfig
  customHtml: string | null
}

export function TermsPageContent({ brandConfig: _brandConfig, customHtml }: Props) {
  return (
    <PortalPageLayout>
      <PageHeader title="Terms of Service" />

      <GlassPanel>
        {customHtml ? (
          <div
            className="legal-prose"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(customHtml, 'marketing-page') }}
          />
        ) : (
          <p className="text-white/50 text-center py-8">
            Terms of Service goes here.
          </p>
        )}
      </GlassPanel>
    </PortalPageLayout>
  )
}
