'use client'

import { PortalPageLayout } from '@/components/ui/PortalPageLayout'
import { PageHeader } from '@/components/ui/PageHeader'
import { GlassPanel } from '@/components/ui/GlassPanel'
import type { BrandConfig } from '@/config/brand'
import { DataRightsRequestForm } from '@/components/privacy/DataRightsRequestForm'
import { CCPAPreferences } from '@/components/privacy/CCPAPreferences'
import { sanitizeHtml } from '@/lib/sanitize-html'

interface Props {
  brandConfig: BrandConfig
  customHtml: string | null
}

export function PrivacyPageContent({ brandConfig, customHtml }: Props) {
  const primaryColor = brandConfig.primaryColor
  const contactEmail = brandConfig.contactEmail || 'privacy@example.com'

  return (
    <PortalPageLayout>
      <PageHeader title="Privacy Policy" />

      <GlassPanel>
        {customHtml ? (
          <div
            className="legal-prose"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(customHtml, 'marketing-page') }}
          />
        ) : (
          <p className="text-white/50 text-center py-8">
            Privacy Policy goes here.
          </p>
        )}

        {/* Data rights request forms — always shown */}
        <div className="mt-8 space-y-6">
          <h2 className="text-xl font-semibold text-white">Manage Your Privacy</h2>
          <DataRightsRequestForm brandEmail={contactEmail} primaryColor={primaryColor} />
          <CCPAPreferences brandEmail={contactEmail} primaryColor={primaryColor} />
        </div>
      </GlassPanel>
    </PortalPageLayout>
  )
}
