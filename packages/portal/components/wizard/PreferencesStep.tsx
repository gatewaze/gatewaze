'use client'

import type { BrandConfig } from '@/config/brand'
import { isLightColor } from '@/config/brand'

interface Props {
  brandConfig: BrandConfig
  marketingConsent: boolean
  onChange: (value: boolean) => void
}

/**
 * Wizard step for collecting communication preferences.
 * Defaults to unchecked — user must actively opt in.
 */
export function PreferencesStep({ brandConfig, marketingConsent, onChange }: Props) {
  const primaryColor = brandConfig.primaryColor

  return (
    <div className="space-y-6">
      <p className="text-white/70 text-sm text-center mb-6">
        Choose how you&apos;d like to hear from us.
      </p>

      <label className="flex items-start gap-3 cursor-pointer group">
        <div className="relative flex-shrink-0 mt-0.5">
          <input
            type="checkbox"
            checked={marketingConsent}
            onChange={(e) => onChange(e.target.checked)}
            className="sr-only peer"
          />
          <div
            className="w-5 h-5 rounded border-2 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-transparent"
            style={{
              borderColor: marketingConsent ? primaryColor : 'rgba(255,255,255,0.4)',
              backgroundColor: marketingConsent ? primaryColor : 'transparent',
            }}
          >
            {marketingConsent && (
              <svg className="w-full h-full" viewBox="0 0 20 20" fill="currentColor" style={{ color: isLightColor(primaryColor) ? '#000000' : '#ffffff' }}>
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
            )}
          </div>
        </div>
        <div>
          <span className="text-white text-sm font-medium">
            I&apos;d like to receive updates and news
          </span>
          <p className="text-white/50 text-xs mt-1">
            We&apos;ll send you occasional updates about events, community news, and relevant content. No spam, ever.
          </p>
        </div>
      </label>

      <p className="text-white/40 text-xs text-center">
        You can change this at any time in your profile settings.
      </p>
    </div>
  )
}
