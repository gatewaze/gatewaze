'use client'

/**
 * MembersOnlyRegisterModal — shown when a visitor clicks "Register now" on an
 * event whose registration is gated to members (content_access policy,
 * action='register') and they are not a signed-in member.
 *
 * Two-panel layout mirroring the onboarding modal shell (frosted glass +
 * GlowBorder over a blurred backdrop, portalled to document.body):
 *   - Left:  sign in with LFID (the `sign-in:providers` module slot). After
 *            sign-in the LFID flow returns to the event page with `?register=1`,
 *            which EventContext resumes automatically.
 *   - Right: "Become a member" CTA linking to the brand's configurable
 *            membership URL (platform_settings.membership_url).
 *
 * The register CTA itself keeps saying "Register now"; this modal is the gate a
 * non-member hits on click.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { GlowBorder } from '@/components/ui/GlowBorder'
import { ModuleSlot } from '@/lib/modules'

const KEYFRAMES = `
@keyframes mor-modal-in { 0% { opacity: 0; transform: scale(0.94) } 100% { opacity: 1; transform: scale(1) } }
@media (prefers-reduced-motion: reduce) { .mor-modal__panel { animation-duration: 1ms !important } }
`

interface Props {
  open: boolean
  onClose: () => void
  eventTitle: string
  membershipUrl: string
  primaryColor: string
  /** True when a viewer is signed in but is not a member (modal only opens for non-members). */
  isSignedIn: boolean
  /** Where the LFID sign-in flow should return to (the event page + ?register=1). */
  redirectTo: string
  enabledModuleIds: string[]
  enabledFeatures: string[]
}

export function MembersOnlyRegisterModal({
  open,
  onClose,
  eventTitle,
  membershipUrl,
  primaryColor,
  isSignedIn,
  redirectTo,
  enabledModuleIds,
  enabledFeatures,
}: Props) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    if (!open) return
    setMounted(true)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
  }, [open, onClose])

  if (!open || !mounted) return null

  // Only honour http(s) membership URLs — the value is admin-set (Branding
  // settings) but rendered as an href, so guard against a javascript:/data: URL.
  const safeMembershipUrl = /^https?:\/\//i.test(membershipUrl) ? membershipUrl : ''

  const becomeMember: ReactNode = safeMembershipUrl ? (
    <a
      href={safeMembershipUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex w-full items-center justify-center gap-2.5 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
      style={{ backgroundColor: '#fff', color: '#000' }}
    >
      Become a member
    </a>
  ) : null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
      <style>{KEYFRAMES}</style>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div
        className="mor-modal__panel relative w-full"
        style={{ maxWidth: 720, animation: 'mor-modal-in 380ms cubic-bezier(0.16,1,0.3,1) both' }}
      >
        <GlowBorder borderRadius="var(--radius-card, 20px)">
          <div
            className="overflow-hidden shadow-2xl"
            style={{
              borderRadius: 'var(--radius-card, 20px)',
              backgroundColor: 'rgba(var(--panel-tint, 20,16,28), 0.92)',
              backdropFilter: 'blur(var(--glass-blur, 16px))',
              WebkitBackdropFilter: 'blur(var(--glass-blur, 16px))',
              border: '1px solid rgba(255,255,255, var(--glass-border-opacity, 0.1))',
            }}
          >
            <div className="flex items-center justify-between px-6 pt-5 pb-1">
              <strong className="text-white/90 text-sm font-semibold">Members-only event</strong>
              <button
                onClick={onClose}
                aria-label="Close"
                className="text-white/50 hover:text-white/90 text-2xl leading-none px-1 transition-colors"
              >
                ×
              </button>
            </div>

            {/* Scope: force the sign-in:providers slot button to a solid white
                button with black text. The LFID mark uses fill="currentColor",
                so a black text colour also renders the LF logo in black —
                matching the "Become a member" button. */}
            <style>{`
.mor-signin-solid button {
  background: #fff !important;
  color: #000 !important;
  border: 1px solid rgba(0,0,0,0.12) !important;
  backdrop-filter: none !important;
}
.mor-signin-solid button:hover { background: #f2f2f2 !important; }
`}</style>

            <p className="px-6 pb-4 pt-1 text-sm text-white/70">
              Registration for <span className="text-white/90 font-medium">{eventTitle}</span> is
              open to members{isSignedIn ? ', and your account isn’t a member yet.' : '.'}
            </p>

            <div className="flex flex-col gap-5 px-6 pb-6 sm:flex-row sm:gap-4">
              {/* Left: sign in with LFID */}
              <div className="flex-1 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <h3 className="text-sm font-semibold text-white/90">
                  {isSignedIn ? 'Signed in' : 'Already a member?'}
                </h3>
                <p className="mt-1 mb-4 text-xs text-white/60">
                  {isSignedIn
                    ? 'You’re signed in, but this account isn’t linked to a member organization. Register with a member email, or join below.'
                    : 'Sign in with your LFID to register with your member email.'}
                </p>
                {!isSignedIn && (
                  <div className="mor-signin-solid">
                    <ModuleSlot
                      name="sign-in:providers"
                      enabledModuleIds={enabledModuleIds}
                      enabledFeatures={enabledFeatures}
                      props={{ redirectTo, primaryColor, soleProvider: true }}
                    />
                  </div>
                )}
              </div>

              {/* Right: become a member */}
              {becomeMember && (
                <div className="flex-1 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                  <h3 className="text-sm font-semibold text-white/90">Not a member yet?</h3>
                  <p className="mt-1 mb-4 text-xs text-white/60">
                    Join to unlock registration for members-only events and more.
                  </p>
                  {becomeMember}
                </div>
              )}
            </div>
          </div>
        </GlowBorder>
      </div>
    </div>,
    document.body,
  )
}

export default MembersOnlyRegisterModal
