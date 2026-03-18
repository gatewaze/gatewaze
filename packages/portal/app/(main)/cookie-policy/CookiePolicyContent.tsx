'use client'

import { useEffect, useState } from 'react'

interface Props {
  brandId: string
}

export function CookiePolicyContent({ brandId }: Props) {
  const [policyHtml, setPolicyHtml] = useState<string | null>(null)
  const [policyStyles, setPolicyStyles] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadPolicy = async () => {
      try {
        // Determine which policy file to load based on brand
        const policyFile =
          brandId === 'mlops' ? '/policies/cookie-policy-mlops.html' : '/policies/cookie-policy.html'

        const response = await fetch(policyFile)
        if (!response.ok) {
          throw new Error('Failed to load cookie policy')
        }

        const html = await response.text()

        // Extract styles from head and body content
        const parser = new DOMParser()
        const doc = parser.parseFromString(html, 'text/html')

        // Get styles from the head
        const styleElements = doc.querySelectorAll('style')
        let styles = ''
        styleElements.forEach(style => {
          styles += style.innerHTML
        })

        // Scope the styles to our container to avoid conflicts
        const scopedStyles = styles.replace(/body\s*\{/g, '.cookie-policy-content {')

        setPolicyStyles(scopedStyles)
        setPolicyHtml(doc.body.innerHTML)
      } catch (err) {
        console.error('Error loading cookie policy:', err)
        setError('Unable to load cookie policy. Please try again later.')
      } finally {
        setIsLoading(false)
      }
    }

    loadPolicy()
  }, [brandId])

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6 text-center">
        <div className="text-gray-600">Loading cookie policy...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Cookie Policy</h1>
        <p className="text-red-600">{error}</p>
      </div>
    )
  }

  return (
    <>
      {/* Inject the policy styles */}
      {policyStyles && <style dangerouslySetInnerHTML={{ __html: policyStyles }} />}

      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        {policyHtml && (
          <div
            className="cookie-policy-content"
            dangerouslySetInnerHTML={{ __html: policyHtml }}
          />
        )}
      </div>
    </>
  )
}
