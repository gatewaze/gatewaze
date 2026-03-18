'use client'

import { useEffect, useState } from 'react'
import { PortalPageLayout } from '@/components/ui/PortalPageLayout'
import { PageHeader } from '@/components/ui/PageHeader'
import { GlassPanel } from '@/components/ui/GlassPanel'
import type { BrandConfig } from '@/config/brand'

interface CookieEntry {
  name: string
  purpose: string
  duration: string
  type: string
  description: string
  provider?: string
  firstParty: boolean
  verified: boolean
}

interface Category {
  label: string
  description: string
  cookies: CookieEntry[]
}

interface CookiePolicyData {
  version: string
  categories: Record<string, Category>
  thirdPartyServices: string[]
}

interface Props {
  brandConfig: BrandConfig
  brandId: string
}

export function CookiePolicyPageContent({ brandConfig }: Props) {
  const [data, setData] = useState<CookiePolicyData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/policies/cookie-policy.json')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load cookie policy')
        return res.json()
      })
      .then(setData)
      .catch(() => setError('Unable to load cookie policy. Please try again later.'))
      .finally(() => setIsLoading(false))
  }, [])

  const totalCookies = data
    ? Object.values(data.categories).reduce((sum, cat) => sum + cat.cookies.length, 0)
    : 0

  const brandName = brandConfig.name

  return (
    <PortalPageLayout>
      <PageHeader title="Cookie Policy" />

      <GlassPanel>
        {isLoading && (
          <div className="text-center py-8">
            <div
              className="loader"
              style={{
                '--primary-color': '#fff',
                '--secondary-color': brandConfig.primaryColor,
              } as React.CSSProperties}
            />
            <p className="mt-4 text-white/70">Loading cookie policy...</p>
          </div>
        )}

        {error && (
          <div className="text-center py-8">
            <h2 className="text-xl font-semibold text-white mb-2">Cookie Policy</h2>
            <p className="text-red-300">{error}</p>
          </div>
        )}

        {!isLoading && !error && data && (
          <div className="cookie-policy-portal">
            {/* Header */}
            <div className="cp-header">
              <p>
                <strong>Policy Version:</strong> {data.version}
              </p>
            </div>

            {/* Stats */}
            <div className="cp-stats">
              <div className="cp-stat-card">
                <div className="cp-stat-number">{totalCookies}</div>
                <div className="cp-stat-label">Total Cookies</div>
              </div>
              {Object.entries(data.categories)
                .filter(([, cat]) => cat.cookies.length > 0)
                .map(([key, cat]) => (
                  <div key={key} className="cp-stat-card">
                    <div className="cp-stat-number">{cat.cookies.length}</div>
                    <div className="cp-stat-label">{cat.label.replace(' Cookies', '')}</div>
                  </div>
                ))}
              {data.thirdPartyServices.length > 0 && (
                <div className="cp-stat-card">
                  <div className="cp-stat-number">{data.thirdPartyServices.length}</div>
                  <div className="cp-stat-label">Third-Party Services</div>
                </div>
              )}
            </div>

            {/* Overview */}
            <h2>Overview</h2>
            <p>
              This website uses {totalCookies} cookie{totalCookies !== 1 ? 's' : ''} to enhance your
              experience, provide essential functionality, and support ad conversion tracking. Below
              is a complete inventory of all cookies used on this site.
            </p>

            {/* Category sections */}
            {Object.entries(data.categories)
              .filter(([, cat]) => cat.cookies.length > 0)
              .map(([key, cat]) => (
                <div key={key} className="cp-category">
                  <h3 className="cp-category-title">
                    {cat.label} ({cat.cookies.length})
                  </h3>
                  <div className="cp-category-desc">
                    <strong>{cat.description.split('.')[0]}.</strong>
                    <br />
                    {cat.description.split('.').slice(1).join('.').trim()}
                  </div>

                  <table className="cp-table">
                    <thead>
                      <tr>
                        <th>Cookie Name</th>
                        <th>Purpose</th>
                        <th>Duration</th>
                        <th>Provider</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cat.cookies.map((cookie) => (
                        <tr key={cookie.name}>
                          <td>
                            <span className="cp-cookie-name">{cookie.name}</span>
                            {cookie.verified && (
                              <span className="cp-verified">Verified</span>
                            )}
                          </td>
                          <td>
                            {cookie.purpose}
                            <br />
                            <small>{cookie.description}</small>
                          </td>
                          <td>{cookie.duration}</td>
                          <td>
                            {cookie.firstParty ? brandName : cookie.provider}
                            <br />
                            <span className="cp-provider-type">{cookie.type}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}

            {/* Third-party services */}
            {data.thirdPartyServices.length > 0 && (
              <div className="cp-category">
                <h3>Third-Party Services</h3>
                <p>This website uses services from the following third-party providers:</p>
                <ul>
                  {data.thirdPartyServices.map((svc) => (
                    <li key={svc}>
                      <strong>{svc}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Managing preferences */}
            <div className="cp-category">
              <h3>Managing Your Cookie Preferences</h3>
              <p>You can manage your cookie preferences at any time by:</p>
              <ul>
                <li>Using our cookie consent banner when you first visit</li>
                <li>Clicking the cookie preferences icon in the bottom-left corner</li>
                <li>Adjusting your browser settings to block or delete cookies</li>
              </ul>
            </div>

            {/* Contact */}
            <div className="cp-category">
              <h3>Contact Information</h3>
              <p>
                If you have questions about our use of cookies, please see our{' '}
                <a href="/privacy">privacy policy</a> page.
              </p>
            </div>

            {/* Footer */}
            <footer className="cp-footer">
              <p>Cookie policy for {brandName}. Policy version {data.version}.</p>
            </footer>
          </div>
        )}
      </GlassPanel>

      <style jsx global>{`
        .cookie-policy-portal {
          color: rgba(255, 255, 255, 0.9);
        }
        .cookie-policy-portal h2 {
          color: white;
          font-size: 1.25rem;
          font-weight: 600;
          margin-top: 1.5rem;
          margin-bottom: 0.75rem;
        }
        .cookie-policy-portal h3 {
          color: white;
          font-size: 1.125rem;
          font-weight: 500;
          margin-top: 1rem;
          margin-bottom: 0.5rem;
        }
        .cookie-policy-portal p {
          margin-bottom: 1rem;
          line-height: 1.6;
          color: rgba(255, 255, 255, 0.9);
        }
        .cookie-policy-portal ul {
          margin-left: 1.5rem;
          margin-bottom: 1rem;
          color: rgba(255, 255, 255, 0.9);
        }
        .cookie-policy-portal li {
          margin-bottom: 0.5rem;
          list-style-type: disc;
        }
        .cookie-policy-portal strong {
          color: white;
        }
        .cookie-policy-portal a {
          color: ${brandConfig.primaryColor};
          text-decoration: underline;
        }
        .cookie-policy-portal a:hover {
          opacity: 0.8;
        }
        .cp-header {
          margin-bottom: 1rem;
        }
        .cp-header p {
          margin: 0.25rem 0;
          color: rgba(255, 255, 255, 0.7);
          font-size: 0.875rem;
        }
        .cp-stats {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap: 1rem;
          margin: 1.5rem 0;
        }
        .cp-stat-card {
          background: rgba(255, 255, 255, 0.1);
          padding: 1.25rem;
          border-radius: 0.75rem;
          text-align: center;
          border: 1px solid rgba(255, 255, 255, 0.15);
        }
        .cp-stat-number {
          font-size: 1.75rem;
          font-weight: 700;
          color: white;
        }
        .cp-stat-label {
          font-size: 0.75rem;
          color: rgba(255, 255, 255, 0.7);
          text-transform: uppercase;
          margin-top: 0.25rem;
        }
        .cp-category {
          margin: 2rem 0;
        }
        .cp-category-title {
          border-left: 4px solid ${brandConfig.primaryColor};
          padding-left: 1rem;
          margin-bottom: 1rem;
          font-size: 1.125rem;
          font-weight: 600;
        }
        .cp-category-desc {
          background: rgba(255, 255, 255, 0.05);
          padding: 1rem;
          border-radius: 0.5rem;
          margin-bottom: 1rem;
          border-left: 4px solid ${brandConfig.primaryColor};
          font-size: 0.9rem;
          color: rgba(255, 255, 255, 0.85);
        }
        .cp-table {
          width: 100%;
          border-collapse: collapse;
          margin: 1rem 0;
          font-size: 0.875rem;
          background: rgba(255, 255, 255, 0.03);
          border-radius: 0.5rem;
          overflow: hidden;
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .cp-table th {
          background: rgba(255, 255, 255, 0.1);
          color: white;
          font-weight: 600;
          text-align: left;
          padding: 0.875rem;
          border-bottom: 1px solid rgba(255, 255, 255, 0.15);
        }
        .cp-table td {
          padding: 0.875rem;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          vertical-align: top;
          color: rgba(255, 255, 255, 0.9);
        }
        .cp-table tr:last-child td {
          border-bottom: none;
        }
        .cp-table tr:hover td {
          background: rgba(255, 255, 255, 0.05);
        }
        .cp-table small {
          color: rgba(255, 255, 255, 0.6);
        }
        .cp-cookie-name {
          font-family: 'Monaco', 'Consolas', monospace;
          background: rgba(255, 255, 255, 0.1);
          padding: 0.25rem 0.5rem;
          border-radius: 0.25rem;
          font-weight: 500;
          font-size: 0.8rem;
          color: white;
        }
        .cp-verified {
          background: #10b981;
          color: white;
          font-size: 0.625rem;
          padding: 0.125rem 0.5rem;
          border-radius: 0.25rem;
          text-transform: uppercase;
          font-weight: 500;
          margin-left: 0.5rem;
        }
        .cp-provider-type {
          font-size: 0.75rem;
          color: rgba(255, 255, 255, 0.6);
          font-style: italic;
        }
        .cp-footer {
          margin-top: 2rem;
          padding-top: 1rem;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
        }
        .cp-footer p {
          font-size: 0.75rem;
          color: rgba(255, 255, 255, 0.5);
        }
        @media (max-width: 640px) {
          .cp-stats {
            grid-template-columns: repeat(2, 1fr);
          }
        }
      `}</style>
    </PortalPageLayout>
  )
}
