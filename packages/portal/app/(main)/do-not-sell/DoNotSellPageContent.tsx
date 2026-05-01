'use client'

import { useState } from 'react'
import { PortalPageLayout } from '@/components/ui/PortalPageLayout'
import { PageHeader } from '@/components/ui/PageHeader'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { GlowInput } from '@/components/ui/GlowInput'
import { PortalButton } from '@/components/ui/PortalButton'
import { setDoNotSell, setDoNotShare } from '@/lib/privacyCompliance'
import { sanitizeHtml } from '@/lib/sanitize-html'
import type { BrandConfig } from '@/config/brand'

interface Props {
  brandConfig: BrandConfig
  brand: string
  customHtml?: string | null
}

export function DoNotSellPageContent({ brandConfig, brand, customHtml }: Props) {
  const primaryColor = brandConfig.primaryColor
  const brandEmail = brandConfig.contactEmail || 'privacy@example.com'

  const [email, setEmail] = useState('')
  const [doNotSellChecked, setDoNotSellChecked] = useState(true)
  const [doNotShareChecked, setDoNotShareChecked] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!email) {
      setResult({ success: false, message: 'Please enter your email address.' })
      return
    }

    setIsSaving(true)
    setResult(null)

    try {
      const sellResult = await setDoNotSell(email, doNotSellChecked)
      const shareResult = await setDoNotShare(email, doNotShareChecked)

      if (sellResult.not_found || shareResult.not_found) {
        setResult({
          success: false,
          message: "Email address not found. We don't have any data associated with this email address.",
        })
      } else if (sellResult.success || shareResult.success) {
        setResult({
          success: true,
          message: 'Your preferences have been saved. We will not sell or share your personal information.',
        })
      } else {
        setResult({
          success: false,
          message: 'We could not save your preferences. Please try again or contact us directly.',
        })
      }
    } catch {
      setResult({
        success: false,
        message: `An error occurred. Please contact us at ${brandEmail}.`,
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <PortalPageLayout>
      <PageHeader title="Do Not Sell My Info" />

      <GlassPanel>
        {customHtml ? (
          <div
            className="legal-prose mb-6"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(customHtml, 'marketing-page') }}
          />
        ) : (
          <p className="text-white/70 mb-6">
            Under the California Consumer Privacy Act (CCPA) and similar privacy laws, you have the right to opt out of
            the &quot;sale&quot; or &quot;sharing&quot; of your personal information. Use this form to exercise your rights.
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="dns-email" className="block text-base font-medium text-white mb-2">
              Email Address
            </label>
            <GlowInput
              type="email"
              id="dns-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="Enter your email address"
              glowColor={primaryColor}
              borderRadius="0.5rem"
              className="w-full text-base px-4 py-2.5 border rounded-lg bg-white/10 text-white placeholder-white/50"
              style={{ borderColor: `${primaryColor}40` }}
            />
          </div>

          <div className="space-y-4">
            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={doNotSellChecked}
                onChange={(e) => setDoNotSellChecked(e.target.checked)}
                className="mt-1 h-4 w-4 rounded cursor-pointer"
                style={{ accentColor: primaryColor }}
              />
              <div>
                <span className="font-medium text-white group-hover:text-white/90 transition-colors">
                  Do Not Sell My Personal Information
                </span>
                <p className="text-xs text-white/50 mt-1">
                  Opt out of the sale of your personal information to third parties.
                </p>
              </div>
            </label>

            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={doNotShareChecked}
                onChange={(e) => setDoNotShareChecked(e.target.checked)}
                className="mt-1 h-4 w-4 rounded cursor-pointer"
                style={{ accentColor: primaryColor }}
              />
              <div>
                <span className="font-medium text-white group-hover:text-white/90 transition-colors">
                  Do Not Share My Personal Information
                </span>
                <p className="text-xs text-white/50 mt-1">
                  Opt out of cross-context behavioral advertising.
                </p>
              </div>
            </label>
          </div>

          <PortalButton
            type="submit"
            variant="primary"
            primaryColor={primaryColor}
            disabled={isSaving}
            isLoading={isSaving}
            className="w-full"
          >
            {isSaving ? 'Saving...' : 'Save my preferences'}
          </PortalButton>
        </form>

        {result && (
          <div
            className={`mt-6 p-4 rounded-lg ${
              result.success
                ? 'text-white'
                : 'bg-yellow-500/20 border border-yellow-400/50 text-yellow-300'
            }`}
            style={result.success ? { backgroundColor: `${primaryColor}33`, border: `1px solid ${primaryColor}80` } : undefined}
          >
            {result.message}
          </div>
        )}

        <p className="mt-6 text-xs text-white/50 text-center">
          Questions? Contact us at{' '}
          <a href={`mailto:${brandEmail}`} className="hover:underline" style={{ color: primaryColor }}>
            {brandEmail}
          </a>
        </p>
      </GlassPanel>
    </PortalPageLayout>
  )
}
