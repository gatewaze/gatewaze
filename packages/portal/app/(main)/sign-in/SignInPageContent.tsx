'use client'

import { useSearchParams } from 'next/navigation'
import type { BrandConfig } from '@/config/brand'
import { SignInForm } from './SignInForm'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { hasPortalSlot } from '@/lib/modules'

interface Props {
  brandConfig: BrandConfig
  enabledModuleIds?: string[]
  enabledFeatures?: string[]
}

export function SignInPageContent({ brandConfig, enabledModuleIds, enabledFeatures }: Props) {
  const searchParams = useSearchParams()
  // Sole-SSO + explicit sign-in intent (?sso=1): the page is only a
  // pass-through to the provider — no card, no heading, just the provider's
  // minimal "Processing sign in…" surface while the redirect kicks off.
  // Route-guard bounces (no sso=1) keep the card + button so sign-out isn't
  // silently reverted while the upstream SSO session is still alive.
  const ssoPassThrough =
    hasPortalSlot('sign-in:providers', new Set(enabledModuleIds ?? []), new Set(enabledFeatures ?? [])) &&
    searchParams.get('sso') === '1'

  // Center in normal flow (min-h-screen) rather than position:fixed. The page
  // transition (app/(main)/template.tsx) animates a transform on an ancestor,
  // and a transformed ancestor makes position:fixed resolve relative to it —
  // which mispositioned the card (top-left) until the animation's transform
  // cleared, then it snapped to centre. In-flow centring isn't affected.
  return (
    <main className="min-h-screen relative z-10 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        {ssoPassThrough ? (
          <SignInForm
            brandConfig={brandConfig}
            enabledModuleIds={enabledModuleIds}
            enabledFeatures={enabledFeatures}
            minimal
          />
        ) : (
          <GlassPanel padding="p-8">
            <SignInForm
              brandConfig={brandConfig}
              enabledModuleIds={enabledModuleIds}
              enabledFeatures={enabledFeatures}
            />
          </GlassPanel>
        )}
      </div>
    </main>
  )
}
