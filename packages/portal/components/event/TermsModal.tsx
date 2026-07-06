'use client'

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { PortalButton } from '@/components/ui/PortalButton'
import { getClientBrandConfig } from '@/config/brand'

interface Props {
  title?: string
  /** Admin-configured HTML body (platform_settings.event_terms_html). */
  html: string
  onAccept: () => void
  onClose: () => void
}

/**
 * Event terms modal (Luma-style): scrollable terms body with a full-width
 * "Accept Terms" button that checks the agreement checkbox on the form behind
 * it. Styled like the ProfileCompletionWizard — the same blurred backdrop and
 * token-driven GlassPanel (glass opacity/blur/tint come from the brand theme),
 * no hard-coded panel colour. Portalled to <body> so page transforms/stacking
 * contexts can't trap it.
 */
export function TermsModal({ title = 'Event Terms', html, onAccept, onClose }: Props) {
  const brandConfig = getClientBrandConfig()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center px-4" role="dialog" aria-modal="true" aria-label={title}>
      {/* Backdrop — identical treatment to ProfileWizard */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-lg">
        <GlassPanel padding="p-0" className="overflow-hidden">
          <div className="flex max-h-[85vh] flex-col">
            <div className="flex items-start justify-between px-6 pt-6 pb-3">
              <h2 className="text-xl font-semibold text-white">{title}</h2>
              <button
                type="button"
                aria-label="Close"
                onClick={onClose}
                className="rounded-full p-1.5 text-white/60 hover:text-white hover:bg-white/10 transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <div
              className="px-6 pb-4 overflow-y-auto text-sm leading-relaxed text-white/80 [&_h2]:text-white [&_h2]:font-semibold [&_h2]:text-base [&_h2]:mt-5 [&_h2]:mb-2 [&_h3]:text-white [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2 [&_p]:mb-3 [&_a]:underline [&_a]:text-white"
              dangerouslySetInnerHTML={{ __html: html }}
            />
            <div className="px-6 pb-6 pt-3">
              <PortalButton
                variant="primary"
                primaryColor={brandConfig.primaryColor}
                onClick={onAccept}
                glow
                className="w-full"
              >
                Accept Terms
              </PortalButton>
            </div>
          </div>
        </GlassPanel>
      </div>
    </div>,
    document.body,
  ) as React.ReactNode
}
