'use client'

import { useState } from 'react'
import { setDoNotSell, setDoNotShare, getPrivacyPreferences } from '@/lib/privacyCompliance'
import { GlowInput } from '@/components/ui/GlowInput'
import { PortalButton } from '@/components/ui/PortalButton'

interface CCPAPreferencesProps {
  brandEmail: string
  primaryColor?: string
}

export function CCPAPreferences({ brandEmail, primaryColor = '#3b82f6' }: CCPAPreferencesProps) {
  const [email, setEmail] = useState('')
  const [doNotSellState, setDoNotSellState] = useState(false)
  const [doNotShareState, setDoNotShareState] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)
  const [hasLoadedPreferences, setHasLoadedPreferences] = useState(false)

  const loadPreferences = async () => {
    if (!email) return

    setIsLoading(true)
    setResult(null)

    try {
      const prefs = await getPrivacyPreferences(email)
      if (prefs) {
        setDoNotSellState(prefs.doNotSell ?? false)
        setDoNotShareState(prefs.doNotShare ?? false)
        setHasLoadedPreferences(true)
      } else {
        setResult({
          success: false,
          message: 'No account found with this email. Your preferences will be saved when you create an account.',
        })
        setHasLoadedPreferences(true)
      }
    } catch {
      setResult({
        success: false,
        message: 'Failed to load preferences. Please try again.',
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleSave = async () => {
    if (!email) {
      setResult({ success: false, message: 'Please enter your email address.' })
      return
    }

    setIsSaving(true)
    setResult(null)

    try {
      const sellResult = await setDoNotSell(email, doNotSellState)
      const shareResult = await setDoNotShare(email, doNotShareState)

      if (sellResult.not_found || shareResult.not_found) {
        setResult({
          success: false,
          message: "Email address not found. We don't have any data associated with this email address.",
        })
      } else if (sellResult.success && shareResult.success) {
        setResult({
          success: true,
          message: 'Your CCPA preferences have been saved successfully.',
        })
      } else {
        setResult({
          success: false,
          message: 'Failed to save some preferences. Please try again or contact us.',
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
    <div
      className="bg-white/5 p-6 rounded-xl backdrop-blur-sm mt-6"
      style={{ border: `1px solid ${primaryColor}40` }}
    >
      <h3 className="text-lg font-semibold text-white mb-2">California Privacy Rights (CCPA)</h3>
      <p className="text-base text-white/70 mb-4">
        Under the California Consumer Privacy Act (CCPA), California residents have the right to opt out of the &quot;sale&quot; or
        &quot;sharing&quot; of their personal information.
      </p>

      <div className="space-y-4">
        <div>
          <label htmlFor="ccpa-email" className="block text-base font-medium text-white mb-2">
            Email Address
          </label>
          <div className="flex gap-2">
            <div className="flex-1">
              <GlowInput
                type="email"
                id="ccpa-email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  setHasLoadedPreferences(false)
                }}
                placeholder="Enter your email address"
                glowColor={primaryColor}
                borderRadius="0.5rem"
                className="w-full text-base px-4 py-2.5 border rounded-lg bg-white/10 text-white placeholder-white/50"
                style={{ borderColor: `${primaryColor}40` }}
              />
            </div>
            <PortalButton
              variant="secondary"
              primaryColor={primaryColor}
              onClick={loadPreferences}
              disabled={isLoading || !email}
              isLoading={isLoading}
            >
              {isLoading ? 'Loading...' : 'Load'}
            </PortalButton>
          </div>
        </div>

        {hasLoadedPreferences && (
          <>
            <div className="space-y-3 pt-2">
              <label className="flex items-start gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={doNotSellState}
                  onChange={(e) => setDoNotSellState(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-white/30 bg-white/10 cursor-pointer"
                  style={{ accentColor: primaryColor }}
                />
                <div>
                  <span className="font-medium text-white group-hover:text-white/90 transition-colors">Do Not Sell My Personal Information</span>
                  <p className="text-xs text-white/50 mt-1">Opt out of the sale of your personal information to third parties.</p>
                </div>
              </label>

              <label className="flex items-start gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={doNotShareState}
                  onChange={(e) => setDoNotShareState(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-white/30 bg-white/10 cursor-pointer"
                  style={{ accentColor: primaryColor }}
                />
                <div>
                  <span className="font-medium text-white group-hover:text-white/90 transition-colors">Do Not Share My Personal Information</span>
                  <p className="text-xs text-white/50 mt-1">Opt out of cross-context behavioral advertising.</p>
                </div>
              </label>
            </div>

            <PortalButton
              variant="primary"
              primaryColor={primaryColor}
              onClick={handleSave}
              disabled={isSaving}
              isLoading={isSaving}
              className="w-full"
            >
              {isSaving ? 'Saving...' : 'Save preferences'}
            </PortalButton>
          </>
        )}
      </div>

      {result && (
        <div
          className={`mt-4 p-4 rounded-lg ${
            result.success
              ? 'text-white'
              : 'bg-yellow-500/20 border border-yellow-400/50 text-yellow-300'
          }`}
          style={result.success ? { backgroundColor: `${primaryColor}33`, border: `1px solid ${primaryColor}80` } : undefined}
        >
          {result.message}
        </div>
      )}

      <p className="mt-4 text-xs text-white/50">
        You can also manage these preferences by emailing{' '}
        <a href={`mailto:${brandEmail}`} className="hover:underline" style={{ color: primaryColor }}>
          {brandEmail}
        </a>
      </p>
    </div>
  )
}
