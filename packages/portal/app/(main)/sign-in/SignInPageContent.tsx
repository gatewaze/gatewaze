'use client'

import type { BrandConfig } from '@/config/brand'
import { SignInForm } from './SignInForm'
import { GlassPanel } from '@/components/ui/GlassPanel'

interface Props {
  brandConfig: BrandConfig
}

export function SignInPageContent({ brandConfig }: Props) {
  // Content uses fixed positioning to center in full viewport regardless of header
  // No wrapper div needed - fixed position removes it from document flow
  return (
    <main className="fixed inset-0 z-10 flex items-center justify-center px-4 pointer-events-none">
      <div className="w-full max-w-md pointer-events-auto">
        <GlassPanel padding="p-8">
          <SignInForm brandConfig={brandConfig} />
        </GlassPanel>
      </div>
    </main>
  )
}
