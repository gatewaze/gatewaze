'use client'

import { ReactNode } from 'react'

interface Props {
  /** Main page title */
  title: string
  /** Optional subtitle/description */
  subtitle?: string
  /** Optional right-side content (e.g., action buttons) */
  actions?: ReactNode
  /** Additional class names */
  className?: string
}

/**
 * Page header component for portal pages.
 * Displays a large heading with optional subtitle and action buttons.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  className = '',
}: Props) {
  return (
    <div className={`mb-8 ${className}`}>
      {actions ? (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white">{title}</h1>
            {subtitle && (
              <p className="text-white/70 mt-1">{subtitle}</p>
            )}
          </div>
          <div className="flex gap-2 self-start sm:self-auto">
            {actions}
          </div>
        </div>
      ) : (
        <>
          <h1 className="text-2xl sm:text-3xl font-bold text-white">{title}</h1>
          {subtitle && (
            <p className="text-white/70 mt-1">{subtitle}</p>
          )}
        </>
      )}
    </div>
  )
}
