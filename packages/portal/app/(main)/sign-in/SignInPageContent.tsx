'use client'

import type { BrandConfig } from '@/config/brand'
import { SignInForm } from './SignInForm'
import { GlassPanel } from '@/components/ui/GlassPanel'

interface Props {
  brandConfig: BrandConfig
  enabledModuleIds?: string[]
  enabledFeatures?: string[]
}

export function SignInPageContent({ brandConfig, enabledModuleIds, enabledFeatures }: Props) {
  // Center in normal flow (min-h-screen) rather than position:fixed. The page
  // transition (app/(main)/template.tsx) animates a transform on an ancestor,
  // and a transformed ancestor makes position:fixed resolve relative to it —
  // which mispositioned the card (top-left) until the animation's transform
  // cleared, then it snapped to centre. In-flow centring isn't affected.
  return (
    <main className="min-h-screen relative z-10 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <GlassPanel padding="p-8">
          <SignInForm
            brandConfig={brandConfig}
            enabledModuleIds={enabledModuleIds}
            enabledFeatures={enabledFeatures}
          />
        </GlassPanel>
      </div>
    </main>
  )
}
