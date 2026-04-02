'use client'

import { useState } from 'react'
import { submitPrivacyRequest, PrivacyRequestType } from '@/lib/privacyCompliance'
import { GlowInput } from '@/components/ui/GlowInput'
import { PortalButton } from '@/components/ui/PortalButton'

interface DataRightsRequestFormProps {
  brandEmail: string
  primaryColor?: string
}

export function DataRightsRequestForm({ brandEmail, primaryColor = '#3b82f6' }: DataRightsRequestFormProps) {
  const [email, setEmail] = useState('')
  const [requestType, setRequestType] = useState<PrivacyRequestType>('data_export')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)

  const requestTypeLabels: Record<PrivacyRequestType, string> = {
    data_export: 'Request a copy of my data (Data Export)',
    data_deletion: 'Delete my data (Right to Erasure)',
    data_correction: 'Correct my data (Right to Rectification)',
    consent_withdrawal: 'Withdraw my consent',
    data_portability: 'Transfer my data (Data Portability)',
    processing_restriction: 'Restrict processing of my data',
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setResult(null)

    try {
      const response = await submitPrivacyRequest(requestType, email)

      if (response.success) {
        setResult({
          success: true,
          message:
            response.message ||
            `Your ${requestTypeLabels[requestType].toLowerCase()} request has been submitted. We will process your request within 30 days and contact you at ${email}.`,
        })
        setEmail('')
      } else {
        setResult({
          success: false,
          message: response.error || 'Failed to submit request. Please try again or contact us directly.',
        })
      }
    } catch {
      setResult({
        success: false,
        message: `An error occurred. Please contact us directly at ${brandEmail}.`,
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div
      className="bg-white/5 p-6 rounded-xl backdrop-blur-sm"
      style={{ border: `1px solid ${primaryColor}40` }}
    >
      <h3 className="text-lg font-semibold text-white mb-2">Exercise Your Data Rights</h3>
      <p className="text-base text-white/70 mb-4">Use this form to submit a privacy request. We will respond within 30 days.</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="data-rights-email" className="block text-base font-medium text-white mb-2">
            Email Address
          </label>
          <GlowInput
            type="email"
            id="data-rights-email"
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

        <div>
          <label htmlFor="requestType" className="block text-base font-medium text-white mb-2">
            Request Type
          </label>
          <div className="relative">
            <select
              id="requestType"
              value={requestType}
              onChange={(e) => setRequestType(e.target.value as PrivacyRequestType)}
              className="w-full text-base px-4 py-2.5 border rounded-lg bg-white/10 text-white focus:outline-none transition-colors appearance-none cursor-pointer"
              style={{
                borderColor: `${primaryColor}40`,
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='white' stroke-width='2'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`,
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 0.75rem center',
                backgroundSize: '1.25rem',
              }}
            >
              {Object.entries(requestTypeLabels).map(([value, label]) => (
                <option key={value} value={value} className="bg-gray-800 text-white">
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <PortalButton
          type="submit"
          variant="primary"
          primaryColor={primaryColor}
          disabled={isSubmitting}
          isLoading={isSubmitting}
          className="w-full"
        >
          {isSubmitting ? 'Submitting...' : 'Submit request'}
        </PortalButton>
      </form>

      {result && (
        <div
          className={`mt-4 p-4 rounded-lg ${
            result.success
              ? 'text-white'
              : 'bg-red-500/20 border border-red-400/50 text-red-300'
          }`}
          style={result.success ? { backgroundColor: `${primaryColor}33`, border: `1px solid ${primaryColor}80` } : undefined}
        >
          {result.message}
        </div>
      )}

      <p className="mt-4 text-xs text-white/50">
        You can also submit requests by emailing{' '}
        <a href={`mailto:${brandEmail}`} className="hover:underline" style={{ color: primaryColor }}>
          {brandEmail}
        </a>
      </p>
    </div>
  )
}
