'use client'

import { useState, useEffect, useMemo } from 'react'
import { useEventContext } from './EventContext'
import { useAuth } from '@/hooks/useAuth'
import { useDiscountCode } from '@/hooks/useDiscountCode'
import { GlowBorder } from '@/components/ui/GlowBorder'
import { GlowInput } from '@/components/ui/GlowInput'
import { PortalButton } from '@/components/ui/PortalButton'
import { getSupabaseClient } from '@/lib/supabase/client'
import { getClientBrandConfig } from '@/config/brand'
import type { EventDiscount } from '@/types/event'
import DOMPurify from 'isomorphic-dompurify'

export interface DiscountWithCode extends EventDiscount {
  existingCode?: string | null
}

export function DiscountCard({ discount, index }: { discount: DiscountWithCode; index: number }) {
  const { event, useDarkText } = useEventContext()
  const { session } = useAuth()
  const { claimCode, claimLumaCode, checkExistingCode, getAvailableCount, isClaiming, error } = useDiscountCode()
  const isDynamic = !!discount.luma_event_api_id

  const brandConfig = getClientBrandConfig()
  const brandPrimary = brandConfig.primaryColor

  const [email, setEmail] = useState('')
  const [claimedCode, setClaimedCode] = useState<string | null>(discount.existingCode || null)
  const [availableCount, setAvailableCount] = useState<number | null>(null)
  const [showConfetti, setShowConfetti] = useState(false)
  const [copied, setCopied] = useState(false)
  const [, setMagicLinkSent] = useState(false)
  const [codePending, setCodePending] = useState(false)

  const eventId = event.event_id

  const panelBorder = useMemo(
    () => useDarkText ? 'border border-gray-700/50' : 'border border-white/20',
    [useDarkText]
  )

  // Prefill email from sessionStorage on mount
  useEffect(() => {
    const prefillEmail = sessionStorage.getItem('prefill_email')
    if (prefillEmail && !session) {
      setEmail(prefillEmail)
    }
  }, [session])

  // Check for existing code on mount and when session changes
  useEffect(() => {
    async function checkCode() {
      const userEmail = session?.user?.email || sessionStorage.getItem('prefill_email')
      if (!userEmail || claimedCode) return

      const result = await checkExistingCode(userEmail, eventId)
      if (result.has_code && result.code) {
        setClaimedCode(result.code)
        setCodePending(false)
      }
    }
    checkCode()
  }, [session, eventId, claimedCode, checkExistingCode])

  // Get available code count on mount
  useEffect(() => {
    async function fetchCount() {
      if (isDynamic) {
        // For dynamic discounts with a max_codes limit, fetch the issued count
        if (discount.max_codes == null) return
        const supabase = getSupabaseClient()
        const { count } = await supabase
          .from('events_discount_codes')
          .select('*', { count: 'exact', head: true })
          .eq('discount_id', discount.id)
          .eq('issued', true)
        const issued = count ?? 0
        setAvailableCount(Math.max(0, discount.max_codes - issued))
      } else {
        const count = await getAvailableCount(eventId)
        setAvailableCount(count)
      }
    }
    fetchCount()
  }, [eventId, getAvailableCount, isDynamic, discount.id, discount.max_codes])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const claimEmail = session?.user?.email || email.trim()
    if (!claimEmail) return

    const result = isDynamic
      ? await claimLumaCode(claimEmail, discount.id)
      : await claimCode(claimEmail, eventId)

    if (result.sold_out) {
      setAvailableCount(0)
      return
    }

    if (result.success && result.code) {
      if (session) {
        setClaimedCode(result.code)
        setShowConfetti(true)
        if (!isDynamic) {
          const count = await getAvailableCount(eventId)
          setAvailableCount(count)
        } else if (discount.max_codes != null) {
          setAvailableCount((prev) => Math.max(0, (prev ?? discount.max_codes!) - 1))
        }
        setTimeout(() => setShowConfetti(false), 3000)
      } else {
        setCodePending(true)
        try {
          const supabase = getSupabaseClient()
          const { error: magicLinkError } = await supabase.auth.signInWithOtp({
            email: claimEmail,
            options: {
              emailRedirectTo: `${window.location.origin}${window.location.pathname}`,
            },
          })
          if (!magicLinkError) setMagicLinkSent(true)
        } catch (err) {
          console.error('Error sending magic link:', err)
        }
      }
    }
  }

  const handleCopy = () => {
    if (claimedCode) {
      navigator.clipboard.writeText(claimedCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const sanitizedContent = discount.content
    ? DOMPurify.sanitize(discount.content, {
        ALLOWED_TAGS: [
          'p', 'br', 'strong', 'em', 'u', 's', 'a', 'ul', 'ol', 'li',
          'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'code', 'pre'
        ],
        ALLOWED_ATTR: ['href', 'target', 'rel']
      })
    : null

  const formatCloseDate = () => {
    if (discount.close_display) return discount.close_display
    if (!discount.close_date) return null
    const date = new Date(discount.close_date)
    return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  }

  const isClosingSoon = () => {
    if (!discount.close_date) return false
    const closeDate = new Date(discount.close_date)
    const now = new Date()
    const hoursLeft = (closeDate.getTime() - now.getTime()) / (1000 * 60 * 60)
    return hoursLeft > 0 && hoursLeft <= 72
  }

  const isSoldOut = !codePending && availableCount !== null && availableCount === 0 && (!isDynamic || discount.max_codes != null)

  return (
    <div
      className="transition-opacity duration-300 ease-out relative"
      style={{ animationDelay: `${index * 100}ms` }}
    >
      {/* Confetti effect */}
      {showConfetti && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-2xl z-10">
          {[...Array(20)].map((_, i) => (
            <div
              key={i}
              className="absolute w-2 h-2 animate-confetti"
              style={{
                left: `${Math.random() * 100}%`,
                top: '-10%',
                backgroundColor: ['#FFD700', '#FF6B9D', '#C398FF', '#00D4FF', brandPrimary][i % 5],
                animationDelay: `${Math.random() * 0.5}s`,
                animationDuration: `${2 + Math.random()}s`,
              }}
            />
          ))}
        </div>
      )}

      <GlowBorder useDarkTheme={useDarkText} className="shadow-2xl" autoRotate autoRotateSpeed={50} borderWidth={2}>
        <div className={`backdrop-blur-[10px] rounded-2xl shadow-2xl overflow-hidden ${panelBorder}`}>

          {/* Banner — brand primary background */}
          <div className="px-5 sm:px-6 pt-5 sm:pt-6 pb-4" style={{ backgroundColor: brandPrimary }}>
            <p className="text-xl sm:text-2xl font-bold text-white text-center">
              {discount.intro || discount.title}
            </p>
            {discount.value && (
              <p className="text-sm text-white/80 text-center mt-1">{discount.value}</p>
            )}
          </div>

          {/* Content — white-to-transparent gradient */}
          <div
            className="px-5 sm:px-6 py-6"
            style={{ background: 'linear-gradient(to bottom, rgba(255, 255, 255, 1) 0%, rgba(255, 255, 255, 0.15) 100%)' }}
          >
            {/* Ticket Details — signed-out users only */}
            {discount.ticket_details && !session && (
              <div className="mb-4 p-3 rounded-lg bg-white">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-400 mb-1">Ticket details</p>
                <p className="text-sm text-gray-900">{discount.ticket_details}</p>
              </div>
            )}

            {/* White action panel: code, form, or status */}
            {claimedCode ? (
              <div className="text-center">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-2">Your discount code</p>
                <div className="flex items-center justify-center gap-2 mb-4">
                  <code className="text-2xl font-bold text-gray-900 tracking-wider">{claimedCode}</code>
                  <button
                    onClick={handleCopy}
                    title={copied ? 'Copied!' : 'Copy code'}
                    className={`p-1.5 rounded-lg transition-all ${
                      copied
                        ? 'text-green-600 bg-green-50'
                        : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    {copied ? (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    )}
                  </button>
                </div>
                {event.event_link && (
                  <PortalButton
                    variant="primary"
                    primaryColor={brandPrimary}
                    glow
                    href={`${event.event_link}${event.event_link.includes('?') ? '&' : '?'}coupon=${claimedCode}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Get ticket
                  </PortalButton>
                )}
              </div>
            ) : isSoldOut ? (
              <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-center">
                <p className="text-sm font-medium text-red-700">
                  😔 All discount codes have been claimed
                </p>
              </div>
            ) : codePending && !session ? (
              <div className="mb-4 p-3 rounded-lg bg-white">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 flex-shrink-0 rounded-full flex items-center justify-center mt-0.5" style={{ backgroundColor: brandPrimary }}>
                    <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">Check your email to get your code</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Click the link we sent to {email} — your discount code will be revealed when you sign in.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit}>
                {error && (
                  <div className="mb-3 p-3 rounded-lg bg-red-50 border border-red-200">
                    <p className="text-xs text-red-700">{error}</p>
                  </div>
                )}
                {!session ? (
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="flex-1">
                      <GlowInput
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Enter your email"
                        required
                        glowColor={brandPrimary}
                        glowWhenFilled
                        borderRadius="0.5rem"
                        className="w-full text-sm px-4 py-3 border-[3px] rounded-lg bg-white text-gray-900 placeholder-gray-400 border-gray-300 focus:outline-none transition-colors"
                      />
                    </div>
                    <PortalButton
                      variant="primary"
                      primaryColor={brandPrimary}
                      glow
                      type="submit"
                      disabled={isClaiming}
                      className="sm:w-auto w-full"
                    >
                      {isClaiming ? 'Getting code...' : 'Get your code'}
                    </PortalButton>
                  </div>
                ) : (
                  <PortalButton
                    variant="primary"
                    primaryColor={brandPrimary}
                    glow
                    type="submit"
                    disabled={isClaiming}
                  >
                    {isClaiming ? 'Getting code...' : 'Get your discount code'}
                  </PortalButton>
                )}
              </form>
            )}

          </div>

        </div>
      </GlowBorder>

      <style jsx>{`
        @keyframes confetti {
          0% { transform: translateY(0) rotateZ(0deg); opacity: 1; }
          100% { transform: translateY(100vh) rotateZ(360deg); opacity: 0; }
        }
        .animate-confetti {
          animation: confetti 3s ease-out forwards;
        }
      `}</style>
    </div>
  )
}

export function DiscountsContent() {
  const { event, useDarkText, primaryColor, theme } = useEventContext()
  const [discounts, setDiscounts] = useState<DiscountWithCode[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    async function fetchDiscounts() {
      const supabase = getSupabaseClient()
      const { data } = await supabase
        .from('events_discounts')
        .select('*')
        .eq('event_id', event.event_id)
        .eq('status', 'active')
        .order('sort_order', { ascending: true })

      setDiscounts(data || [])
      setIsLoading(false)
    }
    fetchDiscounts()
  }, [event.event_id])

  const panelTheme = useMemo(() => ({
    panelBg: useDarkText ? 'bg-gray-900/15' : 'bg-white/15',
    panelBorder: useDarkText ? 'border border-gray-700/50' : 'border border-white/20',
    textColor: useDarkText ? 'text-gray-900' : 'text-white',
    textMuted: useDarkText ? 'text-gray-600' : 'text-white/70',
    cardBg: useDarkText ? 'bg-gray-900/10' : 'bg-white/10',
  }), [useDarkText])

  return (
    <div className={`transition-opacity duration-500 ease-out ${mounted ? 'opacity-100' : 'opacity-0'}`}>
      {/* Loading state */}
      <div className={`absolute inset-0 flex items-center justify-center transition-opacity duration-300 ${
        isLoading ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}>
        <div
          className="loader"
          style={{ '--primary-color': '#fff', '--secondary-color': primaryColor } as React.CSSProperties}
        />
      </div>

      {/* Content */}
      <div className={`transition-opacity duration-300 ${isLoading ? 'opacity-0' : 'opacity-100'}`}>
        {discounts.length === 0 && !isLoading ? (
          <GlowBorder useDarkTheme={useDarkText}>
            <div className={`${panelTheme.panelBg} backdrop-blur-[10px] rounded-2xl shadow-2xl overflow-hidden ${panelTheme.panelBorder} p-8`}>
              <div className="text-center py-4">
                <div className={`w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center ${panelTheme.cardBg}`}>
                  <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: theme.textMutedColor }}>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 010 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a2.999 2.999 0 010-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375z" />
                  </svg>
                </div>
                <h2 className={`text-xl font-semibold ${panelTheme.textColor} mb-2`}>No active discounts</h2>
                <p className={panelTheme.textMuted}>
                  Check back later for discount offers.
                </p>
              </div>
            </div>
          </GlowBorder>
        ) : (
          <div className="space-y-4">
            {discounts.map((discount, index) => (
              <DiscountCard key={discount.id} discount={discount} index={index} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
