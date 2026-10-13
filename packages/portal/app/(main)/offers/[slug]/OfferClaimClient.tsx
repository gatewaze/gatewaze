'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import DOMPurify from 'isomorphic-dompurify'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { PortalButton } from '@/components/ui/PortalButton'
import { useAuth } from '@/hooks/useAuth'
import { getEmailFromParams } from '@/lib/emailEncoding'

export interface OfferLink {
  eventId: string
  eventTitle: string
  eventStart: string | null
  eventCity: string | null
  imageUrl: string | null
  label: string
  url: string
}

interface Props {
  slug: string
  title: string
  intro: string | null
  value: string | null
  content: string | null
  ticketDetails: string | null
  closeDisplay: string | null
  closeDate: string | null
  closed: boolean
  links: OfferLink[]
  primaryColor: string
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function formatDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

export function OfferClaimClient({
  slug, title, intro, content, ticketDetails, closeDisplay, closeDate, closed, links, primaryColor,
}: Props) {
  const searchParams = useSearchParams()
  const { session } = useAuth()

  // Who this is: the encoded address from the email link (?utm_medium= / ?e=),
  // then one captured earlier in this tab, then the signed-in member. Reading
  // it never claims anything; only the button below does.
  const [knownEmail, setKnownEmail] = useState<string | null>(null)
  const [typedEmail, setTypedEmail] = useState('')
  const [editing, setEditing] = useState(false)
  const [code, setCode] = useState<string | null>(null)
  const [claiming, setClaiming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let email: string | null = getEmailFromParams(new URLSearchParams(searchParams.toString()))
    if (email) {
      try { sessionStorage.setItem('prefill_email', email) } catch { /* storage blocked */ }
    } else {
      try { email = sessionStorage.getItem('prefill_email') } catch { email = null }
    }
    if (!email && session?.user?.email) email = session.user.email
    setKnownEmail(email && EMAIL_RE.test(email) ? email.toLowerCase() : null)
  }, [searchParams, session])

  const email = editing || !knownEmail ? typedEmail.trim().toLowerCase() : knownEmail

  const claim = async (e?: React.FormEvent) => {
    e?.preventDefault()
    setError(null)
    if (!EMAIL_RE.test(email)) {
      setError('Enter a valid email address')
      return
    }
    setClaiming(true)
    try {
      const res = await fetch(`/api/offers/${encodeURIComponent(slug)}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok && typeof body.code === 'string') {
        setCode(body.code)
        try { sessionStorage.setItem('prefill_email', email) } catch { /* storage blocked */ }
      } else {
        setError(typeof body.error === 'string' ? body.error : 'Something went wrong. Please try again.')
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setClaiming(false)
    }
  }

  const copy = async () => {
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard blocked */ }
  }

  const sanitizedContent = content
    ? DOMPurify.sanitize(content, {
        ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 's', 'a', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'blockquote'],
        ALLOWED_ATTR: ['href', 'target', 'rel'],
      })
    : null

  const closesOn = closeDisplay || formatDate(closeDate)

  return (
    // Centred in the viewport in normal flow, as the sign-in page does.
    <main className="min-h-screen relative z-10 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <GlassPanel padding="p-0" className="overflow-hidden">
          <div className="px-6 pt-6 pb-5 text-center" style={{ backgroundColor: primaryColor }}>
            <h1 className="text-2xl sm:text-3xl font-bold text-white">{title}</h1>
            {intro && <p className="mt-2 text-white/85">{intro}</p>}
          </div>

          <div className="bg-white px-6 py-6 space-y-6 text-gray-900">
            <ul className="grid gap-3 sm:grid-cols-2">
              {links.map((l) => (
                <li key={l.eventId} className="rounded-lg border border-gray-200 overflow-hidden">
                  {l.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={l.imageUrl} alt="" className="w-full aspect-[640/336] object-cover" loading="lazy" />
                  )}
                  <div className="p-3">
                    <p className="font-semibold leading-snug">{l.eventTitle}</p>
                    <p className="text-sm text-gray-500">
                      {[formatDate(l.eventStart), l.eventCity].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                </li>
              ))}
            </ul>

            {ticketDetails && (
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">Ticket details</p>
                <p className="text-sm">{ticketDetails}</p>
              </div>
            )}

            {sanitizedContent && (
              <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: sanitizedContent }} />
            )}

            {closed ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-center text-sm font-medium text-red-700">
                This offer has closed.
              </div>
            ) : code ? (
              <div className="space-y-5">
                <div className="text-center">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-2">Your discount code</p>
                  <div className="flex items-center justify-center gap-3">
                    <code className="text-2xl sm:text-3xl font-bold tracking-wider">{code}</code>
                    <button
                      type="button"
                      onClick={copy}
                      className="rounded-lg px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                    >
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <p className="mt-2 text-sm text-gray-500">
                    {links.length > 1 ? 'The same code works for every event below.' : 'Use it when you register.'}
                  </p>
                </div>

                <ol className="space-y-1 text-sm text-gray-700 list-decimal list-inside">
                  <li>Open the registration page for your event.</li>
                  <li>Choose your ticket and go to checkout.</li>
                  <li>Enter the code <span className="font-mono font-semibold">{code}</span> to apply the discount.</li>
                </ol>

                <div className="flex flex-col gap-3">
                  {links.map((l) => (
                    <PortalButton
                      key={l.eventId}
                      variant="primary"
                      primaryColor={primaryColor}
                      href={l.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full"
                    >
                      {l.label}
                    </PortalButton>
                  ))}
                </div>
              </div>
            ) : (
              <form onSubmit={claim} className="space-y-3">
                {knownEmail && !editing ? (
                  <p className="text-center text-sm text-gray-600">
                    Claiming as <span className="font-medium text-gray-900">{knownEmail}</span>.{' '}
                    <button
                      type="button"
                      className="underline hover:text-gray-900"
                      onClick={() => { setEditing(true); setTypedEmail('') }}
                    >
                      Not you?
                    </button>
                  </p>
                ) : (
                  <div>
                    <label htmlFor="offer-email" className="mb-1.5 block text-sm font-medium">
                      Your email address
                    </label>
                    {/* Solid field with explicit colours: the panel follows the
                        portal theme, and a translucent input disappeared into it. */}
                    <input
                      id="offer-email"
                      type="email"
                      required
                      autoComplete="email"
                      inputMode="email"
                      value={typedEmail}
                      onChange={(e) => setTypedEmail(e.target.value)}
                      placeholder="you@company.com"
                      className="w-full rounded-lg border-2 px-4 py-3 text-base outline-none focus:ring-2"
                      style={{ backgroundColor: '#ffffff', color: '#111827', borderColor: primaryColor }}
                    />
                  </div>
                )}
                <PortalButton
                  type="submit"
                  variant="primary"
                  primaryColor={primaryColor}
                  glow
                  isLoading={claiming}
                  disabled={claiming}
                  className="w-full"
                >
                  Get my code
                </PortalButton>
                {error && <p className="text-center text-sm text-red-600">{error}</p>}
              {(!knownEmail || editing) && (
                <p className="text-center text-xs text-gray-500">
                  Claiming creates a free account with this address and signs you up for event offers by email.
                  You can unsubscribe at any time.
                </p>
              )}
                {closesOn && <p className="text-center text-xs text-gray-500">Offer closes {closesOn}</p>}
              </form>
            )}
          </div>
        </GlassPanel>
      </div>
    </main>
  )
}
